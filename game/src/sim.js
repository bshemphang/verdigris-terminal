// VERDIGRIS TERMINAL — sim.js: the fixed 1/60 deterministic simulation.
// Kinematics (acceleration, counter-strafe deceleration, crouch, jump, AABB slide),
// multi-zone hitboxes (Head 3.8x / Chest 1.0x / Legs 0.75x, helmet trims heads),
// ballistics with wall occlusion + smoke occlusion, grenades, and the round
// economy. Rendering never touches this file's numbers; it only reads them.
import * as THREE from 'three';
import { TICK, WEAPONS, GRENADES, ARMOR, HELMET, DEFUSE_KIT, ECONOMY, PLANT_SECONDS, DEFUSE_SECONDS, DEFUSE_KIT_SECONDS, FUSE_SECONDS, BUY_SECONDS, ROUND_SECONDS, MATCH_WIN_ROUNDS, MATCH_MAX_ROUNDS, PLAYER } from './config.js';
import { logEvent, clamp } from './state.js';
import { SITES } from './map.js';

// ---- kinematics ------------------------------------------------------------
export function createBody(x, z, yaw) {
  return { position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), yaw, pitch: 0, eye: PLAYER.eye, crouch: false, onGround: true, vy: 0 };
}

export function createMover(colliders, heightAt) {
  // Circle (radius r) vs AABB in XZ, respecting vertical overlap.
  function collides(x, z, r, feetY, topY) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (topY <= c.minY || feetY >= c.maxY) continue;
      const cx = clamp(x, c.minX, c.maxX), cz = clamp(z, c.minZ, c.maxZ);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  function step(body, dt, wishX, wishZ, speed, crouch, jump) {
    body.crouch = crouch;
    const targetEye = crouch ? PLAYER.eyeCrouch : PLAYER.eye;
    body.eye += (targetEye - body.eye) * Math.min(1, dt * 10);
    const accel = body.onGround ? 42 : 10;
    const maxSpeed = speed * (crouch ? 0.45 : 1);
    const wLen = Math.hypot(wishX, wishZ);
    if (wLen > 0.01) {
      body.velocity.x += (wishX / wLen) * accel * dt;
      body.velocity.z += (wishZ / wLen) * accel * dt;
    } else if (body.onGround) {
      // Crisp counter-strafe deceleration.
      const dec = Math.min(1, dt * 12);
      body.velocity.x *= 1 - dec; body.velocity.z *= 1 - dec;
    }
    const sp = Math.hypot(body.velocity.x, body.velocity.z);
    if (sp > maxSpeed) { body.velocity.x *= maxSpeed / sp; body.velocity.z *= maxSpeed / sp; }
    // Vertical: gravity + jump, ground follows the height map (ramps, sunken B).
    const ground = heightAt(body.position.x, body.position.z);
    if (jump && body.onGround) { body.vy = 5.2; body.onGround = false; }
    body.vy -= 18 * dt;
    let ny = body.position.y + body.vy * dt;
    if (ny <= ground) { ny = ground; body.vy = 0; body.onGround = true; }
    body.position.y = ny;
    // Axis-separated slide: try X, then Z.
    const r = PLAYER.radius, top = body.position.y + (crouch ? 1.15 : PLAYER.height);
    const nx = body.position.x + body.velocity.x * dt;
    if (!collides(nx, body.position.z, r, body.position.y, top)) body.position.x = nx;
    const nz = body.position.z + body.velocity.z * dt;
    if (!collides(body.position.x, nz, r, body.position.y, top)) body.position.z = nz;
    // Map bounds.
    body.position.x = clamp(body.position.x, -38.4, 38.4);
    body.position.z = clamp(body.position.z, -31.4, 31.4);
  }
  return { step, collides };
}

export function wishFrom(yaw, forward, strafe, out) {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  out.x = -sin * forward + cos * strafe;
  out.z = -cos * forward - sin * strafe;
  return out;
}

export function groundSpeed(body) { return Math.hypot(body.velocity.x, body.velocity.z); }

// ---- ballistics ------------------------------------------------------------
// Ray vs AABB slab: nearest wall distance along the ray, or Infinity.
function rayWallT(colliders, ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    let t0 = 0, t1 = best, ok = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [c.minX, c.minY, c.minZ], mx = [c.maxX, c.maxY, c.maxZ];
    for (let a = 0; a < 3; a += 1) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) { ok = false; break; } continue; }
      let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best && t0 > 0) best = t0;
  }
  return best;
}

// Ray vs sphere; returns t or -1.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

// Smoke blocks a ray if the segment passes within any live cloud's radius.
export function smokeBlocks(state, ax, ay, az, bx, by, bz) {
  for (const s of state.smokes) {
    if (state.time > s.until) continue;
    // Closest point on segment to cloud centre.
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / len2;
    t = clamp(t, 0, 1);
    const px = ax + abx * t - s.x, py = ay + aby * t - s.y, pz = az + abz * t - s.z;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}

export function createCombat(map, state, audio) {
  const actors = [];
  function fireShot(shooter, def, ox, oy, oz, dx, dy, dz, spread, random, playerActor) {
    state.roundStats.shots += 1;
    if (def.melee) {
      // Karambit: short arc, no tracer, instant.
      for (const a of actors) {
        if (a === shooter || !a.alive || a.team === shooter.team) continue;
        const d = Math.hypot(a.body.position.x - ox, a.body.position.z - oz);
        if (d < 2.4) { damageActor(shooter, a, def.damage, 'chest', playerActor); return { hit: true, killed: !a.alive, victim: a, point: null, zone: 'chest' }; }
      }
      return { hit: false };
    }
    const jx = (random() * 2 - 1) * spread, jy = (random() * 2 - 1) * spread;
    const nx = dx + jx, ny = dy + jy, nz = dz + (random() * 2 - 1) * spread;
    const il = 1 / Math.hypot(nx, ny, nz);
    const rx = nx * il, ry = ny * il, rz = nz * il;
    const wallT = rayWallT(map.colliders, ox, oy, oz, rx, ry, rz, def.range);
    let bestT = wallT, bestActor = null, bestZone = null;
    for (const a of actors) {
      if (a === shooter || !a.alive || a.team === shooter.team) continue;
      const bp = a.body.position;
      const zones = [
        ['head', bp.x, bp.y + 1.52, bp.z, 0.24],
        ['chest', bp.x, bp.y + 1.05, bp.z, 0.36],
        ['legs', bp.x, bp.y + 0.45, bp.z, 0.32],
      ];
      for (const [zone, cx, cy, cz, r] of zones) {
        const t = raySphere(ox, oy, oz, rx, ry, rz, cx, cy, cz, r);
        if (t > 0 && t < bestT) { bestT = t; bestActor = a; bestZone = zone; }
      }
    }
    const hx = ox + rx * bestT, hy = oy + ry * bestT, hz = oz + rz * bestT;
    if (bestActor) {
      // Smoke between shooter and victim eats the shot.
      if (smokeBlocks(state, ox, oy, oz, hx, hy, hz)) return { hit: false, blocked: 'smoke', point: [hx, hy, hz] };
      const dist = bestT;
      let dmg = def.damage;
      if (dist > def.falloffStart) dmg *= Math.max(def.falloffMin, 1 - (dist - def.falloffStart) / def.range * (1 - def.falloffMin));
      let mult = bestZone === 'head' ? def.headMult : bestZone === 'legs' ? def.legMult : 1;
      if (bestZone === 'head' && bestActor.helmet) mult *= 0.62;
      const killed = damageActor(shooter, bestActor, dmg * mult, bestZone, playerActor);
      state.roundStats.hits += 1;
      if (bestZone === 'head') state.roundStats.headshots += 1;
      return { hit: true, killed, victim: bestActor, zone: bestZone, point: [hx, hy, hz] };
    }
    return { hit: false, point: [hx, hy, hz], wallT };
  }

  function damageActor(shooter, victim, dmg, zone, playerActor) {
    let remaining = dmg;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, remaining * 0.5);
      victim.armor -= absorbed;
      remaining -= absorbed;
    }
    victim.health -= remaining;
    if (victim.health <= 0) {
      victim.health = 0; victim.alive = false;
      state.roundStats.kills += shooter === playerActor ? 1 : 0;
      const reward = shooter.weaponId && WEAPONS[shooter.weaponId] && WEAPONS[shooter.weaponId].killReward ? WEAPONS[shooter.weaponId].killReward : ECONOMY.kill;
      if (shooter.money !== undefined) shooter.money += reward;
      logEvent(state, 'kill', `${shooter.name} ${zone === 'head' ? '⌖' : ''} ${victim.name}`);
      if (state.carrier === victim.id) state.carrier = null;
      return true;
    }
    return false;
  }

  function explode(x, y, z, playerActor) {
    for (const a of actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.body.position.x - x, a.body.position.y + 1 - y, a.body.position.z - z);
      if (d < GRENADES.frag.radius) {
        const dmg = GRENADES.frag.damage * (1 - d / GRENADES.frag.radius * 0.7);
        damageActor(playerActor, a, dmg, 'chest', playerActor);
      }
    }
  }

  return { actors, fireShot, damageActor, explode };
}

// ---- grenades --------------------------------------------------------------
export function createGrenades() {
  const live = []; // {type, x,y,z, vx,vy,vz, fuse, bounces}
  function throwFrom(type, ox, oy, oz, dx, dy, dz) {
    live.push({ type, x: ox, y: oy, z: oz, vx: dx * 16, vy: dy * 16 + 3.5, vz: dz * 16, fuse: GRENADES[type].fuse, bounces: 0 });
  }
  // Returns detonation events: {type, x, y, z}.
  function step(dt, map, state) {
    const events = [];
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.fuse -= dt;
      g.vy -= 16 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const ground = map.heightAt(g.x, g.z);
      if (g.y < ground + 0.12) {
        g.y = ground + 0.12;
        if (Math.abs(g.vy) > 2 && g.bounces < 2) { g.vy = -g.vy * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounces += 1; }
        else { g.vy = 0; g.vx *= 0.6; g.vz *= 0.6; }
      }
      if (g.fuse <= 0) {
        events.push({ type: g.type, x: g.x, y: g.y, z: g.z });
        live.splice(i, 1);
      }
    }
    return events;
  }
  return { live, throwFrom, step, clear() { live.length = 0; } };
}

// ---- rounds & economy ------------------------------------------------------
export function createRounds(state, hooks) {
  function startMatch() {
    state.score.aurora = 0; state.score.meridian = 0;
    state.lossStreak.aurora = 0; state.lossStreak.meridian = 0;
    state.round = 1; state.winner = null;
    startRound();
  }
  function startRound() {
    state.phase = 'buy'; state.buyTime = BUY_SECONDS; state.roundTime = ROUND_SECONDS;
    state.planted = false; state.plantSite = null; state.plantProgress = 0; state.defuseProgress = 0;
    state.fuseTime = 0; state.carrier = 'player';
    state.roundStats.shots = 0; state.roundStats.hits = 0; state.roundStats.headshots = 0; state.roundStats.kills = 0;
    hooks.resetActors();
    hooks.onRoundStart(state.round);
  }
  function goLive() {
    state.phase = 'live';
    hooks.onLive();
  }
  function endRound(winnerTeam, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.score[winnerTeam] += 1;
    const loser = winnerTeam === 'aurora' ? 'meridian' : 'aurora';
    state.lossStreak[loser] += 1;
    state.lossStreak[winnerTeam] = 0;
    // Economy: winners +3250, losers +1900 plus 500 per loss in the streak.
    for (const a of [...state.members.aurora, ...state.members.meridian, state.playerActor]) {
      if (!a) continue;
      a.money += a.team === winnerTeam ? ECONOMY.win : ECONOMY.loss + (state.lossStreak[a.team] - 1) * ECONOMY.lossStreakBonus;
    }
    hooks.onRoundEnd(winnerTeam, reason);
    if (state.score[winnerTeam] >= MATCH_WIN_ROUNDS || state.round >= MATCH_MAX_ROUNDS) {
      state.phase = 'matchEnd';
      state.winner = state.score.aurora === state.score.meridian ? 'draw' : winnerTeam;
      hooks.onMatchEnd(state.winner);
      return;
    }
    state.round += 1;
    state.endTimer = 3.5;
  }
  function plantCharge(site, byName, x, z) {
    state.planted = true; state.plantSite = site; state.fuseTime = FUSE_SECONDS;
    state.plantX = x ?? SITES[site].cx; state.plantZ = z ?? SITES[site].cz;
    logEvent(state, 'plant', `Charge planted at Site ${site} — ${byName}`);
    hooks.onPlant(site);
    if (state.playerActor && byName === state.playerActor.name) state.playerActor.money += ECONOMY.plant;
  }
  function defuseCharge(byName) {
    state.planted = false;
    logEvent(state, 'defuse', `Charge defused — ${byName}`);
    hooks.onDefuse();
    endRound('meridian', 'Charge defused');
  }
  function buy(actor, itemId) {
    const price = WEAPONS[itemId] ? WEAPONS[itemId].price
      : GRENADES[itemId] ? GRENADES[itemId].price
      : itemId === 'armor' ? ARMOR.price : itemId === 'helmet' ? HELMET.price
      : itemId === 'kit' ? DEFUSE_KIT.price : null;
    if (price === null) return { ok: false, reason: 'Unknown item' };
    if (actor.money < price) return { ok: false, reason: 'Not enough cash' };
    if (WEAPONS[itemId]) {
      if (actor.owned && actor.owned.has(itemId)) return { ok: false, reason: 'Already owned' };
    }
    if (GRENADES[itemId] && (actor.grenadesOf?.[itemId] ?? 0) >= 2) return { ok: false, reason: 'Carrying max' };
    actor.money -= price;
    if (WEAPONS[itemId]) { actor.owned = actor.owned || new Set(); actor.owned.add(itemId); hooks.giveWeapon(itemId); }
    else if (GRENADES[itemId]) { actor.grenadesOf = actor.grenadesOf || {}; actor.grenadesOf[itemId] = (actor.grenadesOf[itemId] || 0) + 1; }
    else if (itemId === 'armor') actor.armor = ARMOR.points;
    else if (itemId === 'helmet') { actor.armor = HELMET.points; actor.helmet = true; }
    else if (itemId === 'kit') actor.hasKit = true;
    return { ok: true };
  }
  function step(dt, input) {
    if (state.phase === 'buy') {
      state.buyTime -= dt;
      if (state.buyTime <= 0) goLive();
    } else if (state.phase === 'live') {
      state.roundTime -= dt;
      if (state.planted) {
        state.fuseTime -= dt;
        if (state.fuseTime <= 0) {
          hooks.onDetonate();
          endRound('aurora', 'Charge detonated');
          return;
        }
      }
      if (state.roundTime <= 0 && !state.planted) { endRound('meridian', 'Time expired'); return; }
      // Plant / defuse progress.
      if (input.planting) {
        state.plantProgress += dt / PLANT_SECONDS;
        if (state.plantProgress >= 1) { state.plantProgress = 0; plantCharge(input.site, state.playerActor.name, input.px, input.pz); }
      } else state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
      if (input.defusing) {
        const need = state.playerActor.hasKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS;
        state.defuseProgress += dt / need;
        if (state.defuseProgress >= 1) { state.defuseProgress = 0; defuseCharge(state.playerActor.name); }
      } else state.defuseProgress = Math.max(0, state.defuseProgress - dt * 2);
      // Elimination check.
      const atkAlive = state.members.aurora.some((b) => b.alive) || (state.playerActor && state.playerActor.alive);
      const defAlive = state.members.meridian.some((b) => b.alive);
      if (!atkAlive) endRound('meridian', 'AURORA eliminated');
      else if (!defAlive && !state.planted) endRound('aurora', 'MERIDIAN eliminated');
    } else if (state.phase === 'roundEnd') {
      state.endTimer -= dt;
      if (state.endTimer <= 0) startRound();
    }
  }
  return { startMatch, startRound, goLive, endRound, plantCharge, defuseCharge, buy, step };
}
