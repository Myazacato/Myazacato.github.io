/* ==========================================================================
   Diana — browser demo
   --------------------------------------------------------------------------
   An endless arcade run built from the Godot project's flight scene. Shared
   with the real game:

     - speed curve    : fast ramp -> shoulder -> endless creep
     - chunk spawner  : authored patterns emitted on distance, with a
                        guaranteed breather every few chunks
     - coins          : the pathing language, never scattered at random
     - radio chatter  : the dispatch lines, spoken by the captain

   Differs from the Godot build on purpose: there is no contract to complete
   and no delivery grade. The run is endless and scored, cargo integrity is
   the health bar, and the floor is lethal to linger on.

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

  // Speed curve, straight from the Godot build. The creep never stops, so the
  // lane is what eventually ends an endless run.
  const BASE_SCROLL_SPEED = 220;
  const MAX_SCROLL_SPEED  = 480;
  const SPEED_RAMP_TAU    = 22;
  const SPEED_CREEP       = 3.4;
  const PIXELS_PER_METER  = BASE_SCROLL_SPEED / 60;
  // Overall pace. Scales the whole curve, so the lane opens faster and keeps
  // its shape. Also means chunks — and the canisters in them — arrive sooner.
  const SPEED_MULT        = 1.1;

  // Cargo is the health bar now — at zero the run is over. Halved from the
  // original 100, so everything that damages you hurts twice as much.
  const CARGO_MAX            = 50;
  const CARGO_HAZARD_DAMAGE  = 18;
  const CARGO_BOUNCE_DAMAGE  = 10;
  const CARGO_HIGH_G_THRESH  = 350;   // only used for hard-landing damage now

  // Sitting on the deck grinds the cargo down for as long as you stay there.
  // Against the halved cargo pool that is a bit over two seconds from full to
  // dead, so the floor is a place you pass through, never a place you rest.
  const GROUND_BAND          = 6;    // px above FLOOR that still counts as grounded
  const CARGO_GROUND_DRAIN   = 22;   // per second

  // FUEL_ECONOMY is the single knob for range: 1 is the original burn, higher
  // drains faster. At 1.6 a full tank is worth about 15 seconds of gliding,
  // 5.7 of continuous climbing, or 8 at half throttle — so canisters are
  // something you steer toward rather than scramble between.
  const FUEL_ECONOMY      = 1.6;
  const FUEL_MAX          = 100;
  const FUEL_DRAIN_IDLE   = 4.2 * FUEL_ECONOMY;
  const FUEL_DRAIN_THRUST = 11.0 * FUEL_ECONOMY;
  const FUEL_PICKUP_GAIN  = 34;

  // Scoring. Distance is banked through the Momentum multiplier, so flying
  // clean is worth more than flying far.
  const SEED_POINTS = 25;

  /* ------------------------------- shield --------------------------------
     A bubble you can pick up that wraps around her. It absorbs exactly one
     mistake: touch a hazard and it pops instead of the cargo taking the hit,
     or touch the deck and it throws you back up instead of grinding you down.

     One-shot on purpose. A shield that survived several hits would flatten the
     run, because what ends a run is a chain of small mistakes rather than any
     single one. */
  const SHIELD_SIZE   = 74;    // drawn diameter, wide enough to enclose her
  const SHIELD_BOUNCE = -880;  // upward kick when the bubble hits the deck

  // How long a pad plays its bounce for after being struck. Each pad keeps its
  // own timer, so one springing does not set the whole lane wobbling.
  const PAD_ANIM = 0.4;

  /* ------------------------------- flame ---------------------------------
     The jetpack burns green and hard while you are climbing, and idles yellow
     and short when you are not — so the exhaust tells you what the throttle is
     doing without you having to look at the fuel bar. Dry tank, no flame.

     FLAME_ANCHOR is where the pack sits on the ARTWORK, measured off the
     sprite standing upright: behind her, at body height. Because the character
     is then leaned into a flight pose, that point has to be rotated by the
     same angle to find where the pack ends up on screen — otherwise the flame
     stays where her feet swung to. The flame itself still points straight back
     along the direction of travel. */
  const FLAME_ANCHOR = { x: -9, y: -3 };
  const FLAME = {
    thrust: { core: '#f0fff6', mid: '#5cff9d', outer: '#00b45e',
              len: 36, halfW: 8.5, sparks: 2, spark: '#5cff9d' },
    hover:  { core: '#fff6d8', mid: '#ffd75c', outer: '#d98a1c',
              len: 14, halfW: 5.5, sparks: 0.5, spark: '#ffd75c' },
  };

  // Flight physics.
  const GRAVITY     = 1500;
  const THRUST      = -2750;
  const VEL_CLAMP   = 700;
  const TRAMP_BOOST = -780;

  // Spawner.
  const SPAWN_X = W + 90;
  const CHUNK_GAP_PIXELS = 330;
  const CHUNKS_BETWEEN_BREATHERS = 3;

  // Sky tint by altitude, same idea as the Godot build.
  const GROUND_SKY = [13, 8, 23];
  const HIGH_SKY   = [3, 18, 41];

  /* ------------------------------ sprites --------------------------------
     TO USE YOUR OWN ART: put a transparent PNG in assets/game/ and write its
     path into `src` below. That is the whole job — everything else adapts.

         plane: { src: 'assets/game/plane.png', w: 56, h: 36 },

     TO ANIMATE: use a sprite sheet — every frame in ONE png, all the same
     size, laid out left to right — and say how many frames it holds.

         plane: { src: 'assets/game/dog.png', w: 56, h: 36, frames: 5, fps: 12 },

     Animated GIFs do not work here, and cannot be made to: canvas draws only
     the first frame of a GIF and ignores the rest. The same is true of
     animated WebP and APNG. A sheet is the better art anyway — full colour
     and soft alpha edges, where GIF gives 256 colours and hard-edged cutouts.

     For a grid rather than a single strip, add `cols`. Frames fill left to
     right, then wrap to the next row:

         frames: 8, cols: 4      // a 4x2 sheet

     `src: null` means "draw the built-in vector shape instead", which is also
     what happens if the file 404s or fails to decode, so a typo degrades to
     the old look rather than an empty screen. Paths start out null so the
     browser is not chasing files that do not exist yet.

     `w`/`h` are the on-canvas size within the 960x540 frame — of ONE frame,
     not of the whole sheet. Frames are scaled to fit, so any source
     resolution works; 2x or 3x art just looks sharper on high-DPI screens.

     The plane sprite should face right and sit centred in its frame: it is
     drawn around its centre and rotated to the climb angle.
     ---------------------------------------------------------------------- */

  const SPRITES = {
    // `rotate` is a fixed pose angle in degrees, clockwise, applied on top of
    // the bank angle. The run cycle is drawn standing upright; leaning it over
    // turns the stance into a forward flight pose without redrawing anything.
    // 0 stands her up, 90 lays her flat.
    plane: { src: 'assets/game/dog-run.png', w: 48, h: 48, frames: 5, fps: 12, rotate: 38 },
    coin:  { src: null, w: 26, h: 26 },   // e.g. 'assets/game/coin.png'
    fuel:  { src: 'assets/game/fuel.png', w: 64, h: 64 },
    ball:  { src: 'assets/game/ball.png', w: 44, h: 44 },
    // Frame 1 is the cable at rest; the rest are the bounce. Driven per pad
    // rather than on a clock, so a pad only moves when it is actually hit.
    pad:   { src: 'assets/game/pad.png', w: 100, h: 36, frames: 6 },
  };

  // Each entry gains .img (an Image) and .ready (true once it decodes).
  Object.keys(SPRITES).forEach((key) => {
    const s = SPRITES[key];
    s.ready = false;
    s.frames = Math.max(1, s.frames || 1);
    s.cols = Math.max(1, s.cols || s.frames);
    s.rows = Math.ceil(s.frames / s.cols);
    s.fps = s.fps || 10;
    if (!s.src) return;
    const img = new Image();
    img.addEventListener('load', () => {
      s.ready = img.naturalWidth > 0;
      // Frame size is measured off the sheet, so the art decides it.
      s.fw = img.naturalWidth / s.cols;
      s.fh = img.naturalHeight / s.rows;
    });
    img.addEventListener('error', () => {
      s.ready = false;
      console.warn(`[Diana] sprite "${key}" could not load from ${s.src} — using the drawn shape.`);
    });
    img.src = s.src;
    s.img = img;
  });

  // Which cell of the sheet to show right now. By default it cycles on the
  // wall clock, so the animation holds its stated fps whatever the render
  // rate is doing. Setting `s.frameIndex` to a number pins it to that frame
  // instead — which is how the character switches between two poses rather
  // than playing a run cycle.
  function frameRect(s) {
    if (s.frames <= 1) return null;
    const i = typeof s.frameIndex === "number"
      ? Math.max(0, Math.min(s.frames - 1, s.frameIndex))
      : Math.floor(performance.now() / 1000 * s.fps) % s.frames;
    return { sx: (i % s.cols) * s.fw, sy: Math.floor(i / s.cols) * s.fh };
  }

  // Draws a sprite centred on (x, y). Returns false when it is not usable, so
  // callers can fall through to the drawn shape. `wOverride` lets the coin
  // squash horizontally without disturbing the sheet maths.
  function sprite(key, x, y, wOverride) {
    const s = SPRITES[key];
    if (!s || !s.ready) return false;
    const w = wOverride === undefined ? s.w : wOverride;
    const f = frameRect(s);
    if (f) ctx.drawImage(s.img, f.sx, f.sy, s.fw, s.fh, x - w / 2, y - s.h / 2, w, s.h);
    else   ctx.drawImage(s.img, x - w / 2, y - s.h / 2, w, s.h);
    return true;
  }

  /* Tinting has to happen on its own buffer. Compositing a colour straight
     onto the main canvas with 'source-atop' would tint everything already
     painted there — the sky included — because that is opaque too. Drawing the
     sprite alone into a scratch canvas gives the tint an alpha mask to respect. */
  const tintCanvas = document.createElement('canvas');
  const tintCtx = tintCanvas.getContext('2d');

  function spriteTinted(key, x, y, color, strength) {
    const s = SPRITES[key];
    if (!s || !s.ready) return false;
    if (strength <= 0.02) return sprite(key, x, y);

    if (tintCanvas.width !== s.w || tintCanvas.height !== s.h) {
      tintCanvas.width = s.w;
      tintCanvas.height = s.h;
    }
    tintCtx.clearRect(0, 0, s.w, s.h);
    tintCtx.globalCompositeOperation = 'source-over';
    const f = frameRect(s);
    if (f) tintCtx.drawImage(s.img, f.sx, f.sy, s.fw, s.fh, 0, 0, s.w, s.h);
    else   tintCtx.drawImage(s.img, 0, 0, s.w, s.h);
    tintCtx.globalCompositeOperation = 'source-atop';   // masked by the sprite
    tintCtx.fillStyle = color;
    tintCtx.globalAlpha = strength;
    tintCtx.fillRect(0, 0, s.w, s.h);
    tintCtx.globalAlpha = 1;

    ctx.drawImage(tintCanvas, x - s.w / 2, y - s.h / 2);
    return true;
  }

  /* --------------------------- authored chunks --------------------------- */
  /* {dx, y, t} — dx is pixels from the chunk's leading edge, y is absolute.
     Coins trace the line you are meant to fly, or bait you into a worse one. */

  /* Canisters sit on the line the coins already describe, or just off it as a
     tempting detour — same rule as the coins. Two or three per chunk, so the
     tank is topped up by flying the pattern well rather than by luck. */

  const CHUNKS = [
    { name: 'coin_arc', difficulty: 0, length: 640, entries: [
      { dx:   0, y: 420, t: 'coin' }, { dx:  70, y: 370, t: 'coin' },
      { dx: 140, y: 320, t: 'coin' }, { dx: 210, y: 285, t: 'coin' },
      { dx: 280, y: 270, t: 'coin' }, { dx: 350, y: 285, t: 'coin' },
      { dx: 420, y: 320, t: 'coin' }, { dx: 490, y: 370, t: 'coin' },
      { dx: 560, y: 420, t: 'coin' },
      { dx: 280, y: 170, t: 'fuel' }, { dx: 140, y: 210, t: 'fuel' },
      { dx: 420, y: 210, t: 'fuel' }, { dx:  70, y: 300, t: 'fuel' },
      { dx: 490, y: 300, t: 'fuel' }, { dx: 350, y: 175, t: 'fuel' },
    ]},
    { name: 'refuel_lane', difficulty: 0, length: 620, entries: [
      { dx:   0, y: 300, t: 'fuel' }, { dx: 200, y: 250, t: 'fuel' },
      { dx: 400, y: 200, t: 'fuel' }, { dx: 560, y: 250, t: 'fuel' },
      { dx: 100, y: 180, t: 'fuel' }, { dx: 300, y: 150, t: 'fuel' },
      { dx: 480, y: 320, t: 'fuel' },
      { dx: 100, y: 380, t: 'coin' },
      { dx: 300, y: 340, t: 'coin' }, { dx: 500, y: 300, t: 'coin' },
    ]},
    { name: 'hop_pads', difficulty: 1, length: 700, entries: [
      { dx:   0, y: 452, t: 'tramp' }, { dx:  60, y: 330, t: 'coin' },
      { dx: 120, y: 260, t: 'coin' },  { dx: 260, y: 452, t: 'tramp' },
      { dx: 320, y: 330, t: 'coin' },  { dx: 380, y: 260, t: 'coin' },
      { dx: 520, y: 452, t: 'tramp' }, { dx: 300, y: 150, t: 'ball' },
      // At the apex of each bounce, so a good hop pays for itself.
      { dx: 170, y: 205, t: 'fuel' }, { dx: 430, y: 205, t: 'fuel' },
      { dx: 580, y: 320, t: 'fuel' }, { dx:  60, y: 400, t: 'fuel' },
      { dx: 330, y: 400, t: 'fuel' }, { dx: 620, y: 230, t: 'fuel' },
    ]},
    { name: 'low_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 170, t: 'zapper_h' }, { dx: 380, y: 170, t: 'zapper_h' },
      { dx: 100, y: 400, t: 'coin' }, { dx: 180, y: 400, t: 'coin' },
      { dx: 260, y: 400, t: 'coin' }, { dx: 340, y: 400, t: 'coin' },
      { dx: 420, y: 400, t: 'coin' },
      { dx:  40, y: 400, t: 'fuel' }, { dx: 500, y: 400, t: 'fuel' },
      { dx: 240, y: 448, t: 'fuel' }, { dx: 140, y: 448, t: 'fuel' },
      { dx: 340, y: 448, t: 'fuel' }, { dx: 600, y: 400, t: 'fuel' },
    ]},
    { name: 'high_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 400, t: 'zapper_h' }, { dx: 380, y: 400, t: 'zapper_h' },
      { dx: 100, y: 160, t: 'coin' }, { dx: 180, y: 160, t: 'coin' },
      { dx: 260, y: 160, t: 'coin' }, { dx: 340, y: 160, t: 'coin' },
      { dx: 420, y: 160, t: 'coin' },
      { dx:  40, y: 160, t: 'fuel' }, { dx: 500, y: 160, t: 'fuel' },
      { dx: 240, y: 108, t: 'fuel' }, { dx: 140, y: 215, t: 'fuel' },
      { dx: 340, y: 215, t: 'fuel' }, { dx: 600, y: 160, t: 'fuel' },
    ]},
    { name: 'pillar_gate', difficulty: 2, length: 720, entries: [
      { dx:   0, y: 120, t: 'zapper_v' }, { dx: 240, y: 400, t: 'zapper_v' },
      { dx: 480, y: 120, t: 'zapper_v' },
      { dx: 120, y: 300, t: 'coin' }, { dx: 360, y: 240, t: 'coin' },
      { dx: 600, y: 300, t: 'coin' }, { dx: 240, y: 170, t: 'ball' },
      // In the gaps between pillars, where you have to weave anyway.
      { dx: 120, y: 380, t: 'fuel' }, { dx: 360, y: 160, t: 'fuel' },
      { dx: 600, y: 180, t: 'fuel' }, { dx:  60, y: 300, t: 'fuel' },
      { dx: 300, y: 240, t: 'fuel' }, { dx: 540, y: 300, t: 'fuel' },
    ]},
    { name: 'the_pinch', difficulty: 2, length: 700, entries: [
      { dx: 100, y: 140, t: 'zapper_h' }, { dx: 100, y: 430, t: 'zapper_h' },
      { dx: 420, y: 140, t: 'zapper_h' }, { dx: 420, y: 430, t: 'zapper_h' },
      { dx: 200, y: 290, t: 'coin' }, { dx: 280, y: 290, t: 'coin' },
      { dx: 520, y: 290, t: 'coin' },
      // Dead centre of each pinch — the only safe line through is also the
      // one that refuels you.
      { dx: 100, y: 290, t: 'fuel' }, { dx: 420, y: 290, t: 'fuel' },
      { dx: 600, y: 290, t: 'fuel' }, { dx: 240, y: 240, t: 'fuel' },
      { dx: 240, y: 345, t: 'fuel' }, { dx: 560, y: 240, t: 'fuel' },
    ]},
    { name: 'greed_shelf', difficulty: 2, length: 680, entries: [
      { dx: 150, y: 300, t: 'zapper_h' }, { dx: 430, y: 300, t: 'zapper_h' },
      // The good money sits behind the beams. That is the bait.
      { dx: 150, y: 130, t: 'coin' }, { dx: 230, y: 120, t: 'coin' },
      { dx: 310, y: 115, t: 'coin' }, { dx: 390, y: 120, t: 'coin' },
      { dx: 470, y: 130, t: 'coin' }, { dx: 310, y: 175, t: 'ball' },
      // Fuel on the safe road below, so taking the greedy line costs you range.
      { dx: 300, y: 430, t: 'fuel' }, { dx:  40, y: 430, t: 'fuel' },
      { dx: 560, y: 430, t: 'fuel' }, { dx: 180, y: 430, t: 'fuel' },
      { dx: 440, y: 430, t: 'fuel' }, { dx: 640, y: 380, t: 'fuel' },
    ]},
  ];

  const BREATHERS = CHUNKS.filter(c => c.difficulty === 0);
  const PRESSURE  = CHUNKS.filter(c => c.difficulty > 0);

  /* ------------------------- the captain's lines -------------------------
     The dispatch chatter is lifted from the Godot build; the reactive lines
     are new, because the browser run has states the real game does not.
     ---------------------------------------------------------------------- */

  const LINES = {
    start: [
      "Don't crash this one, I already told the boss it'd be fine.",
      "Cargo's fragile. Try not to loop-the-loop this time.",
      "Bring the cargo back in one piece and I'll purr about it.",
      "I've seen the forecast. You won't like the forecast.",
    ],
    idle: [
      "Storm cell ahead — actually, you're already in it.",
      "Everything's fine. Probably.",
      "Don't tell the boss about the birds.",
      "Is that smoke? That's probably normal.",
      "I'm not panicking, why are you panicking.",
      "Nice line. I'll pretend that was on purpose.",
    ],
    hit: [
      "That's coming out of your seed deposit.",
      "I felt that from here.",
      "The crates are making a noise. A bad noise.",
      "Please stop hitting things.",
    ],
    ground: [
      "You're scraping the deck! Pull up!",
      "The cargo is grinding. UP. Now.",
      "That's the floor. We do not like the floor.",
    ],
    fuel: [
      "Fuel's low. I'd find a canister.",
      "Running dry — start looking up.",
    ],
    far: [
      "Still flying. Genuinely surprised.",
      "This is the furthest anyone's got today.",
      "The boss just asked who's flying. I said nobody.",
    ],
    shield: [
      "Bubble's up. That buys you exactly one mistake.",
      "Shield on. Spend it wisely, or don't, I'm not your mother.",
      "Nice, a bubble. Try to make it last longer than the last one.",
    ],
    shieldPop: [
      "Bubble's gone. You're on your own again.",
      "That's what it was for. No more freebies.",
      "Popped. Back to being fragile.",
    ],
    dead: [
      "Well. That happened.",
      "I'm filing this one under 'learning experience'.",
      "I'll get the mop.",
    ],
    record: [
      "That's a record. Sign the board.",
      "Best run I've seen. Put your name on it.",
    ],
  };

  /* ---------------------------- high scores ------------------------------
     Saved in this browser's localStorage: each visitor keeps their own board,
     on their own device. There is no shared server, so nothing syncs between
     people — a global leaderboard would need a backend a static site cannot
     provide on its own.
     ---------------------------------------------------------------------- */

  const STORE_KEY = 'diana.scores.v1';
  const BOARD_SIZE = 5;

  function loadBoard() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(e => e && typeof e.score === 'number' && typeof e.name === 'string')
        .sort((a, b) => b.score - a.score)
        .slice(0, BOARD_SIZE);
    } catch (e) {
      // Private browsing, disabled storage, corrupt JSON — a demo should still
      // be playable, it just will not remember anything.
      return [];
    }
  }

  function saveBoard(board) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(board));
      return true;
    } catch (e) {
      return false;
    }
  }

  let board = loadBoard();
  const bestScore = () => (board.length ? board[0].score : 0);
  const qualifies = (score) =>
    score > 0 && (board.length < BOARD_SIZE || score > board[board.length - 1].score);

  /* ------------------------------ state --------------------------------- */

  let S = null;
  let running = false;
  let lastTime = 0;
  let holding = false;
  let startArmed = true;
  let resultsLockUntil = 0;

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
      score: 0,
      speed: BASE_SCROLL_SPEED * SPEED_MULT,
      planeY: 300,
      vel: 0,
      fuel: FUEL_MAX,
      cargo: CARGO_MAX,
      seeds: 0,
      momentum: 1.0,
      lastDamageDist: 0,
      grounded: false,
      groundedFor: 0,
      ents: [],
      particles: [],
      nextChunkAt: 260,
      chunksSinceBreather: 0,
      over: false,
      shake: 0,
      flash: 0,
      thrusting: false,
      shield: false,
      sparkDebt: 0,
      nextIdleLine: 6,
      nextMilestone: 800,
      warnedFuel: false,
    };
    SPRITES.plane.frameIndex = 0;   // resting pose
  }

  /* ------------------------------ captain -------------------------------- */

  const capBubble = document.getElementById('cap-line');
  const capPortrait = document.getElementById('cap-portrait');
  // The mood styling hangs off .captain, not off the bubble — the CSS selectors
  // are `.captain[data-mood=...]`, so setting it anywhere else silently does
  // nothing.
  const capPanel = document.querySelector('.captain');
  let sayLockUntil = 0;

  function say(kind, opts) {
    const o = opts || {};
    const now = performance.now();
    if (!o.force && now < sayLockUntil) return;
    const pool = LINES[kind];
    if (!pool || !capBubble) return;
    capBubble.textContent = pool[(Math.random() * pool.length) | 0];
    sayLockUntil = now + (o.hold || 2600);
    if (capPortrait) {
      capPortrait.classList.remove('talking');
      // Reflow so the animation restarts even on back-to-back lines.
      void capPortrait.offsetWidth;
      capPortrait.classList.add('talking');
    }
    if (capPanel) {
      capPanel.dataset.mood =
        (kind === 'hit' || kind === 'ground' || kind === 'dead') ? 'alarm'
        : (kind === 'record') ? 'good' : 'calm';
    }
  }

  /* ---------------------------- spawning -------------------------------- */

  function maybeSpawnChunk() {
    if (S.scrolled < S.nextChunkAt) return;

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
      // r scales with the icon so what you see stays what you can grab.
      case 'fuel':     S.ents.push({ t, x, y, r: 30, dead: false }); break;
      case 'ball':     S.ents.push({ t, x, y, r: 24, dead: false }); break;
      case 'tramp':    S.ents.push({ t, x, y, w: 100, h: 18, animT: 0, dead: false }); break;
      case 'zapper_h': S.ents.push({ t, x, y, w: 168, h: 13, dead: false }); break;
      case 'zapper_v': S.ents.push({ t, x, y, w: 13, h: 168, dead: false }); break;
    }
  }

  /* ----------------------------- update --------------------------------- */

  function damageCargo(amount, quiet) {
    if (S.over) return;
    S.cargo = Math.max(0, S.cargo - amount);
    S.momentum = 1.0;              // Momentum Bank resets the moment you take a hit.
    S.lastDamageDist = S.distance;
    S.shake = Math.min(16, S.shake + 11);
    S.flash = 0.5;
    if (!quiet) say('hit');
    for (let i = 0; i < 14; i++) {
      S.particles.push({
        x: PLANE_X, y: S.planeY,
        vx: -160 - Math.random() * 260, vy: (Math.random() - 0.5) * 340,
        life: 0.5 + Math.random() * 0.35, max: 0.85, c: '#ff4d6d',
      });
    }
    if (S.cargo <= 0) finish();
  }

  // The bubble bursting. Deliberately loud — it has just saved the run, and
  // the player needs to register that the protection is gone.
  function popShield() {
    S.shield = false;
    S.shake = Math.min(14, S.shake + 8);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * 6.2832;
      S.particles.push({
        x: PLANE_X + Math.cos(a) * 26,
        y: S.planeY + Math.sin(a) * 26,
        vx: Math.cos(a) * 230 - S.speed * 0.15,
        vy: Math.sin(a) * 230,
        life: 0.34 + Math.random() * 0.2, max: 0.54, c: '#c9a2ff',
      });
    }
    say('shieldPop', { force: true });
  }

  function update(dt) {
    S.t += dt;

    const ramp = (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * (1 - Math.exp(-S.t / SPEED_RAMP_TAU));
    S.speed = (BASE_SCROLL_SPEED + ramp + SPEED_CREEP * S.t) * SPEED_MULT;

    const dx = S.speed * dt;
    S.scrolled += dx;
    const metres = dx / PIXELS_PER_METER;
    S.distance += metres;
    S.score += metres * S.momentum;

    // Momentum Bank: ratchets while you stay undamaged.
    if (S.distance - S.lastDamageDist > 120) {
      S.momentum = Math.min(3, 1 + Math.floor((S.distance - S.lastDamageDist) / 120) * 0.15);
    }

    /* --- flight --- */
    const canThrust = holding && S.fuel > 0;
    S.vel += (canThrust ? THRUST : GRAVITY) * dt;
    S.vel = Math.max(-VEL_CLAMP, Math.min(VEL_CLAMP, S.vel));
    S.planeY += S.vel * dt;

    if (S.planeY < PLAY_TOP) { S.planeY = PLAY_TOP; S.vel = Math.max(S.vel, 120); }
    if (S.planeY > FLOOR) {
      S.planeY = FLOOR;
      if (S.shield) {
        // The bubble takes the deck for you and throws you clear.
        S.vel = SHIELD_BOUNCE;
        popShield();
      } else {
        if (S.vel > CARGO_HIGH_G_THRESH) damageCargo(CARGO_BOUNCE_DAMAGE);
        S.vel = -Math.abs(S.vel) * 0.28;
      }
    }
    if (S.over) return;

    /* --- the deck grinds the cargo down for as long as you sit on it --- */
    // A shielded touch bounces clear before the grind can start.
    S.grounded = !S.shield && S.planeY >= FLOOR - GROUND_BAND;
    if (S.grounded) {
      S.groundedFor += dt;
      S.cargo = Math.max(0, S.cargo - CARGO_GROUND_DRAIN * dt);
      S.shake = Math.min(9, S.shake + dt * 26);
      if (S.groundedFor > 0.35) say('ground', { hold: 1800 });
      if (S.cargo <= 0) { finish(); return; }
    } else {
      S.groundedFor = 0;
    }

    /* The Godot build bleeds cargo during sustained high-G flying. That is
       removed here, and deliberately so: with gravity at 1500 and thrust at
       -2750, ordinary flying crosses the 350 threshold within a fifth of a
       second and basically never drops back under it, so the drain ran almost
       continuously. Against the halved 50-point cargo pool that killed a run
       in about six seconds with nothing on screen to explain why.

       Every remaining way to lose cargo is something you can see happen: a
       hazard, a hard landing, or grinding along the deck. If it comes back it
       needs a threshold near the 700 clamp and a warning on the HUD. */

    /* --- fuel --- */
    S.fuel -= (canThrust ? FUEL_DRAIN_THRUST : FUEL_DRAIN_IDLE) * dt;
    S.fuel = Math.max(0, S.fuel);
    if (S.fuel < 25 && !S.warnedFuel) { S.warnedFuel = true; say('fuel'); }
    if (S.fuel > 45) S.warnedFuel = false;

    /* --- chatter --- */
    if (S.t > S.nextIdleLine) {
      S.nextIdleLine = S.t + 9 + Math.random() * 7;
      if (!S.grounded) say('idle', { hold: 2200 });
    }
    if (S.distance > S.nextMilestone) {
      S.nextMilestone += 800;
      say('far', { force: true });
    }

    /* --- jetpack exhaust ---
       The flame itself is drawn attached to the character; these are the
       sparks it throws off, which live in world space so they hang in the air
       and stream away behind her. The nozzle has to be rotated into world
       coordinates by hand, since the particles are not inside her transform. */
    S.thrusting = canThrust;
    // Two poses, no cycle: frame 1 at rest, frame 2 while the jetpack burns.
    SPRITES.plane.frameIndex = canThrust ? 1 : 0;

    if (S.fuel > 0) {
      const f = canThrust ? FLAME.thrust : FLAME.hover;
      S.sparkDebt += f.sparks * dt * 60;
      const tilt = Math.max(-0.5, Math.min(0.5, S.vel / 1400));
      const cos = Math.cos(tilt), sin = Math.sin(tilt);
      const noz = flameNozzle();
      const nx = noz.x - f.len * 0.5, ny = noz.y;
      while (S.sparkDebt >= 1) {
        S.sparkDebt -= 1;
        S.particles.push({
          x: PLANE_X + nx * cos - ny * sin,
          y: S.planeY + nx * sin + ny * cos,
          vx: -S.speed * 0.45 - Math.random() * 90,
          vy: (Math.random() - 0.5) * 70 + 40,
          life: 0.18 + Math.random() * 0.22, max: 0.4, c: f.spark,
        });
      }
    }

    maybeSpawnChunk();

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
          S.score += SEED_POINTS;
          burst(e.x, e.y, '#ffd75c', 6);
        }
      } else if (e.t === 'ball') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.shield = true;
          burst(e.x, e.y, '#c9a2ff', 16);
          say('shield', { force: true });
        }
      } else if (e.t === 'fuel') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.fuel = Math.min(FUEL_MAX, S.fuel + FUEL_PICKUP_GAIN);
          burst(e.x, e.y, '#5cff9d', 8);
        }
      } else if (e.t === 'tramp') {
        if (e.animT > 0) e.animT = Math.max(0, e.animT - dt);
        if (hitsRect(px, S.planeY, pr, e) && S.vel > 0) {
          S.vel = TRAMP_BOOST;
          e.animT = PAD_ANIM;          // this pad springs; the others stay put
          burst(e.x, e.y, '#a78bfa', 10);
        }
      } else if (e.t === 'zapper_h' || e.t === 'zapper_v') {
        if (!e.hitCooldown && hitsRect(px, S.planeY, pr, e)) {
          e.hitCooldown = 0.6;
          if (S.shield) {
            popShield();          // absorbs the hit; the cargo is untouched
          } else {
            damageCargo(CARGO_HAZARD_DAMAGE);
            if (S.over) return;
          }
        }
        if (e.hitCooldown) e.hitCooldown = Math.max(0, e.hitCooldown - dt);
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

    const alt = 1 - (S.planeY - PLAY_TOP) / (FLOOR - PLAY_TOP);
    const mix = (a, b) => Math.round(a + (b - a) * alt);
    const sky = `rgb(${mix(GROUND_SKY[0], HIGH_SKY[0])},${mix(GROUND_SKY[1], HIGH_SKY[1])},${mix(GROUND_SKY[2], HIGH_SKY[2])})`;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky);
    g.addColorStop(1, '#05030b');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

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
    drawShield();   // over her, so it reads as a bubble she is sitting inside

    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${S.flash * 0.3})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    ctx.restore();
    drawHUD();
  }

  function drawFloor() {
    // The deck glows hot while you are on it — the damage should be visible,
    // not just a number ticking down.
    const hot = S.grounded && !S.over;
    ctx.strokeStyle = hot ? 'rgba(255,77,109,.95)' : 'rgba(255,43,214,.45)';
    ctx.lineWidth = hot ? 4 : 2;
    if (hot) { ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 22; }
    ctx.beginPath(); ctx.moveTo(0, FLOOR + 18); ctx.lineTo(W, FLOOR + 18); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = hot ? 'rgba(255,77,109,.22)' : 'rgba(255,43,214,.14)';
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
          // A custom coin sprite keeps the spin by squashing horizontally,
          // exactly as the drawn one does — and still animates if it is a sheet.
          if (sprite('coin', e.x, e.y, SPRITES.coin.w * (0.35 + sq * 0.65))) return;
          ctx.fillStyle = '#ffd75c';
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, e.r * (0.35 + sq * 0.65), e.r, 0, 0, 6.2832);
          ctx.fill();
        });
        break;
      }
      case 'fuel': {
        // Pickups keep a soft halo even as real artwork, unlike the character.
        // She is always in the same spot on screen and never needs help being
        // found; canisters are small, numerous, and must be spotted at speed.
        glow('#5cff9d', 12, () => {
          if (sprite('fuel', e.x, e.y)) return;
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
      case 'ball': {
        // Bobs gently so it reads as a pickup rather than scenery.
        const bob = Math.sin(S.t * 3 + e.x * 0.01) * 4;
        glow('#c9a2ff', 16, () => {
          if (sprite('ball', e.x, e.y + bob)) return;
          ctx.strokeStyle = '#c9a2ff';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(e.x, e.y + bob, e.r, 0, 6.2832); ctx.stroke();
        });
        break;
      }
      case 'tramp': {
        const s = SPRITES.pad;
        if (s.ready) {
          // Frame 0 is the cable at rest. animT counts down only on the pad
          // that was actually struck, so an untouched pad never moves.
          const i = e.animT > 0
            ? Math.min(s.frames - 1, Math.floor((1 - e.animT / PAD_ANIM) * s.frames))
            : 0;
          glow('#a78bfa', e.animT > 0 ? 16 : 8, () => {
            ctx.drawImage(s.img, i * s.fw, 0, s.fw, s.fh,
                          e.x - s.w / 2, e.y - s.h / 2, s.w, s.h);
          });
        } else {
          glow('#a78bfa', 12, () => {
            ctx.fillStyle = '#a78bfa';
            ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
          });
        }
        break;
      }
      case 'zapper_h':
      case 'zapper_v': {
        /* A ray rather than a bar: three stacked beams, each narrower and
           hotter than the last, ending in a near-white core. The flicker mixes
           two rates so it crackles instead of throbbing. */
        const flick = 0.78 + Math.sin(S.t * 27) * 0.14 + Math.sin(S.t * 9) * 0.08;
        const horiz = e.t === 'zapper_h';
        const len = horiz ? e.w : e.h;
        const beam = (thick, color, alpha, blur) => {
          ctx.save();
          ctx.globalAlpha = alpha * flick;
          ctx.shadowColor = color;
          ctx.shadowBlur = blur;
          ctx.fillStyle = color;
          const w = horiz ? len : thick, h = horiz ? thick : len;
          ctx.fillRect(e.x - w / 2, e.y - h / 2, w, h);
          ctx.restore();
        };
        beam(26, '#ff1030', 0.22, 30);   // outer bloom
        beam(13, '#ff3347', 0.60, 20);   // body
        beam(5,  '#ff8a94', 0.95, 12);   // hot inner
        beam(1.6, '#fff0f0', 1.0, 8);    // white-hot core

        // Emitters at both ends, so the ray reads as fired from something.
        ctx.save();
        ctx.shadowColor = '#ff1030';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ff5566';
        if (horiz) {
          ctx.fillRect(e.x - len / 2 - 8, e.y - 13, 10, 26);
          ctx.fillRect(e.x + len / 2 - 2, e.y - 13, 10, 26);
        } else {
          ctx.fillRect(e.x - 13, e.y - len / 2 - 8, 26, 10);
          ctx.fillRect(e.x - 13, e.y + len / 2 - 2, 26, 10);
        }
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

  // Where the pack actually appears once the flight pose has been applied.
  function flameNozzle() {
    const deg = (SPRITES.plane.ready && SPRITES.plane.rotate) || 0;
    if (!deg) return FLAME_ANCHOR;
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return {
      x: FLAME_ANCHOR.x * c - FLAME_ANCHOR.y * s,
      y: FLAME_ANCHOR.x * s + FLAME_ANCHOR.y * c,
    };
  }

  // One tongue of flame: a leaf shape tapering from the nozzle to a point.
  function flameTongue(len, halfW, color, blur, alpha) {
    const n = flameNozzle();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - halfW);
    ctx.quadraticCurveTo(n.x - len * 0.55, n.y - halfW * 0.85, n.x - len, n.y);
    ctx.quadraticCurveTo(n.x - len * 0.55, n.y + halfW * 0.85, n.x, n.y + halfW);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFlame() {
    if (S.fuel <= 0) return;                    // dry tank burns nothing
    const f = S.thrusting ? FLAME.thrust : FLAME.hover;

    // Flicker: a fast wobble plus a slower swell, so it never looks like a
    // sine wave. Three layers, each shorter and brighter than the last.
    const flicker = 0.82 + Math.sin(S.t * 47) * 0.12 + Math.sin(S.t * 13) * 0.06;
    const len = f.len * flicker;

    flameTongue(len,        f.halfW,        f.outer, 22, 0.55);
    flameTongue(len * 0.66, f.halfW * 0.72, f.mid,   14, 0.85);
    flameTongue(len * 0.32, f.halfW * 0.40, f.core,   8, 0.95);
  }

  function drawPlane() {
    const x = PLANE_X, y = S.planeY;
    const tilt = Math.max(-0.5, Math.min(0.5, S.vel / 1400));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // Behind the character, so she sits on top of her own exhaust. Drawn
    // before the pose rotation, so the exhaust keeps streaming straight back
    // along the direction of travel however far she is leaned over.
    drawFlame();

    const dmgFrac = 1 - S.cargo / CARGO_MAX;

    // A custom sprite replaces the whole craft, and is drawn flat with no halo
    // behind it. The glow exists to give the flat vector shape some presence;
    // over real artwork it only smears a cyan fringe across the outline. The
    // sprite sits inside the translate/rotate, so it banks with the flight
    // angle for free, and it flushes red as cargo drops so switching to art
    // does not cost the damage feedback the shapes gave.
    const pose = (SPRITES.plane.rotate || 0) * Math.PI / 180;
    if (pose) ctx.rotate(pose);
    if (!spriteTinted('plane', 0, 0, '#ff4d6d', dmgFrac * 0.6)) {
      if (pose) ctx.rotate(-pose);   // the drawn fallback stands upright
      glow('#00f0ff', 18, () => {
        ctx.fillStyle = '#d1e6ff';
        ctx.beginPath();
        ctx.moveTo(22, 0); ctx.lineTo(-14, -11); ctx.lineTo(-9, 0); ctx.lineTo(-14, 11);
        ctx.closePath(); ctx.fill();

        ctx.fillStyle = `rgb(${Math.round(dmgFrac * 255)},${Math.round(240 - dmgFrac * 163)},${Math.round(255 - dmgFrac * 146)})`;
        ctx.fillRect(-11, -7, 13, 14);

        ctx.fillStyle = '#ffd75c';
        ctx.beginPath(); ctx.arc(7, -3, 5, 0, 6.2832); ctx.fill();
      });
    }

    ctx.restore();
  }

  // The bubble around her while the shield is up. Drawn semi-transparent and
  // unrotated: a sphere has no orientation, and letting it bank with her would
  // just make the highlight wobble for no reason.
  function drawShield() {
    if (!S.shield || S.over) return;
    const pulse = 1 + Math.sin(S.t * 6) * 0.035;
    const d = SHIELD_SIZE * pulse;
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(S.t * 6) * 0.08;
    ctx.shadowColor = '#c9a2ff';
    ctx.shadowBlur = 20;
    if (SPRITES.ball.ready) {
      ctx.drawImage(SPRITES.ball.img, PLANE_X - d / 2, S.planeY - d / 2, d, d);
    } else {
      ctx.strokeStyle = '#c9a2ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(PLANE_X, S.planeY, d / 2, 0, 6.2832); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.font = '12px ui-monospace, "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(8,6,15,.72)';
    ctx.fillRect(0, 0, W, 46);
    ctx.strokeStyle = 'rgba(42,33,64,.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 46.5); ctx.lineTo(W, 46.5); ctx.stroke();

    // Score leads — it is the whole point of the run now.
    ctx.fillStyle = '#5c6584';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('SCORE', 18, 15);
    ctx.fillStyle = '#d1e6ff';
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.fillText(String(Math.floor(S.score)), 18, 36);

    ctx.fillStyle = '#5c6584';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('BEST', 150, 15);
    ctx.fillStyle = '#ffd75c';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText(String(Math.max(bestScore(), 0)), 150, 34);

    ctx.fillStyle = '#5c6584';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('DISTANCE', 268, 15);
    ctx.fillStyle = '#d1e6ff';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText(Math.floor(S.distance) + ' m', 268, 34);

    bar(400, 'FUEL', S.fuel / FUEL_MAX, S.fuel < 25 ? '#ff4d6d' : '#5cff9d');

    const cargoFrac = S.cargo / CARGO_MAX;
    const cargoCol = cargoFrac > 0.5 ? '#00f0ff' : cargoFrac > 0.25 ? '#ffd75c' : '#ff4d6d';
    bar(570, 'CARGO', cargoFrac, cargoCol);

    // A shield protects the cargo rather than repairing it, so the bar does not
    // move when you pick one up. Without a chip here that reads as "nothing
    // happened" — this is what tells you the protection is actually on.
    if (S.shield) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillStyle = '#c9a2ff';
      ctx.fillText('◍ SHIELD', 570, 44);
    }

    ctx.textAlign = 'right';
    ctx.font = 'bold 17px ui-monospace, monospace';
    ctx.fillStyle = '#ffd75c';
    ctx.fillText(String(S.seeds), W - 18, 22);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#5c6584';
    ctx.fillText('SEEDS', W - 18, 34);

    if (S.momentum > 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillStyle = '#ff2bd6';
      ctx.fillText(`MOMENTUM ×${S.momentum.toFixed(2)}`, W / 2, H - 18);
    }

    if (S.grounded && !S.over) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px ui-monospace, monospace';
      ctx.fillStyle = `rgba(255,77,109,${0.6 + Math.sin(S.t * 18) * 0.4})`;
      ctx.fillText('PULL UP — CARGO GRINDING', W / 2, 76);
    } else if (S.fuel <= 0) {
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

  function boardHTML(highlightIndex) {
    if (!board.length) return '<p class="board-empty">No scores yet. Be the first.</p>';
    return '<ol class="board">' + board.map((e, i) =>
      `<li${i === highlightIndex ? ' class="is-new"' : ''}>` +
        `<span class="board-rank">${i + 1}</span>` +
        `<span class="board-name">${e.name}</span>` +
        `<span class="board-score">${e.score}</span>` +
      '</li>').join('') + '</ol>';
  }

  function finish() {
    if (S.over) return;
    S.over = true;
    running = false;

    const score = Math.floor(S.score);
    const isRecord = qualifies(score);

    say(isRecord ? 'record' : 'dead', { force: true, hold: 5000 });

    ovTitle.textContent = S.fuel <= 0 && S.cargo > 0 ? 'RUN ENDED' : 'CARGO DESTROYED';
    ovTitle.style.color = '#ff4d6d';

    const summary =
      `<dl class="result-grid">
         <dt>Score</dt><dd><strong>${score}</strong></dd>
         <dt>Distance</dt><dd>${Math.floor(S.distance)} m</dd>
         <dt>Seeds</dt><dd>${S.seeds}</dd>
       </dl>`;

    if (isRecord) {
      ovBody.innerHTML = summary +
        `<p class="record-flag">NEW HIGH SCORE</p>
         <label class="initials-label" for="initials">Enter your initials</label>
         <input id="initials" class="initials" maxlength="3" autocomplete="off"
                autocorrect="off" autocapitalize="characters" spellcheck="false"
                inputmode="latin" aria-label="Three-character initials">`;
      ovBtn.textContent = 'Save score';
      ovBtn.dataset.action = 'save';
      ovBtn.dataset.score = String(score);
    } else {
      ovBody.innerHTML = summary + boardHTML(-1);
      ovBtn.textContent = 'Fly again';
      ovBtn.dataset.action = 'restart';
    }

    if (ovKeys) ovKeys.style.display = 'none';
    overlay.classList.remove('hidden');

    startArmed = false;
    resultsLockUntil = performance.now() + 700;

    if (isRecord) {
      const input = document.getElementById('initials');
      if (input) {
        // Only A-Z and 0-9, always uppercase — arcade rules.
        input.addEventListener('input', () => {
          input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
        });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();          // never let Space here restart the run
          if (e.key === 'Enter') { e.preventDefault(); commitScore(); }
        });
        setTimeout(() => input.focus(), 60);
      }
    }
  }

  function commitScore() {
    const input = document.getElementById('initials');
    const score = parseInt(ovBtn.dataset.score || '0', 10);
    const name = ((input && input.value) || 'AAA').toUpperCase()
      .replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, '-');

    board.push({ name, score });
    board.sort((a, b) => b.score - a.score);
    board = board.slice(0, BOARD_SIZE);
    const stored = saveBoard(board);

    const idx = board.findIndex(e => e.name === name && e.score === score);
    ovTitle.textContent = 'SCORE SAVED';
    ovTitle.style.color = '#5cff9d';
    ovBody.innerHTML = boardHTML(idx) + (stored ? '' :
      '<p class="board-empty">This browser is blocking storage, so the board ' +
      'will reset when you leave.</p>');
    ovBtn.textContent = 'Fly again';
    ovBtn.dataset.action = 'restart';
    startArmed = false;
    resultsLockUntil = performance.now() + 400;
  }

  function start() {
    reset();
    overlay.classList.add('hidden');
    ovBtn.dataset.action = 'restart';
    running = true;
    say('start', { force: true, hold: 3200 });
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

  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };

  function canStartNow() {
    return !running
      && overlay && !overlay.classList.contains('hidden')
      && startArmed
      && !typing()
      && ovBtn.dataset.action !== 'save'
      && performance.now() >= resultsLockUntil;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (!running) {
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

  if (ovBtn) ovBtn.addEventListener('click', () => {
    if (ovBtn.dataset.action === 'save') commitScore();
    else start();
  });

  /* ---------------------------- first paint ------------------------------ */

  reset();
  draw();

  if (capBubble) {
    capBubble.textContent = board.length
      ? `Board says ${board[0].name} is the one to beat. ${board[0].score} points.`
      : "Fresh board, no names on it. Go put yours up.";
  }

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
