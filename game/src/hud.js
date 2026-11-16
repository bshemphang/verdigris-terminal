// VERDIGRIS TERMINAL - hud.js: the editorial tactical HUD.
// Obsidian-glass panels, brass hairlines, tabular monospace numerals, inline SVG
// silhouettes (no emojis). Top-center score + alive diamond pips + Round X/9 +
// timer; top-left Canvas2D radar; top-right kill feed; bottom health/armor/cash/
// weapon strip/ammo; center crosshair + hitmarker + radial E ring + RADIO toast.
// DOM writes are throttled: text only changes when the value changes.
import { WEAPONS, GRENADES, ARMOR, HELMET, DEFUSE_KIT } from './config.js';

const $ = (id) => document.getElementById(id);
const SVG = {
  rifle: '<svg viewBox="0 0 64 24" width="46" height="18"><path d="M2 12h34l4-4h8l2 4h10l4 2-4 2H48l-2 4H38l-2-4H2z" fill="currentColor"/></svg>',
  smg: '<svg viewBox="0 0 64 24" width="46" height="18"><path d="M2 10h30l3-3h10l2 3h12l3 2-3 2H46l-2 5h-8l-2-5H2z" fill="currentColor"/></svg>',
  pistol: '<svg viewBox="0 0 64 24" width="40" height="16"><path d="M4 6h40l4 3-4 3H26l-2 8H16l2-8H4z" fill="currentColor"/></svg>',
  sniper: '<svg viewBox="0 0 64 24" width="52" height="18"><path d="M2 11h44l2-3h6l2 3h4l2 1-2 1h-6l-2 3H40l-2-3H2z" fill="currentColor"/><circle cx="34" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  knife: '<svg viewBox="0 0 64 24" width="40" height="16"><path d="M2 14L40 6l20 6-20 4z" fill="currentColor"/></svg>',
  smoke: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="8" cy="14" r="5" fill="currentColor" opacity=".7"/><circle cx="15" cy="10" r="6" fill="currentColor" opacity=".5"/><circle cx="18" cy="16" r="4" fill="currentColor" opacity=".8"/></svg>',
  flash: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor"/></svg>',
  frag: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="14" r="8" fill="currentColor"/><rect x="10" y="2" width="4" height="6" fill="currentColor"/></svg>',
  armor: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/></svg>',
  kit: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="7" width="18" height="13" rx="2" fill="currentColor"/><path d="M9 7V5a3 3 0 016 0v2" fill="none" stroke="#0b1016" stroke-width="2"/></svg>',
  headshot: '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
};
const WEAPON_SVG = { karambit: SVG.knife, vesper: SVG.pistol, kestrel: SVG.smg, sovereign: SVG.rifle, longbow: SVG.sniper };

function diamond(color, alive) {
  return `<span style="display:inline-block;width:9px;height:9px;transform:rotate(45deg);background:${alive ? color : 'transparent'};border:1px solid ${color};margin:0 2px"></span>`;
}

export function createHud(opts) {
  const els = {
    timer: $('timer-value'), score: $('score-value'), round: $('round-label'),
    aliveA: $('alive-aurora'), aliveM: $('alive-meridian'),
    feed: $('feed'), health: $('health-value'), healthBar: $('health-bar'),
    armor: $('armor-value'), money: $('money-value'), ammoMag: $('ammo-mag'),
    ammoRes: $('ammo-reserve'), weaponName: $('weapon-name'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), hurt: $('hurt'),
    progress: $('progress'), progressLabel: $('progress-label'), progressFill: $('progress-fill'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'), buyCash: $('buy-cash'), buyGrid: $('buy-grid'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    radio: $('radio'), scope: $('scope'), radar: $('radar'), hint: $('hint'),
    strip: $('weapon-strip'), carrier: $('carrier-value'), plantTimer: $('plant-timer'),
  };
  const radarCtx = els.radar.getContext('2d');
  const cache = {};
  let buyOpenFlag = false;
  let feedCount = 0;

  function setText(el, key, value) {
    if (cache[key] !== value) { cache[key] = value; el.textContent = value; }
  }
  function setHtml(el, key, value) {
    if (cache[key] !== value) { cache[key] = value; el.innerHTML = value; }
  }

  let bannerTimer = 0;
  function showBanner(title, sub, ms = 2500) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { els.banner.hidden = true; }, ms);
  }
  let radioTimer = 0;
  function showRadio(text, sticky) {
    els.radio.textContent = text;
    els.radio.hidden = false;
    clearTimeout(radioTimer);
    if (!sticky) radioTimer = setTimeout(() => { els.radio.hidden = true; }, 3200);
  }
  let hitTimer = 0;
  function hitMarker(kill, headshot, sticky) {
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', !!kill);
    els.hitmarker.classList.toggle('head', !!headshot);
    clearTimeout(hitTimer);
    if (!sticky) hitTimer = setTimeout(() => els.hitmarker.classList.remove('on'), kill ? 500 : 160);
  }
  function hurtFlash() {
    els.hurt.classList.add('on');
    setTimeout(() => els.hurt.classList.remove('on'), 140);
  }

  function setScore(a, m, round) {
    setHtml(els.score, 'score', `<span class="a">AURORA ${a}</span> - <span class="m">${m} MERIDIAN</span>`);
    setText(els.round, 'round', `ROUND ${round} / 9`);
  }
  function setAlive(aAlive, aTotal, mAlive, mTotal) {
    let a = '', m = '';
    for (let i = 0; i < aTotal; i += 1) a += diamond('#c0392b', i < aAlive);
    for (let i = 0; i < mTotal; i += 1) m += diamond('#4a90c2', i < mAlive);
    setHtml(els.aliveA, 'aliveA', a);
    setHtml(els.aliveM, 'aliveM', m);
  }
  function setTimer(seconds, planted) {
    const s = Math.max(0, Math.ceil(seconds));
    setText(els.timer, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    els.timer.classList.toggle('planted', !!planted);
    els.timer.classList.toggle('low', !planted && seconds < 15);
  }
  function setHealth(hp, armor) {
    setText(els.health, 'hp', String(Math.max(0, Math.round(hp))));
    els.healthBar.style.width = `${Math.max(0, hp)}%`;
    els.healthBar.classList.toggle('low', hp <= 30);
    setText(els.armor, 'armor', armor > 0 ? `ARMOR ${Math.round(armor)}` : '');
  }
  function setMoney(cash) { setText(els.money, 'money', `$${cash}`); }
  function setAmmo(mag, reserve, name) {
    setText(els.ammoMag, 'mag', mag === Infinity ? '-' : String(mag));
    setText(els.ammoRes, 'res', reserve === Infinity ? '' : `/ ${reserve}`);
    setText(els.weaponName, 'wname', name);
  }
  function setCarrier(text) { setText(els.carrier, 'carrier', text); }
  function setPlantTimer(text) { setText(els.plantTimer, 'plant', text); }
  function setCrosshairSpread(px) {
    els.crosshair.style.setProperty('--gap', `${px}px`);
  }
  function setProgress(label, frac) {
    els.progress.hidden = false;
    setText(els.progressLabel, 'prog', label);
    els.progressFill.style.width = `${Math.round(frac * 100)}%`;
  }
  function hideProgress() { els.progress.hidden = true; }
  function setStrip(current, owned, grenadesOf) {
    const items = [
      ['1', 'KARAMBIT', WEAPON_SVG.karambit, true],
      ['2', 'VESPER-9', WEAPON_SVG.vesper, true],
      ['3', owned.primary || '-', WEAPON_SVG[owned.primaryId] || SVG.rifle, !!owned.primary],
      ['4', `SMOKE ×${grenadesOf.smoke || 0}`, SVG.smoke, (grenadesOf.smoke || 0) > 0],
      ['5', `FLASH ×${grenadesOf.flash || 0}`, SVG.flash, (grenadesOf.flash || 0) > 0],
      ['6', `FRAG ×${grenadesOf.frag || 0}`, SVG.frag, (grenadesOf.frag || 0) > 0],
    ];
    const html = items.map(([key, name, svg, has]) =>
      `<span class="strip-item${has ? '' : ' dim'}">${svg}<b>${key}</b> ${name}</span>`).join('');
    setHtml(els.strip, 'strip', html);
  }

  // ---- Radar: Canvas2D architectural minimap ----
  function drawRadar(player, bots, map, state) {
    const g = radarCtx;
    const W = 190, H = 156;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(11,16,22,0.78)';
    g.fillRect(0, 0, W, H);
    const sx = (x) => (x + 39) / 78 * W;
    const sy = (z) => (z + 32) / 64 * H;
    // Walls.
    g.strokeStyle = 'rgba(214,173,96,0.55)'; g.lineWidth = 1.4;
    for (const c of map.colliders) {
      if (c.maxY < 2) continue;
      g.strokeRect(sx(c.minX), sy(c.minZ), sx(c.maxX) - sx(c.minX), sy(c.maxZ) - sy(c.minZ));
    }
    // Sites.
    g.font = 'bold 10px monospace'; g.textAlign = 'center';
    g.fillStyle = '#d6ad60'; g.fillText('A', sx(-28), sy(-17));
    g.fillText('B', sx(28), sy(-17));
    if (state.planted) {
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 6);
      g.fillStyle = `rgba(192,57,43,${0.5 + pulse * 0.5})`;
      g.beginPath(); g.arc(sx(state.plantSite === 'A' ? -28 : 28), sy(-17), 5 + pulse * 3, 0, 7); g.fill();
    }
    // Teammates (crimson diamonds), enemies only when spotted (faint).
    for (const b of bots) {
      if (!b.alive) continue;
      const isTeam = b.team === 'aurora';
      g.fillStyle = isTeam ? '#e06a4a' : 'rgba(74,144,194,0.85)';
      g.save();
      g.translate(sx(b.body.position.x), sy(b.body.position.z));
      g.rotate(Math.PI / 4);
      g.fillRect(-3, -3, 6, 6);
      g.restore();
    }
    // Player: FOV cone + dot.
    if (player && player.alive) {
      g.fillStyle = 'rgba(239,233,220,0.18)';
      g.beginPath();
      g.moveTo(sx(player.body.position.x), sy(player.body.position.z));
      const a = player.body.yaw;
      const fx = -Math.sin(a), fz = -Math.cos(a);
      const spread = 0.5, len = 26;
      g.lineTo(sx(player.body.position.x) + (fx * Math.cos(spread) - fz * Math.sin(spread)) * len * (W / 78),
        sy(player.body.position.z) + (fx * Math.sin(spread) + fz * Math.cos(spread)) * len * (H / 64));
      g.lineTo(sx(player.body.position.x) + (fx * Math.cos(-spread) - fz * Math.sin(-spread)) * len * (W / 78),
        sy(player.body.position.z) + (fx * Math.sin(-spread) + fz * Math.cos(-spread)) * len * (H / 64));
      g.closePath(); g.fill();
      g.fillStyle = '#efe9dc';
      g.beginPath(); g.arc(sx(player.body.position.x), sy(player.body.position.z), 3.5, 0, 7); g.fill();
    }
  }

  // ---- Kill feed ----
  function feedEvents(events) {
    if (events.length === feedCount) return;
    feedCount = events.length;
    els.feed.innerHTML = events.slice(0, 5).map((e) => {
      const cls = e.kind === 'kill' ? 'kill' : e.kind === 'plant' ? 'plant' : e.kind === 'defuse' ? 'defuse' : e.kind === 'win' ? 'win' : '';
      const icon = e.kind === 'kill' ? SVG.headshot : '';
      return `<div class="feed-row ${cls}">${icon} ${e.text}</div>`;
    }).join('');
  }

  // ---- Buy menu ----
  const BUY_ITEMS = [
    { id: 'kestrel', name: 'Kestrel-45 SMG', price: 1250, svg: SVG.smg, desc: 'High ROF · close range · $600 kill reward' },
    { id: 'sovereign', name: 'Sovereign-76 Carbine', price: 2700, svg: SVG.rifle, desc: '1-tap headshot · tactical spray' },
    { id: 'longbow', name: 'Longbow-M2 Marksman', price: 4500, svg: SVG.sniper, desc: 'RMB dual-zoom scope · 1-shot chest' },
    { id: 'smoke', name: 'Vapor Smoke', price: 300, svg: SVG.smoke, desc: 'Dense cloud · blocks bot vision' },
    { id: 'flash', name: 'Prism Flash', price: 250, svg: SVG.flash, desc: 'Blinds facing enemies' },
    { id: 'frag', name: 'Shard Frag', price: 350, svg: SVG.frag, desc: 'Bouncing fuse · radial damage' },
    { id: 'armor', name: 'Bronze Plate', price: 650, svg: SVG.armor, desc: '50 armor · soaks half of every hit' },
    { id: 'helmet', name: 'Plate + Helm', price: 1000, svg: SVG.armor, desc: '50 armor · trims headshot damage' },
    { id: 'kit', name: 'Defuse Kit', price: 400, svg: SVG.kit, desc: 'Defuse in 2.5s instead of 5s' },
  ];
  function renderBuy(cash) {
    setText(els.buyCash, 'buycash', `$${cash}`);
    els.buyGrid.innerHTML = BUY_ITEMS.map((it) =>
      `<button class="buy-item" data-item="${it.id}"><span class="buy-svg">${it.svg}</span><span class="buy-name">${it.name}</span><span class="buy-desc">${it.desc}</span><span class="buy-price">$${it.price}</span></button>`).join('');
    els.buyGrid.querySelectorAll('.buy-item').forEach((btn) => {
      btn.addEventListener('click', () => opts.onBuy(btn.dataset.item));
    });
  }
  function showBuy(open, cash) {
    buyOpenFlag = open;
    els.buyMenu.hidden = !open;
    if (open) renderBuy(cash ?? 0);
  }
  function buyOpen() { return buyOpenFlag; }

  // ---- Overlays / scope ----
  function showOverlay(kind, data) {
    els.overlay.hidden = false;
    if (kind === 'menu') {
      els.overlayTitle.textContent = 'VERDIGRIS TERMINAL';
      els.overlayCopy.innerHTML = 'AURORA attacks · MERIDIAN defends<br>Plant the Resonator Charge at Site A or Site B - or eliminate MERIDIAN.<br><br>WASD move · Shift walk silent · Ctrl crouch · Space jump<br>Click fire · R reload · 1–3 weapons · 4–6 grenades · G throw · E plant / defuse<br>B buy menu · RMB scope (Longbow-M2)';
      $('play').textContent = 'DEPLOY - ROUND 1';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'PAUSED';
      els.overlayCopy.textContent = 'Click to resume. Your squad holds the terminal.';
      $('play').textContent = 'RESUME';
    } else if (kind === 'matchEnd') {
      els.overlayTitle.textContent = data.title;
      els.overlayCopy.textContent = data.copy;
      $('play').textContent = 'PLAY AGAIN';
    }
  }
  function hideOverlay() { els.overlay.hidden = true; }
  function showScope(on) { els.scope.hidden = !on; }
  function setScopeZoom(level) {
    els.scope.querySelector('.scope-zoom').textContent = level === 2 ? '8x' : '4x';
  }
  function onPlay(cb) { $('play').addEventListener('click', cb); }

  return {
    setScore, setAlive, setTimer, setHealth, setMoney, setAmmo, setCarrier, setPlantTimer,
    setCrosshairSpread, setProgress, hideProgress, setStrip, drawRadar, feedEvents,
    showBanner, showRadio, hitMarker, hurtFlash, showBuy, buyOpen, renderBuy,
    showOverlay, hideOverlay, showScope, setScopeZoom, onPlay,
  };
}
