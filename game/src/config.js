// VERDIGRIS TERMINAL — config.js: the one place for every number the game balances on.
// Setting: an ornate sunlit Art-Deco botanical conservatory & sunken metro concourse.
// Attackers AURORA (crimson / terracotta / brass) vs defenders MERIDIAN (cobalt / ivory / teal).
export const PALETTE = {
  canvas: '#0b1016', skyTop: '#7fb2e0', skyLow: '#f2c98f',
  travertine: '#dfd5c3', limestone: '#c7b9a1', verdigris: '#1f5b5c', verdigrisLight: '#2e7d7a',
  bronze: '#8f6b32', brass: '#d6ad60', foliage: '#2d6a4f', foliageLight: '#40916c',
  ink: '#efe9dc', muted: '#9aa8a0', accent: '#d6ad60', danger: '#c0392b',
  aurora: '#c0392b', auroraTrim: '#d97b4a', meridian: '#1f4e79', meridianTrim: '#2e7d7a',
  panel: 'rgba(11,16,22,0.78)', hairline: 'rgba(214,173,96,0.35)',
};

export const TICK = 1 / 60;
export const ROUND_SECONDS = 100;
export const BUY_SECONDS = 15;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
export const DEFUSE_KIT_SECONDS = 2.5;
export const FUSE_SECONDS = 35;
export const MATCH_WIN_ROUNDS = 5;
export const MATCH_MAX_ROUNDS = 9;
export const MAP = { minX: -39, maxX: 39, minZ: -32, maxZ: 32 };

export const ECONOMY = {
  start: 800, kill: 300, killSmg: 600, win: 3250, loss: 1900,
  lossStreakBonus: 500, plant: 300, defuse: 300, roundWinBonus: 0,
};

// Weapons. damage = torso damage at close range; falloff starts past falloffStart
// and bottoms at falloffMin. headMult 3.8 (helmet trims it), legMult 0.75.
// slot: HUD weapon key. price 0 = owned from round start.
export const WEAPONS = {
  karambit: { name: 'Brass Karambit', short: 'KARAMBIT', price: 0, slot: 1, auto: false,
    mag: Infinity, reserve: Infinity, damage: 55, headMult: 3.8, legMult: 0.75,
    fireGap: 0.45, reloadTime: 0, spreadStill: 0, spreadMove: 0, bloom: 0, recoil: 0.004,
    range: 2.2, falloffStart: 0, falloffMin: 1, moveSpeed: 6.4, melee: true, tracer: 0xd6ad60 },
  vesper: { name: 'Vesper-9 Sidearm', short: 'VESPER-9', price: 0, slot: 2, auto: false,
    mag: 15, reserve: 60, damage: 34, headMult: 3.8, legMult: 0.75,
    fireGap: 0.15, reloadTime: 1.3, spreadStill: 0.003, spreadMove: 0.019,
    bloom: 0.0035, recoil: 0.009, range: 55, falloffStart: 16, falloffMin: 0.6,
    moveSpeed: 5.8, tracer: 0xefe9dc },
  kestrel: { name: 'Kestrel-45 SMG', short: 'KESTREL-45', price: 1250, slot: 3, auto: true,
    mag: 30, reserve: 120, damage: 26, headMult: 3.8, legMult: 0.75,
    fireGap: 0.075, reloadTime: 1.9, spreadStill: 0.004, spreadMove: 0.024,
    bloom: 0.005, recoil: 0.007, range: 45, falloffStart: 13, falloffMin: 0.55,
    moveSpeed: 5.8, killReward: 600, tracer: 0xd97b4a },
  sovereign: { name: 'Sovereign-76 Carbine', short: 'SOVEREIGN-76', price: 2700, slot: 3, auto: true,
    mag: 30, reserve: 90, damage: 34, headMult: 3.8, legMult: 0.75,
    fireGap: 0.1, reloadTime: 2.2, spreadStill: 0.0022, spreadMove: 0.028,
    bloom: 0.0045, recoil: 0.012, range: 70, falloffStart: 22, falloffMin: 0.65,
    moveSpeed: 5.2, tracer: 0xf0c060 },
  longbow: { name: 'Longbow-M2 Marksman', short: 'LONGBOW-M2', price: 4500, slot: 3, auto: false,
    mag: 5, reserve: 20, damage: 95, headMult: 3.8, legMult: 0.75,
    fireGap: 1.0, reloadTime: 3.1, spreadStill: 0.0008, spreadMove: 0.05,
    bloom: 0.02, recoil: 0.035, range: 95, falloffStart: 30, falloffMin: 0.8,
    moveSpeed: 4.6, scoped: true, tracer: 0x9fd8ff },
};

export const GRENADES = {
  smoke: { name: 'Vapor Smoke', short: 'SMOKE', price: 300, radius: 5.5, fuse: 0.9, life: 16, color: '#cfd8d3' },
  flash: { name: 'Prism Flash', short: 'FLASH', price: 250, radius: 14, fuse: 1.1, life: 0, color: '#ffffff' },
  frag: { name: 'Shard Frag', short: 'FRAG', price: 350, radius: 7, fuse: 1.6, life: 0, damage: 115, color: '#d97b4a' },
};

export const ARMOR = { name: 'Bronze Plate', price: 650, points: 50, absorb: 0.5 };
export const HELMET = { name: 'Plate + Helm', price: 1000, points: 50, absorb: 0.5, helmet: true };
export const DEFUSE_KIT = { name: 'Defuse Kit', price: 400 };

export const BOT = {
  health: 100, reactionMin: 0.35, reactionMax: 0.85,
  burstMin: 3, burstMax: 6, pauseMin: 0.5, pauseMax: 1.1,
  aimError: 0.042, hearRadius: 26, seeDistance: 55, seeFov: 1.9,
  walkSpeed: 4.4, runSpeed: 5.2, rotateDelay: 2.5,
};

export const PLAYER = { eye: 1.62, eyeCrouch: 1.08, radius: 0.38, height: 1.75, walkSpeed: 5.4 };
