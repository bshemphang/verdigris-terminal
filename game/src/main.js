// VERDIGRIS TERMINAL - main.js: boot and the one loop.
// Fixed 60 Hz simulation feeding a render at the display rate.
// ?shot=combat|buy|plant|sniper with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
// ?roundsecs=N shortens the round clock for testing.
import * as THREE from 'three';
import { TICK, WEAPONS, GRENADES, ROUND_SECONDS, BUY_SECONDS, PLAYER } from './config.js';
import { createState, mulberry32, clamp, logEvent } from './state.js';
import { createMap, nearestWaypoint, SITES } from './map.js';
import { createMover, createBody, wishFrom, groundSpeed, createCombat, createGrenades, createRounds, smokeBlocks } from './sim.js';
import { createBots, resetBot, aliveCount, stepAllBots, nextSpectateTarget } from './ai.js';
import { makeTextures } from './textures.js';
import { createRender } from './renderer.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const roundSeconds = Number.parseInt(params.get('roundsecs') ?? String(ROUND_SECONDS), 10) || ROUND_SECONDS;

const random = mulberry32(seed * 31 + 7);
const botRandom = mulberry32(seed * 101 + 3);

const render = createRender();
const textures = makeTextures();
const map = createMap(render.scene, textures);
const state = createState();
const audio = createAudio();
const mover = createMover(map.colliders, map.heightAt);
const camera = render.camera;

// ---- the player: one actor among AURORA ----
const playerBody = createBody(map.spawns.aurora[0].x, map.spawns.aurora[0].z, 0);
const playerActor = {
  id: 'player', name: 'You', team: 'aurora', isPlayer: true, body: playerBody,
  health: 100, armor: 0, helmet: false, hasKit: false, alive: true,
  money: 800, kills: 0, deaths: 0, weaponId: 'vesper',
  owned: new Set(['karambit', 'vesper']), grenadesOf: { smoke: 0, flash: 0, frag: 0 },
};
state.playerActor = playerActor;

const bots = createBots(render.scene, map, mover, (team) => render.makeOperator(team));
state.members = {
  aurora: bots.filter((b) => b.team === 'aurora'),
  meridian: bots.filter((b) => b.team === 'meridian'),
};
const combat = createCombat(map, state, audio);
combat.actors.push(playerActor, ...bots);
const grenades = createGrenades();

// ---- weapon state (per owned weapon: mag + reserve) ----
const mags = {};
function refillWeapon(id) { mags[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve }; }
for (const id of ['karambit', 'vesper']) refillWeapon(id);
let fireTimer = 0, reloadTimer = 0, bloom = 0;
let scoped = false, scopeZoom = 1;
let blindUntil = 0, flashOverlay = null;

const weapons = {
  def: () => WEAPONS[playerActor.weaponId],
  current: () => playerActor.weaponId,
  state: () => mags[playerActor.weaponId] || { mag: 0, reserve: 0 },
  ready: () => fireTimer <= 0 && reloadTimer <= 0,
  equip(id) {
    if (!playerActor.owned.has(id)) return false;
    playerActor.weaponId = id;
    if (!mags[id]) refillWeapon(id);
    render.equip(id);
    scoped = false; render.setFov(78); hud.showScope(false);
    fireTimer = 0.25; reloadTimer = 0;
    return true;
  },
  give(id) { if (!mags[id]) refillWeapon(id); playerActor.owned.add(id); playerActor.weaponId = id; render.equip(id); },
  fire() {
    const def = WEAPONS[playerActor.weaponId];
    if (reloadTimer > 0 || fireTimer > 0) return null;
    const m = mags[playerActor.weaponId];
    if (def.melee) { fireTimer = def.fireGap; return def; }
    if (m.mag <= 0) return null;
    m.mag -= 1;
    fireTimer = def.fireGap;
    bloom = Math.min(0.05, bloom + def.bloom);
    return def;
  },
  reload() {
    const def = WEAPONS[playerActor.weaponId];
    const m = mags[playerActor.weaponId];
    if (def.melee || m.reserve <= 0 || m.mag >= def.mag || reloadTimer > 0) return false;
    reloadTimer = def.reloadTime;
    render.reloadTilt();
    return true;
  },
  step(dt) {
    fireTimer = Math.max(0, fireTimer - dt);
    bloom = Math.max(0, bloom - dt * 0.03);
    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        const def = WEAPONS[playerActor.weaponId];
        const m = mags[playerActor.weaponId];
        const need = def.mag - m.mag;
        const take = Math.min(need, m.reserve);
        m.mag += take; m.reserve -= take;
      }
    }
  },
  spread(speed, airborne) {
    const def = WEAPONS[playerActor.weaponId];
    let s = def.spreadStill + bloom + (speed / 6) * def.spreadMove;
    if (airborne) s += 0.03;
    if (playerBody.crouch) s *= 0.6;
    if (scoped) s *= 0.25;
    return s;
  },
};

// ---- input ----
const input = { keys: new Set(), firing: false, lookX: 0, lookY: 0, queue: [] };
let started = false, frozen = false;
let plantingBot = null, defusingBot = null;
let spectateTarget = null;

const hud = createHud({
  onBuy: (itemId) => {
    const result = rounds.buy(playerActor, itemId);
    if (result.ok) {
      audio.buy();
      if (WEAPONS[itemId]) weapons.equip(itemId);
      hud.renderBuy(playerActor.money);
    } else {
      audio.denied();
      hud.showBanner('Cannot buy', result.reason, 1500);
    }
    syncHud();
  },
});

const rounds = createRounds(state, {
  resetActors,
  onRoundStart(round) {
    if (shot) return;
    if (round === 1) { hud.showBuy(true, playerActor.money); document.exitPointerLock?.(); }
    else hud.showBanner(`Round ${round} - buy phase`, 'Press B to open the shop', 2200);
    syncHud();
  },
  onLive() { hud.showBuy(false); hud.showBanner('Round live', 'Plant the charge or eliminate MERIDIAN', 2200); },
  onRoundEnd(winnerTeam, reason) {
    if (winnerTeam === 'aurora') audio.roundWin(); else audio.roundLose();
    hud.showBuy(false);
    hud.showBanner(winnerTeam === 'aurora' ? `AURORA takes round ${state.round}` : `MERIDIAN takes round ${state.round}`, reason, 3600);
    logEvent(state, 'win', winnerTeam === 'aurora' ? 'AURORA wins the round' : 'MERIDIAN wins the round');
    syncHud();
  },
  onMatchEnd(winner) {
    if (document.pointerLockElement) document.exitPointerLock();
    if (winner === 'draw') hud.showOverlay('matchEnd', { title: 'Match drawn', copy: `Nine rounds, ${state.score.aurora} - ${state.score.meridian}. Neither squad broke the tie.` });
    else if (winner === 'aurora') hud.showOverlay('matchEnd', { title: 'AURORA wins the match', copy: `${state.score.aurora} - ${state.score.meridian} over ${state.round} rounds. The terminal is yours.` });
    else hud.showOverlay('matchEnd', { title: 'MERIDIAN wins the match', copy: `${state.score.aurora} - ${state.score.meridian} over ${state.round} rounds. The charge never went off.` });
  },
  onPlant(site) {
    audio.plantBeep(true);
    hud.showBanner('Charge planted', `Site ${site} - ${state.fuseTime | 0}s to detonation`, 3000);
    hud.showRadio('RADIO: Charge planted - defend the site');
    document.getElementById('objective').textContent = 'Defend the planted charge';
  },
  onDetonate() { audio.explosion(); document.getElementById('objective').textContent = 'Plant the charge at Site A or Site B'; },
  onDefuse() { audio.defuseBeep(); hud.showBanner('Charge defused', 'MERIDIAN holds the terminal', 2600); },
  giveWeapon(itemId) { weapons.give(itemId); },
});

hud.onPlay(() => {
  audio.unlock();
  started = true;
  if (shot) return;
  if (state.phase === 'menu' || state.phase === 'matchEnd') {
    hud.hideOverlay();
    rounds.startMatch();
  } else {
    hud.hideOverlay();
    requestLock();
  }
});

function requestLock() {
  try { render.renderer.domElement.requestPointerLock(); } catch { /* headless: look still works via __game.look */ }
}
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    if (state.phase === 'buy') hud.showBuy(false);
  } else if (started && state.phase === 'live' && playerActor.alive) {
    hud.showOverlay('paused', {});
  }
}
document.addEventListener('pointerlockchange', () => onLockChange(!!document.pointerLockElement));
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  input.lookX += e.movementX; input.lookY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (!started || shot) return;
  if (!document.pointerLockElement && state.phase === 'live' && playerActor.alive) { requestLock(); return; }
  if (e.button === 0) {
    if (!playerActor.alive) { spectateTarget = nextSpectateTarget(state, bots); return; }
    input.firing = true;
  }
  if (e.button === 2 && playerActor.weaponId === 'longbow' && playerActor.alive) {
    scoped = !scoped;
    render.setFov(scoped ? (scopeZoom === 2 ? 16 : 30) : 78);
    hud.showScope(scoped);
    hud.setScopeZoom(scopeZoom);
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) input.firing = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', () => {
  if (scoped) { scopeZoom = scopeZoom === 1 ? 2 : 1; render.setFov(scopeZoom === 2 ? 16 : 30); hud.setScopeZoom(scopeZoom); }
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  input.keys.add(e.code);
  input.queue.push(e.code);
});
document.addEventListener('keyup', (e) => input.keys.delete(e.code));

function resetActors() {
  state.members.aurora.forEach((bot, i) => {
    const wid = bot.money >= 4500 && i === 0 ? 'longbow' : bot.money >= 2700 ? 'sovereign' : bot.money >= 1250 ? 'kestrel' : 'vesper';
    resetBot(bot, map.spawns.aurora[i + 1], wid, botRandom);
    bot.money = bot.money; // keep economy across rounds
  });
  state.members.meridian.forEach((bot, i) => {
    const wid = i === 2 ? 'longbow' : bot.money >= 2700 ? 'sovereign' : bot.money >= 1250 ? 'kestrel' : 'vesper';
    resetBot(bot, map.spawns.meridian[i], wid, botRandom);
  });
  const spawn = map.spawns.aurora[0];
  playerBody.position.set(spawn.x, 0, spawn.z);
  playerBody.velocity.set(0, 0, 0);
  playerBody.yaw = spawn.yaw; playerBody.pitch = 0; playerBody.eye = PLAYER.eye;
  playerActor.health = 100; playerActor.armor = 0; playerActor.helmet = false;
  playerActor.hasKit = false; playerActor.alive = true;
  playerActor.grenadesOf = { smoke: 0, flash: 0, frag: 0 };
  playerActor.owned = new Set(['karambit', 'vesper']);
  for (const id of ['karambit', 'vesper']) refillWeapon(id);
  weapons.equip('vesper');
  grenades.clear();
  plantingBot = null; defusingBot = null; spectateTarget = null;
  state.shotNoise.length = 0; state.smokes.length = 0;
  document.getElementById('objective').textContent = 'Plant the charge at Site A or Site B';
  syncCamera();
}

function syncCamera() {
  if (!playerActor.alive && spectateTarget) {
    const b = spectateTarget.body;
    camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
    camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
}

function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return key;
  }
  return null;
}
function carrierName() {
  if (state.carrier === 'player') return 'Charge: YOU - hold E in a site to plant';
  if (!state.carrier) return 'Charge: dropped';
  const bot = bots.find((b) => b.id === state.carrier);
  return bot ? `Charge: ${bot.name}` : 'Charge: -';
}

function syncHud() {
  hud.setHealth(playerActor.health, playerActor.armor);
  const w = weapons.state();
  hud.setAmmo(w.mag, w.reserve, weapons.def().name);
  hud.setMoney(playerActor.money);
  hud.setCarrier(state.planted ? `Charge live at Site ${state.plantSite}` : carrierName());
  if (state.phase === 'buy') hud.setTimer(state.buyTime, false);
  else if (state.planted) hud.setTimer(state.fuseTime, true);
  else hud.setTimer(state.roundTime, false);
  hud.setScore(state.score.aurora, state.score.meridian, state.round);
  const atkAlive = aliveCount(bots, 'aurora') + (playerActor.alive ? 1 : 0);
  hud.setAlive(atkAlive, 5, aliveCount(bots, 'meridian'), 5);
  hud.feedEvents(state.events);
  hud.setCrosshairSpread(Math.min(40, Math.max(2, weapons.spread(groundSpeed(playerBody), !playerBody.onGround) * 800)));
  const primary = [...playerActor.owned].find((id) => WEAPONS[id].slot === 3);
  hud.setStrip(playerActor.weaponId, { primary: primary ? WEAPONS[primary].short : null, primaryId: primary }, playerActor.grenadesOf);
  hud.drawRadar(playerActor, bots, map, state);
  hud.setPlantTimer(state.planted ? `DETONATION ${Math.max(0, state.fuseTime).toFixed(1)}s` : '');
}

const _wish = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();

function playerShoot() {
  const def = weapons.fire();
  if (!def) {
    if (weapons.state().mag === 0 && weapons.reload()) audio.reload();
    else if (weapons.state().mag === 0) audio.dryClick();
    return;
  }
  camera.getWorldDirection(_dir);
  _eye.copy(camera.position);
  if (def.melee) {
    const result = combat.fireShot(playerActor, def, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, 0, random, playerActor);
    audio.shot('karambit');
    if (result.hit) hud.hitMarker(result.killed, false);
    syncHud();
    return;
  }
  const result = combat.fireShot(playerActor, def, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, weapons.spread(groundSpeed(playerBody), !playerBody.onGround), random, playerActor);
  playerBody.pitch = Math.min(1.45, playerBody.pitch + def.recoil * (0.8 + random() * 0.4));
  playerBody.yaw += (random() * 2 - 1) * 0.004;
  render.fireKick(def.recoil);
  render.flashMuzzle(state.time);
  audio.shot(playerActor.weaponId);
  // Muzzle -> impact tracer + casing + impact sparks/decal.
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  render.spawnCasing(_eye, _right);
  // Tracer starts at the gun's muzzle (offset from the eye), not on the view
  // axis: a tracer spawned on the view axis is seen end-on as a big square
  // over the crosshair. From the muzzle it reads as a diagonal streak.
  camera.updateMatrixWorld();
  const muzzlePos = camera.localToWorld(new THREE.Vector3(0.28, -0.26, -0.87));
  if (result.point) {
    render.spawnTracer(muzzlePos, new THREE.Vector3(result.point[0], result.point[1], result.point[2]), def.tracer);
    if (!result.hit) { render.spawnSparks(result.point, 5); render.spawnDecal(result.point, [0, 0, 1]); }
  }
  state.shotNoise.push({ x: playerBody.position.x, z: playerBody.position.z, radius: 26, at: state.time });
  if (state.shotNoise.length > 32) state.shotNoise.splice(0, state.shotNoise.length - 32);
  if (result.hit) {
    if (result.zone === 'head') audio.headshotDink(); else audio.hit();
    if (result.killed) audio.kill();
    hud.hitMarker(result.killed, result.zone === 'head');
  }
  syncHud();
}

function botFireShot(bot, target) {
  const def = WEAPONS[bot.weaponId];
  if (bot.mag <= 0 || bot.cooldown > 0) return;
  bot.mag -= 1;
  bot.cooldown = def.fireGap;
  _eye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
  _dir.set(target.body.position.x - _eye.x, target.body.position.y + 1.15 - _eye.y, target.body.position.z - _eye.z).normalize();
  _dir.x += (botRandom() * 2 - 1) * 0.042;
  _dir.y += (botRandom() * 2 - 1) * 0.042;
  _dir.z += (botRandom() * 2 - 1) * 0.042;
  _dir.normalize();
  const result = combat.fireShot(bot, def, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, 0, botRandom, playerActor);
  state.shotNoise.push({ x: bot.body.position.x, z: bot.body.position.z, radius: 26, at: state.time });
  if (state.shotNoise.length > 32) state.shotNoise.splice(0, state.shotNoise.length - 32);
  if (result.point) {
    render.spawnTracer(new THREE.Vector3(_eye.x, _eye.y, _eye.z), new THREE.Vector3(result.point[0], result.point[1], result.point[2]), def.tracer);
    if (!result.hit) render.spawnSparks(result.point, 3);
  }
  const dist = bot.body.position.distanceTo(playerBody.position);
  if (dist < 42) audio.distantShot();
  if (result.hit && result.victim === playerActor) {
    audio.hurt();
    hud.hurtFlash();
    if (!playerActor.alive) onPlayerDown();
  }
  syncHud();
}

function onPlayerDown() {
  playerActor.deaths += 1;
  spectateTarget = nextSpectateTarget(state, bots);
  hud.showBanner('You are down', spectateTarget ? `Spectating ${spectateTarget.name} - click to cycle` : 'Your squad fights on', 2600);
  if (document.pointerLockElement) document.exitPointerLock();
}

function throwGrenade(type) {
  if ((playerActor.grenadesOf[type] || 0) <= 0 || state.phase !== 'live' || !playerActor.alive) return;
  playerActor.grenadesOf[type] -= 1;
  camera.getWorldDirection(_dir);
  _eye.copy(camera.position).addScaledVector(_dir, 0.5);
  grenades.throwFrom(type, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z);
  audio.grenadeThrow();
  syncHud();
}

function handleKey(code) {
  if (code === 'KeyB') {
    if (state.phase !== 'buy') return;
    if (hud.buyOpen()) { hud.showBuy(false); requestLock(); }
    else { hud.showBuy(true, playerActor.money); if (document.pointerLockElement) document.exitPointerLock(); }
    return;
  }
  if (hud.buyOpen()) return; // buy menu buttons handle purchases
  if (code === 'Digit1') weapons.equip('karambit');
  else if (code === 'Digit2') weapons.equip('vesper');
  else if (code === 'Digit3') {
    const primary = [...playerActor.owned].find((id) => WEAPONS[id].slot === 3);
    if (primary) weapons.equip(primary);
  } else if (code === 'Digit4') throwGrenade('smoke');
  else if (code === 'Digit5') throwGrenade('flash');
  else if (code === 'Digit6') throwGrenade('frag');
  else if (code === 'KeyG') {
    if (playerActor.grenadesOf.smoke > 0) throwGrenade('smoke');
    else if (playerActor.grenadesOf.flash > 0) throwGrenade('flash');
    else throwGrenade('frag');
  } else if (code === 'KeyR') { if (weapons.reload()) audio.reload(); }
  else if (code === 'KeyQ' && !playerActor.alive) spectateTarget = nextSpectateTarget(state, bots);
}

const botCtx = {
  dt: TICK, time: 0, random: botRandom, state, map, mover,
  segmentBlocked: (ax, ay, az, bx, by, bz) => map.segmentBlocked(ax, ay, az, bx, by, bz),
  actors: [playerActor, ...bots],
  fireShot: botFireShot,
  plantStart(bot) { plantingBot = bot; logEvent(state, 'info', `${bot.name} is planting the charge`); },
  plantComplete(bot) {
    plantingBot = null;
    const site = siteAt(bot.body.position.x, bot.body.position.z);
    if (site) rounds.plantCharge(site, bot.name, bot.body.position.x, bot.body.position.z);
  },
  defuseStart(bot) { defusingBot = bot; logEvent(state, 'info', `${bot.name} is defusing the charge`); },
  defuseComplete(bot) { defusingBot = null; rounds.defuseCharge(bot.name); },
};

function step(dt) {
  state.time += dt;
  botCtx.dt = dt; botCtx.time = state.time;
  for (const code of input.queue.splice(0)) handleKey(code);

  const lookX = input.lookX, lookY = input.lookY;
  input.lookX = 0; input.lookY = 0;
  playerBody.yaw -= lookX * 0.0022;
  playerBody.pitch = clamp(playerBody.pitch - lookY * 0.0022, -1.45, 1.45);

  const keys = input.keys;
  const inGame = playerActor.alive && (state.phase === 'live' || state.phase === 'buy');
  if (inGame) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wishFrom(playerBody.yaw, forward, strafe, _wish);
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = weapons.def().moveSpeed * (walk ? 0.5 : 1);
    mover.step(playerBody, dt, _wish.x, _wish.z, speed, crouch, keys.has('Space'));
    if (state.phase === 'live' && input.firing && weapons.ready()) playerShoot();
    // Footsteps: audible unless Shift-walking.
    if (groundSpeed(playerBody) > 2 && state.time % 0.45 < dt) audio.footstep(walk);
  }
  weapons.step(dt);

  // Grenades fly and detonate during live play.
  if (state.phase === 'live') {
    for (const ev of grenades.step(dt, map, state)) {
      if (ev.type === 'smoke') {
        state.smokes.push({ x: ev.x, y: ev.y + 0.6, z: ev.z, r: GRENADES.smoke.radius, until: state.time + GRENADES.smoke.life });
        render.spawnSmoke(ev.x, ev.y + 0.6, ev.z, GRENADES.smoke.radius);
        audio.smokeHiss();
        logEvent(state, 'info', 'Smoke deployed');
      } else if (ev.type === 'flash') {
        audio.flashRing();
        // Blind the player if facing the pop with clear LOS.
        camera.getWorldDirection(_dir);
        _eye.copy(camera.position);
        const dx = ev.x - _eye.x, dy = ev.y - _eye.y, dz = ev.z - _eye.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const facing = (dx * _dir.x + dy * _dir.y + dz * _dir.z) / d;
        if (facing > 0.2 && d < 16 && !map.segmentBlocked(_eye.x, _eye.y, _eye.z, ev.x, ev.y, ev.z)) {
          blindUntil = state.time + 2.5 * facing;
        }
        for (const b of bots) {
          if (!b.alive) continue;
          const bdx = ev.x - b.body.position.x, bdz = ev.z - b.body.position.z;
          const bd = Math.hypot(bdx, bdz);
          if (bd < 14) { b.pauseUntil = Math.max(b.pauseUntil, state.time + 2); b.target = null; }
        }
      } else if (ev.type === 'frag') {
        audio.explosion();
        combat.explode(ev.x, ev.y, ev.z, playerActor);
        render.spawnSparks([ev.x, ev.y, ev.z], 10);
      }
    }
  }

  // Bots play whenever a round is running; they hold fire during the buy phase.
  if (state.phase === 'live' || state.phase === 'buy' || state.phase === 'roundEnd') {
    stepAllBots(botCtx, bots, dt);
  }
  // Any death (bot shot, frag, fall) switches the player to the spectator camera.
  if (!playerActor.alive && spectateTarget === null && (state.phase === 'live' || state.phase === 'roundEnd')) onPlayerDown();

  // Plant / defuse progress, for the player and for whichever bot is working.
  const site = siteAt(playerBody.position.x, playerBody.position.z);
  const planting = keys.has('KeyE') && !state.planted && state.carrier === 'player' && site !== null && playerActor.alive && state.phase === 'live';
  const defusing = keys.has('KeyE') && state.planted && site === state.plantSite && playerActor.alive && state.phase === 'live';
  rounds.step(dt, { planting, defusing, site, px: playerBody.position.x, pz: playerBody.position.z });
  if (planting) hud.setProgress('Planting the charge', state.plantProgress);
  else if (defusing) hud.setProgress('Defusing the charge', state.defuseProgress);
  else if (plantingBot) hud.setProgress(`${plantingBot.name} is planting`, 1 - plantingBot.plantLeft / 3);
  else if (defusingBot) hud.setProgress(`${defusingBot.name} is defusing`, 1 - defusingBot.defuseLeft / 5);
  else hud.hideProgress();

  syncCamera();
  syncHud();
}

let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= TICK && steps < 5) { step(TICK); accumulator -= TICK; steps += 1; }
    if (accumulator > TICK * 5) accumulator = 0;
  }
  const blind = state.time < blindUntil ? Math.min(1, (blindUntil - state.time) * 1.5) : 0;
  if (flashOverlay) flashOverlay.style.opacity = String(blind * 0.9);
  render.step(dt, state, state.time, playerBody, bots, { ads: scoped, scoped });
  render.renderer.render(render.scene, camera);
}

function settle(ticks) {
  for (let i = 0; i < ticks; i += 1) { step(TICK); render.step(TICK, state, state.time, playerBody, bots, { ads: false, scoped: false }); }
}

function aimAt(point) {
  const dx = point.x - playerBody.position.x;
  const dy = point.y - (playerBody.position.y + playerBody.eye);
  const dz = point.z - playerBody.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerBody.yaw = Math.atan2(-dx, -dz);
  playerBody.pitch = Math.asin(clamp(dy / length, -1, 1));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    render.step(0, state, state.time, playerBody, bots, { ads: scoped, scoped });
    render.renderer.render(render.scene, camera);
    painted += 1;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  flashOverlay = document.getElementById('flash');
  if (name === 'buy') {
    rounds.startMatch();
    playerBody.position.set(0, 0, 24);
    playerBody.yaw = 0; playerBody.pitch = 0;
    playerActor.money = 8000;
    syncCamera();
    hud.showBuy(true, playerActor.money);
    syncHud();
    paintTwiceThenReady();
    return;
  }
  if (name === 'combat') {
    rounds.startMatch();
    state.phase = 'live';
    state.roundTime = roundSeconds;
    weapons.give('sovereign');
    // Smoke first so it grows to full size during the settle (render.step grows
    // the cloud each tick; a cloud spawned after the settle stays a small puff).
    // Kept small (r 3.5) and west of the line of fire: a bigger cloud eats the
    // player's shot (smokeBlocks) and hides the sign and the target.
    state.smokes.push({ x: -27, y: 1, z: -6, r: 3.5, until: state.time + 16 });
    render.spawnSmoke(-27, 1, -6, 3.5);
    settle(300);
    // Stage the fight in the sunlit Conservatory: the SITE A sign reads fully
    // above the lane, a MERIDIAN defender stands in the line of fire before the
    // fountain, another at the A door, smoke drifting across the lane. The first
    // defender is softened so this shot kills: the killfeed and hitmarker show.
    const defenders = bots.filter((b) => b.team === 'meridian' && b.alive);
    if (defenders[0]) {
      defenders[0].body.position.set(-23, 0, -11);
      defenders[0].group.position.set(-23, 0, -11);
      defenders[0].body.yaw = Math.PI * 0.75;
      defenders[0].group.rotation.y = defenders[0].body.yaw;
      defenders[0].health = 30;
    }
    if (defenders[1]) {
      defenders[1].body.position.set(-18, 0, -8);
      defenders[1].group.position.set(-18, 0, -8);
      defenders[1].body.yaw = Math.PI * 0.6;
      defenders[1].group.rotation.y = defenders[1].body.yaw;
    }
    playerBody.position.set(-15, 0, -1);
    settle(6);
    const target = defenders[0];
    // Aim at the head: a headshot kill puts "You ⌖ <name>" in the feed.
    aimAt(new THREE.Vector3(target.body.position.x, target.body.position.y + 1.52, target.body.position.z));
    playerShoot();
    // Muzzle flash at the gun's muzzle (bottom-right of the frame), not along
    // the view axis: sparks on the view axis land dead-center and read as a
    // glitch square over the crosshair. Impact burst on the enemy's head.
    camera.updateMatrixWorld();
    const muzzle = camera.localToWorld(new THREE.Vector3(0.28, -0.26, -0.87));
    render.spawnSparks([muzzle.x, muzzle.y, muzzle.z], 4);
    render.spawnSparks([target.body.position.x, target.body.position.y + 1.52, target.body.position.z], 6);
    // A lateral enemy tracer across the open court, east of the smoke so it
    // stays visible, so the frame reads as a firefight, not a posed shot.
    render.spawnTracer(new THREE.Vector3(-22, 1.3, -10), new THREE.Vector3(-16, 1.3, -14), 0x9fd8ff);
    hud.showRadio('RADIO: Contact at Site A, engaging', true);
    // Pin the hitmarker on (sticky: no wall-clock timeout) so it survives the
    // slow SwiftShader capture frames.
    hud.hitMarker(true, true, true);
    syncHud();
    paintTwiceThenReady();
    return;
  }
  if (name === 'plant') {
    rounds.startMatch();
    state.phase = 'live';
    state.roundTime = roundSeconds;
    settle(300);
    // (Re-)plant at the staged spot even if a bot planted during the settle:
    // the capture needs the charge in the open court, not wherever a bot stood.
    rounds.plantCharge('B', 'Ember', 24, -13);
    // Charge in the open court south of the parked tram (not inside the tram car),
    // player south-west of it with the tram's flank and the B planters in view,
    // teammate covering the site.
    playerBody.position.set(21, -1.2, -8);
    const defender = bots.find((b) => b.team === 'aurora' && b.alive);
    if (defender) {
      defender.body.position.set(26, -1.2, -9);
      defender.group.position.set(26, -1.2, -9);
      defender.body.yaw = Math.PI;
      defender.group.rotation.y = Math.PI;
    }
    aimAt(new THREE.Vector3(25, -0.5, -14));
    settle(4);
    paintTwiceThenReady();
    return;
  }
  // sniper: Longbow-M2 scoped down the Mid colonnade.
  rounds.startMatch();
  state.phase = 'live';
  state.roundTime = roundSeconds;
  weapons.give('longbow');
  settle(240);
  // Stage three MERIDIAN defenders in staggered tactical stances down the Mid
  // colonnade: one crouched behind cover, one peeking, one moving.
  const mids = bots.filter((b) => b.team === 'meridian');
  const stage = [[-3, -14, 1], [3, -16, 2], [0, -22, 0]];
  mids.slice(0, 3).forEach((bot, i) => {
    const [sx, sz, stance] = stage[i];
    bot.alive = true; bot.health = 100;
    bot.body.position.set(sx, 0, sz);
    bot.group.position.set(sx, 0, sz);
    bot.body.yaw = Math.PI;
    bot.group.rotation.y = Math.PI;
    bot.group.userData.stance = stance;
  });
  // North of the Mid vent lintel (it would fill a scoped frame from the south):
  // the colonnade, skylight trusses and planters run away to the north.
  playerBody.position.set(0, 0, 6);
  playerBody.yaw = 0; playerBody.pitch = 0.01;
  scoped = true; scopeZoom = 1;
  render.setFov(30);
  hud.showScope(true);
  hud.setScopeZoom(1);
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

// Debug handle for play-testing: state, actors and input, nothing more.
window.__game = {
  state, playerActor, bots, weapons, rounds, input, map, grenades, combat, render,
  look(dx, dy) { playerBody.yaw -= dx * 0.0022; playerBody.pitch = clamp(playerBody.pitch - dy * 0.0022, -1.45, 1.45); },
  aimAt(x, y, z) { aimAt(new THREE.Vector3(x, y, z)); },
  buy(item) { return rounds.buy(playerActor, item); },
  teleport(x, z) { playerBody.position.set(x, map.heightAt(x, z), z); },
};
flashOverlay = document.getElementById('flash');

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('menu', {});
  requestAnimationFrame(frame);
}
