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
  const PLAY_TOP = 62;    // top of the AUTHORED band — not a ceiling any more
  const FLOOR    = 486;
  // Measured off the sprite's own opaque pixels (dog-run.png, resting frame:
  // 35x56 native, scaled to the 72px display size), then pulled in a further
  // bit on top of that — a hitbox exactly tracing the art still reads as
  // unfair on a graze, since the eye forgives near-misses a pixel-perfect
  // box won't.
  const PLANE_R  = 17;

  /* ------------------------------- camera --------------------------------
     There is no ceiling. Fly high enough and the camera follows, the ground
     drops away below, and the sky opens out — which is why every world draw
     goes through a translate and why entity Y values are world, not screen.

     The camera only ever moves UP. Letting it track downward as well would
     make the floor drift around, and the floor is the one fixed thing the
     player judges everything else against. */
  const CAM_REST_Y = 320;   // she sits here until she climbs past it
  const CAM_LERP   = 5.2;   // how hard the camera chases, per second
  const SKY_RANGE  = 1500;  // altitude over which the sky fully changes

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
  // On top of the continuous ramp above, speed steps up permanently every
  // SPEED_MILESTONE_M of distance flown — a distinct kick the player can feel
  // land, rather than only the smooth creep. Linear, not compounding: at
  // milestone 5 (5000m) the multiplier is a flat 1.6x, not runaway growth.
  const SPEED_MILESTONE_M    = 1000;
  const SPEED_MILESTONE_STEP = 0.12;

  // Cargo is the health bar now — at zero the run is over. Halved from the
  // original 100, so everything that damages you hurts twice as much.
  const CARGO_MAX            = 50;
  const CARGO_HAZARD_DAMAGE  = 18;

  // Every pickup used to be pure survival — worth flying toward only because
  // running dry or taking one more hit would end the run anyway, never
  // because it was worth anything on its own. A score bonus on each one
  // makes going out of your way for a canister or a bubble an actual
  // decision with a payoff, not just chores between the parts that count.
  const SCORE_FUEL  = 15;
  const SCORE_LIFE  = 25;   // a rescue, and rarer than the others — pays like one
  const SCORE_SHIELD = 20;

  // Sitting on the deck grinds the cargo down for as long as you stay there.
  // Against the halved cargo pool that is a bit over two seconds from full to
  // dead, so the floor is a place you pass through, never a place you rest.
  const GROUND_BAND          = 6;    // px above FLOOR that still counts as grounded
  const CARGO_GROUND_DRAIN   = 22;   // per second
  const GROUND_FEEDBACK_DELAY = 0.12; // seconds grounded before the hit cue fires

  // FUEL_ECONOMY is the single knob for range: 1 is the original burn, higher
  // drains faster. At 1.6 a full tank is worth about 15 seconds of gliding,
  // 5.7 of continuous climbing, or 8 at half throttle — so canisters are
  // something you steer toward rather than scramble between.
  const FUEL_ECONOMY      = 1.2;
  const FUEL_MAX          = 100;
  const FUEL_DRAIN_IDLE   = 4.2 * FUEL_ECONOMY;
  const FUEL_DRAIN_THRUST = 11.0 * FUEL_ECONOMY;
  const FUEL_PICKUP_GAIN  = 34;
  // A guaranteed cadence, not a chance roll — the sky/chunk spawners are
  // probabilistic and can go quiet, which is fine for hazards but not for the
  // one thing that keeps the run alive.
  const FUEL_SPAWN_EVERY       = 5;
  // Denser early on, while she is still learning the range a tank buys —
  // canisters taper back to the normal cadence once she is past this
  // distance and has the feel of it.
  const FUEL_SPAWN_EVERY_EARLY = 1.8;
  const FUEL_EARLY_DIST_M      = 2000;


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
  const PAD_ANIM = 0.1;      // snappy: the bounce should read as a kick

  /* -------------------------------- fan ----------------------------------
     A small updraught. Fly into the column and it bounces you — a clean
     upward kick, on a short per-entity cooldown so lingering in the column
     gives a quick series of bounces rather than one push, then nothing.
     Costs no fuel, which is the point: it is the poor pilot's jetpack. Spawns
     both on the deck and, via maybeSpawnSky, up in the open air — it is not
     only a ground-level mechanic any more. */
  const FAN_W        = 56;    // width of the column — smaller than it was
  const FAN_REACH    = 140;   // column height, both for the trigger zone and the drawn effect
  const FAN_BOUNCE   = -640;  // upward kick on each bounce, a notch gentler than the pad
  const FAN_COOLDOWN = 0.55;  // seconds between bounces while she stays inside

  /* ------------------------------ fireball --------------------------------
     A one-shot streak from the right edge to the left — not a hazard that
     rides the world scroll like everything else, but something that actively
     flies at her under its own speed, on its own timer rather than the sky
     spawner's probability roll. One hit and it is spent, same as a pickup.

     It spawns off-screen with no lane to gradually enter the way a zapper
     does, so with nothing else it was a hit with zero warning — a real
     source of "why did I just lose a heart" complaints. The spawn now plays
     the same warning cue a zapper gets, and the speed is tuned down from an
     original 560 so that warning buys a real reaction window (about a
     second) rather than firing an instant before impact. */
  const FIREBALL_SPEED       = 380;   // px/s, ADDED on top of the normal scroll
  const FIREBALL_R           = 22;
  const FIREBALL_SPAWN_EVERY = 4.5;   // average seconds between them, plus jitter

  // One of these picked at random per fireball, core/mid/edge for the
  // radial gradient and a matching pair of trail-particle colours — so a
  // run's fireballs read as a family, not one hardcoded orange every time.
  const FIREBALL_PALETTES = [
    { core: '#fff3c4', mid: '#ffb43c', edge: '#ff4d1a', sparkA: '#ff7a1a', sparkB: '#ffcf5c' }, // classic ember
    { core: '#ffe0e0', mid: '#ff4d4d', edge: '#b30000', sparkA: '#ff3030', sparkB: '#ff9a9a' }, // crimson
    { core: '#fffbe0', mid: '#ffe066', edge: '#e08a00', sparkA: '#ffcf40', sparkB: '#fff2b0' }, // gold
    { core: '#ffe0f0', mid: '#ff4d8a', edge: '#b3003c', sparkA: '#ff4d8a', sparkB: '#ffb3d1' }, // magenta
  ];

  /* Cargo shown as hearts rather than a bar. Sparse on purpose — five states
     read at a glance where a smooth bar just looks like it is always half
     full. Each heart is CARGO_MAX / HEARTS worth of cargo. */
  const HEARTS = 5;

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

  // Flight physics. Tuned toward a plane/glide feel over a fall: a long,
  // fast coast after you let go of thrust before gravity actually turns it
  // into a descent, and a light pull once it does.
  const GRAVITY     = 500;
  const THRUST      = -2750;
  const VEL_CLAMP   = 1000;   // caps ASCENT always, and unpowered falls too
  const TRAMP_BOOST = -780;
  /* Dive: past DIVE_FROM the fall ramps toward DIVE_GRAVITY, so a long drop
     has weight to it instead of floating down at a constant rate. Falling
     also gets its own, higher terminal velocity (DIVE_VEL_CLAMP) — without
     it, DIVE_GRAVITY only made a fall reach the SAME 700 cap sooner, never
     actually faster. Ascent is unaffected; it never used this clamp. */
  const DIVE_FROM      = 260;
  const DIVE_GRAVITY   = 3400;
  const DIVE_VEL_CLAMP = 1050;

  /* A "big fall" used to be measured in distance dropped below her last
     peak. That number never came back down on its own once she levelled
     off — only landing reset it — so the side-of-screen dive effect and her
     straight-down pose could still be running several seconds after she had
     stopped falling entirely. It is time now: how long she has been
     continuously falling, which drops to zero the instant she thrusts or
     starts climbing, so the effect cannot outlast the fall that caused it. */
  const BIG_FALL_DELAY = 2;     // seconds of continuous falling before it starts
  const BIG_FALL_RAMP  = 1.5;   // further seconds to reach full intensity

  /* Opening beat: a real Start Run begins with her behind the deck line
     next to the cannon, out of sight, rising into view before it fires her
     up and to the right — the death sink's clip trick run in reverse, so
     the same shape (hidden behind the line, then revealed) opens a run and
     closes one. Attract mode's idle bob never calls update() at all, so it
     never touches this — see reset()/start(). */
  const LAUNCH_RISE_TIME = 0.5;    // seconds rising behind the cannon before it fires
  const LAUNCH_KICK_TIME = 0.8;    // seconds for the sideways kick to settle into her flight station
  const LAUNCH_VEL        = -1250; // upward impulse the cannon fires her with — stronger than a tramp bounce
  const LAUNCH_X_KICK     = -50;   // how far left of station she starts, easing back to 0
  const CANNON_X_OFFSET   = -60;  // cannon position relative to PLANE_X

  /* Death sequence: always plays, whatever zeroed the cargo — a fall, the
     ground grind, or a low hazard hit all get the same beat. She sinks out
     of sight behind the deck line, an explosion blooms where she went down,
     and once that has fully burned out the same portrait used on the
     results screen rises up behind the line, tilted like she just picked
     herself up. Timings are phases of S.deathT, restarting its clock at
     each phase change (see beginDeath()/updateDying()). */
  const DEATH_SINK_TIME     = 0.32;  // seconds for her to sink out of sight
  const DEATH_EXPLOSION_END = 0.85;  // seconds for the explosion to fully burn out
  const DEATH_PEEK_RISE     = 0.42;  // seconds for the portrait to rise into place after
  const DEATH_HOLD_TOTAL    = 1.85;  // total time in the 'sink' phase before results

  // Spawner.
  const SPAWN_X = W + 90;
  const CHUNK_GAP_PIXELS = 330;
  const CHUNKS_BETWEEN_BREATHERS = 3;
  // How far into a run the mix of pressure chunks finishes shifting from
  // mostly difficulty-1 to mostly difficulty-2 — see maybeSpawnChunk().
  const HARD_CHUNK_RAMP_M   = 2200;
  const HARD_CHUNK_START    = 0.15;   // chance of a hard chunk at distance 0
  const HARD_CHUNK_CEILING  = 0.75;   // chance it ramps up to, and caps at

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
    plane: { src: 'assets/game/dog-run.png', w: 72, h: 72, frames: 5, fps: 12, rotate: 38 },
    ball:  { src: 'assets/game/ball.png', w: 44, h: 44 },
    fuel:  { src: 'assets/game/fuel.png', w: 51, h: 51 },   // 1.5x — easier to spot and grab
    // Frame 1 is the cable at rest; the rest are the bounce. Driven per pad
    // rather than on a clock, so a pad only moves when it is actually hit.
    pad:   { src: 'assets/game/pad.png', w: 100, h: 36, frames: 6 },
    // The same portrait shown on the results screen, reused as the thing
    // that rises up behind the deck line at the end of the death sequence —
    // see drawDeathSink().
    endPhoto: { src: 'assets/game/end-photo.png', w: 52, h: 70 },
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

  /* ------------------------------- sound ---------------------------------
     One-shot effects, as distinct from the looping bgm below. Each play
     spawns a fresh Audio() rather than reusing one instance, so two of the
     same cue (a fast run of zapper warnings, say) can overlap instead of the
     second cutting the first off. Silent whenever the music is — one mute
     button for both, since the game only exposes the one control. */
  const SFX = {
    zapperNear: 'assets/audio/zapper-near.wav',   // a beam is about to cross her lane
    death:      'assets/audio/death.wav',
    fuel:       'assets/audio/fuel.wav',
    hit:        'assets/audio/hit.wav',            // a hazard actually landed
    heal:       'assets/audio/heal.wav',            // a heart pickup
    shieldPop:  'assets/audio/shield-pop.wav',
    shieldGet:  'assets/audio/shield-get.wav',      // picking the bubble up, not it bursting
    trampBoost: 'assets/audio/tramp-boost.wav',     // the pad launches her
    uiClick:    'assets/audio/ui-click.wav',
  };
  function playSfx(key) {
    if (bgm && bgm.muted) return;
    const a = new Audio(SFX[key]);
    a.volume = 0.7;
    a.play().catch(() => {});
  }

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

  /* Pickups are now hearts only, and rare. Coins and canisters both came out:
     the lane was so thick with them that flying became hoovering, and with a
     canister every couple of seconds fuel stopped being a resource at all.

     A tank is now the whole run. That turns the question from "where is the
     next canister" into "how much of this climb can I afford", which is the
     decision the flight model was built around in the first place. */

  const CHUNKS = [
    { name: 'open_gate', difficulty: 0, length: 620, entries: [
      { dx:  90, y: 468, t: 'tramp' },
      { dx: 470, y: 468, t: 'tramp' },
    ]},
    { name: 'updraught', difficulty: 0, length: 640, entries: [
      { dx: 240, y: 470, t: 'fan' },
      { dx: 560, y: 468, t: 'tramp' },
    ]},
    { name: 'hop_pads', difficulty: 1, length: 700, entries: [
      { dx:   0, y: 468, t: 'tramp' },
      { dx: 260, y: 468, t: 'tramp' },
      { dx: 520, y: 468, t: 'tramp' },
      { dx: 300, y: 150, t: 'ball' },
    ]},
    { name: 'low_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 170, t: 'zapper_v' },
      { dx: 420, y: 200, t: 'zapper_v' },
      { dx: 240, y: 448, t: 'life' },
    ]},
    { name: 'high_road', difficulty: 1, length: 660, entries: [
      { dx: 120, y: 400, t: 'zapper_v' },
      { dx: 420, y: 360, t: 'zapper_v' },
      { dx: 600, y: 470, t: 'fan' },
    ]},
    { name: 'pillar_gate', difficulty: 2, length: 720, entries: [
      { dx:   0, y: 130, t: 'zapper_v' },
      { dx: 260, y: 400, t: 'zapper_v' },
      { dx: 520, y: 130, t: 'zapper_v' },
      { dx: 640, y: 470, t: 'fan' },
    ]},
    { name: 'the_pinch', difficulty: 2, length: 700, entries: [
      { dx: 110, y: 140, t: 'zapper_v' },
      { dx: 110, y: 430, t: 'zapper_v' },
      { dx: 440, y: 140, t: 'zapper_v' },
      { dx: 440, y: 430, t: 'zapper_v' },
      { dx: 620, y: 290, t: 'life' },
    ]},
    { name: 'greed_shelf', difficulty: 2, length: 680, entries: [
      { dx: 160, y: 300, t: 'zapper_v' },
      { dx: 460, y: 290, t: 'zapper_v' },
      { dx: 300, y: 120, t: 'life' },
      { dx: 620, y: 468, t: 'tramp' },
    ]},
  ];

  const BREATHERS = CHUNKS.filter(c => c.difficulty === 0);
  // Split rather than one flat PRESSURE pool: without this, a run had no
  // arc at all — the mix of patterns at 50m was exactly the same as at
  // 5000m, and only the scroll speed ever changed. See PRESSURE_HARD_CHANCE
  // in maybeSpawnChunk() for how these two get blended over distance.
  const PRESSURE_EASY = CHUNKS.filter(c => c.difficulty === 1);
  const PRESSURE_HARD = CHUNKS.filter(c => c.difficulty === 2);

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
      "That is coming out of your pay.",
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
      "Fuel is low. Whatever you are doing, do less of it.",
      "Running dry. Choose where you spend the rest.",
    ],
    far: [
      "Still flying. Genuinely surprised.",
      "This is the furthest anyone's got today.",
      "The boss just asked who's flying. I said nobody.",
    ],
    life: [
      "Spare crate. Patch the cargo with it.",
      "That's a repair. You've earned exactly one mistake back.",
      "Cargo's looking less awful. Don't get comfortable.",
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

  // Just the number now — no name to type in, so nothing to store but the
  // score itself. v2: the old shape was {name, score} objects; bumping the
  // key rather than migrating means a returning visitor's old board quietly
  // does not parse under the new filter below and starts fresh, which is
  // fine — these were never meant to be precious.
  const STORE_KEY = 'diana.scores.v2';
  const BOARD_SIZE = 3;

  function loadBoard() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(n => typeof n === 'number')
        .sort((a, b) => b - a)
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
  const bestScore = () => (board.length ? board[0] : 0);
  const qualifies = (score) =>
    score > 0 && (board.length < BOARD_SIZE || score > board[board.length - 1]);

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
      planeY: FLOOR - 6,   // where the cannon launch starts her — see start()
      fallTime: 0,    // seconds she has been continuously falling, right now
      bigFall: 0,     // 0..1, eases toward 1 once fallTime clears BIG_FALL_DELAY
      camY: 0,
      diving: 0,
      vel: 0,
      // null outside a real run — attract mode's idle bob calls draw()
      // directly and never update(), so it never sees anything but null
      // here. Set to 'rising' by start(); see updateLaunchRise().
      launching: null,
      launchT: 0,
      launchKick: 0,   // current sideways offset while kicking into station, eases to 0
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
      nextSkyAt: 0,
      nextFuelAt: 1.5,   // short initial delay before the first guaranteed canister
      nextFireballAt: 6,
      chunksSinceBreather: 0,
      over: false,
      dying: null,    // null | 'falling' | 'sink' — see beginDeath()
      deathT: 0,
      // What actually zeroed the cargo, set right at the moment it happens
      // — 'zapper' | 'fireball' | 'ground' | 'ground-dry'. Shown on the
      // results screen so "why did I die" has an answer that does not
      // depend on either of us remembering the run afterward.
      deathCause: null,
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
  // The altitude gauge lives in the sidebar, in its own small canvas, rather
  // than on the main 960x540 canvas — see drawCapAltimeter().
  const capAltCanvas = document.getElementById('cap-altimeter');
  const capAltCtx = capAltCanvas ? capAltCanvas.getContext('2d') : null;
  // The mood styling hangs off .captain, not off the bubble — the CSS selectors
  // are `.captain[data-mood=...]`, so setting it anywhere else silently does
  // nothing.
  const capPanel = document.querySelector('.captain');
  // Drives whether the captain panel is on screen. 'intro' hides her, so the
  // title screen is just the game and the name.
  const stage = document.querySelector('.game-stage');
  const setStage = (v) => { if (stage) stage.dataset.state = v; };
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


  /* --------------------------- sky hazards -------------------------------
     The authored chunks all sit near the deck, so once the ceiling came off
     the upper air was empty — safe, and therefore boring. These spawn
     relative to how high she actually is, so the sky is never a free ride
     and climbing has something to dodge and something to collect.

     Spaced on distance like the chunks, but far sparser: up here the reward
     is the altitude itself, and a dense field would just punish the climb. */
  const SKY_FROM     = 140;    // altitude at which the upper air wakes up
  const SKY_INTERVAL = 300;    // px of travel between sky spawns

  function maybeSpawnSky() {
    const altitude = FLOOR - S.planeY;
    if (altitude < SKY_FROM) return;
    if (S.scrolled < S.nextSkyAt) return;
    S.nextSkyAt = S.scrolled + SKY_INTERVAL * (0.75 + Math.random() * 0.7);

    // Placed around HER altitude, not a fixed band, so it keeps finding her
    // however high she goes.
    let band = S.planeY + (Math.random() - 0.5) * 260;
    // Nudge off anything already occupying that slot; give up rather than
    // force a spawn, since a skipped hazard is invisible and a stacked one
    // is unreadable.
    let tries = 0;
    while (!spaceIsFree(SPAWN_X, band, 95) && tries++ < 6) {
      band = S.planeY + (Math.random() - 0.5) * 300;
    }
    if (tries >= 6) return;
    const roll = Math.random();

    if (roll < 0.80) {
      spawnEntry(SPAWN_X, band, 'zapper_v');
    } else if (roll < 0.88) {
      // The fan is not only a ground fixture any more — it turns up in the
      // open air too, so climbing has something to bounce off, not just
      // things to dodge.
      spawnEntry(SPAWN_X, band, 'fan');
    } else if (roll < 0.95) {
      spawnEntry(SPAWN_X, band, 'ball');
    } else {
      spawnEntry(SPAWN_X, band, 'life');
    }
  }

  /* A guaranteed canister on a wall-clock timer, independent of the
     probabilistic sky/chunk spawners above — those are fine going quiet on a
     hazard, but not on the one thing that keeps the tank from running dry. */
  function maybeSpawnFuel() {
    if (S.t < S.nextFuelAt) return;
    const every = S.distance < FUEL_EARLY_DIST_M ? FUEL_SPAWN_EVERY_EARLY : FUEL_SPAWN_EVERY;
    S.nextFuelAt = S.t + every;

    // A third of the time it sits low, near the deck, instead of always
    // trailing wherever she currently is — a real "swoop down for it" pick,
    // not just a freebie sitting on her current line.
    let band = Math.random() < 0.35
      ? FLOOR - 60 - Math.random() * 70
      : S.planeY + (Math.random() - 0.5) * 220;
    let tries = 0;
    while (!spaceIsFree(SPAWN_X, band, 60) && tries++ < 6) {
      band = S.planeY + (Math.random() - 0.5) * 260;
    }
    if (tries >= 6) return;
    spawnEntry(SPAWN_X, band, 'fuel');
  }

  // On its own timer for the same reason fuel is: it needs a cadence the
  // probability roll can't guarantee, and it is a distinct enough threat
  // (fast, one-shot, arrives from off the right edge) to want its own beat
  // rather than competing in the sky spawner's roll.
  function maybeSpawnFireball() {
    if (S.t < S.nextFireballAt) return;
    S.nextFireballAt = S.t + FIREBALL_SPAWN_EVERY * (0.75 + Math.random() * 0.6);

    let band = S.planeY + (Math.random() - 0.5) * 280;
    let tries = 0;
    while (!spaceIsFree(SPAWN_X, band, 70) && tries++ < 6) {
      band = S.planeY + (Math.random() - 0.5) * 320;
    }
    if (tries >= 6) return;
    spawnEntry(SPAWN_X, band, 'fireball');
    // It starts off-screen with no lane to gradually enter like a zapper
    // does, so the only fair place for a warning is right at the spawn —
    // otherwise it is a hit with no cue at all before it lands.
    playSfx('zapperNear');
  }

  function maybeSpawnChunk() {
    if (S.scrolled < S.nextChunkAt) return;

    // Force a breather regularly so pressure has somewhere to release.
    let chunk;
    if (S.chunksSinceBreather >= CHUNKS_BETWEEN_BREATHERS) {
      chunk = BREATHERS[(Math.random() * BREATHERS.length) | 0];
      S.chunksSinceBreather = 0;
    } else if (Math.random() < 0.28) {
      chunk = BREATHERS[(Math.random() * BREATHERS.length) | 0];
      S.chunksSinceBreather = 0;
    } else {
      // Ramps from mostly-gentle to mostly-hard over the first ~2200m, so
      // a run has a felt arc — without this, distance 50m and distance
      // 5000m offered the exact same mix of patterns, and only the scroll
      // speed ever escalated.
      const hardChance = Math.min(HARD_CHUNK_CEILING,
        HARD_CHUNK_START + (S.distance / HARD_CHUNK_RAMP_M) * (HARD_CHUNK_CEILING - HARD_CHUNK_START));
      const pool = Math.random() < hardChance ? PRESSURE_HARD : PRESSURE_EASY;
      chunk = pool[(Math.random() * pool.length) | 0];
      S.chunksSinceBreather++;
    }

    // Chunks are hand-authored, so their own entries are deliberately close
    // together sometimes (a cluster of beams IS the pattern) — spaceIsFree
    // against everything would break that. But chunks are on a distance
    // clock and fuel/life/shield are on their own independent timers, so a
    // canister already scrolling through the lane has no say in where a
    // chunk lands its beams a moment later. That gap is what made grabbing
    // fuel occasionally double as an unexplained hit: the pickup and a
    // freshly-spawned hazard could end up on top of each other with
    // neither spawner ever checking the other. Only pickups are checked
    // here, and only against what already exists, so it cannot affect how
    // a chunk's own hazards are laid out relative to one another.
    for (const e of chunk.entries) {
      const x = SPAWN_X + e.dx;
      const blockedByPickup = S.ents.some(o =>
        !o.dead && (o.t === 'fuel' || o.t === 'life' || o.t === 'ball') &&
        Math.abs(o.x - x) < 50 && Math.abs(o.y - e.y) < 50);
      if (!blockedByPickup) spawnEntry(x, e.y, e.t, e);
    }
    S.nextChunkAt = S.scrolled + chunk.length + CHUNK_GAP_PIXELS;
  }

  /* Rough on-screen radius of a thing, used only to keep spawns apart. Beams
     are long, so they claim a wide box; pickups claim their own circle. */
  function claimRadius(e) {
    if (e.w) return Math.max(e.w, e.h) / 2;
    return (e.r || 16) + 10;
  }

  /* Refuses a spawn that would land on top of something already in the lane.
     Without this the sky spawner, which places relative to the player, kept
     dropping beams through pickups and stacking two hazards into one
     unreadable blob. */
  function spaceIsFree(x, y, want) {
    for (const o of S.ents) {
      if (o.dead) continue;
      const need = want + claimRadius(o);
      if (Math.abs(o.x - x) < need && Math.abs(o.y - y) < need) return false;
    }
    return true;
  }
  function spawnEntry(x, y, t, opts) {
    switch (t) {
      // Collision sizes throughout this switch are deliberately a bit
      // smaller than what each thing actually draws at — measured against
      // the real art/render size, then pulled in further, so a hit only
      // registers on a real overlap the eye would also call a hit, not a
      // graze against a bounding box wider than the visible pixels.
      // r is the drawn heart's own size (see drawEntity's r*0.82) — hitR is
      // the separate, smaller collision size, so shrinking one cannot
      // accidentally shrink the icon along with it.
      case 'life':     S.ents.push({ t, x, y, r: 20, hitR: 15, dead: false }); break;
      // r scales with the icon so what you see stays what you can grab.
      case 'ball':     S.ents.push({ t, x, y, r: 19, dead: false }); break;
      case 'fuel':     S.ents.push({ t, x, y, r: 15, dead: false }); break;
      case 'fan':      S.ents.push({ t, x, y, w: FAN_W, h: 14, cool: 0, dead: false }); break;
      case 'tramp':    S.ents.push({ t, x, y, w: 100, h: 18, animT: 0, dead: false }); break;
      case 'zapper_v': S.ents.push({ t, x, y, w: 11, h: 168, dead: false }); break;
      case 'fireball': S.ents.push({ t, x, y, r: FIREBALL_R, hitR: FIREBALL_R * 0.75, dead: false,
                                     pal: FIREBALL_PALETTES[(Math.random() * FIREBALL_PALETTES.length) | 0] }); break;
    }
  }

  /* ----------------------------- update --------------------------------- */

  function damageCargo(amount, quiet) {
    if (S.over || S.dying) return;
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
    if (S.cargo <= 0) beginDeath();
  }

  // She holds behind the deck line for LAUNCH_RISE_TIME, then the cannon
  // fires: an upward impulse plus a sideways kick that 'kick' (in update())
  // eases back out over LAUNCH_KICK_TIME.
  function updateLaunchRise(dt) {
    S.launchT += dt;
    if (S.launchT >= LAUNCH_RISE_TIME) {
      S.launching = 'kick';
      S.launchT = 0;
      S.vel = LAUNCH_VEL;
      S.launchKick = LAUNCH_X_KICK;
      playSfx('trampBoost');
      burst(PLANE_X + CANNON_X_OFFSET + 16, FLOOR - 98, '#7ee8ff', 16);   // at the muzzle — see the 'cannon' case in drawEntity()
      S.shake = Math.min(14, S.shake + 10);
    }
  }

  function beginDeath() {
    if (S.over || S.dying) return;
    S.dying = 'falling';
    S.deathT = 0;
  }

  function updateDying(dt) {
    S.deathT += dt;
    S.shake = Math.max(0, S.shake - dt * 34);
    S.flash = Math.max(0, S.flash - dt * 2.2);
    for (const p of S.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.life -= dt;
    }
    S.particles = S.particles.filter(p => p.life > 0);

    if (S.dying === 'falling') {
      // Same fall curve as ordinary flight (see the pull ramp in update()),
      // just without thrust ever cancelling it.
      let pull = GRAVITY;
      if (S.vel > DIVE_FROM) {
        const into = Math.min(1, (S.vel - DIVE_FROM) / (DIVE_VEL_CLAMP - DIVE_FROM));
        pull = GRAVITY + (DIVE_GRAVITY - GRAVITY) * into;
      }
      S.vel = Math.min(DIVE_VEL_CLAMP, S.vel + pull * dt);
      S.planeY += S.vel * dt;
      if (S.planeY >= FLOOR) {
        S.planeY = FLOOR;
        S.shake = Math.min(16, S.shake + 12);
        burst(PLANE_X, FLOOR, '#ff4d6d', 10);
        // Spiky starburst pop: one jagged ring, point lengths jittered once
        // at creation so it reads as a single messy blast, not a neat star.
        S.deathSpike = Array.from({ length: 12 }, () => 0.7 + Math.random() * 0.6);
        // The puff that follows it: a cluster of solid circles, each with
        // its own offset/size/delay/life, so it blooms outward unevenly and
        // dissipates into a ragged spread of rings rather than one uniform
        // shape fading in place.
        S.deathBlobs = Array.from({ length: 8 }, () => ({
          dx: (Math.random() - 0.5) * 70,
          dy: (Math.random() - 0.5) * 44 - 8,
          r: 15 + Math.random() * 17,
          delay: 0.1 + Math.random() * 0.16,
          life: 0.4 + Math.random() * 0.22,
        }));
        S.dying = 'sink';
        S.deathT = 0;
      }
      return;
    }

    // 'sink' — she has gone down behind the deck line and drawDeathSink()
    // is bringing the portrait up behind it. Once it has held long enough
    // to register, hand off to the real finish().
    if (S.deathT >= DEATH_HOLD_TOTAL) finish();
  }

  // The bubble bursting. Deliberately loud — it has just saved the run, and
  // the player needs to register that the protection is gone.
  function popShield() {
    S.shield = false;
    playSfx('shieldPop');
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
    // The run is already decided; nothing left in the normal loop below
    // should run — she is either still dropping or already sunk out of
    // sight, and only updateDying() drives either of those.
    if (S.dying) { updateDying(dt); return; }

    // 'rising': she is behind the deck line and nothing else has started
    // yet — updateLaunchRise() owns the clock until the cannon fires.
    // 'kick': it has fired — gravity and everything else below run as
    // normal from here, this just decays the sideways kick and holds
    // thrust off until she has settled into her flight station.
    if (S.launching === 'rising') { updateLaunchRise(dt); return; }
    if (S.launching === 'kick') {
      S.launchT += dt;
      S.launchKick = LAUNCH_X_KICK * Math.max(0, 1 - S.launchT / LAUNCH_KICK_TIME);
      if (S.launchT >= LAUNCH_KICK_TIME) { S.launching = null; S.launchKick = 0; }
    }

    S.t += dt;

    const ramp = (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * (1 - Math.exp(-S.t / SPEED_RAMP_TAU));
    // Distance milestones stack a flat multiplier on top of the time-based
    // ramp/creep above, so speed takes a felt step every 1000m rather than
    // relying on the continuous curve alone to read as "getting faster".
    const milestones = Math.floor(S.distance / SPEED_MILESTONE_M);
    S.speed = (BASE_SCROLL_SPEED + ramp + SPEED_CREEP * S.t) * SPEED_MULT
              * (1 + milestones * SPEED_MILESTONE_STEP);

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
    // No fighting the launch — thrust stays off until the kick settles, so
    // the cannon reads as one clean beat rather than something to wrestle.
    const canThrust = holding && S.fuel > 0 && !S.launching;

    /* Falling accelerates. Past DIVE_FROM the pull ramps toward DIVE_GRAVITY,
       so coming down off a big climb is a plunge rather than a long drift --
       height you gained is height you commit to losing. Thrusting cancels it
       at once, so the dive is always a choice. */
    let pull = GRAVITY;
    if (!canThrust && S.vel > DIVE_FROM) {
      const into = Math.min(1, (S.vel - DIVE_FROM) / (DIVE_VEL_CLAMP - DIVE_FROM));
      pull = GRAVITY + (DIVE_GRAVITY - GRAVITY) * into;
      S.diving = into;
    } else {
      S.diving = 0;
    }
    S.vel += (canThrust ? THRUST : pull) * dt;

    /* --- fan: bounces rather than lifts ---
       Checked before the velocity clamp so the kick is not immediately capped
       away. Each fan owns its own cooldown (e.cool), decremented here every
       frame regardless of contact, so lingering in the column gives a quick
       series of bounces on a beat rather than one push and then silence. */
    S.inFan = false;
    for (const e of S.ents) {
      if (e.t !== 'fan' || e.dead) continue;
      if (e.cool > 0) e.cool -= dt;
      const inside = S.planeY < e.y && S.planeY > e.y - FAN_REACH
                     && Math.abs(e.x - PLANE_X) < FAN_W / 2 + PLANE_R;
      if (inside) {
        S.inFan = true;
        if (!(e.cool > 0)) {
          S.vel = FAN_BOUNCE;
          e.cool = FAN_COOLDOWN;
          burst(e.x, S.planeY, '#7ee8ff', 6);
        }
      }
    }

    // Falling gets a higher ceiling than climbing — see DIVE_VEL_CLAMP above.
    // The cannon kick gets its own higher ceiling too: without this, the
    // ordinary ascent cap (VEL_CLAMP, the same one thrust is held to) cut
    // LAUNCH_VEL down to it on the very next frame regardless of how much
    // stronger the cannon was set to fire.
    const ascentCap = S.launching ? -LAUNCH_VEL : VEL_CLAMP;
    S.vel = Math.max(-ascentCap, Math.min(canThrust ? VEL_CLAMP : DIVE_VEL_CLAMP, S.vel));
    S.planeY += S.vel * dt;

    // Falling means under gravity and actually descending — thrusting or
    // moving upward resets the clock at once, so the effect it drives below
    // cannot linger past the fall that earned it.
    if (!canThrust && S.vel > 0) S.fallTime += dt;
    else S.fallTime = 0;

    const bigFallTarget = S.fallTime > BIG_FALL_DELAY
      ? Math.min(1, (S.fallTime - BIG_FALL_DELAY) / BIG_FALL_RAMP)
      : 0;
    // Chases the target rather than jumping to it, so it still ramps in and
    // fades out smoothly — just quickly (~1/6s), not the several seconds a
    // stale distance-below-peak used to hang around for.
    S.bigFall += (bigFallTarget - S.bigFall) * Math.min(1, dt * 6);
    // Scaled by bigFall itself, so the rattle builds in step with the dive
    // committing rather than snapping on — has to clear the constant decay
    // below (dt * 34) by a real margin once bigFall is most of the way in,
    // the same mistake the ground-grind shake made at weaker rates.
    if (S.bigFall > 0.15) S.shake = Math.min(9, S.shake + dt * 70 * S.bigFall);

    // No ceiling. She can climb as far as fuel allows; the camera follows.
    if (S.planeY > FLOOR) {
      S.planeY = FLOOR;
      if (S.shield) {
        // The bubble takes the deck for you and throws you clear.
        S.vel = SHIELD_BOUNCE;
        popShield();
      } else {
        // Landing itself is free now — however hard, it costs nothing. The
        // only ways to lose cargo are a hazard hit or sitting on the deck.
        S.vel = -Math.abs(S.vel) * 0.28;
      }
    }
    if (S.over || S.dying) return;

    /* --- the deck grinds the cargo down for as long as you sit on it --- */
    // A shielded touch bounces clear before the grind can start. Every other
    // way to lose cargo gets a flash, a sound and a particle burst the
    // instant it happens; this one never did — it just ticked S.cargo down
    // in silence, which is exactly what made it read as an "invisible" hit,
    // especially right after a shield pop leaves her low with nothing to
    // show for it landing. GROUND_FEEDBACK_DELAY gates the cue on actually
    // sitting there for a beat, not on touching the deck at all — every
    // ordinary landing bounce grazes S.grounded for a single frame on its
    // way back up, and that is not damage worth announcing.
    S.grounded = !S.shield && S.planeY >= FLOOR - GROUND_BAND;
    if (S.grounded) {
      const warnedAlready = S.groundedFor > GROUND_FEEDBACK_DELAY;
      S.groundedFor += dt;
      S.cargo = Math.max(0, S.cargo - CARGO_GROUND_DRAIN * dt);
      // A drag through the deck still rattles the screen a little from the
      // first instant — gating it entirely behind a delay made a quick
      // graze read as no feedback at all. It only escalates to the harder
      // shake once she has actually sat there a full second. Both rates
      // have to clear the constant decay below (dt * 34) by a real margin —
      // anything close to or under that never visibly accumulates, which is
      // why the previous 9/26 rates here never actually shook the screen.
      S.shake = Math.min(9, S.shake + dt * (S.groundedFor > 1 ? 90 : 50));
      if (!warnedAlready && S.groundedFor > GROUND_FEEDBACK_DELAY) {
        playSfx('hit');
        S.flash = 0.4;
        burst(PLANE_X, S.planeY, '#ff4d6d', 8);
      }
      if (S.groundedFor > 0.35) say('ground', { hold: 1800 });
      if (S.cargo <= 0) { S.deathCause = S.fuel <= 0 ? 'ground-dry' : 'ground'; beginDeath(); return; }
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
    maybeSpawnSky();
    maybeSpawnFuel();
    maybeSpawnFireball();

    /* --- entities --- */
    const px = PLANE_X + S.launchKick, pr = PLANE_R;
    for (const e of S.ents) {
      e.x -= dx;
      if (e.x < -260) e.dead = true;
      if (e.dead) continue;

      if (e.t === 'life') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.hitR + pr) {
          e.dead = true;
          // Restores exactly one heart. Rare enough that it is a rescue rather
          // than a top-up, which is what makes finding one feel like anything.
          S.cargo = Math.min(CARGO_MAX, S.cargo + CARGO_MAX / HEARTS);
          S.score += SCORE_LIFE;
          playSfx('heal');
          burst(e.x, e.y, '#ff5a7a', 14);
          say('life', { force: true });
        }
      } else if (e.t === 'ball') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.shield = true;
          S.score += SCORE_SHIELD;
          playSfx('shieldGet');
          burst(e.x, e.y, '#c9a2ff', 16);
          say('shield', { force: true });
        }
      } else if (e.t === 'fuel') {
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.r + pr) {
          e.dead = true;
          S.fuel = Math.min(FUEL_MAX, S.fuel + FUEL_PICKUP_GAIN);
          S.score += SCORE_FUEL;
          playSfx('fuel');
          burst(e.x, e.y, '#5cff9d', 8);
        }
      } else if (e.t === 'tramp') {
        if (e.animT > 0) e.animT = Math.max(0, e.animT - dt);
        if (hitsRect(px, S.planeY, pr, e) && S.vel > 0) {
          S.vel = TRAMP_BOOST;
          e.animT = PAD_ANIM;          // this pad springs; the others stay put
          playSfx('trampBoost');
          burst(e.x, e.y, '#a78bfa', 10);
        }
      } else if (e.t === 'zapper_v') {
        // Once per beam, well before it enters her lane — a real heads-up
        // ahead of the hit, not a repeated alarm while it lingers nearby.
        // Widened from 140/120: a thin 13px-wide vertical beam scrolling in
        // at full speed closed that gap in under half a second, which read
        // as a hit with no warning at all.
        //
        // X-distance only now — it used to also require the player's
        // CURRENT y to already be near the beam's y. That was fine standing
        // still, but a fast dive (up to 1050px/s) can cross the old 160px
        // y-band in under 0.06s, so the warning and the hit landed close
        // enough together to read as no warning at all. Diving into a
        // beam's lane should still get the same heads-up as flying level
        // into one, not less.
        if (!e.warned && Math.abs(e.x - px) < 260) {
          e.warned = true;
          playSfx('zapperNear');
        }
        if (!e.hitCooldown && hitsRect(px, S.planeY, pr, e)) {
          e.hitCooldown = 0.6;
          if (S.shield) {
            popShield();          // absorbs the hit; the cargo is untouched
          } else {
            playSfx('hit');
            S.deathCause = 'zapper';
            damageCargo(CARGO_HAZARD_DAMAGE);
            if (S.over || S.dying) return;
          }
        }
        if (e.hitCooldown) e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      } else if (e.t === 'fireball') {
        // On top of the world-scroll shift every entity already gets above —
        // this is what makes it stream past rather than drift like scenery.
        e.x -= FIREBALL_SPEED * dt;
        S.particles.push({
          x: e.x + e.r * 0.5 + (Math.random() - 0.5) * 6,
          y: e.y + (Math.random() - 0.5) * 10,
          vx: 30 + Math.random() * 50, vy: (Math.random() - 0.5) * 40,
          life: 0.16 + Math.random() * 0.16, max: 0.32,
          c: Math.random() < 0.5 ? e.pal.sparkA : e.pal.sparkB,
        });
        // hitR, not r: the drawn circle carries a soft glow past its own
        // edge, so a hitbox matching r already reads as a hit before the
        // flame visibly touches her.
        if (Math.hypot(e.x - px, e.y - S.planeY) < e.hitR + pr) {
          e.dead = true;
          if (S.shield) {
            popShield();
          } else {
            playSfx('hit');
            S.deathCause = 'fireball';
            damageCargo(CARGO_HAZARD_DAMAGE);
            if (S.over || S.dying) return;
          }
          burst(e.x, e.y, e.pal.edge, 14);
        }
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

    /* --- camera ---
       Chases upward only, and never past 0, so the ground stays put until she
       actually climbs above the rest line. Exponential so it eases rather than
       locking rigidly to her, which would make the whole world jitter with
       every thrust tap. */
    const camTarget = Math.min(0, S.planeY - CAM_REST_Y);
    S.camY += (camTarget - S.camY) * Math.min(1, dt * CAM_LERP);

    S.shake = Math.max(0, S.shake - dt * 34);
    S.flash = Math.max(0, S.flash - dt * 2.2);
  }

  /* Circle vs rectangle, and now vs a ROTATED rectangle. Rather than write a
     separate test, the plane is rotated into the beam's own frame — the same
     maths as the axis-aligned case once you are in local space. */
  function hitsRect(px, py, pr, e) {
    const lx = px - e.x, ly = py - e.y;
    const hw = e.w / 2, hh = e.h / 2;
    const cx = Math.max(-hw, Math.min(lx, hw));
    const cy = Math.max(-hh, Math.min(ly, hh));
    return Math.hypot(lx - cx, ly - cy) < pr;
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

    /* Sky by ALTITUDE, not by position on screen. Now that the camera can
       climb, screen position says nothing about how high she is — the two
       came apart the moment the ceiling was removed. Three stops so the
       transition has a middle rather than washing straight from one to the
       other over a very long climb. */
    const altitude = Math.max(0, FLOOR - S.planeY);
    const alt = Math.min(1, altitude / SKY_RANGE);
    const mix = (a, b) => Math.round(a + (b - a) * alt);
    const sky = `rgb(${mix(GROUND_SKY[0], HIGH_SKY[0])},${mix(GROUND_SKY[1], HIGH_SKY[1])},${mix(GROUND_SKY[2], HIGH_SKY[2])})`;
    const deep = `rgb(${mix(5, 2)},${mix(3, 6)},${mix(11, 26)})`;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Stars live in screen space and thicken with altitude, so climbing feels
    // like leaving the smog rather than just panning up.
    for (const s of stars) {
      s.x -= S.speed * 0.14 * s.z * (1 / 60);
      if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
      ctx.globalAlpha = (0.22 + s.z * 0.5) * (0.55 + alt * 0.75);
      ctx.fillStyle = '#9fd8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Everything from here is in WORLD space; the camera offset puts it on
    // screen. The HUD is drawn after the restore so it never moves.
    ctx.save();
    ctx.translate(0, -S.camY);

    drawFloor();
    for (const e of S.ents) drawEntity(e);
    drawParticles();
    // Once she is down, she sinks out of sight and the portrait replaces
    // her — see beginDeath(). Symmetrically, a run opens with her behind
    // the same line next to the cannon — see start()/updateLaunchRise().
    if (S.dying === 'sink') {
      drawDeathSink();
    } else if (S.launching === 'rising') {
      drawLaunchRise();
    } else {
      drawPlane();
      drawShield();   // over her, so it reads as a bubble she is sitting inside
    }

    ctx.restore();

    drawDiveEffect();   // screen-space, so it must sit outside the camera translate

    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${S.flash * 0.3})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    ctx.restore();
    // Not on the title screen: attract mode keeps calling draw() to animate
    // her idle bob, and with nothing running yet the HUD was showing a full
    // Distance/Fuel/Cargo readout for a run that has not started — faintly
    // visible through the overlay as a ghost behind the DIANA card.
    if (running || S.over) drawHUD();
    drawCapAltimeter();   // separate canvas, so a separate call outside ctx.save/restore
  }

  // Just the deck line itself, split out of drawFloor() so drawDeathSink()
  // and drawLaunchRise() can repaint it on top of her once she is drawn —
  // otherwise the clipped reveal still draws over the line where the two
  // meet, and she reads as standing in front of it rather than behind it.
  function drawDeckLine() {
    const hot = S.grounded && !S.over;
    ctx.strokeStyle = hot ? 'rgba(255,77,109,.95)' : 'rgba(255,43,214,.45)';
    ctx.lineWidth = hot ? 4 : 2;
    if (hot) { ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 22; }
    ctx.beginPath(); ctx.moveTo(0, FLOOR + 18); ctx.lineTo(W, FLOOR + 18); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawFloor() {
    // The deck glows hot while you are on it — the damage should be visible,
    // not just a number ticking down.
    const hot = S.grounded && !S.over;
    drawDeckLine();

    ctx.strokeStyle = hot ? 'rgba(255,77,109,.22)' : 'rgba(255,43,214,.14)';
    ctx.lineWidth = 1;
    const off = S.scrolled % 80;
    // Run the perspective lines well past the old screen height: with the
    // camera raised, world Y = H is no longer the bottom of the view.
    const deckDepth = FLOOR + 18 + 420;
    for (let x = -off; x < W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR + 18);
      ctx.lineTo(x - 220, deckDepth);
      ctx.stroke();
    }
    // No ceiling line any more — there is no ceiling.
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
      case 'life': {
        // A pickup heart, same shape as the HUD hearts so the connection is
        // instant — you do not have to be told what it does.
        const bob = Math.sin(S.t * 3.2 + e.x * 0.01) * 4;
        const y = e.y + bob;
        const r = e.r * 0.82;
        glow('#ff5a7a', 16, () => {
          ctx.fillStyle = '#ff5a7a';
          ctx.beginPath();
          ctx.moveTo(e.x, y + r * 0.85);
          ctx.bezierCurveTo(e.x - r * 1.5, y - r * 0.35, e.x - r * 0.55, y - r * 1.15, e.x, y - r * 0.35);
          ctx.bezierCurveTo(e.x + r * 0.55, y - r * 1.15, e.x + r * 1.5, y - r * 0.35, e.x, y + r * 0.85);
          ctx.closePath();
          ctx.fill();
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
      case 'fuel': {
        const bob = Math.sin(S.t * 3.4 + e.x * 0.01) * 4;
        glow('#5cff9d', 14, () => {
          if (sprite('fuel', e.x, e.y + bob)) return;
          ctx.strokeStyle = '#5cff9d';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(e.x - 13.5, e.y + bob - 18, 27, 36);
          ctx.fillStyle = 'rgba(92,255,157,.28)';
          ctx.fillRect(e.x - 13.5, e.y + bob - 18, 27, 36);
        });
        break;
      }
      case 'fireball': {
        // No sprite for this one — a radial gradient reads as molten better
        // than flat art would, and it is cheap enough to paint fresh every
        // frame. The trail is the particles pushed for it in update(). Which
        // of FIREBALL_PALETTES this one drew was decided once, at spawn.
        glow(e.pal.edge, 22, () => {
          const g = ctx.createRadialGradient(
            e.x + e.r * 0.25, e.y, e.r * 0.1,
            e.x, e.y, e.r);
          g.addColorStop(0,   e.pal.core);
          g.addColorStop(0.4, e.pal.mid);
          g.addColorStop(0.8, e.pal.edge);
          g.addColorStop(1,   e.pal.edge + '00');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r, 0, 6.2832);
          ctx.fill();
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
      case 'fan': {
        // The housing, then the column above it. The column is drawn as rising
        // chevrons so the direction of the push is obvious before you enter it.
        glow('#7ee8ff', 12, () => {
          ctx.fillStyle = '#7ee8ff';
          ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
          ctx.fillStyle = '#0c1c24';
          for (let i = -3; i <= 3; i++) {
            ctx.fillRect(e.x + i * 11 - 2, e.y - e.h / 2 + 4, 4, e.h - 8);
          }
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) {
          // Each chevron drifts upward on its own loop.
          const p = ((S.t * 0.85 + i / 6) % 1);
          const y = e.y - 14 - p * FAN_REACH;
          ctx.globalAlpha = (1 - p) * 0.32;
          ctx.strokeStyle = '#7ee8ff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(e.x - e.w / 2 + 8, y + 10);
          ctx.lineTo(e.x, y);
          ctx.lineTo(e.x + e.w / 2 - 8, y + 10);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'cannon': {
        // Black body, cyan outline, matching the rest of the prop palette.
        // One wheel; the barrel leans just a little off vertical, toward
        // the direction the launch actually sends her, rather than sitting
        // dead straight or swinging to the old steep diagonal. Purely
        // decorative — there is no case for it in the collision loop above,
        // so it never touches her.
        const bx = e.x, by = e.y;
        const barrelW = 24, barrelLen = 92;
        const tilt = 0.18;   // just a lean, not the old steep diagonal
        glow('#00f0ff', 14, () => {
          ctx.fillStyle = '#0c0c14';
          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 2.4;

          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, 6.2832);
          ctx.fill();
          ctx.stroke();

          ctx.save();
          ctx.translate(bx, by - 8);
          ctx.rotate(tilt);
          ctx.beginPath();
          ctx.rect(-barrelW / 2, -barrelLen, barrelW, barrelLen);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -barrelLen, 13, 0, 6.2832);
          ctx.stroke();
          ctx.restore();
        });
        break;
      }
      case 'zapper_v': {
        /* A ray rather than a bar: three stacked beams, each narrower and
           hotter than the last, ending in a near-white core. The flicker mixes
           two rates so it crackles instead of throbbing. */
        const flick = 0.78 + Math.sin(S.t * 27) * 0.14 + Math.sin(S.t * 9) * 0.08;
        const len = e.h;
        const beam = (thick, color, alpha, blur) => {
          ctx.save();
          ctx.globalAlpha = alpha * flick;
          ctx.shadowColor = color;
          ctx.shadowBlur = blur;
          ctx.fillStyle = color;
          ctx.fillRect(e.x - thick / 2, e.y - len / 2, thick, len);
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
        ctx.fillRect(e.x - 13, e.y - len / 2 - 8, 26, 10);
        ctx.fillRect(e.x - 13, e.y + len / 2 - 2, 26, 10);
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

  // The opening beat, mirroring drawDeathSink()'s clip: she rises up from
  // behind the deck line next to the cannon rather than sinking behind it.
  // Once the cannon fires (see updateLaunchRise()), S.launching moves to
  // 'kick' and drawPlane() takes over — this only ever covers the hold
  // before that happens.
  function drawLaunchRise() {
    const x = PLANE_X + CANNON_X_OFFSET;
    const groundY = FLOOR + 18;   // the deck line drawFloor() draws
    const ease = (p) => p * p * (3 - 2 * p);   // smoothstep — a gentler rise than the death sink's fall

    ctx.save();
    ctx.beginPath();
    ctx.rect(-20, -20, W + 40, groundY + 20);
    ctx.clip();

    const p = ease(Math.min(1, S.launchT / LAUNCH_RISE_TIME));
    const startY = groundY + 50;   // fully below the clip line
    const restY = S.planeY;        // the cannon's muzzle height — where the kick then launches her from
    sprite('plane', x, startY + (restY - startY) * p);

    ctx.restore();
    drawDeckLine();   // repainted on top, so she reads as rising from behind it
  }

  function drawPlane() {
    const x = PLANE_X + S.launchKick, y = S.planeY;
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
    //
    // The resting pose (SPRITES.plane.rotate) blends toward straight down —
    // total rotation of exactly 90°, regardless of the current tilt — as
    // S.bigFall approaches 1. At bigFall 0 this is identical to the old fixed
    // pose, so ordinary flight is unaffected; only a genuine big-height dive
    // reorients her.
    const baseDeg = SPRITES.plane.rotate || 0;
    const normalTotal = tilt + baseDeg * Math.PI / 180;
    const diveTotal = normalTotal + (Math.PI / 2 - normalTotal) * S.bigFall;
    const pose = diveTotal - tilt;
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

  // No hole shape — just a hard clip at the deck line. She slides down out
  // of sight behind it, then the same portrait shown on the results screen
  // rises up behind the same line, resting with only its top showing.
  function drawDeathSink() {
    const x = PLANE_X;
    const groundY = FLOOR + 18;   // the deck line drawFloor() draws
    const ease = (p) => 1 - Math.pow(1 - p, 3);

    ctx.save();
    ctx.beginPath();
    ctx.rect(-20, -20, W + 40, groundY + 20);   // nothing below this line renders
    ctx.clip();

    const sinkP = ease(Math.min(1, S.deathT / DEATH_SINK_TIME));
    if (sinkP < 1) sprite('plane', x, FLOOR + sinkP * 70);

    // Held back until the explosion has fully burned out, so the beat reads
    // as sink, then blast, then she climbs back into frame — not all three
    // happening on top of each other.
    const peekP = ease(Math.min(1, Math.max(0, S.deathT - DEATH_EXPLOSION_END) / DEATH_PEEK_RISE));
    if (peekP > 0) {
      const restY = groundY - 14;    // most of the portrait showing, feet still hidden
      const startY = groundY + 50;   // fully below the clip line
      const bob = Math.sin(S.t * 4) * 2 * peekP;
      const tilt = -0.1 * peekP;     // settles in at a slight lean, not dead straight
      ctx.save();
      ctx.translate(x, startY + (restY - startY) * peekP + bob);
      ctx.rotate(tilt);
      sprite('endPhoto', 0, 0);
      ctx.restore();
    }

    ctx.restore();
    drawDeckLine();          // repainted on top, so she reads as behind it, not overlapping it
    drawDeathExplosion();    // unclipped — it happens at the deck line, not behind it
  }

  // Three beats, recreated procedurally (no source art for this one either):
  // a spiky starburst pop, then a cluster of solid circles blooming outward,
  // each one collapsing to a thin ring and fading — then a soft magenta
  // glaze laid over the whole thing so it reads as one warm-pink flash
  // rather than a pile of separately-coloured shapes.
  function drawDeathExplosion() {
    if (!S.deathBlobs) return;
    const x = PLANE_X, y = FLOOR;
    const ease = (p) => 1 - Math.pow(1 - p, 3);

    if (S.deathSpike) {
      const SPIKE_TIME = 0.24;
      const p = S.deathT / SPIKE_TIME;
      if (p < 1) {
        const grow = ease(Math.min(1, p / 0.55));
        const alpha = Math.max(0, 1 - Math.max(0, (p - 0.5) / 0.5));
        const outer = 8 + grow * 46;
        const points = S.deathSpike.length;
        ctx.save();
        ctx.globalAlpha = alpha;
        const g = ctx.createRadialGradient(x, y, 0, x, y, outer);
        g.addColorStop(0,    '#fff0fa');
        g.addColorStop(0.4,  '#ff8ad6');
        g.addColorStop(1,    '#ff2b8a');
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let i = 0; i <= points * 2; i++) {
          const a = (i / (points * 2)) * 6.2832;
          const jitter = S.deathSpike[i % points];
          const r = (i % 2 === 0) ? outer * jitter : outer * 0.42;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.7;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    for (const b of S.deathBlobs) {
      const t = S.deathT - b.delay;
      if (t < 0 || t > b.life) continue;
      const p = t / b.life;
      const grow = ease(Math.min(1, p / 0.35));
      const r = b.r * (0.25 + grow * 0.85);
      const bx = x + b.dx, by = y + b.dy;

      const fillAlpha = Math.max(0, 1 - Math.max(0, (p - 0.45) / 0.55)) * 0.85;
      if (fillAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = p < 0.45 ? '#ff5ad1' : '#c93cff';
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }

      const ringAlpha = Math.max(0, (p - 0.5) / 0.5) * 0.7;
      if (ringAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = ringAlpha;
        ctx.strokeStyle = '#ff2bd6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, r * (1 + (p - 0.5) * 0.6), 0, 6.2832);
        ctx.stroke();
        ctx.restore();
      }
    }

    // The overlay glaze, on top of everything above.
    const overlayAlpha = Math.max(0, 1 - S.deathT / DEATH_EXPLOSION_END) * 0.35;
    if (overlayAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = overlayAlpha;
      const og = ctx.createRadialGradient(x, y, 0, x, y, 95);
      og.addColorStop(0, '#ff2bd6');
      og.addColorStop(1, 'rgba(255,43,214,0)');
      ctx.fillStyle = og;
      ctx.beginPath();
      ctx.arc(x, y, 95, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  }

  /* Panel chrome shared by the HUD boxes: a chamfered rect with a cyan edge,
     matching the cut-corner buttons on the page so the game and the site read
     as one design rather than two. */
  function panel(x, y, w, h, cut) {
    const c = cut || 10;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + c);
    ctx.closePath();
    ctx.fillStyle = 'rgba(9,12,26,.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,240,255,.55)';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(0,240,255,.35)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
  }

  function hudLabel(text, x, y, align) {
    ctx.textAlign = align || 'left';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#7fb2c9';
    ctx.fillText(text, x, y);
  }

  /* ---------------------------- altimeter --------------------------------
     A radar altimeter, read the way the real instrument is: a needle sweeping
     a dial rather than a number climbing. It is the one gauge you need while
     busy not dying, and a shape reads faster than digits.

     The sweep is deliberately non-linear. Near the deck is where altitude
     actually matters, and a linear dial would leave the needle barely
     twitching exactly there, so the first stretch of climb takes most of the
     face.

     Lives in its own small canvas in the sidebar rather than on the main
     960x540 canvas, so it never has to duck behind the HUD strip or the
     camera. `paintAltimeter` takes the drawing context explicitly (as `g`,
     not `ctx` — shadowing the outer `ctx` would make every call inside
     silently draw to the wrong canvas) so the same routine can be reused if
     the gauge ever needs to render somewhere else again. */
  function paintAltimeter(g, cx, cy, r) {
    const altitude = Math.max(0, FLOOR - S.planeY);
    const norm = Math.min(1, Math.pow(altitude / SKY_RANGE, 0.62));

    const START = Math.PI * 0.75;      // bottom-left
    const SWEEP = Math.PI * 1.5;       // three-quarters of the face, clockwise

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.beginPath();
    g.arc(cx, cy, r, 0, 6.2832);
    g.fillStyle = 'rgba(6,14,20,.9)';
    g.fill();
    g.strokeStyle = 'rgba(0,240,255,.45)';
    g.lineWidth = 1.2;
    g.stroke();

    // Long tick every fifth, short between, as the real dial reads.
    for (let i = 0; i <= 40; i++) {
      const a = START + (i / 40) * SWEEP;
      const major = i % 5 === 0;
      const inner = r - (major ? 10 : 5);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      g.strokeStyle = major ? 'rgba(0,240,255,.85)' : 'rgba(0,240,255,.35)';
      g.lineWidth = major ? 1.6 : 1;
      g.stroke();
    }

    g.font = '8px ui-monospace, monospace';
    g.fillStyle = 'rgba(180,230,245,.8)';
    const marks = [0, 25, 50, 75, 100];
    for (let i = 0; i < marks.length; i++) {
      const a = START + (i / 4) * SWEEP;
      g.fillText(String(marks[i]), cx + Math.cos(a) * (r - 19), cy + Math.sin(a) * (r - 19));
    }

    // The amber danger arc down at deck height, straight off the real gauge.
    g.beginPath();
    g.arc(cx, cy, r - 6, START, START + SWEEP * 0.12);
    g.strokeStyle = 'rgba(255,180,60,.75)';
    g.lineWidth = 5;
    g.stroke();

    const a = START + norm * SWEEP;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.shadowColor = '#ffb43c';
    g.shadowBlur = 8;
    g.fillStyle = '#ffb43c';
    g.beginPath();
    g.moveTo(r - 9, 0);
    g.lineTo(-5, -3.4);
    g.lineTo(-5, 3.4);
    g.closePath();
    g.fill();
    g.restore();

    g.beginPath();
    g.arc(cx, cy, 3.2, 0, 6.2832);
    g.fillStyle = '#cfe9f5';
    g.fill();

    g.textBaseline = 'alphabetic';
    g.restore();
  }

  // Repaints the sidebar gauge. Called once a frame from draw() regardless of
  // whether the captain panel is currently visible — cheap, and avoids the
  // gauge showing a stale needle position on the frame she slides back in.
  function drawCapAltimeter() {
    if (!capAltCtx) return;
    const w = capAltCanvas.width, h = capAltCanvas.height;
    capAltCtx.clearRect(0, 0, w, h);
    paintAltimeter(capAltCtx, w / 2, h / 2, Math.min(w, h) / 2 - 6);
  }


  /* Speed lines while diving. Drawn in SCREEN space on purpose: they are a
     camera effect, not something in the world, so they must not slide with
     the camera translate. Gated on S.bigFall (seconds spent continuously
     falling, see BIG_FALL_DELAY), not S.diving (velocity) — velocity alone
     cannot tell a routine dip from a real dive, since both converge on the
     same speed given enough time. This is why the effect no longer shows
     for every ordinary drop, and why it cannot linger once she pulls out of
     one: S.bigFall chases a target that resets to zero the instant she
     stops actually falling. */
  function drawDiveEffect() {
    if (S.bigFall <= 0.02 || S.over) return;
    const n = Math.floor(6 + S.bigFall * 26);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#9fd8ff';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < n; i++) {
      // Seeded off i and time so streaks flicker rather than crawl.
      const sx = ((i * 137.5 + S.t * 40) % W);
      const sy = ((i * 61.7 + S.t * 1500) % (H + 200)) - 100;
      const len = 26 + S.bigFall * 90 * (0.4 + (i % 5) / 5);
      ctx.globalAlpha = 0.10 + S.bigFall * 0.30;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy + len);
      ctx.stroke();
    }
    // A wash at the edges so the tunnel closes in as it gets fast.
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(120,190,255,0)');
    g.addColorStop(1, 'rgba(120,190,255,' + (S.bigFall * 0.16) + ')');
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  function drawHUD() {
    ctx.save();

    /* ---- top strip: Distance | Fuel | Cargo Life ---- */
    const PX = 34, PY = 14, PW = W - 68, PH = 50;
    panel(PX, PY, PW, PH, 12);

    hudLabel('Distance', PX + 24, PY + 20);
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.fillStyle = '#dff4ff';
    ctx.fillText(String(Math.floor(S.distance)), PX + 24, PY + 40);

    const fx = PX + 250;
    hudLabel('Fuel', fx, PY + 20);
    const ff = Math.max(0, Math.min(1, S.fuel / FUEL_MAX));
    ctx.fillStyle = 'rgba(60,50,90,.55)';
    ctx.fillRect(fx, PY + 28, 212, 11);
    ctx.fillStyle = S.fuel < 25 ? '#ff4d6d' : '#7cf2a8';
    ctx.fillRect(fx, PY + 28, 212 * ff, 11);

    const cargoFrac = S.cargo / CARGO_MAX;
    const heartCol = cargoFrac > 0.5 ? '#ff5a7a' : cargoFrac > 0.25 ? '#ffb44d' : '#ff4d6d';
    const hx = PX + PW - 24;
    hudLabel('Cargo Life', hx, PY + 20, 'right');
    const perHeart = CARGO_MAX / HEARTS;
    for (let i = 0; i < HEARTS; i++) {
      const left = S.cargo - i * perHeart;
      const fill = left >= perHeart * 0.999 ? 1 : left > 0 ? 0.42 : 0.13;
      heart(hx - (HEARTS - 1 - i) * 24 - 6, PY + 36, 7.5, fill, heartCol);
    }

    /* Altitude gauge moved to its own canvas in the sidebar (see
       drawCapAltimeter) — nothing to draw for it here. */

    /* ---- transient callouts ---- */
    if (S.shield) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillStyle = '#c9a2ff';
      ctx.fillText('SHIELD', PX + 24, PY + PH + 20);
    }

    ctx.textAlign = 'left';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#5c6584';
    ctx.fillText('SCORE ' + Math.floor(S.score) + '   BEST ' + Math.max(bestScore(), 0)
                 , PX + 150, PY + PH + 20);

    if (S.momentum > 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillStyle = '#ff2bd6';
      ctx.fillText('MOMENTUM x' + S.momentum.toFixed(2), W / 2, H - 18);
    }

    if (S.grounded && !S.over) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,77,109,' + (0.6 + Math.sin(S.t * 18) * 0.4) + ')';
      ctx.fillText('PULL UP - CARGO GRINDING', W / 2, PY + PH + 48);
    } else if (S.fuel <= 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.fillStyle = '#ff4d6d';
      ctx.fillText('FUEL DRY', W / 2, PY + PH + 48);
    }

    ctx.restore();

    // One heart, drawn from two lobes and a point. `fill` doubles as opacity,
    // so a spent heart is the same shape ghosted rather than a different one --
    // the row keeps its rhythm as you lose them.
    function heart(cx, cy, r, fill, color) {
      ctx.save();
      ctx.globalAlpha = fill;
      ctx.fillStyle = color;
      if (fill > 0.5) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.85);
      ctx.bezierCurveTo(cx - r * 1.5, cy - r * 0.35, cx - r * 0.55, cy - r * 1.15, cx, cy - r * 0.35);
      ctx.bezierCurveTo(cx + r * 0.55, cy - r * 1.15, cx + r * 1.5, cy - r * 0.35, cx, cy + r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------ flow ---------------------------------- */

  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovBody  = document.getElementById('ov-body');
  const ovBtn   = document.getElementById('ov-btn');
  const ovKeys  = overlay ? overlay.querySelector('.keys') : null;

  /* ---------------------------- music -----------------------------------
     Plays from Start Run to the results screen (see start()/finish() below),
     silent on the title screen and in attract mode. The mute choice is
     remembered across visits — nobody wants to re-mute a tab every time.

     One small speaker icon, at the far right of the chrome bar. It stays put
     across both the title screen and gameplay (the overlay hides for the
     latter, so this is the only control reachable mid-flight). */
  const MUTE_KEY = 'diana.muted';
  const bgm = document.getElementById('bgm');
  if (bgm) bgm.volume = 0.5;   // sits behind the SFX (0.7) rather than over them
  const muteBtn = document.getElementById('mute-btn');
  const iconSound = muteBtn ? muteBtn.querySelector('.icon-sound') : null;
  const iconMuted = muteBtn ? muteBtn.querySelector('.icon-muted') : null;

  // toggleHidden uses setAttribute/removeAttribute rather than the `.hidden`
  // IDL property: on these inline SVGs, assigning `.hidden = true` updates
  // the property but does not reflect to the actual `hidden` attribute in
  // this renderer, so the CSS `[hidden]` selector never saw the change and
  // both icons stayed visible at once — which is what looked like a
  // duplicated button. Attribute calls sidestep that reflection entirely.
  const toggleHidden = (el, hide) => {
    if (!el) return;
    if (hide) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  };

  function setMuted(muted) {
    if (bgm) bgm.muted = muted;
    if (muteBtn) {
      muteBtn.setAttribute('aria-pressed', String(muted));
      muteBtn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
      muteBtn.classList.toggle('is-muted', muted);   // drives the red styling; see style.css
    }
    toggleHidden(iconSound, muted);
    toggleHidden(iconMuted, !muted);
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* private browsing */ }
  }
  setMuted((() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } })());

  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();   // never let a click here be reinterpreted elsewhere
      setMuted(!(bgm && bgm.muted));
    });
  }

  function boardHTML(highlightIndex) {
    if (!board.length) return '<p class="board-empty">No scores yet. Be the first.</p>';
    return '<ol class="board">' + board.map((score, i) =>
      `<li${i === highlightIndex ? ' class="is-new"' : ''}>` +
        `<span class="board-rank">${i + 1}</span>` +
        `<span class="board-score">${score}</span>` +
      '</li>').join('') + '</ol>';
  }

  function finish() {
    if (S.over) return;
    S.over = true;
    running = false;
    if (bgm) bgm.pause();
    playSfx('death');

    const score = Math.floor(S.score);
    const isRecord = qualifies(score);

    say(isRecord ? 'record' : 'dead', { force: true, hold: 5000 });

    setStage('results');
    ovTitle.textContent = 'WELL PLAYED';
    ovTitle.style.color = '#00f0ff';

    // Answers "why did I die" without either of us having to reconstruct
    // the run afterward — S.deathCause is set right where the fatal hit or
    // drain actually happens, not guessed at here.
    const CAUSE_TEXT = {
      zapper: 'A zapper caught you.',
      fireball: 'A fireball caught you.',
      ground: 'The deck ground the cargo down.',
      'ground-dry': 'Ran dry, then the deck ground you down.',
    };
    const causeText = CAUSE_TEXT[S.deathCause] || '';

    // No name to type in any more, so a qualifying score just goes straight
    // onto the board — nothing left for the player to do but see it land.
    let newIndex = -1;
    if (isRecord) {
      board.push(score);
      board.sort((a, b) => b - a);
      board = board.slice(0, BOARD_SIZE);
      saveBoard(board);
      newIndex = board.indexOf(score);
    }

    const summary =
      `${causeText ? `<p class="death-cause">${causeText}</p>` : ''}
       <dl class="result-grid">
         <dt>Score</dt><dd><strong>${score}</strong></dd>
         <dt>Distance</dt><dd>${Math.floor(S.distance)} m</dd>
       </dl>`;

    ovBody.innerHTML = summary +
      (isRecord ? '<p class="record-flag">NEW HIGH SCORE</p>' : '') +
      boardHTML(newIndex);
    ovBtn.textContent = 'Fly again';
    ovBtn.dataset.action = 'restart';

    if (ovKeys) ovKeys.style.display = 'none';
    overlay.classList.remove('hidden');

    startArmed = false;
    resultsLockUntil = performance.now() + 700;
  }

  function start() {
    reset();
    S.launching = 'rising';
    S.ents.push({ t: 'cannon', x: PLANE_X + CANNON_X_OFFSET, y: FLOOR, dead: false });
    overlay.classList.add('hidden');
    ovBtn.dataset.action = 'restart';
    running = true;
    setStage('playing');
    playSfx('uiClick');
    say('start', { force: true, hold: 3200 });
    if (bgm) {
      bgm.currentTime = 0;
      // Autoplay is blocked without a user gesture, but start() only ever
      // runs from a keydown/click handler, so this is always inside one —
      // the catch is just a guard against the odd browser that still balks.
      bgm.play().catch(() => {});
    }
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
      && performance.now() >= resultsLockUntil;
  }

  // Space/Up/W start the run — except when one of these controls has focus,
  // where Space is that control's own native activation (toggling mute, in
  // particular) rather than a request to fly. Without this exclusion, Space
  // on a focused audio button both fires its click AND starts the run, since
  // preventDefault() below would otherwise race ahead of the button's own
  // (keyup-triggered) activation and suppress it.
  const startBlockedByFocusOn = () => [ovBtn, muteBtn].includes(document.activeElement);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (!running) {
        if (canStartNow() && !startBlockedByFocusOn()) {
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
    start();
  });

  /* ---------------------------- first paint ------------------------------ */

  reset();
  draw();

  if (capBubble) {
    capBubble.textContent = board.length
      ? `Best on this board so far: ${board[0]} points. Beat it.`
      : "Fresh board, nothing on it yet. Go set the first score.";
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
