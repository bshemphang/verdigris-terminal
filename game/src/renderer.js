// VERDIGRIS TERMINAL - renderer.js: Three.js scene, PMREM IBL baked once at boot,
// ACES tone mapping, PCF soft skylight shadows, articulated operators, 3D viewmodels
// with critically-damped spring physics, and pooled InstancedMesh VFX (tracers,
// casings, sparks, decals, smoke) plus a pooled muzzle-flash light and dust motes.
// All scratch Vector3/Quaternion/Matrix4/Color objects are pre-allocated at module
// scope: zero `new THREE.*` inside step()/render().
import * as THREE from 'three';
import { WEAPONS } from './config.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _c1 = new THREE.Color();
const _s1 = new THREE.Vector3();

// Critically-damped spring: x, v integrated toward target.
function spring(s, target, stiffness, damping, dt) {
  const f = -stiffness * (s.x - target) - damping * s.v;
  s.v += f * dt;
  s.x += s.v * dt;
  return s.x;
}
function makeSpring(x = 0) { return { x, v: 0 }; }

export function createRender() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd8c9a8, 55, 160);
  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // ---- Baked procedural IBL: one PMREM pass at boot, then disposed ----
  {
    const env = new THREE.Scene();
    const top = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xbfd9e8, side: THREE.BackSide }));
    env.add(top);
    const warm = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: 0xf2c98f }));
    warm.position.set(20, 30, 10); warm.lookAt(0, 0, 0); env.add(warm);
    const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ color: 0x8a7a5e }));
    floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = -10; env.add(floorGlow);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    top.geometry.dispose(); warm.geometry.dispose(); floorGlow.geometry.dispose();
  }

  // ---- Lights: late-afternoon skylight sun + warm bounce fill ----
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 120; sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9e8, 0x8a7a5e, 0.85));
  const fill = new THREE.DirectionalLight(0xffc890, 0.5);
  fill.position.set(-20, 12, 30); scene.add(fill);

  // ---- Operators: articulated deco tactical figures, team-rigged ----
  const teamMats = {
    aurora: { torso: 0xc0392b, trim: 0xd97b4a, legs: 0x3a2a24, skin: 0xc8a586 },
    meridian: { torso: 0x1f4e79, trim: 0x2e7d7a, legs: 0x23282e, skin: 0xc8a586 },
  };
  let opCount = 0;
  function makeOperator(team) {
    const m = teamMats[team];
    const g = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: m.torso, roughness: 0.7, metalness: 0.1 });
    const trimMat = new THREE.MeshStandardMaterial({ color: m.trim, roughness: 0.4, metalness: 0.6 });
    const legsMat = new THREE.MeshStandardMaterial({ color: m.legs, roughness: 0.85 });
    const skinMat = new THREE.MeshStandardMaterial({ color: m.skin, roughness: 0.7 });
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.4, metalness: 0.7 });
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
    };
    add(new THREE.BoxGeometry(0.52, 0.62, 0.3), torsoMat, 0, 1.12, 0); // torso
    add(new THREE.BoxGeometry(0.54, 0.1, 0.32), trimMat, 0, 1.42, 0); // chest trim
    add(new THREE.BoxGeometry(0.4, 0.34, 0.08), trimMat, 0, 1.14, 0.18); // chest rig
    add(new THREE.BoxGeometry(0.3, 0.26, 0.3), skinMat, 0, 1.62, 0); // head
    add(new THREE.BoxGeometry(0.34, 0.1, 0.32), trimMat, 0, 1.72, 0); // helmet band
    add(new THREE.BoxGeometry(0.32, 0.08, 0.06), trimMat, 0, 1.62, 0.17); // visor
    const rifle = add(new THREE.BoxGeometry(0.07, 0.1, 0.78), gunmetal, 0.12, 1.18, 0.3); // rifle
    rifle.rotation.x = -0.25;
    add(new THREE.BoxGeometry(0.06, 0.16, 0.1), trimMat, 0.12, 1.05, 0.28); // rifle magazine
    const armL = add(new THREE.BoxGeometry(0.14, 0.55, 0.16), torsoMat, -0.34, 1.12, 0);
    const armR = add(new THREE.BoxGeometry(0.14, 0.55, 0.16), torsoMat, 0.34, 1.12, 0);
    const legL = add(new THREE.BoxGeometry(0.2, 0.62, 0.22), legsMat, -0.14, 0.36, 0);
    const legR = add(new THREE.BoxGeometry(0.2, 0.62, 0.22), legsMat, 0.14, 0.36, 0);
    // Shoulder lamp: a tiny brass glint so silhouettes read at a glance.
    add(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0xd6ad60, metalness: 0.9, roughness: 0.25 }), -0.2, 1.44, 0.16);
    // Stance: 0 upright, 1 crouched behind cover, 2 peeking. Varies per bot so
    // a squad never reads as identical figures in a row.
    armL.rotation.x = -0.9; armR.rotation.x = -1.1;
    g.userData = { armL, armR, legL, legR, stance: opCount++ % 3 };
    return g;
  }

  // ---- Viewmodels: box-built guns with brass trim, one per weapon ----
  const vmGroup = new THREE.Group();
  camera.add(vmGroup);
  const vmGuns = {};
  function buildGun(def, accent) {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x565e66, roughness: 0.35, metalness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd6ad60, roughness: 0.3, metalness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc8a586, roughness: 0.7 });
    const add = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); g.add(m); return m;
    };
    if (def.melee) {
      add(0.03, 0.05, 0.3, brass, 0, 0, -0.25); // curved brass blade
      add(0.05, 0.06, 0.12, wood, 0, 0, -0.05); // grip
      add(0.06, 0.02, 0.04, brass, 0, 0.01, -0.11); // brass guard
    } else if (def.scoped) {
      add(0.07, 0.1, 0.85, steel, 0, 0, -0.35); // long barrel
      add(0.09, 0.12, 0.22, wood, 0, -0.02, 0.05); // stock
      add(0.06, 0.09, 0.16, brass, 0, 0.09, -0.2); // scope tube
      add(0.02, 0.05, 0.05, brass, 0, 0.05, -0.62); // muzzle
      add(0.06, 0.13, 0.09, steel, 0, -0.11, -0.25); // magazine
      add(0.04, 0.05, 0.05, steel, 0, 0.075, -0.08); // rear sight
      add(0.03, 0.04, 0.03, brass, 0, 0.075, -0.72); // front sight
      add(0.05, 0.06, 0.09, skin, 0, -0.1, -0.05); // firing hand on grip
    } else {
      const short = def.name.includes('Kestrel');
      const rl = short ? 0.42 : 0.6, bl = short ? 0.2 : 0.32;
      add(0.08, 0.12, rl, steel, 0, 0, -0.28); // receiver
      add(0.05, 0.05, bl, steel, 0, 0.02, -0.28 - rl / 2 - bl / 2 + 0.05); // barrel
      add(0.06, 0.14, 0.09, steel, 0, -0.12, -0.22); // magazine
      add(0.07, 0.11, 0.16, wood, 0, -0.02, 0.08); // stock
      add(0.07, 0.16, 0.12, wood, 0, -0.1, 0.02); // grip
      add(0.05, 0.05, 0.06, steel, 0, 0.085, -0.05); // rear sight
      add(0.03, 0.05, 0.03, brass, 0, 0.085, -0.28 - rl / 2 - 0.02); // front sight
      add(0.06, 0.04, 0.18, brass, 0, 0.09, -0.3); // brass rail
      add(0.05, 0.06, 0.09, skin, 0, -0.1, -0.08); // firing hand on grip
      if (short) add(0.05, 0.05, 0.22, steel, 0, -0.06, -0.45); // foregrip
    }
    g.visible = false;
    vmGroup.add(g);
    return g;
  }
  for (const [id, def] of Object.entries(WEAPONS)) vmGuns[id] = buildGun(def, 0xd6ad60);
  vmGroup.position.set(0.28, -0.26, -0.55);

  // ---- Pooled VFX: tracers, casings, sparks, decals, smoke ----
  const muzzleLight = new THREE.PointLight(0xffc060, 0, 12, 1.6);
  camera.add(muzzleLight);
  muzzleLight.position.set(0.3, -0.2, -0.8);
  let muzzleUntil = 0;

  // Planted-charge beacon: pulsing red octahedron + red point light, anchored at
  // state.plantX/plantZ while a charge is live.
  const beacon = new THREE.Group();
  const beaconCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0xff2a18, emissiveIntensity: 2.2, roughness: 0.3 }),
  );
  beaconCore.position.y = 0.55;
  beacon.add(beaconCore);
  const beaconRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xff4030 }),
  );
  beaconRing.rotation.x = Math.PI / 2; beaconRing.position.y = 0.12;
  beacon.add(beaconRing);
  const beaconLight = new THREE.PointLight(0xff2a18, 0, 10, 1.5);
  beaconLight.position.y = 0.8;
  beacon.add(beaconLight);
  beacon.visible = false;
  scene.add(beacon);

  function makePool(count, geo, mat) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = count;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, items: Array.from({ length: count }, () => ({ life: 0, max: 1 })) };
  }
  const tracers = makePool(24, new THREE.BoxGeometry(0.07, 0.07, 1),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
  const casings = makePool(32, new THREE.BoxGeometry(0.02, 0.02, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xd6ad60, metalness: 0.9, roughness: 0.3 }));
  const sparks = makePool(64, new THREE.TetrahedronGeometry(0.05),
    new THREE.MeshBasicMaterial({ color: 0xffc060 }));
  const decals = makePool(48, new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0.75, depthWrite: false }));
  const smoke = makePool(28, new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xcfd8d3, transparent: true, opacity: 0.42, roughness: 1, depthWrite: false }));
  // Per-item velocities / scales live in plain arrays (no allocations).
  const casingVel = Array.from({ length: 32 }, () => new THREE.Vector3());
  const sparkVel = Array.from({ length: 64 }, () => new THREE.Vector3());
  const smokeScale = new Float32Array(28);
  const smokeMax = new Float32Array(28);
  let tracerIdx = 0, casingIdx = 0, sparkIdx = 0, decalIdx = 0, smokeIdx = 0;
  _m1.makeScale(0, 0, 0);
  for (const p of [tracers, casings, sparks, decals, smoke]) for (let i = 0; i < p.items.length; i += 1) p.mesh.setMatrixAt(i, _m1);

  // Dust motes drifting in the skylight sunbeams.
  const moteCount = 320;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(moteCount * 3);
  const moteSeed = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i += 1) {
    motePos[i * 3] = (Math.random() * 2 - 1) * 14;
    motePos[i * 3 + 1] = Math.random() * 8 + 0.5;
    motePos[i * 3 + 2] = -24 + Math.random() * 46;
    moteSeed[i] = Math.random() * 100;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xffe8c0, size: 0.035, transparent: true, opacity: 0.55 }));
  scene.add(motes);

  // Viewmodel springs: sway, bob, kick, reload tilt, ADS blend, crouch ease.
  const swayX = makeSpring(), swayY = makeSpring(), bob = makeSpring(), kick = makeSpring(), tilt = makeSpring(), ads = makeSpring();
  let currentGun = 'vesper';
  let lastYaw = 0, lastPitch = 0;

  function equip(id) {
    if (vmGuns[currentGun]) vmGuns[currentGun].visible = false;
    currentGun = id;
    if (vmGuns[id]) vmGuns[id].visible = true;
    kick.x = 0; kick.v = 0; tilt.x = 0; tilt.v = 0;
  }
  function fireKick(amount) { kick.v -= amount * 14; }
  function reloadTilt() { tilt.v += 6; }

  function spawnTracer(from, to, color) {
    const it = tracers.items[tracerIdx];
    it.life = 0.09; it.max = 0.09;
    _v1.copy(to).sub(from);
    const len = _v1.length() || 1;
    _v2.copy(from).add(to).multiplyScalar(0.5);
    _q1.setFromUnitVectors(_v3.set(0, 0, 1), _v1.normalize());
    _m1.compose(_v2, _q1, _s1.set(1, 1, len));
    tracers.mesh.setMatrixAt(tracerIdx, _m1);
    tracers.mesh.instanceMatrix.needsUpdate = true;
    _c1.set(color);
    tracers.mesh.setColorAt(tracerIdx, _c1);
    if (tracers.mesh.instanceColor) tracers.mesh.instanceColor.needsUpdate = true;
    tracerIdx = (tracerIdx + 1) % tracers.items.length;
  }
  function spawnCasing(pos, right) {
    const it = casings.items[casingIdx];
    it.life = 1.6; it.max = 1.6;
    casingVel[casingIdx].set(right.x * 2 + Math.random(), 2.2 + Math.random(), right.z * 2);
    _m1.makeTranslation(pos.x, pos.y, pos.z);
    casings.mesh.setMatrixAt(casingIdx, _m1);
    casings.mesh.instanceMatrix.needsUpdate = true;
    casingIdx = (casingIdx + 1) % casings.items.length;
  }
  function spawnSparks(p, n = 6) {
    for (let k = 0; k < n; k += 1) {
      const it = sparks.items[sparkIdx];
      it.life = 0.35; it.max = 0.35;
      sparkVel[sparkIdx].set((Math.random() * 2 - 1) * 4, Math.random() * 4, (Math.random() * 2 - 1) * 4);
      _m1.makeTranslation(p[0], p[1], p[2]);
      sparks.mesh.setMatrixAt(sparkIdx, _m1);
      sparks.mesh.instanceMatrix.needsUpdate = true;
      sparkIdx = (sparkIdx + 1) % sparks.items.length;
    }
  }
  function spawnDecal(p, normal) {
    const it = decals.items[decalIdx];
    it.life = 30; it.max = 30;
    _v1.set(p[0], p[1], p[2]);
    _v2.set(normal[0], normal[1], normal[2]);
    _q1.setFromUnitVectors(_v3.set(0, 0, 1), _v2);
    _m1.compose(_v1, _q1, _s1.set(1, 1, 1));
    decals.mesh.setMatrixAt(decalIdx, _m1);
    decals.mesh.instanceMatrix.needsUpdate = true;
    decalIdx = (decalIdx + 1) % decals.items.length;
  }
  function spawnSmoke(x, y, z, r) {
    for (let k = 0; k < 5; k += 1) {
      const it = smoke.items[smokeIdx];
      it.life = 16; it.max = 16;
      smokeScale[smokeIdx] = 0.4;
      smokeMax[smokeIdx] = r * (0.7 + Math.random() * 0.5);
      _m1.makeTranslation(x + (Math.random() * 2 - 1) * r * 0.4, y + 0.4 + Math.random() * 0.8, z + (Math.random() * 2 - 1) * r * 0.4);
      smoke.mesh.setMatrixAt(smokeIdx, _m1);
      smoke.mesh.instanceMatrix.needsUpdate = true;
      smokeIdx = (smokeIdx + 1) % smoke.items.length;
    }
  }
  function flashMuzzle(now) { muzzleLight.intensity = 40; muzzleUntil = now + 0.045; }

  function hidePoolItem(pool, i) {
    _m1.makeScale(0, 0, 0);
    pool.mesh.setMatrixAt(i, _m1);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }
  function updatePool(pool, dt, update) {
    for (let i = 0; i < pool.items.length; i += 1) {
      const it = pool.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { hidePoolItem(pool, i); continue; }
      update(i, it, dt);
    }
  }

  function step(dt, state, time, playerBody, bots, view) {
    // Operators follow their bodies; dead bots fall, alive ones walk-bob.
    for (const bot of bots) {
      const g = bot.group;
      g.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
      if (!bot.alive) { g.rotation.set(-Math.PI / 2 * 0.9, bot.body.yaw, 0); continue; }
      const st = g.userData.stance || 0;
      g.rotation.set(st === 1 ? 0.14 : 0, bot.body.yaw, st === 2 ? 0.16 : 0);
      const sp = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
      const wob = Math.sin(time * 9 + bot.id.length) * Math.min(0.5, sp * 0.12);
      g.userData.legL.rotation.x = st === 1 ? 0.55 : wob;
      g.userData.legR.rotation.x = st === 1 ? -0.35 : -wob;
      g.userData.armL.rotation.x = st === 2 ? -0.6 : -0.9;
      g.userData.armR.rotation.x = st === 2 ? -0.7 : -1.1;
      g.position.y = bot.body.position.y + (st === 1 ? -0.26 : 0) + Math.abs(Math.sin(time * 9)) * 0.03 * Math.min(1, sp / 4);
    }
    // VFX pools.
    updatePool(tracers, dt, (i, it) => {
      if (it.life <= 0.02) hidePoolItem(tracers, i);
    });
    updatePool(casings, dt, (i, it) => {
      casingVel[i].y -= 14 * dt;
      tracers.mesh.getMatrixAt; // no-op guard: casings use their own matrix
      casings.mesh.getMatrixAt(i, _m1);
      _v1.setFromMatrixPosition(_m1);
      _v1.addScaledVector(casingVel[i], dt);
      if (_v1.y < 0.03) { _v1.y = 0.03; casingVel[i].y = Math.abs(casingVel[i].y) * 0.3; casingVel[i].x *= 0.6; casingVel[i].z *= 0.6; }
      _m1.makeTranslation(_v1.x, _v1.y, _v1.z);
      casings.mesh.setMatrixAt(i, _m1);
      casings.mesh.instanceMatrix.needsUpdate = true;
    });
    updatePool(sparks, dt, (i) => {
      sparkVel[i].y -= 12 * dt;
      sparks.mesh.getMatrixAt(i, _m1);
      _v1.setFromMatrixPosition(_m1);
      _v1.addScaledVector(sparkVel[i], dt);
      _m1.makeTranslation(_v1.x, _v1.y, _v1.z);
      sparks.mesh.setMatrixAt(i, _m1);
      sparks.mesh.instanceMatrix.needsUpdate = true;
    });
    updatePool(smoke, dt, (i, it) => {
      const grow = 1 - it.life / it.max;
      smokeScale[i] += (smokeMax[i] - smokeScale[i]) * Math.min(1, dt * 0.8);
      smoke.mesh.getMatrixAt(i, _m1);
      _v1.setFromMatrixPosition(_m1);
      _v1.y += dt * 0.12;
      _m1.makeScale(smokeScale[i], smokeScale[i] * 0.8, smokeScale[i]);
      _m1.setPosition(_v1);
      smoke.mesh.setMatrixAt(i, _m1);
      smoke.mesh.instanceMatrix.needsUpdate = true;
      smoke.mesh.material.opacity = 0.42 * Math.min(1, it.life / 4);
      void grow;
    });
    if (muzzleLight.intensity > 0 && time > muzzleUntil) muzzleLight.intensity = 0;

    // Planted-charge beacon pulses while the charge is live.
    if (state.planted) {
      beacon.visible = true;
      const gy = state.plantSite === 'B' ? -1.2 : 0;
      beacon.position.set(state.plantX, gy, state.plantZ);
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      beaconCore.scale.setScalar(1 + pulse * 0.45);
      beaconCore.rotation.y = time * 2;
      beaconRing.scale.setScalar(1 + pulse * 0.5);
      beaconLight.intensity = 2 + pulse * 5;
    } else beacon.visible = false;

    // Dust motes drift slowly through the sunbeams.
    const pos = moteGeo.attributes.position.array;
    for (let i = 0; i < moteCount; i += 1) {
      pos[i * 3 + 1] -= dt * 0.06;
      pos[i * 3] += Math.sin(time * 0.3 + moteSeed[i]) * dt * 0.05;
      if (pos[i * 3 + 1] < 0.4) pos[i * 3 + 1] = 8.5;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // ---- Viewmodel springs ----
    if (playerBody && view) {
      const yawVel = (playerBody.yaw - lastYaw) / Math.max(dt, 0.001);
      const pitchVel = (playerBody.pitch - lastPitch) / Math.max(dt, 0.001);
      lastYaw = playerBody.yaw; lastPitch = playerBody.pitch;
      spring(swayX, THREE.MathUtils.clamp(-yawVel * 0.004, -0.09, 0.09), 90, 14, dt);
      spring(swayY, THREE.MathUtils.clamp(pitchVel * 0.004, -0.06, 0.06), 90, 14, dt);
      const speed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
      const bobAmp = playerBody.onGround ? Math.min(0.035, speed * 0.006) : 0;
      spring(bob, Math.sin(time * (playerBody.crouch ? 6 : 10)) * bobAmp, 120, 18, dt);
      spring(kick, 0, 140, 16, dt);
      spring(tilt, 0, 60, 10, dt);
      spring(ads, view.ads ? 1 : 0, 120, 20, dt);
      const a = ads.x;
      vmGroup.position.set(
        0.28 * (1 - a) + 0 * a + swayX.x,
        -0.26 * (1 - a) + -0.19 * a + swayY.x + bob.x,
        -0.55 + kick.x * 0.12,
      );
      vmGroup.rotation.set(tilt.x * 0.5 + kick.x * 0.35, swayX.x * 0.6, tilt.x * 0.9);
      vmGroup.visible = !view.scoped;
    }
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return {
    scene, camera, renderer, step, equip, fireKick, reloadTilt,
    spawnTracer, spawnCasing, spawnSparks, spawnDecal, spawnSmoke, flashMuzzle,
    makeOperator,
    setFov(fov) { camera.fov = fov; camera.updateProjectionMatrix(); },
  };
}
