// VERDIGRIS TERMINAL - map.js: the 78 x 64 m Art-Deco Botanical Conservatory &
// Sunken Metro Concourse. Three lanes (A / Mid / B), a Vent/Ticket Connector, a
// mezzanine catwalk over Site A, a sunken Site B with a parked art-deco tram.
// Every solid exports an AABB collider; ramps are smooth height zones, not steps.
// The nav-graph (~42 named waypoints) is auto-linked by line-of-sight at eye height.
import * as THREE from 'three';
import { makeSignTexture } from './textures.js';

export const SITES = {
  A: { key: 'A', name: 'SITE A · CONSERVATORY', cx: -28, cz: -17, minX: -38, maxX: -15, minZ: -28, maxZ: -7 },
  B: { key: 'B', name: 'SITE B · VAULT TRACKS', cx: 28, cz: -17, minX: 15, maxX: 38, minZ: -28, maxZ: -7 },
};

const SPAWNS = {
  aurora: [
    { x: 0, z: 28, yaw: 0 }, { x: -4, z: 29, yaw: 0 }, { x: 4, z: 29, yaw: 0 },
    { x: -8, z: 27, yaw: 0 }, { x: 8, z: 27, yaw: 0 },
  ],
  meridian: [
    { x: 0, z: -28, yaw: Math.PI }, { x: -4, z: -29, yaw: Math.PI }, { x: 4, z: -29, yaw: Math.PI },
    { x: -8, z: -27, yaw: Math.PI }, { x: 8, z: -27, yaw: Math.PI },
  ],
};

// Ground height: Site B is sunken 1.2 m; ramps ease the drop at its doors.
// The Site A mezzanine is a raised platform with a south ramp.
export function heightAt(x, z) {
  // Mezzanine platform (west wall of Site A), ramp on its south edge.
  if (x >= -38 && x <= -32) {
    if (z >= -26 && z <= -10) return 2.4;
    if (z > -10 && z < -6) return 2.4 * ((-6 - z) / 4);
  }
  // Sunken Site B floor.
  const inB = x >= 20 && x <= 36 && z >= -28 && z <= -6;
  if (inB) return -1.2;
  // B door ramp (south entry, x 15..21).
  if (x >= 15 && x <= 21 && z > -7 && z < -3) return -1.2 * ((z + 3) / 4);
  // B flank ramp (north-east entry, x 13..17, z -21..-15).
  if (x >= 13 && x <= 17 && z >= -21 && z <= -15) return -1.2 * ((z + 21) / 6);
  return 0;
}

export function zoneAt(x, z) {
  if (x >= SITES.A.minX && x <= SITES.A.maxX && z >= SITES.A.minZ && z <= SITES.A.maxZ) return 'SITE A';
  if (x >= SITES.B.minX && x <= SITES.B.maxX && z >= SITES.B.minZ && z <= SITES.B.maxZ) return 'SITE B';
  if (z >= 2 && z <= 8 && Math.abs(x) > 7) return 'CONNECTOR';
  if (z >= 24) return 'AURORA SPAWN';
  if (z <= -24 && Math.abs(x) <= 14) return 'MERIDIAN SPAWN';
  if (Math.abs(x) <= 8) return 'MID';
  return x < 0 ? 'WEST GALLERY' : 'EAST GALLERY';
}

// Slab-method segment vs AABB test, used for LOS and nav-graph linking.
export function segmentBlocked(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    let t0 = 0, t1 = 1, ok = true;
    const o = [ax, ay, az], d = [dx, dy, dz];
    const mn = [c.minX, c.minY, c.minZ], mx = [c.maxX, c.maxY, c.maxZ];
    for (let a = 0; a < 3; a += 1) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) { ok = false; break; } continue; }
      let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

const WAYPOINTS = [
  // name, x, z
  ['A Spawn', 0, 28], ['A Spawn W', -8, 26], ['A Spawn E', 8, 26],
  ['Mid South', 0, 18], ['Mid South W', -6, 18], ['Mid South E', 6, 18],
  ['Connector W', -18, 5], ['Connector C', 0, 5], ['Connector E', 18, 5],
  ['Mid', 0, 8], ['Mid North', 0, -2], ['Mid Top', 0, -12], ['Mid Top W', -6, -12], ['Mid Top E', 6, -12],
  ['West Gall', -11, 14], ['West Gall N', -11, -2], ['East Gall', 11, 14], ['East Gall N', 11, -2],
  ['A Door', -18, -6], ['A Court', -24, -12], ['A Fountain', -28, -17], ['A Planters', -33, -20],
  ['A Mezz', -35, -18], ['A Mezz Ramp', -35, -8], ['A Corner', -35, -24], ['A South', -24, -24],
  ['B Door', 18, -6], ['B Court', 24, -12], ['B Tram N', 28, -20], ['B Tram S', 28, -13],
  ['B Platform', 32, -22], ['B Booth', 20, -21], ['B Corner', 35, -24], ['B South', 24, -24],
  ['B Flank', 15, -18], ['D Spawn', 0, -28], ['D Spawn W', -8, -26], ['D Spawn E', 8, -26],
  ['D Mid W', -6, -22], ['D Mid E', 6, -22], ['A Vent', -11, 5], ['B Vent', 11, 5], ['B East', 36, -12],
];

export function createMap(scene, T) {
  const colliders = [];
  const addCollider = (cx, cz, w, d, h, y = 0) => {
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y, maxY: y + h });
  };

  const matFloor = new THREE.MeshStandardMaterial({ map: T.travertine.map, roughnessMap: T.travertine.roughnessMap, roughness: 0.9, metalness: 0.02 });
  const matFloorMark = new THREE.MeshStandardMaterial({ map: T.floorMark.map, roughnessMap: T.floorMark.roughnessMap, roughness: 0.9, metalness: 0.02 });
  const matTile = new THREE.MeshStandardMaterial({ map: T.tile.map, roughnessMap: T.tile.roughnessMap, roughness: 0.35, metalness: 0.05 });
  const matTileWarm = new THREE.MeshStandardMaterial({ map: T.tileWarm.map, roughnessMap: T.tileWarm.roughnessMap, roughness: 0.35, metalness: 0.05 });
  const matPlaster = new THREE.MeshStandardMaterial({ map: T.plaster.map, roughnessMap: T.plaster.roughnessMap, roughness: 0.9, metalness: 0.02 });
  const matBronze = new THREE.MeshStandardMaterial({ map: T.bronze.map, roughnessMap: T.bronze.roughnessMap, roughness: 0.35, metalness: 0.85 });
  const matWood = new THREE.MeshStandardMaterial({ map: T.wood.map, roughnessMap: T.wood.roughnessMap, roughness: 0.8, metalness: 0.02 });
  const matStone = new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 0.85, metalness: 0.02 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6, metalness: 0.4 });
  const matTram = new THREE.MeshStandardMaterial({ color: 0x1f5b5c, roughness: 0.3, metalness: 0.6 });
  const matTramTrim = new THREE.MeshStandardMaterial({ color: 0xd6ad60, roughness: 0.3, metalness: 0.9 });
  const matLeaf = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9, metalness: 0 });
  const matLeaf2 = new THREE.MeshStandardMaterial({ color: 0x40916c, roughness: 0.9, metalness: 0 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0xbfd9e8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28 });

  const group = new THREE.Group();
  scene.add(group);
  function box(w, h, d, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
    group.add(m); return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, seg = 10) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    group.add(m); return m;
  }

  // Floors: main concourse + sunken Site B slab + mezzanine deck.
  // The main floor is four pieces around the Site B pit: a single y=0 plane
  // would cover the sunken concourse and hide everything below grade there
  // (planted-charge beacon, tram lower half, bot legs). UVs are scaled so the
  // travertine tile density matches the original 78x64 plane (10x8 repeats).
  function floorPiece(w, d, cx, cz) {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (w / 78), uv.getY(i) * (d / 64));
    const m = new THREE.Mesh(g, matFloor);
    m.rotation.x = -Math.PI / 2; m.position.set(cx, 0, cz); m.receiveShadow = true; group.add(m);
  }
  floorPiece(59, 64, -9.5, 0); // west of the B pit
  floorPiece(3, 64, 37.5, 0); // east of the B pit
  floorPiece(16, 38, 28, 13); // south of the B pit
  floorPiece(16, 4, 28, -30); // north of the B pit
  const floorB = new THREE.Mesh(new THREE.PlaneGeometry(16, 22), matFloorMark);
  floorB.rotation.x = -Math.PI / 2; floorB.position.set(28, -1.19, -17); floorB.receiveShadow = true; group.add(floorB);
  const mezz = box(6, 0.3, 16, matBronze, -35, 2.25, -18);
  mezz.receiveShadow = true;
  const ramp = box(6, 0.3, 5.4, matWood, -35, 1.15, -8);
  ramp.rotation.x = Math.atan2(2.4, 4); ramp.position.y = 1.2;

  // Sky dome + glass-and-bronze vaulted skylight over Mid.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 12), new THREE.MeshBasicMaterial({ map: T.sky.map, side: THREE.BackSide, fog: false }));
  sky.position.y = 0; group.add(sky);
  const glassRoof = new THREE.Mesh(new THREE.PlaneGeometry(16, 46), matGlass);
  glassRoof.rotation.x = Math.PI / 2; glassRoof.position.set(0, 9.5, -2); group.add(glassRoof);
  for (let i = 0; i < 7; i += 1) {
    const z = -22 + i * 7;
    box(16.5, 0.35, 0.5, matBronze, 0, 9.6, z); // skylight truss ribs
    box(0.5, 0.35, 46, matBronze, -8, 9.6, -2);
    box(0.5, 0.35, 46, matBronze, 8, 9.6, -2);
  }
  // Glass canopy over Site A atrium.
  const glassA = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), matGlass);
  glassA.rotation.x = Math.PI / 2; glassA.position.set(-28, 8.5, -17); group.add(glassA);
  box(20.5, 0.4, 0.6, matBronze, -28, 8.6, -27); box(20.5, 0.4, 0.6, matBronze, -28, 8.6, -7);
  box(0.6, 0.4, 20.5, matBronze, -38, 8.6, -17); box(0.6, 0.4, 20.5, matBronze, -18, 8.6, -17);

  // Perimeter walls (verdigris tile, 5 m high). Site A runs warm, Site B cool.
  const wall = (cx, cz, w, d, mat = matTile) => { box(w, 5, d, mat, cx, 2.5, cz); addCollider(cx, cz, w, d, 5); };
  wall(0, -32, 80, 1); wall(0, 32, 80, 1); wall(-39, 0, 1, 66, matTileWarm); wall(39, 0, 1, 66);
  // z = -6 cross-wall with three doors: A (-22..-14), Mid (-7..7), B (14..22).
  wall(-30.5, -6, 17, 1, matTileWarm); wall(-10.5, -6, 7, 1); wall(10.5, -6, 7, 1); wall(30.5, -6, 17, 1);
  // Vertical lane walls x = +/-14, z -6..20, with the Connector gap at z 2..8.
  wall(-14, -2, 1, 8, matTileWarm); wall(-14, 14, 1, 12, matTileWarm); wall(14, -2, 1, 8); wall(14, 14, 1, 12);
  // North lane wall x = 14, z -32..-16 with B flank gap at z -21..-15.
  wall(14, -28.5, 1, 7); wall(14, -12.5, 1, 5);
  wall(-14, -19, 1, 26, matTileWarm); // west lane wall, full height north of the connector
  // Plaster wainscot band + bronze trim break up the long tile walls.
  for (const [wx, wz, ww, wd] of [[0, -31.4, 78, 0.15], [0, 31.4, 78, 0.15]]) {
    box(ww, 1.1, wd, matPlaster, wx, 0.55, wz);
    box(ww, 0.12, wd + 0.06, matBronze, wx, 1.16, wz);
  }
  for (const [wx, wz, ww, wd] of [[-38.4, 0, 0.15, 64], [38.4, 0, 0.15, 64]]) {
    box(ww, 1.1, wd, matPlaster, wx, 0.55, wz);
    box(ww + 0.06, 0.12, wd, matBronze, wx, 1.16, wz);
  }
  // Vents, pipes and light fixtures on the long walls.
  for (const vx of [-20, 20]) {
    box(1.6, 1, 0.12, matDark, vx, 3.4, -31.4);
    box(1.6, 0.12, 0.16, matBronze, vx, 3.95, -31.4);
    box(1.6, 1, 0.12, matDark, vx, 3.4, 31.4);
    box(1.6, 0.12, 0.16, matBronze, vx, 3.95, 31.4);
  }
  for (const px of [-38.4, 38.4]) {
    box(0.18, 5, 0.18, matBronze, px, 2.5, 12);
    box(0.18, 5, 0.18, matBronze, px, 2.5, -12);
  }
  // Crouch-only vent lintel across Mid at z = 12 (duck under, 1.15 m clearance).
  box(14, 2.9, 0.8, matTile, 0, 2.6, 12);
  colliders.push({ minX: -7, maxX: 7, minZ: 11.6, maxZ: 12.4, minY: 1.15, maxY: 4.05 });

  // Mid colonnade: bronze pillars framing the sniper sightline.
  for (const z of [-20, -10, 0, 10, 20]) {
    for (const x of [-6.5, 6.5]) {
      cyl(0.45, 0.55, 6, matBronze, x, 3, z);
      addCollider(x, z, 1.1, 1.1, 6);
    }
  }
  // Site A: stepped fountain/planter centerpiece + marble benches + timber planters.
  cyl(2.2, 2.6, 0.9, matStone, -28, 0.45, -17, 16);
  addCollider(-28, -17, 4.4, 4.4, 0.9);
  cyl(1.4, 1.4, 0.25, matTile, -28, 1.0, -17, 16);
  box(3.4, 0.55, 1, matStone, -24, 0.28, -13); addCollider(-24, -13, 3.4, 1, 0.55);
  box(3.4, 0.55, 1, matStone, -32, 0.28, -21); addCollider(-32, -21, 3.4, 1, 0.55);
  box(1, 0.55, 3.4, matStone, -22, 0.28, -21); addCollider(-22, -21, 1, 3.4, 0.55);
  for (const [px, pz] of [[-33, -12], [-23, -22], [-36, -26], [-20, -10]]) {
    box(2.2, 0.9, 2.2, matWood, px, 0.45, pz); addCollider(px, pz, 2.2, 2.2, 0.9);
  }
  // Mezzanine rail + support columns.
  box(0.15, 1, 16, matBronze, -32.1, 2.9, -18);
  for (const z of [-24, -18, -12]) { cyl(0.25, 0.25, 2.4, matBronze, -32.2, 1.2, z); addCollider(-32.2, z, 0.5, 0.5, 2.4); }

  // Site B: parked art-deco tram (tight dual-peek lanes) + ticket booth + tile pillars.
  box(10, 2.6, 2.6, matTram, 28, 0.1, -16.5); addCollider(28, -16.5, 10, 2.6, 2.6, -1.2);
  box(10.2, 0.3, 2.8, matTramTrim, 28, 1.55, -16.5);
  box(10.2, 0.25, 2.8, matTramTrim, 28, -0.9, -16.5);
  for (const wx of [24, 28, 32]) box(1.4, 1.4, 0.1, matGlass, wx, 0.5, -15.15);
  box(3, 2.4, 2, matWood, 22, 0, -24); addCollider(22, -24, 3, 2, 2.4, -1.2);
  box(3.2, 0.2, 2.2, matBronze, 22, 1.3, -24);
  for (const [px, pz] of [[21, -10], [35, -10], [21, -26], [35, -26]]) {
    box(1.2, 5, 1.2, matTile, px, 1.3, pz); addCollider(px, pz, 1.2, 1.2, 5, -1.2);
  }
  // Sunken platform edge step (visual lip around Site B).
  box(16, 0.25, 0.6, matBronze, 28, -0.05, -6.2);
  box(0.6, 0.25, 22, matBronze, 19.8, -0.05, -17);

  // Botanical planters along Mid + Connector (emerald foliage, instanced look via clones).
  const leafGeo = new THREE.ConeGeometry(0.55, 1.6, 6);
  const leafGeo2 = new THREE.SphereGeometry(0.7, 7, 5);
  const foliage = new THREE.InstancedMesh(leafGeo, matLeaf, 108);
  const foliage2 = new THREE.InstancedMesh(leafGeo2, matLeaf2, 72);
  foliage.castShadow = true; foliage2.castShadow = true;
  const m4 = new THREE.Matrix4();
  const planterSpots = [[-9, 22], [9, 22], [-9, -24], [9, -24], [-20, 10], [20, 10], [-36, -8], [36, -8], [-11, -14], [11, -14], [-7, -18], [7, -18]];
  let fi = 0, fj = 0;
  for (const [px, pz] of planterSpots) {
    box(2.4, 0.8, 2.4, matWood, px, 0.4, pz); addCollider(px, pz, 2.4, 2.4, 0.8);
    for (let k = 0; k < 9 && fi < 108; k += 1) {
      m4.makeTranslation(px - 0.8 + (k % 3) * 0.8, 1.4 + (k % 2) * 0.5, pz - 0.8 + ((k / 3) | 0) * 0.8);
      foliage.setMatrixAt(fi, m4); fi += 1;
    }
    for (let k = 0; k < 6 && fj < 72; k += 1) {
      m4.makeTranslation(px - 0.7 + (k % 3) * 0.7, 1.1, pz - 0.7 + ((k / 3) | 0) * 0.7);
      foliage2.setMatrixAt(fj, m4); fj += 1;
    }
  }
  foliage.count = fi; foliage2.count = fj;
  group.add(foliage); group.add(foliage2);

  // Painted site signs (in-world, CanvasTexture).
  function sign(text, sub, x, y, z, ry, w = 8, h = 2) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: makeSignTexture(text, sub), roughness: 0.6, metalness: 0.1 }));
    m.position.set(x, y, z); m.rotation.y = ry; group.add(m);
  }
  sign('SITE A · CONSERVATORY', 'AURORA OBJECTIVE', -28, 4.2, -5.4, 0);
  sign('SITE B · VAULT TRACKS', 'AURORA OBJECTIVE', 28, 4.2, -5.4, 0);
  sign('MID CONCOURSE', 'SNIPER SIGHTLINE', 0, 4.4, 24.5, Math.PI);
  sign('TICKET CONNECTOR', 'VENT ROUTE', 0, 3.4, 1.6, 0);
  sign('VERDIGRIS TERMINAL', 'EST. 1927 · AURORA vs MERIDIAN', 0, 5.2, 31.4, Math.PI, 12, 2.4);

  // Nav-graph: link waypoints within 12 m when the walk line is clear at 1 m.
// (12 m, not 10: the Mid-to-gallery hops are 11 m, and the door gaps need the
// diagonal; every link is still validated against the colliders, so a longer
// cap can only add links that are genuinely walkable.)
  const nodes = WAYPOINTS.map(([name, x, z], i) => ({ id: i, name, x, z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 12) continue;
      const ay = Math.max(heightAt(a.x, a.z), heightAt(b.x, b.z)) + 1;
      if (segmentBlocked(colliders, a.x, ay, a.z, b.x, ay, b.z)) continue;
      a.links.push(j); b.links.push(i);
    }
  }

  return {
    colliders, nodes, spawns: SPAWNS, sites: SITES,
    heightAt, zoneAt, segmentBlocked: (ax, ay, az, bx, by, bz) => segmentBlocked(colliders, ax, ay, az, bx, by, bz),
    group,
  };
}

export function nearestWaypoint(map, x, z) {
  let best = 0, bd = Infinity;
  for (const n of map.nodes) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

// BFS over the nav-graph; returns an array of node ids from start to goal.
export function findPath(map, startId, goalId) {
  if (startId === goalId) return [startId];
  const prev = new Int16Array(map.nodes.length).fill(-1);
  const queue = [startId];
  prev[startId] = startId;
  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi];
    for (const nb of map.nodes[cur].links) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === goalId) {
        const path = [goalId];
        let n = goalId;
        while (n !== startId) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(nb);
    }
  }
  return [startId];
}
