// VERDIGRIS TERMINAL — state.js: the single source of truth for the whole match.
// Every module reads and writes this one object; nothing else keeps match state.
// Phases: 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'.
export function createState() {
  return {
    time: 0, phase: 'menu', round: 1,
    score: { aurora: 0, meridian: 0 },
    lossStreak: { aurora: 0, meridian: 0 },
    buyTime: 0, roundTime: 100, fuseTime: 0,
    planted: false, plantSite: null, plantProgress: 0, defuseProgress: 0,
    plantX: 0, plantZ: 0, // world position of the planted charge (beacon anchor)
    carrier: 'player', // 'player' | bot id | null (dropped)
    playerActor: null, members: { aurora: [], meridian: [] },
    events: [], // {kind, text, at} — kill feed + radio log, newest first
    shotNoise: [], // {x, z, radius, at} — bots investigate these
    smokes: [], // {x, y, z, r, until} — live smoke clouds, block bot LOS
    flashes: [], // {x, y, z, at} — recent flash detonations
    spectateIndex: 0,
    roundStats: { shots: 0, hits: 0, headshots: 0, kills: 0 },
    winner: null,
  };
}

export function logEvent(state, kind, text) {
  state.events.unshift({ kind, text, at: state.time });
  if (state.events.length > 24) state.events.length = 24;
}

// Deterministic RNG (mulberry32) — one stream for the sim, one for bot brains.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
