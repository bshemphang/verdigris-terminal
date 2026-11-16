// VERDIGRIS TERMINAL — ai.js: 5v5 bots on the nav-graph.
// State machine: BUY -> ADVANCE / HOLD_ANGLE -> ENGAGE (burst fire, counter-strafe
// and crouch peeks, reaction delay, smoke occlusion) -> INVESTIGATE_SOUND ->
// ROTATE (on plant / callouts) -> PLANT / DEFUSE. Spectator cycling lives here too.
import * as THREE from 'three';
import { BOT, WEAPONS } from './config.js';
import { nearestWaypoint, findPath } from './map.js';
import { wishFrom, groundSpeed } from './sim.js';
import { smokeBlocks } from './sim.js';
import { logEvent } from './state.js';

const AURORA_NAMES = ['Ember', 'Sable', 'Cinder', 'Flint'];
const MERIDIAN_NAMES = ['Vesper', 'Cobalt', 'Tide', 'Marble', 'Quartz'];

const _wish = new THREE.Vector3();
const _to = new THREE.Vector3();

export function createBots(scene, map, mover, makeOperator) {
  const bots = [];
  function addBot(team, name, i) {
    const body = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, eye: 1.62, crouch: false, onGround: true, vy: 0 };
    const group = makeOperator(team);
    scene.add(group);
    const bot = {
      id: `bot-${team}-${i}`, name, team, body, group,
      health: BOT.health, armor: 0, helmet: false, alive: true,
      money: 800, weaponId: 'vesper', mag: 15, cooldown: 0,
      state: 'BUY', path: [], pathIdx: 0, targetSite: team === 'aurora' ? 'A' : null,
      holdUntil: 0, reactAt: 0, target: null, burstLeft: 0, pauseUntil: 0,
      plantLeft: 0, defuseLeft: 0, strafeDir: 1, strafeUntil: 0, lastNoise: null,
      kills: 0, deaths: 0, owned: new Set(['vesper', 'karambit']),
    };
    bots.push(bot);
    return bot;
  }
  AURORA_NAMES.forEach((n, i) => addBot('aurora', n, i));
  MERIDIAN_NAMES.forEach((n, i) => addBot('meridian', n, i));
  return bots;
}

export function resetBot(bot, spawn, weaponId, random) {
  bot.body.position.set(spawn.x, 0, spawn.z);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = spawn.yaw; bot.body.pitch = 0;
  bot.health = BOT.health; bot.alive = true;
  bot.weaponId = weaponId; bot.mag = WEAPONS[weaponId].mag;
  bot.cooldown = 0; bot.state = 'BUY'; bot.path = []; bot.pathIdx = 0;
  bot.target = null; bot.burstLeft = 0; bot.pauseUntil = 0;
  bot.plantLeft = 0; bot.defuseLeft = 0;
  bot.targetSite = bot.team === 'aurora' ? (random() < 0.55 ? 'A' : 'B') : null;
  bot.group.visible = true;
}

export function aliveCount(bots, team) {
  let n = 0;
  for (const b of bots) if (b.team === team && b.alive) n += 1;
  return n;
}

// Can `bot` see `other` right now? Range + FOV + wall LOS + smoke occlusion.
function canSee(ctx, bot, other) {
  const bp = bot.body.position, op = other.body.position;
  const dx = op.x - bp.x, dz = op.z - bp.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BOT.seeDistance) return false;
  const fwdX = -Math.sin(bot.body.yaw), fwdZ = -Math.cos(bot.body.yaw);
  const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
  if (dot < Math.cos(BOT.seeFov / 2) && dist > 4) return false;
  const ey = bp.y + bot.body.eye, oy = op.y + 1.2;
  if (ctx.segmentBlocked(bp.x, ey, bp.z, op.x, oy, op.z)) return false;
  if (smokeBlocks(ctx.state, bp.x, ey, bp.z, op.x, oy, op.z)) return false;
  return true;
}

function pickTarget(ctx, bot) {
  // Target stickiness: keep the current target while it is still visible, so a
  // bot does not flicker between two contacts every tick.
  if (bot.target && bot.target.alive && canSee(ctx, bot, bot.target)) return bot.target;
  let best = null, bd = Infinity;
  for (const a of ctx.actors) {
    if (a === bot || !a.alive || a.team === bot.team) continue;
    if (!canSee(ctx, bot, a)) continue;
    const d = Math.hypot(a.body.position.x - bot.body.position.x, a.body.position.z - bot.body.position.z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function setPath(ctx, bot, gx, gz) {
  const start = nearestWaypoint(ctx.map, bot.body.position.x, bot.body.position.z);
  const goal = nearestWaypoint(ctx.map, gx, gz);
  bot.path = findPath(ctx.map, start, goal).map((id) => ctx.map.nodes[id]);
  bot.pathIdx = 0;
}

function followPath(ctx, bot, dt, speed) {
  if (bot.pathIdx >= bot.path.length) return false;
  const node = bot.path[bot.pathIdx];
  const dx = node.x - bot.body.position.x, dz = node.z - bot.body.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { bot.pathIdx += 1; return bot.pathIdx < bot.path.length; }
  const yaw = Math.atan2(-dx, -dz);
  // Smooth turn toward the waypoint.
  let dy = yaw - bot.body.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.body.yaw += dy * Math.min(1, dt * 6);
  wishFrom(bot.body.yaw, 1, 0, _wish);
  // Crouch under the Mid vent lintel (z = 12, 1.15 m clearance) when the path
  // crosses it; standing bots would wedge against it.
  const z0 = bot.body.position.z, z1 = node.z;
  const crouchVent = Math.abs(bot.body.position.x) < 7.5 && ((z0 < 12 && z1 >= 12) || (z0 > 12 && z1 <= 12));
  ctx.mover.step(bot.body, dt, _wish.x, _wish.z, speed, crouchVent, false);
  return true;
}

function separate(ctx, bot, dt) {
  for (const other of ctx.actors) {
    if (other === bot || !other.alive) continue;
    const dx = bot.body.position.x - other.body.position.x;
    const dz = bot.body.position.z - other.body.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1.44 && d2 > 0.001) {
      const d = Math.sqrt(d2);
      bot.body.position.x += (dx / d) * (1.2 - d) * dt * 4;
      bot.body.position.z += (dz / d) * (1.2 - d) * dt * 4;
    }
  }
}

export function stepBot(ctx, bot, dt) {
  if (!bot.alive) { bot.group.visible = false; return; }
  bot.group.visible = true;
  bot.cooldown = Math.max(0, bot.cooldown - dt);
  const state = ctx.state;
  const now = state.time;

  // ---- senses: acquire a target, with a human reaction delay ----
  const seen = pickTarget(ctx, bot);
  if (seen && bot.target !== seen) { bot.target = seen; bot.reactAt = now + BOT.reactionMin + ctx.random() * (BOT.reactionMax - BOT.reactionMin); }
  if (!seen) bot.target = null;
  const engaged = bot.target && now >= bot.reactAt;

  // ---- hears gunfire: investigate the newest noise in range ----
  if (!engaged && state.shotNoise.length) {
    const n = state.shotNoise[state.shotNoise.length - 1];
    const d = Math.hypot(n.x - bot.body.position.x, n.z - bot.body.position.z);
    if (d < BOT.hearRadius && now - n.at < 4 && bot.lastNoise !== n) {
      bot.lastNoise = n;
      if (bot.state !== 'PLANT' && bot.state !== 'DEFUSE') {
        bot.state = 'INVESTIGATE_SOUND';
        setPath(ctx, bot, n.x, n.z);
      }
    }
  }

  // ---- plant / defuse duties ----
  if (bot.team === 'aurora' && state.carrier === bot.id && state.phase === 'live' && !state.planted) {
    const site = ctx.map.sites[bot.targetSite];
    const inSite = bot.body.position.x >= site.minX && bot.body.position.x <= site.maxX
      && bot.body.position.z >= site.minZ && bot.body.position.z <= site.maxZ;
    if (inSite) {
      if (bot.state !== 'PLANT') { bot.state = 'PLANT'; bot.plantLeft = 3; ctx.plantStart(bot); }
      bot.plantLeft -= dt;
      if (bot.plantLeft <= 0) { bot.state = 'ADVANCE'; ctx.plantComplete(bot); }
      return;
    }
  }
  if (bot.team === 'meridian' && state.planted) {
    const site = ctx.map.sites[state.plantSite];
    const d = Math.hypot(site.cx - bot.body.position.x, site.cz - bot.body.position.z);
    if (d < 2.2 && !engaged) {
      if (bot.state !== 'DEFUSE') { bot.state = 'DEFUSE'; bot.defuseLeft = bot.hasKit ? 2.5 : 5; ctx.defuseStart(bot); }
      bot.defuseLeft -= dt;
      if (bot.defuseLeft <= 0) { bot.state = 'ADVANCE'; ctx.defuseComplete(bot); }
      return;
    }
    if (bot.state !== 'ROTATE') {
      bot.state = 'ROTATE';
      setPath(ctx, bot, site.cx, site.cz);
      if (ctx.random() < 0.5) logEvent(state, 'radio', `${bot.name}: rotating to Site ${state.plantSite}`);
    }
  }

  // ---- face an acquired target through the reaction window ----
  // A bot that has spotted someone stops pathing and turns to face them while
  // its reaction delay runs; otherwise it can turn away, lose the contact from
  // its FOV cone, and switch to a distant target it cannot hit.
  if (bot.target && !engaged) {
    const dx = bot.target.body.position.x - bot.body.position.x;
    const dz = bot.target.body.position.z - bot.body.position.z;
    const want = Math.atan2(-dx, -dz);
    let dy = want - bot.body.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.body.yaw += dy * Math.min(1, dt * 8);
    bot.body.pitch = Math.atan2((bot.target.body.position.y + 1.1) - (bot.body.position.y + bot.body.eye), Math.hypot(dx, dz));
  }

  // ---- combat: burst fire with counter-strafe peeks ----
  if (engaged) {
    const t = bot.target;
    const dx = t.body.position.x - bot.body.position.x;
    const dz = t.body.position.z - bot.body.position.z;
    bot.body.yaw = Math.atan2(-dx, -dz);
    bot.body.pitch = Math.atan2((t.body.position.y + 1.1) - (bot.body.position.y + bot.body.eye), Math.hypot(dx, dz));
    if (now > bot.pauseUntil) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = BOT.burstMin + ((ctx.random() * (BOT.burstMax - BOT.burstMin)) | 0);
        bot.pauseUntil = now + BOT.pauseMin + ctx.random() * (BOT.pauseMax - BOT.pauseMin);
      } else {
        // Strafe sideways while firing, flip direction every ~0.9 s.
        if (now > bot.strafeUntil) { bot.strafeDir *= -1; bot.strafeUntil = now + 0.9; }
        wishFrom(bot.body.yaw, 0, bot.strafeDir, _wish);
        ctx.mover.step(bot.body, dt, _wish.x, _wish.z, BOT.walkSpeed, ctx.random() < 0.12, false);
        if (bot.mag <= 0) {
          bot.mag = WEAPONS[bot.weaponId].mag;
          bot.pauseUntil = now + WEAPONS[bot.weaponId].reloadTime;
        } else {
          bot.burstLeft -= 1;
          ctx.fireShot(bot, t);
        }
      }
    }
    separate(ctx, bot, dt);
    return;
  }

  // ---- movement: buy -> advance / hold / rotate ----
  // While a target is acquired the bot holds its ground and faces it (see above);
  // pathing resumes the moment the contact is lost.
  if (bot.target) {
    separate(ctx, bot, dt);
    return;
  }
  if (state.phase === 'buy') {
    if (bot.state !== 'BUY') bot.state = 'BUY';
    return;
  }
  if (state.phase !== 'live') return;
  if (bot.state === 'BUY' || bot.state === 'ADVANCE' || bot.state === 'ROTATE' || bot.state === 'INVESTIGATE_SOUND') {
    if (bot.pathIdx >= bot.path.length) {
      // Arrived: pick a destination.
      if (bot.team === 'aurora') {
        const site = ctx.map.sites[bot.targetSite];
        setPath(ctx, bot, site.cx + (ctx.random() * 6 - 3), site.cz + (ctx.random() * 6 - 3));
        bot.state = 'ADVANCE';
      } else if (bot.state === 'ROTATE') {
        const site = ctx.map.sites[state.plantSite || 'A'];
        setPath(ctx, bot, site.cx, site.cz);
      } else if (bot.state === 'INVESTIGATE_SOUND') {
        bot.state = 'HOLD_ANGLE';
        bot.holdUntil = now + 2 + ctx.random() * 3;
      } else {
        // Defenders hold an angle near a site or mid.
        const spots = [[-18, -6], [18, -6], [0, -12], [-11, -2], [11, -2]];
        const s = spots[(ctx.random() * spots.length) | 0];
        setPath(ctx, bot, s[0], s[1]);
        bot.state = 'HOLD_ANGLE';
      }
    }
    followPath(ctx, bot, dt, BOT.runSpeed);
  } else if (bot.state === 'HOLD_ANGLE') {
    if (now > bot.holdUntil) {
      bot.state = 'ADVANCE';
      const spots = [[-18, -6], [18, -6], [0, -12], [0, 8]];
      const s = spots[(ctx.random() * spots.length) | 0];
      setPath(ctx, bot, s[0], s[1]);
    }
    // Idle sway: scan the lane slowly.
    bot.body.yaw += Math.sin(now * 0.5 + bot.id.length) * dt * 0.2;
  }
  separate(ctx, bot, dt);
}

export function stepAllBots(ctx, bots, dt) {
  for (const bot of bots) stepBot(ctx, bot, dt);
}

// Spectator: the next alive teammate to watch after the player dies.
export function nextSpectateTarget(state, bots) {
  const alive = [...state.members.aurora, ...state.members.meridian].filter((b) => b.alive);
  if (!alive.length) return null;
  state.spectateIndex = (state.spectateIndex + 1) % alive.length;
  return alive[state.spectateIndex];
}
