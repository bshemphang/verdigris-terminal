# VERDIGRIS TERMINAL

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/bshemphang/verdigris-terminal/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/bshemphang/verdigris-terminal/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Built for the [make.fun threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02). Referral: https://make.fun/r/v6wvv0dh

A 100% original three.js tactical FPS for the make.fun **threejs-fps-02** bounty.
An ornate, sunlit Art-Deco Botanical Conservatory and Sunken Metro Concourse:
attackers **AURORA** (crimson / terracotta / brass) plant the Resonator Charge at
Site A (Conservatory Atrium) or Site B (Vault Rail Concourse, beside the parked
art-deco tram); defenders **MERIDIAN** (cobalt / ivory / teal) hold the terminal.
First to 5 rounds takes the match (max 9).

## How to play

Serve `game/` with any static server (`node serve.ts`, then open
http://localhost:8080) and click **DEPLOY**.

- **WASD** move · **Shift** silent walk · **Ctrl/C** crouch · **Space** jump
- **Mouse** look · **Click** fire · **R** reload · **RMB** scope (Longbow-M2, wheel toggles 4x/8x)
- **1** Karambit · **2** Vesper-9 · **3** primary · **4/5/6** smoke / flash / frag · **G** throw
- **E** plant / defuse (hold) · **B** buy menu during the buy phase
- If you die, you spectate your teammates (click or **Q** to cycle).

## Features

- 5 weapons (Brass Karambit, Vesper-9, Kestrel-45 SMG, Sovereign-76 carbine,
  Longbow-M2 marksman) and 3 grenades (Vapor Smoke that really blocks bot
  vision, Prism Flash, Shard Frag), plus armor, helmet and defuse kit.
- Full round economy: kill bounties, plant/defuse bonuses, win/loss payouts
  with a loss-streak bonus, and a buy menu.
- 5v5 bots on a ~40-waypoint nav-graph (BFS pathing) with a BUY / ADVANCE /
  HOLD_ANGLE / ENGAGE / INVESTIGATE_SOUND / ROTATE / PLANT / DEFUSE state
  machine. Bots burst-fire with reaction delays, counter-strafe peeks,
  investigate gunfire, and rotate on a plant.
- Multi-zone hitboxes (head 3.8x, chest 1.0x, legs 0.75x; helmets trim heads),
  recoil and spread that punish firing on the move, crouch and jump.
- Spring-physics viewmodels (sway, bob, ADS blend, kickback, reload tilt),
  pooled InstancedMesh VFX (tracers, casings, sparks, decals, smoke), a pooled
  muzzle-flash light, dust motes in the skylight beams, and procedural Web
  Audio (per-gun reports, footsteps, headshot dink, smoke hiss, flash ring,
  frag boom, plant beeps).
- Editorial HUD: Canvas2D radar minimap, kill feed, alive diamond pips,
  round timer, health/armor/cash/ammo, dynamic crosshair, hitmarker, radial
  plant/defuse ring, and RADIO callout toasts.
- Baked procedural IBL (PMREM, once at boot), ACES tone mapping, PCF soft
  skylight shadows, and fully procedural CanvasTexture materials and signage.
  Zero network requests, zero external assets, zero bundler.

## Module layout

```
game/index.html   import map + HUD shell + CSS
game/src/config.js    weapons, economy, palette, tuning constants
game/src/state.js     single source of truth for the match
game/src/map.js       architecture, AABB colliders, ramps, nav-graph, signs
game/src/sim.js       fixed 1/60 sim: kinematics, hitboxes, grenades, rounds
game/src/ai.js        bot buy logic, pathing, LOS + smoke, state machine
game/src/textures.js  procedural CanvasTexture materials and signs
game/src/renderer.js  scene, IBL, operators, viewmodels, VFX pools
game/src/audio.js     procedural Web Audio soundscape
game/src/hud.js       HUD, radar, buy menu, scoreboard, scope overlay
game/src/main.js      fixed-timestep loop, input, shot staging, boot
```

## License

MIT — see `LICENSE`. All art, names, map, and code are original work made
for this bounty.
