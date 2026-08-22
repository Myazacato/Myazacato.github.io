/* ==========================================================================
   Diana — browser demo
   --------------------------------------------------------------------------
   A condensed version of the Godot build's flight scene. The numbers here are
   lifted from the real game so the feel carries over:

     - speed curve      : fast ramp -> shoulder -> endless creep
     - chunk spawner    : authored patterns emitted on distance, with a
                          guaranteed breather every few chunks
     - cargo integrity  : hazards and hard bounces degrade the cargo, and the
                          delivery grade decides both the pay share and the rep
     - coins            : the pathing language, never scattered at random

   No dependencies, no build step. One file.
   ========================================================================== */

(() => {
  'use strict';

  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  /* ----------------------------- tuning --------------------------------- */

  const PLANE_X  = 190;   // the plane holds station here; the world moves past it
  const PLAY_TOP = 62;
  const FLOOR    = 486;

  // Speed curve, straight from the Godot build.
  const BASE_SCROLL_SPEED = 220;
  const MAX_SCROLL_SPEED  = 480;
  const SPEED_RAMP_TAU    = 22;
  const SPEED_CREEP       = 3.4;
  const PIXELS_PER_METER  = BASE_SCROLL_SPEED / 60;

  // Contract 01 — "Seed Run". Target extended a little for the demo so the
  // speed ramp has room to actually show itself.
  const PAY_PER_METER   = 0.40;
  const FUEL_DRAIN_MULT = 0.8;
  const SPEED_MULT      = 0.9;
  const DISTANCE_TARGET = 900;

  // Cargo model.
  const CARGO_MAX            = 100;
  const CARGO_HAZARD_DAMAGE  = 18;
  const CARGO_BOUNCE_DAMAGE  = 10;
  const CARGO_HIGH_G_THRESH  = 350;
  const CARGO_HIGH_G_DRAIN   = 8;

  const GRADES = [
    { grade: 'S', min: 90, pay: 1.00, rep: 25, color: '#00f0ff' },
    { grade: 'A', min: 75, pay: 0.80, rep: 15, color: '#5cff9d' },
    { grade: 'B', min: 55, pay: 0.60, rep:  8, color: '#ffd75c' },
    { grade: 'C', min: 30, pay: 0.40, rep:  3, color: '#ff9d3d' },
    { grade: 'F', min:  0, pay: 0.25, rep:  0, color: '#ff4d6d' },
  ];
  const gradeFor = (integrity) => GRADES.find(g => integrity >= g.min) || GRADES[GRADES.length - 1];

  const COMPLETION_BONUS_MULT = 1.25;

  // Flight physics.
  const GRAVITY     = 1500;
  const THRUST      = -2750;
  const VEL_CLAMP   = 700;
  const TRAMP_BOOST = -780;

  // Fuel.
  const FUEL_MAX          = 100;
  const FUEL_DRAIN_IDLE   = 4.2;
  const FUEL_DRAIN_THRUST = 11.0;
  const FUEL_PICKUP_GAIN  = 26;

  // Spawner.
  const SPAWN_X = W + 90;
  const CHUNK_GAP_PIXELS = 330;
  const CHUNKS_BETWEEN_BREATHERS = 3;

  // Sky tint by altitude, same idea as the Godot build.
  const GROUND_SKY = [13, 8, 23];
  const HIGH_SKY   = [3, 18, 41];

  /* --------------------------- authored chunks --------------------------- */
  /* {dx, y, t} — dx is pixels from the chunk's leading edge, y is absolute.
     Coins trace the line you are meant to fly, or bait you into a worse one. */

  const CHUNKS = [
    { name: 'coin_arc', difficulty: 0, length: 640, entries: [
      { dx:   0, y: 420, t: 'coin' }, { dx:  70, y: 370, t: 'coin' },
      { dx: 140, y: 320, t: 'coin' }, { dx: 210, y: 285, t: 'coin' },
      { dx: 280, y: 270, t: 'coin' }, { dx: 350, y: 285, t: 'coin' },
      { dx: 420, y: 320, t: 'coin' }, { dx: 490, y: 370, t: 'coin' },
      { dx: 560, y: 420, t: 'coin' }, { dx: 280, y: 170, t: 'fuel' },
    ]},
    { name: 'refuel_lane', difficulty: 0, length: 620, entries: [
      { dx:   0, y: 300, t: 'fuel' }, { dx: 200, y: 250, t: 'fuel' },
      { dx: 400, y: 200, t: 'fuel' }, { dx: 100, y: 380, t: 'coin' },
      { dx: 300, y: 340, t: 'coin' }, { dx: 500, y: 300, t: 'coin' },
    ]},
    { name: 'hop_pads', difficulty: 1, length: 700, entries: [
      { dx:   0, y: 452, t: 'tramp' }, { dx:  60, y: 330, t: 'coin' },
      { dx: 120, y: 260, t: 'coin' },  { dx: 260, y: 452, t: 'tramp' },
      { dx: 320, y: 330, t: 'coin' },  { dx: 380, y: 260, t: 'coin' },
      { dx: 520, y: 452, t: 'tramp' }, { dx: 580, y: 320, t: 'fuel' },
    ]},
    { name: 'low_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 170, t: 'zapper_h' }, { dx: 380, y: 170, t: 'zapper_h' },
      { dx: 100, y: 400, t: 'coin' }, { dx: 180, y: 400, t: 'coin' },
      { dx: 260, y: 400, t: 'coin' }, { dx: 340, y: 400, t: 'coin' },
      { dx: 420, y: 400, t: 'coin' }, { dx: 500, y: 400, t: 'fuel' },
    ]},
    { name: 'high_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 400, t: 'zapper_h' }, { dx: 380, y: 400, t: 'zapper_h' },
      { dx: 100, y: 160, t: 'coin' }, { dx: 180, y: 160, t: 'coin' },
      { dx: 260, y: 160, t: 'coin' }, { dx: 340, y: 160, t: 'coin' },
      { dx: 420, y: 160, t: 'coin' }, { dx: 500, y: 160, t: 'fuel' },
    ]},
    { name: 'pillar_gate', difficulty: 2, length: 720, entries: [
      { dx:   0, y: 120, t: 'zapper_v' }, { dx: 240, y: 400, t: 'zapper_v' },
      { dx: 480, y: 120, t: 'zapper_v' },
      { dx: 120, y: 300, t: 'coin' }, { dx: 360, y: 240, t: 'coin' },
      { dx: 600, y: 300, t: 'coin' }, { dx: 600, y: 180, t: 'fuel' },
    ]},
    { name: 'the_pinch', difficulty: 2, length: 700, entries: [
      { dx: 100, y: 140, t: 'zapper_h' }, { dx: 100, y: 430, t: 'zapper_h' },
      { dx: 420, y: 140, t: 'zapper_h' }, { dx: 420, y: 430, t: 'zapper_h' },
      { dx: 200, y: 290, t: 'coin' }, { dx: 280, y: 290, t: 'coin' },
      { dx: 520, y: 290, t: 'coin' }, { dx: 600, y: 290, t: 'fuel' },
    ]},
    { name: 'greed_shelf', difficulty: 2, length: 680, entries: [
      { dx: 150, y: 300, t: 'zapper_h' }, { dx: 430, y: 300, t: 'zapper_h' },
      // The good money sits behind the beams. That is the bait.
      { dx: 150, y: 130, t: 'coin' }, { dx: 230, y: 120, t: 'coin' },
      { dx: 310, y: 115, t: 'coin' }, { dx: 390, y: 120, t: 'coin' },
      { dx: 470, y: 130, t: 'coin' }, { dx: 300, y: 430, t: 'fuel' },
    ]},
  ];

  const BREATHERS = CHUNKS.filter(c => c.difficulty === 0);
  const PRESSURE  = CHUNKS.filter(c => c.difficulty > 0);

  /* ------------------------------ state --------------------------------- */

  let S = null;
  let running = false;
  let lastTime = 0;
  let holding = false;
  let startArmed = true;       // a run may only start on a fresh key/pointer press
  let resultsLockUntil = 0;    // brief window after a run where input cannot restart it

  const stars = Array.from({ length: 90 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    z: 0.25 + Math.random() * 0.9,
    r: Math.random() * 1.5 + 0.4,
  }));

  function reset() {
    S = {
      t: 0,
      scrolled: 0,
      distance: 0,
      speed: BASE_SCROLL_SPEED * SPEED_MULT,
      planeY: 300,
      vel: 0,
      fuel: FUEL_MAX,
      cargo: CARGO_MAX,
      seeds: 0,
      momentum: 1.0,
      lastDamageDist: 0,
      ents: [],
      particles: [],
      nextChunkAt: 260,
      chunksSinceBreather: 0,
      finishSpawned: false,
      over: false,
      shake: 0,
      flash: 0,
      trail: [],
    };
  }

  /* ---------------------------- spawning -------------------------------- */

  function maybeSpawnChunk() {
    if (S.scrolled < S.nextChunkAt || S.finishSpawned) return;

    // Force a breather regularly so pressure has somewhere to release.
    let chunk;
    if (S.chunksSinceBreather >= CHUNKS_BETWEEN_BREATHERS) {
      chunk = BREATHERS[(Math.random() * BREATHERS.length) | 0];
      S.chunksSinceBreather = 0;
    } else {
      const pool = Math.random() < 0.28 ? BREATHERS : PRESSURE;
      chunk = pool[(Math.random() * pool.length) | 0];
      if (chunk.difficulty === 0) S.chunksSinceBreather = 0;
      else S.chunksSinceBreather++;
    }

    for (const e of chunk.entries) spawnEntry(SPAWN_X + e.dx, e.y, e.t);
    S.nextChunkAt = S.scrolled + chunk.length + CHUNK_GAP_PIXELS;
  }

  function spawnEntry(x, y, t) {
    switch (t) {
      case 'coin':     S.ents.push({ t, x, y, r: 11, spin: Math.random() * 6.28, dead: false }); break;
      case 'fuel':     S.ents.push({ t, x, y, r: 15, dead: false }); break;
      case 'tramp':    S.ents.push({ t, x, y, w: 76, h: 15, dead: false }); break;
      case 'zapper_h': S.ents.push({ t, x, y, w: 168, h: 13, dead: false }); break;
      case 'zapper_v': S.ents.push({ t, x, y, w: 13, h: 168, dead: false }); break;
    }
  }

  function spawnFinish() {
    S.finishSpawned = true;
    S.ents.push({ t: 'finish', x: SPAWN_X, y: PLAY_TOP, w: 18, h: FLOOR - PLAY_TOP, dead: false });
  }

  /* ----------------------------- update --------------------------------- */

  function damageCargo(amount) {
    if (S.over) return;
    S.cargo = Math.max(0, S.cargo - amount);
    S.momentum = 1.0;              // Momentum Bank resets the moment you take a hit.
    S.lastDamageDist = S.distance;
    S.shake = Math.min(16, S.shake + 11);
    S.flash = 0.5;
    for (let i = 0; i < 14; i++) {
      S.particles.push({
        x: PLANE_X, y: S.planeY,
        vx: -160 - Math.random() * 260, vy: (Math.random() - 0.5) * 340,
        life: 0.5 + Math.random() * 0.35, max: 0.85, c: '#ff4d6d',
      });
    }
  }

  function update(dt) {
    S.t += dt;

    // Speed: fast ramp, easing shoulder, then a creep that never stops.
    const ramp = (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * (1 - Math.exp(-S.t / SPEED_RAMP_TAU));
    S.speed = (BASE_SCROLL_SPEED + ramp + SPEED_CREEP * S.t) * SPEED_MULT;

    const dx = S.speed * dt;
    S.scrolled += dx;
    S.distance = S.scrolled / PIXELS_PER_METER;

    // Momentum Bank: ratchets while you stay undamaged.
    if (S.distance - S.lastDamageDist > 120) {
      S.momentum = Math.min(3, 1 + Math.floor((S.distance - S.lastDamageDist) / 120) * 0.15);
    }

    /* --- flight --- */
    const canThrust = holding && S.fuel > 0;
    S.vel += (canThrust ? THRUST : GRAVITY) * dt;
    S.vel = Math.max(-VEL_CLAMP, Math.min(VEL_CLAMP, S.vel));
    S.planeY += S.vel * dt;

    // Ceiling pushes back rather than stopping dead; floor is a hard bounce.
    if (S.planeY < PLAY_TOP) { S.planeY = PLAY_TOP; S.vel = Math.max(S.vel, 120); }
    if (S.planeY > FLOOR) {
      S.planeY = FLOOR;
      if (S.vel > CARGO_HIGH_G_THRESH) damageCargo(CARGO_BOUNCE_DAMAGE);
      S.vel = -Math.abs(S.vel) * 0.28;
    }

    // Sustained high-G flying wears the cargo down even without a collision.
    if (Math.abs(S.vel) > CARGO_HIGH_G_THRESH) {
      S.cargo = Math.max(0, S.cargo - CARGO_HIGH_G_DRAIN * dt);
    }

    /* --- fuel --- */
    S.fuel -= (canThrust ? FUEL_DRAIN_THRUST : FUEL_DRAIN_IDLE) * FUEL_DRAIN_MULT * dt;
    S.fuel = Math.max(0, S.fuel);

    /* --- trail --- */
    S.trail.unshift({ y: S.planeY, thrust: canThrust });
    if (S.trail.length > 22) S.trail.pop();

    /* --- spawn --- */
    maybeSpawnChunk();
    // Spawn the drop zone early enough that it reaches the plane exactly as the
    // odometer hits the target, rather than however long it takes to fly in.
    const RUNWAY_METERS = (SPAWN_X - PLANE_X) / PIXELS_PER_METER;
    if (!S.finishSpawned && S.distance >= DISTANCE_TARGET - RUNWAY_METERS) spawnFinish();

    /* --- entities --- */
    const px = PLANE_X, pr = 17;
    for (const e of S.ents) {
      e.x -= dx;
      if (e.x < -260) e.dead = true;
      if (e.dead) continue;

      if (e.t === 'coin') {
        e.spin += dt * 5;
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.seeds++;
          burst(e.x, e.y, '#ffd75c', 6);
        }
      } else if (e.t === 'fuel') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.fuel = Math.min(FUEL_MAX, S.fuel + FUEL_PICKUP_GAIN);
          burst(e.x, e.y, '#5cff9d', 8);
        }
      } else if (e.t === 'tramp') {
        if (hitsRect(px, S.planeY, pr, e) && S.vel > 0) {
          S.vel = TRAMP_BOOST;
          burst(e.x, e.y, '#00f0ff', 8);
        }
      } else if (e.t === 'zapper_h' || e.t === 'zapper_v') {
        if (!e.hitCooldown && hitsRect(px, S.planeY, pr, e)) {
          e.hitCooldown = 0.6;
          damageCargo(CARGO_HAZARD_DAMAGE);
        }
        if (e.hitCooldown) e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      } else if (e.t === 'finish') {
        if (px > e.x && !S.over) return finish(true);
      }
    }
    S.ents = S.ents.filter(e => !e.dead);

    /* --- particles --- */
    for (const p of S.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.life -= dt;
    }
    S.particles = S.particles.filter(p => p.life > 0);

    S.shake = Math.max(0, S.shake - dt * 34);
    S.flash = Math.max(0, S.flash - dt * 2.2);

    // Out of fuel and back on the deck: the run is done.
    if (S.fuel <= 0 && S.planeY >= FLOOR - 1 && Math.abs(S.vel) < 60) finish(false);
  }

  function hitsRect(px, py, pr, e) {
    const hw = e.w / 2, hh = e.h / 2;
    const cx = Math.max(e.x - hw, Math.min(px, e.x + hw));
    const cy = Math.max(e.y - hh, Math.min(py, e.y + hh));
    return Math.hypot(px - cx, py - cy) < pr;
  }

  function burst(x, y, c, n) {
    for (let i = 0; i < n; i++) {
      S.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.5) * 240,
        life: 0.32 + Math.random() * 0.25, max: 0.57, c,
      });
    }
  }

  /* ----------------------------- drawing -------------------------------- */

  function draw() {
    ctx.save();
    if (S.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    }

    // Sky: shifts from low neon purple to a cold blue-black as you climb.
    const alt = 1 - (S.planeY - PLAY_TOP) / (FLOOR - PLAY_TOP);
    const mix = (a, b) => Math.round(a + (b - a) * alt);
    const sky = `rgb(${mix(GROUND_SKY[0], HIGH_SKY[0])},${mix(GROUND_SKY[1], HIGH_SKY[1])},${mix(GROUND_SKY[2], HIGH_SKY[2])})`;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky);
    g.addColorStop(1, '#05030b');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Parallax stars.
    for (const s of stars) {
      s.x -= S.speed * 0.14 * s.z * (1 / 60);
      if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
      ctx.globalAlpha = 0.22 + s.z * 0.5;
      ctx.fillStyle = '#9fd8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    drawFloor();
    for (const e of S.ents) drawEntity(e);
    drawParticles();
    drawPlane();

    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${S.flash * 0.3})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    ctx.restore();
    drawHUD();
  }

  function drawFloor() {
    ctx.strokeStyle = 'rgba(255,43,214,.45)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR + 18); ctx.lineTo(W, FLOOR + 18); ctx.stroke();

    ctx.strokeStyle = 'rgba(255,43,214,.14)';
    ctx.lineWidth = 1;
    const off = S.scrolled % 80;
    for (let x = -off; x < W; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, FLOOR + 18); ctx.lineTo(x - 40, H); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(0,240,255,.16)';
    ctx.beginPath(); ctx.moveTo(0, PLAY_TOP - 12); ctx.lineTo(W, PLAY_TOP - 12); ctx.stroke();
  }

  function glow(color, blur, fn) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    fn();
    ctx.restore();
  }

  function drawEntity(e) {
    switch (e.t) {
      case 'coin': {
        const sq = Math.abs(Math.cos(e.spin));
        glow('#ffd75c', 14, () => {
          ctx.fillStyle = '#ffd75c';
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, e.r * (0.35 + sq * 0.65), e.r, 0, 0, 6.2832);
          ctx.fill();
        });
        break;
      }
      case 'fuel': {
        glow('#5cff9d', 16, () => {
          ctx.strokeStyle = '#5cff9d';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(e.x - 11, e.y - 14, 22, 28);
          ctx.fillStyle = 'rgba(92,255,157,.28)';
          ctx.fillRect(e.x - 11, e.y - 14, 22, 28);
          ctx.fillStyle = '#5cff9d';
          ctx.font = 'bold 13px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('F', e.x, e.y + 5);
        });
        break;
      }
      case 'tramp': {
        glow('#00f0ff', 14, () => {
          ctx.fillStyle = '#00f0ff';
          ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
        });
        break;
      }
      case 'zapper_h':
      case 'zapper_v': {
        const pulse = 0.72 + Math.sin(S.t * 11) * 0.28;
        glow('#ff2bd6', 22 * pulse, () => {
          ctx.fillStyle = `rgba(255,43,214,${pulse})`;
          ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
          // Emitter caps.
          ctx.fillStyle = '#ff8ae6';
          if (e.t === 'zapper_h') {
            ctx.fillRect(e.x - e.w / 2 - 7, e.y - 12, 9, 24);
            ctx.fillRect(e.x + e.w / 2 - 2, e.y - 12, 9, 24);
          } else {
            ctx.fillRect(e.x - 12, e.y - e.h / 2 - 7, 24, 9);
            ctx.fillRect(e.x - 12, e.y + e.h / 2 - 2, 24, 9);
          }
        });
        break;
      }
      case 'finish': {
        glow('#00f0ff', 24, () => {
          ctx.fillStyle = '#00f0ff';
          ctx.fillRect(e.x - e.w / 2, e.y, e.w, e.h);
        });
        ctx.save();
        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 15px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('DROP ZONE', e.x, e.y - 16);
        ctx.restore();
        break;
      }
    }
  }

  function drawParticles() {
    for (const p of S.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlane() {
    const x = PLANE_X, y = S.planeY;
    const tilt = Math.max(-0.5, Math.min(0.5, S.vel / 1400));

    // Exhaust trail.
    for (let i = S.trail.length - 1; i >= 1; i--) {
      const t = S.trail[i];
      if (!t.thrust) continue;
      ctx.globalAlpha = (1 - i / S.trail.length) * 0.5;
      ctx.fillStyle = i < 8 ? '#ff2bd6' : '#00f0ff';
      const s = 8 * (1 - i / S.trail.length);
      ctx.fillRect(x - 16 - i * 6, t.y - s / 2 + 6, s * 1.6, s);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    glow('#00f0ff', 18, () => {
      // Fuselage.
      ctx.fillStyle = '#d1e6ff';
      ctx.beginPath();
      ctx.moveTo(22, 0); ctx.lineTo(-14, -11); ctx.lineTo(-9, 0); ctx.lineTo(-14, 11);
      ctx.closePath(); ctx.fill();

      // Cargo pod — tints toward red as the cargo degrades.
      const dmg = 1 - S.cargo / CARGO_MAX;
      ctx.fillStyle = `rgb(${Math.round(0 + dmg * 255)},${Math.round(240 - dmg * 163)},${Math.round(255 - dmg * 146)})`;
      ctx.fillRect(-11, -7, 13, 14);

      // Pilot.
      ctx.fillStyle = '#ffd75c';
      ctx.beginPath(); ctx.arc(7, -3, 5, 0, 6.2832); ctx.fill();
    });

    ctx.restore();
  }

  function drawHUD() {
    const gr = gradeFor(S.cargo);
    ctx.save();
    ctx.font = '12px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    // Top strip.
    ctx.fillStyle = 'rgba(8,6,15,.72)';
    ctx.fillRect(0, 0, W, 46);
    ctx.strokeStyle = 'rgba(42,33,64,.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 46.5); ctx.lineTo(W, 46.5); ctx.stroke();

    // Distance + progress.
    ctx.fillStyle = '#8b96b8';
    ctx.fillText('DISTANCE', 18, 18);
    ctx.fillStyle = '#d1e6ff';
    ctx.font = 'bold 17px ui-monospace, monospace';
    ctx.fillText(`${Math.floor(S.distance)} / ${DISTANCE_TARGET} m`, 18, 37);

    const pw = 210, px0 = 200;
    ctx.fillStyle = 'rgba(42,33,64,.9)';
    ctx.fillRect(px0, 20, pw, 7);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(px0, 20, pw * Math.min(1, S.distance / DISTANCE_TARGET), 7);

    // Fuel.
    bar(440, 'FUEL', S.fuel / FUEL_MAX, S.fuel < 25 ? '#ff4d6d' : '#5cff9d');
    // Cargo.
    bar(620, 'CARGO', S.cargo / CARGO_MAX, gr.color);

    // Grade chip.
    ctx.font = 'bold 26px ui-monospace, monospace';
    ctx.fillStyle = gr.color;
    ctx.textAlign = 'center';
    ctx.fillText(gr.grade, 800, 34);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#5c6584';
    ctx.fillText('GRADE', 800, 15);

    // Seeds + momentum.
    ctx.textAlign = 'right';
    ctx.font = 'bold 17px ui-monospace, monospace';
    ctx.fillStyle = '#ffd75c';
    ctx.fillText(`${S.seeds}`, W - 18, 22);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#5c6584';
    ctx.fillText('SEEDS', W - 18, 34);

    if (S.momentum > 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillStyle = '#ff2bd6';
      ctx.fillText(`MOMENTUM ×${S.momentum.toFixed(2)}`, W / 2, H - 18);
    }

    if (S.fuel <= 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.fillStyle = '#ff4d6d';
      ctx.fillText('FUEL DRY', W / 2, 76);
    }

    ctx.restore();

    function bar(x, label, frac, color) {
      ctx.textAlign = 'left';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#5c6584';
      ctx.fillText(label, x, 15);
      ctx.fillStyle = 'rgba(42,33,64,.9)';
      ctx.fillRect(x, 22, 140, 9);
      ctx.fillStyle = color;
      ctx.fillRect(x, 22, 140 * Math.max(0, Math.min(1, frac)), 9);
    }
  }

  /* ------------------------------ flow ---------------------------------- */

  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovBody  = document.getElementById('ov-body');
  const ovBtn   = document.getElementById('ov-btn');
  const ovKeys  = overlay ? overlay.querySelector('.keys') : null;

  function finish(delivered) {
    if (S.over) return;
    S.over = true;
    running = false;

    const gr = gradeFor(S.cargo);
    const fee = Math.round(S.distance * PAY_PER_METER);
    let payout = Math.round(fee * gr.pay * S.momentum);
    if (delivered) payout = Math.round(payout * COMPLETION_BONUS_MULT);

    ovTitle.textContent = delivered ? 'CARGO DELIVERED' : 'RUN ENDED — FUEL DRY';
    ovTitle.style.color = delivered ? '#5cff9d' : '#ff4d6d';

    ovBody.innerHTML = `
      <p class="grade-badge" style="color:${gr.color}">${gr.grade}</p>
      <dl class="result-grid">
        <dt>Distance</dt><dd>${Math.floor(S.distance)} m</dd>
        <!-- Floor, not round: rounding 74.6 up to 75 would show "75%" next to a
             B when the A threshold is 75, which reads as a bug to the player. -->
        <dt>Cargo intact</dt><dd>${Math.floor(S.cargo)}%</dd>
        <dt>Delivery fee</dt><dd>${fee}</dd>
        <dt>Grade pays</dt><dd>${Math.round(gr.pay * 100)}%</dd>
        <dt>Momentum</dt><dd>×${S.momentum.toFixed(2)}</dd>
        ${delivered ? '<dt>Completion bonus</dt><dd>×1.25</dd>' : ''}
        <dt>Seeds collected</dt><dd>${S.seeds}</dd>
        <dt><strong>Payout</strong></dt><dd><strong>${payout + S.seeds}</strong></dd>
        <dt>Reputation</dt><dd>+${gr.rep}</dd>
      </dl>`;

    if (ovKeys) ovKeys.style.display = 'none';
    ovBtn.textContent = 'Fly again';
    overlay.classList.remove('hidden');

    // You almost always cross the drop zone mid-thrust. Without this, the key
    // you are already holding restarts the run instantly and you never get to
    // read your own grade. Require a fresh press, and ignore even that for a
    // beat so a reflex tap cannot skip the results either.
    startArmed = false;
    resultsLockUntil = performance.now() + 700;
  }

  function start() {
    reset();
    overlay.classList.add('hidden');
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (running) update(dt);
    draw();
    if (running) requestAnimationFrame(loop);
  }

  /* ----------------------------- input ---------------------------------- */

  const down = (e) => {
    if (!running) return;
    holding = true;
    e.preventDefault();
  };
  const up = () => { holding = false; startArmed = true; };

  // True when the overlay is up and a fresh press should launch a run.
  function canStartNow() {
    return !running
      && overlay && !overlay.classList.contains('hidden')
      && startArmed
      && performance.now() >= resultsLockUntil;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (!running) {
        // Space doubles as "start"/"fly again" while the overlay is up. Let the
        // button keep its own Space handling when it has focus.
        if (canStartNow() && document.activeElement !== ovBtn) {
          start();
          e.preventDefault();
        }
        return;
      }
      down(e);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') up();
  });

  const pointerDown = (e) => {
    if (!running) {
      if (canStartNow()) { start(); e.preventDefault(); }
      return;
    }
    down(e);
  };

  canvas.addEventListener('mousedown', pointerDown);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', pointerDown, { passive: false });
  window.addEventListener('touchend', up);
  window.addEventListener('blur', up);

  if (ovBtn) ovBtn.addEventListener('click', start);

  /* ---------------------------- first paint ------------------------------ */

  reset();
  draw();

  // Idle attract loop so the canvas is not a dead rectangle before you press start.
  (function attract() {
    if (!running) {
      S.t += 1 / 60;
      S.planeY = 300 + Math.sin(S.t * 1.4) * 42;
      S.vel = Math.cos(S.t * 1.4) * 60;
      S.scrolled += 1.4;
      draw();
      requestAnimationFrame(attract);
    }
  })();

})();
