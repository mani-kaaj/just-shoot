CARTOON HUNT ARENA
==================

A lighthearted, cartoon-style 2D arena shooter. Hit flying cartoon
critters (ducks, geese, birds) with a fictional cartoon shotgun, clear
stages, and take down the occasional cartoon Boss. No blood, no gore —
hits produce stars, feathers, and a "POOF".

Built with plain HTML5, CSS3, and vanilla JavaScript (Canvas 2D).
No Node.js, npm, build tools, or server required.


HOW TO RUN
----------
1. Create a folder on your computer, e.g. "cartoon-hunt-arena".
2. Save the three provided files into that folder, keeping these exact
   names:
       index.html
       style.css
       game.js
   (this README.txt can go in the same folder too)
3. Double-click index.html (or open it via File > Open in your
   browser).
4. Play! Works fully offline in Chrome, Edge, or Firefox — no server
   or internet connection needed.


CONTROLS
--------
  WASD / Arrow Keys   Move around the arena
  Mouse               Aim the shotgun
  Left Click          Shoot (one click = one shot)
  R                    Reload (only matters in Limited Ammo mode)
  ESC                 Pause / Resume


HOW TO PLAY
-----------
- Pick a Difficulty (Easy / Normal / Hard), an Ammo mode
  (Unlimited / Limited), and whether you want Sound on, then hit
  START GAME.
- Each stage has a target number of animals to hit. Watch the
  "TARGETS" counter in the top-left HUD.
- Every 3rd stage (3, 6, 9, ...) is a Boss Stage: a big, tougher
  cartoon critter with its own health bar that takes several hits to
  defeat.
- Animals that reach you deal damage. You get a brief moment of
  invulnerability (with a flashing sprite) after being hit, so a
  single swarm can't chain-damage you instantly.
- If your HP hits 0, it's game over — but your best score and stage
  are saved locally so you can try to beat them next run.


FILES
-----
  index.html   Page structure, canvas, and all menu/HUD/overlay markup
  style.css    Cartoon-style visual theme, layout, responsive scaling
  game.js      All game logic: state machine, player, weapon, animals,
               boss, spawner, particles, audio, rendering, input


ARCHITECTURE (SHORT)
---------------------
- A single explicit state machine drives everything:
  MENU -> PLAYING -> PAUSED / STAGE_COMPLETE / BOSS_INTRO ->
  BOSS_FIGHT -> STAGE_COMPLETE -> ... -> GAME_OVER
  Only one requestAnimationFrame loop ever runs; update() and draw()
  both branch on the current state, so paused/menu/game-over screens
  simply stop simulating the world instead of needing separate loops.
- Shooting is hit-scan: on click, a ray is cast from the player toward
  the mouse position at the moment of the click, and the closest
  animal whose hitbox intersects that ray takes exactly one hit.
- Difficulty is centralized in a single DIFFICULTY config object
  (animal speed, hitbox size, spawn rate, max ammo, reload time, boss
  HP) so Easy/Normal/Hard change real gameplay values, not just a
  label.
- Regular animals (Duck / Goose / Bird) each use a distinct arcade
  movement pattern (sine-wave flight, wandering waypoints, erratic
  direction changes) instead of homing straight at the player. The
  Boss uses its own waypoint-plus-dash pattern with pauses.
- High score and sound preference persist via localStorage, wrapped
  in try/catch so the game keeps working if storage is unavailable.
- Starting a new game (from the menu, pause screen, or game-over
  screen) always goes through one reset routine that clears the
  player, animals, particles, score, stage, ammo, and input state, so
  restarting can't leave stale entities or timers behind.


QA CHECKLIST
------------
[x] Movement (WASD + Arrow keys) with clamped arena bounds
[x] Mouse aiming, weapon visually rotates toward cursor
[x] Single click = single shot (mousedown-triggered, not polled)
[x] Shotgun with magazine, current ammo, reload time, cooldown
[x] Reload indicator with progress bar; R ignored while already
    reloading or while ammo is full
[x] Cannot shoot while reloading, paused, or after game over
[x] Unlimited vs Limited ammo modes, selectable from the main menu
[x] Three difficulty levels affecting speed, hitbox size, spawn rate,
    max ammo, reload time, and boss HP via one config object
[x] Duck / Goose / Bird with distinct sizes, speeds, points, and
    movement patterns (sine, waypoint wander, erratic)
[x] Spawn manager: edge spawns, minimum distance from player, active
    animal cap, difficulty-driven spawn interval
[x] Explicit stage system with a target hit-count per stage (not a
    raw score formula) and a visible "TARGETS: x / y" counter
[x] Stage-complete screen with stats and a stage bonus before the
    next stage begins
[x] Boss stage every 3rd stage (configurable via BOSS_STAGE_INTERVAL):
    warning intro, large sprite, multi-hit health bar, unique
    waypoint/dash movement, entrance drop-in, defeat animation and
    bonus
[x] Player HP bar, brief invulnerability window after taking damage
[x] Game Over screen with score, stage reached, hits, accuracy, best
    score, and Restart / Main Menu buttons
[x] Scoring per animal type + boss + stage bonus
[x] Accuracy tracking (hits / shots fired) with safe zero-shot
    handling — never NaN or Infinity
[x] High score + best stage persisted via localStorage with safe
    fallback if storage is unavailable
[x] Cartoon-style main menu, HUD, pause, boss-intro, stage-complete,
    and game-over screens
[x] Pause (ESC) fully freezes world updates, timers, and spawning;
    resumes cleanly
[x] Cartoon visuals drawn entirely on Canvas (sky, sun, clouds,
    grass, trees, player, animals, boss) — no external image files,
    so it works fully offline
[x] Hit animations: star/feather burst particles, floating score
    popup, "POOF" text
[x] Web Audio API sound effects (shoot, hit, reload, empty, stage
    complete, boss warning, boss defeated, damage, game over) with a
    mute toggle; audio initializes only after the first user
    interaction and the game remains fully playable muted
[x] Robust hit-scan collision: closest single target per shot, boss
    requires multiple hits
[x] Canvas uses a fixed internal resolution with responsive CSS
    scaling; mouse coordinates are transformed via the canvas's
    actual bounding rect and scale factor, so aiming stays accurate
    at any window size
[x] Single game loop guarded against duplicate starts; full state
    reset on every restart (player, animals, particles, score, stage,
    ammo, timers, boss state, accuracy, health, input)
[x] Defensive handling for missing Canvas support, unavailable
    localStorage, unavailable/blocked audio, window resize, and
    losing window focus (auto-pauses instead of continuing hidden)
