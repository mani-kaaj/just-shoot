"use strict";

/* =========================================================================
   CARTOON HUNT ARENA
   Vanilla JS + Canvas 2D. Single file game logic.
   ========================================================================= */

/* --------------------------- CONFIG --------------------------- */

const ARENA = { width: 1280, height: 720 };

const DIFFICULTY = {
  easy: {
    speedMult: 0.70,
    hitboxMult: 1.35,
    maxAnimals: 4,
    spawnInterval: 1900,
    ammoMax: 8,
    reloadTime: 900,
    animalDamage: 8,
    bossHp: 6
  },
  normal: {
    speedMult: 1.0,
    hitboxMult: 1.0,
    maxAnimals: 6,
    spawnInterval: 1300,
    ammoMax: 6,
    reloadTime: 1200,
    animalDamage: 12,
    bossHp: 9
  },
  hard: {
    speedMult: 1.45,
    hitboxMult: 0.75,
    maxAnimals: 9,
    spawnInterval: 800,
    ammoMax: 4,
    reloadTime: 1500,
    animalDamage: 18,
    bossHp: 13
  }
};

const ANIMAL_SPECS = {
  duck:  { radius: 22, baseSpeed: 90,  points: 10, color: "#f4c542", pattern: "sine" },
  goose: { radius: 30, baseSpeed: 70,  points: 20, color: "#e8e8e8", pattern: "waypoint" },
  bird:  { radius: 14, baseSpeed: 150, points: 30, color: "#4aa3e0", pattern: "erratic" }
};

const BOSS_STAGE_INTERVAL = 3; // boss every N stages
const BOSS_SPEC = { radius: 70, baseSpeed: 60, points: 150, color: "#8e3ab0" };

const SHOOT_COOLDOWN_MS = 260;
const PLAYER_RADIUS = 26;
const PLAYER_MAX_HP = 100;
const PLAYER_INVULN_MS = 1000;
const SHOT_MAX_RANGE = 1400;
const SHOT_TOLERANCE = 10; // extra ray thickness in px

const STORAGE_KEY_HIGHSCORE = "cha_highscore_v1";
const STORAGE_KEY_SOUND = "cha_sound_v1";

/* --------------------------- STATE MACHINE --------------------------- */

const STATES = {
  MENU: "MENU",
  PLAYING: "PLAYING",
  PAUSED: "PAUSED",
  STAGE_COMPLETE: "STAGE_COMPLETE",
  BOSS_INTRO: "BOSS_INTRO",
  BOSS_FIGHT: "BOSS_FIGHT",
  GAME_OVER: "GAME_OVER"
};

/* --------------------------- UTILITIES --------------------------- */

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function safeLocalStorageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/* --------------------------- AUDIO MANAGER --------------------------- */

const AudioManager = {
  ctx: null,
  muted: false,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch (e) {
      this.ctx = null;
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  },

  setMuted(m) {
    this.muted = m;
    safeLocalStorageSet(STORAGE_KEY_SOUND, m ? "off" : "on");
  },

  // simple envelope beep synth, no external files needed
  beep(freq, duration, type, gainPeak, when) {
    if (this.muted || !this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + (when || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(gainPeak || 0.2, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) { /* ignore audio failures */ }
  },

  play(name) {
    if (this.muted || !this.ctx) return;
    switch (name) {
      case "shoot": this.beep(180, 0.12, "square", 0.18); this.beep(90, 0.15, "square", 0.12, 0.01); break;
      case "hit": this.beep(700, 0.08, "triangle", 0.2); this.beep(1000, 0.06, "triangle", 0.15, 0.05); break;
      case "reload": this.beep(300, 0.1, "sine", 0.1); this.beep(420, 0.12, "sine", 0.1, 0.15); break;
      case "empty": this.beep(120, 0.08, "square", 0.12); break;
      case "stageComplete":
        this.beep(523, 0.12, "sine", 0.2); this.beep(659, 0.12, "sine", 0.2, 0.12);
        this.beep(784, 0.2, "sine", 0.2, 0.24); break;
      case "bossWarning": this.beep(150, 0.3, "sawtooth", 0.2); this.beep(150, 0.3, "sawtooth", 0.2, 0.35); break;
      case "bossDefeated":
        this.beep(300, 0.15, "sawtooth", 0.2); this.beep(500, 0.15, "sawtooth", 0.2, 0.15);
        this.beep(700, 0.25, "sawtooth", 0.2, 0.3); break;
      case "gameOver": this.beep(220, 0.4, "sine", 0.2); this.beep(140, 0.5, "sine", 0.2, 0.25); break;
      case "damage": this.beep(90, 0.15, "square", 0.2); break;
      default: break;
    }
  }
};

/* --------------------------- PARTICLES --------------------------- */

class Particle {
  constructor(x, y, vx, vy, life, size, color, kind, text) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color;
    this.kind = kind || "burst"; // "burst" | "text" | "feather"
    this.text = text || "";
    this.dead = false;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.kind !== "text") {
      this.vy += 60 * dt; // slight gravity for burst/feather bits
    } else {
      this.vy -= 4 * dt; // text floats upward
    }
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    const a = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    if (this.kind === "text") {
      ctx.fillStyle = this.color;
      ctx.font = "bold 20px Trebuchet MS, Arial";
      ctx.textAlign = "center";
      ctx.fillText(this.text, this.x, this.y);
    } else if (this.kind === "feather") {
      ctx.fillStyle = this.color;
      ctx.translate(this.x, this.y);
      ctx.rotate(this.life * 4);
      ctx.beginPath();
      ctx.ellipse(0, 0, this.size, this.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() { this.particles = []; }

  burstHit(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(60, 220);
      this.particles.push(new Particle(
        x, y, Math.cos(ang) * speed, Math.sin(ang) * speed,
        rand(0.35, 0.7), rand(3, 6), color, "burst"
      ));
    }
    for (let i = 0; i < 5; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(30, 90);
      this.particles.push(new Particle(
        x, y, Math.cos(ang) * speed, Math.sin(ang) * speed,
        rand(0.6, 1.0), rand(4, 7), "#ffffff", "feather"
      ));
    }
  }

  scorePopup(x, y, text, color) {
    this.particles.push(new Particle(x, y - 10, rand(-10, 10), -40, 0.9, 0, color || "#ffcf4a", "text", text));
  }

  poofText(x, y) {
    this.particles.push(new Particle(x, y - 20, 0, -20, 0.7, 0, "#ffffff", "text", "POOF!"));
  }

  muzzleSpark(x, y, angle) {
    for (let i = 0; i < 6; i++) {
      const a = angle + rand(-0.3, 0.3);
      const speed = rand(150, 300);
      this.particles.push(new Particle(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 0.15, rand(2, 4), "#ffe27a", "burst"));
    }
  }

  update(dt) {
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter(p => !p.dead);
  }

  draw(ctx) {
    for (const p of this.particles) p.draw(ctx);
  }

  clear() { this.particles = []; }
}

/* --------------------------- PLAYER / WEAPON --------------------------- */

class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = ARENA.width / 2;
    this.y = ARENA.height / 2 + 120;
    this.radius = PLAYER_RADIUS;
    this.hp = PLAYER_MAX_HP;
    this.maxHp = PLAYER_MAX_HP;
    this.angle = 0;
    this.invulnUntil = 0;
    this.bob = 0;
    this.recoil = 0;
    this.moving = false;

    this.ammoMode = "unlimited"; // set by menu before start
    this.ammoMax = 6;
    this.ammo = 6;
    this.reloading = false;
    this.reloadStart = 0;
    this.reloadDuration = 1200;
    this.nextShotReadyAt = 0;
  }

  configureForDifficulty(diffCfg, ammoMode) {
    this.ammoMode = ammoMode;
    this.ammoMax = diffCfg.ammoMax;
    this.ammo = diffCfg.ammoMax;
    this.reloadDuration = diffCfg.reloadTime;
    this.reloading = false;
  }

  canShoot(now) {
    if (this.reloading) return false;
    if (now < this.nextShotReadyAt) return false;
    if (this.ammoMode === "limited" && this.ammo <= 0) return false;
    return true;
  }

  takeDamage(amount, now) {
    if (now < this.invulnUntil) return false;
    this.hp = clamp(this.hp - amount, 0, this.maxHp);
    this.invulnUntil = now + PLAYER_INVULN_MS;
    return true;
  }

  isInvulnerable(now) {
    return now < this.invulnUntil;
  }

  startReload(now) {
    if (this.ammoMode !== "limited") return;
    if (this.reloading) return;
    if (this.ammo >= this.ammoMax) return;
    this.reloading = true;
    this.reloadStart = now;
  }

  update(dt, now) {
    if (this.reloading) {
      if (now - this.reloadStart >= this.reloadDuration) {
        this.reloading = false;
        this.ammo = this.ammoMax;
      }
    }
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 6);
  }
}

/* --------------------------- ANIMALS --------------------------- */

let animalIdCounter = 1;

class Animal {
  constructor(type, spec, x, y, speedMult, hitboxMult, isBoss, hpOverride) {
    this.id = animalIdCounter++;
    this.type = type;
    this.isBoss = !!isBoss;
    this.x = x; this.y = y;
    this.baseSpeed = spec.baseSpeed * speedMult;
    this.radius = spec.radius * (isBoss ? 1 : hitboxMult);
    this.visualRadius = spec.radius;
    this.color = spec.color;
    this.points = spec.points;
    this.hp = hpOverride || 1;
    this.maxHp = this.hp;
    this.dead = false;
    this.dying = false;
    this.dyingTimer = 0;
    this.age = 0;
    this.angle = 0;
    this.flapPhase = rand(0, Math.PI * 2);

    // movement pattern state
    this.pattern = isBoss ? "boss" : spec.pattern;
    this.dirAngle = rand(0, Math.PI * 2);
    this.waypoint = null;
    this.waitTimer = 0;
    this.turnTimer = rand(0.4, 1.2);
    this.entering = isBoss; // boss drops in
    this.enterProgress = 0;
    this.dashCooldown = rand(1.5, 3);
  }

  pickWaypoint() {
    const margin = 80;
    this.waypoint = {
      x: rand(margin, ARENA.width - margin),
      y: rand(margin + 40, ARENA.height - margin)
    };
  }

  applyDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0 && !this.dying) {
      this.dying = true;
      this.dyingTimer = 0.35;
    }
  }

  update(dt, playerX, playerY) {
    this.age += dt;

    if (this.dying) {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) this.dead = true;
      return;
    }

    this.flapPhase += dt * 10;

    if (this.isBoss) {
      this.updateBoss(dt, playerX, playerY);
      return;
    }

    switch (this.pattern) {
      case "sine": this.updateSine(dt); break;
      case "waypoint": this.updateWaypoint(dt); break;
      case "erratic": this.updateErratic(dt); break;
      default: this.updateSine(dt);
    }

    // despawn if far outside arena bounds
    const pad = 120;
    if (this.x < -pad || this.x > ARENA.width + pad || this.y < -pad || this.y > ARENA.height + pad) {
      this.dead = true;
    }
  }

  updateSine(dt) {
    if (!this.baseDir) {
      this.baseDir = this.dirAngle;
      this.perp = this.baseDir + Math.PI / 2;
      this.sinePhase = rand(0, Math.PI * 2);
    }
    this.sinePhase += dt * 3;
    const forwardSpeed = this.baseSpeed;
    const lateral = Math.sin(this.sinePhase) * 60;
    this.x += Math.cos(this.baseDir) * forwardSpeed * dt + Math.cos(this.perp) * lateral * dt;
    this.y += Math.sin(this.baseDir) * forwardSpeed * dt + Math.sin(this.perp) * lateral * dt;
    this.angle = this.baseDir;
  }

  updateWaypoint(dt) {
    if (!this.waypoint) this.pickWaypoint();
    const d = dist(this.x, this.y, this.waypoint.x, this.waypoint.y);
    if (d < 20) {
      this.pickWaypoint();
    }
    const ang = Math.atan2(this.waypoint.y - this.y, this.waypoint.x - this.x);
    this.angle = ang;
    this.x += Math.cos(ang) * this.baseSpeed * dt;
    this.y += Math.sin(ang) * this.baseSpeed * dt;
  }

  updateErratic(dt) {
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.dirAngle += rand(-1.6, 1.6);
      this.turnTimer = rand(0.3, 0.9);
    }
    this.angle = this.dirAngle;
    this.x += Math.cos(this.dirAngle) * this.baseSpeed * dt;
    this.y += Math.sin(this.dirAngle) * this.baseSpeed * dt;
    // gentle bounce off edges so erratic birds stay in play longer
    const pad = 40;
    if (this.x < pad || this.x > ARENA.width - pad) this.dirAngle = Math.PI - this.dirAngle;
    if (this.y < pad || this.y > ARENA.height - pad) this.dirAngle = -this.dirAngle;
  }

  updateBoss(dt, playerX, playerY) {
    if (this.entering) {
      this.enterProgress += dt * 0.7;
      this.y = -100 + (ARENA.height * 0.28 + 100) * clamp(this.enterProgress, 0, 1);
      if (this.enterProgress >= 1) {
        this.entering = false;
        this.pickWaypoint();
      }
      return;
    }

    this.dashCooldown -= dt;

    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      return;
    }

    if (!this.waypoint) this.pickWaypoint();
    const d = dist(this.x, this.y, this.waypoint.x, this.waypoint.y);

    let speed = this.baseSpeed;
    if (this.dashCooldown <= 0) {
      speed = this.baseSpeed * 2.4;
      if (this.dashCooldown < -0.4) {
        this.dashCooldown = rand(2, 4);
      }
    }

    if (d < 24) {
      this.waitTimer = rand(0.4, 1.0);
      this.pickWaypoint();
      return;
    }
    const ang = Math.atan2(this.waypoint.y - this.y, this.waypoint.x - this.x);
    this.angle = ang;
    this.x += Math.cos(ang) * speed * dt;
    this.y += Math.sin(ang) * speed * dt;
    this.x = clamp(this.x, this.radius, ARENA.width - this.radius);
    this.y = clamp(this.y, this.radius + 60, ARENA.height - this.radius);
  }
}

/* --------------------------- SPAWNER --------------------------- */

class Spawner {
  constructor() {
    this.lastSpawn = 0;
  }

  reset() { this.lastSpawn = 0; }

  edgeSpawnPoint(playerX, playerY, minDistFromPlayer) {
    let x, y;
    let attempts = 0;
    do {
      const edge = Math.floor(rand(0, 4));
      const pad = 40;
      switch (edge) {
        case 0: x = rand(0, ARENA.width); y = -pad; break;
        case 1: x = rand(0, ARENA.width); y = ARENA.height + pad; break;
        case 2: x = -pad; y = rand(0, ARENA.height); break;
        default: x = ARENA.width + pad; y = rand(0, ARENA.height); break;
      }
      attempts++;
    } while (dist(x, y, playerX, playerY) < minDistFromPlayer && attempts < 10);
    return { x, y };
  }

  maybeSpawn(now, game) {
    const diff = game.diffCfg;
    if (game.animals.length >= diff.maxAnimals) return;
    if (now - this.lastSpawn < diff.spawnInterval) return;

    this.lastSpawn = now;
    const type = pick(["duck", "duck", "goose", "bird"]); // ducks slightly more common
    const spec = ANIMAL_SPECS[type];
    const pt = this.edgeSpawnPoint(game.player.x, game.player.y, 260);
    const animal = new Animal(type, spec, pt.x, pt.y, diff.speedMult, diff.hitboxMult, false, 1);
    game.animals.push(animal);
  }

  spawnBoss(game) {
    const diff = game.diffCfg;
    const x = ARENA.width / 2;
    const y = -100;
    const boss = new Animal("boss", BOSS_SPEC, x, y, diff.speedMult, 1, true, diff.bossHp);
    game.animals.push(boss);
    return boss;
  }
}

/* --------------------------- STAGE LOGIC --------------------------- */

function stageTargetCount(stage) {
  if (stage <= 1) return 8;
  if (stage === 2) return 12;
  return 12 + (stage - 2) * 3;
}

function isBossStage(stage) {
  return stage % BOSS_STAGE_INTERVAL === 0;
}

/* --------------------------- MAIN GAME --------------------------- */

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.ctx = this.canvas.getContext("2d");

    this.state = STATES.MENU;
    this.resumeState = STATES.PLAYING;

    this.selectedDifficulty = "easy";
    this.selectedAmmoMode = "unlimited";

    this.player = new Player();
    this.animals = [];
    this.particles = new ParticleSystem();
    this.spawner = new Spawner();

    this.keys = {};
    this.mouseX = ARENA.width / 2;
    this.mouseY = ARENA.height / 2;

    this.stage = 1;
    this.targetsHit = 0;
    this.targetsRequired = stageTargetCount(1);
    this.score = 0;
    this.stageStartScore = 0;

    this.shotsFired = 0;
    this.shotsHit = 0;

    this.bossIntroUntil = 0;
    this.boss = null;
    this.bossDefeated = false;

    this.decor = this.generateDecor();

    this.lastTime = performance.now();
    this.running = false;

    this.highScore = parseInt(safeLocalStorageGet(STORAGE_KEY_HIGHSCORE) || "0", 10) || 0;
    this.highStage = 1;

    this.stageToastText = "";
    this.stageToastTimer = 0;

    this.bindUI();
    this.bindInput();
    this.resizeCanvasCoordsHelper();
    window.addEventListener("resize", () => this.resizeCanvasCoordsHelper());
    window.addEventListener("blur", () => this.handleBlur());

    const soundPref = safeLocalStorageGet(STORAGE_KEY_SOUND);
    if (soundPref === "off") {
      AudioManager.muted = true;
      document.querySelectorAll('[data-sound]').forEach(b => b.classList.remove("selected"));
      const offBtn = document.querySelector('[data-sound="off"]');
      if (offBtn) offBtn.classList.add("selected");
    }

    this.updateMenuHighscore();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ---------- setup helpers ---------- */

  generateDecor() {
    const trees = [];
    for (let i = 0; i < 8; i++) {
      trees.push({
        x: rand(20, ARENA.width - 20),
        y: rand(ARENA.height - 60, ARENA.height - 10),
        scale: rand(0.7, 1.3)
      });
    }
    const clouds = [];
    for (let i = 0; i < 5; i++) {
      clouds.push({ x: rand(0, ARENA.width), y: rand(30, 160), scale: rand(0.8, 1.6), speed: rand(4, 12) });
    }
    return { trees, clouds };
  }

  updateMenuHighscore() {
    const el = document.getElementById("menu-highscore");
    if (this.highScore > 0) {
      el.textContent = `Best Score: ${this.highScore}`;
    } else {
      el.textContent = "";
    }
  }

  resizeCanvasCoordsHelper() {
    // canvas internal resolution is fixed; CSS scales it responsively.
    // Mouse coordinate translation handles the rest (see getCanvasMousePos).
  }

  handleBlur() {
    if (this.state === STATES.PLAYING || this.state === STATES.BOSS_FIGHT) {
      this.setState(STATES.PAUSED, this.state);
    }
  }

  /* ---------- UI bindings ---------- */

  bindUI() {
    document.querySelectorAll("#difficulty-buttons .opt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#difficulty-buttons .opt-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.selectedDifficulty = btn.dataset.diff;
      });
    });

    document.querySelectorAll("#ammo-buttons .opt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#ammo-buttons .opt-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        this.selectedAmmoMode = btn.dataset.ammo;
      });
    });

    document.querySelectorAll("#sound-buttons .opt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#sound-buttons .opt-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        AudioManager.init();
        AudioManager.setMuted(btn.dataset.sound === "off");
      });
    });

    document.getElementById("start-btn").addEventListener("click", () => {
      AudioManager.init();
      AudioManager.resume();
      this.startNewGame();
    });

    document.getElementById("resume-btn").addEventListener("click", () => this.resumeFromPause());
    document.getElementById("restart-from-pause-btn").addEventListener("click", () => this.startNewGame());
    document.getElementById("menu-from-pause-btn").addEventListener("click", () => this.goToMenu());

    document.getElementById("next-stage-btn").addEventListener("click", () => this.beginNextStage());

    document.getElementById("play-again-btn").addEventListener("click", () => this.startNewGame());
    document.getElementById("game-over-menu-btn").addEventListener("click", () => this.goToMenu());
  }

  bindInput() {
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;

      if (e.code === "KeyR") {
        if (this.state === STATES.PLAYING || this.state === STATES.BOSS_FIGHT) {
          this.player.startReload(performance.now());
        }
      }
      if (e.code === "Escape") {
        if (this.state === STATES.PLAYING || this.state === STATES.BOSS_FIGHT) {
          this.setState(STATES.PAUSED, this.state);
        } else if (this.state === STATES.PAUSED) {
          this.resumeFromPause();
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const p = this.getCanvasMousePos(e);
      this.mouseX = p.x;
      this.mouseY = p.y;
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      AudioManager.init();
      AudioManager.resume();
      const p = this.getCanvasMousePos(e);
      this.mouseX = p.x;
      this.mouseY = p.y;
      this.tryShoot();
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  getCanvasMousePos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
  }

  /* ---------- state transitions ---------- */

  setState(next, resumeTarget) {
    this.state = next;
    if (resumeTarget) this.resumeState = resumeTarget;
    this.syncOverlays();
  }

  syncOverlays() {
    const map = {
      MENU: "menu-screen",
      PAUSED: "pause-screen",
      BOSS_INTRO: "boss-intro-screen",
      STAGE_COMPLETE: "stage-complete-screen",
      GAME_OVER: "game-over-screen"
    };
    ["menu-screen", "pause-screen", "boss-intro-screen", "stage-complete-screen", "game-over-screen"].forEach(id => {
      document.getElementById(id).classList.add("hidden");
    });
    const activeId = map[this.state];
    if (activeId) document.getElementById(activeId).classList.remove("hidden");
  }

  goToMenu() {
    this.setState(STATES.MENU);
    this.updateMenuHighscore();
  }

  startNewGame() {
    // full reset per section 24
    this.diffCfg = DIFFICULTY[this.selectedDifficulty];
    this.player.reset();
    this.player.configureForDifficulty(this.diffCfg, this.selectedAmmoMode);

    this.animals = [];
    this.particles.clear();
    this.spawner.reset();

    this.stage = 1;
    this.targetsHit = 0;
    this.targetsRequired = stageTargetCount(1);
    this.score = 0;
    this.stageStartScore = 0;

    this.shotsFired = 0;
    this.shotsHit = 0;

    this.boss = null;
    this.bossDefeated = false;

    this.keys = {};

    this.showStageToast(`STAGE ${this.stage}`);
    this.setState(STATES.PLAYING);
  }

  resumeFromPause() {
    this.setState(this.resumeState || STATES.PLAYING);
  }

  showStageToast(text) {
    this.stageToastText = text;
    this.stageToastTimer = 1.6;
  }

  beginStageFlow() {
    this.targetsHit = 0;
    this.targetsRequired = stageTargetCount(this.stage);
    this.animals = [];
    this.boss = null;
    this.bossDefeated = false;

    if (isBossStage(this.stage)) {
      this.setState(STATES.BOSS_INTRO);
      this.bossIntroUntil = performance.now() + 2400;
      AudioManager.play("bossWarning");
    } else {
      this.showStageToast(`STAGE ${this.stage}`);
      this.setState(STATES.PLAYING);
    }
  }

  beginNextStage() {
    this.stage += 1;
    this.beginStageFlow();
  }

  completeStage(bonus) {
    this.score += bonus;
    document.getElementById("stage-complete-stats").innerHTML = `
      <div class="stat-row"><span>Targets Hit</span><span>${this.targetsHit} / ${this.targetsRequired}</span></div>
      <div class="stat-row"><span>Accuracy</span><span>${this.accuracyText()}</span></div>
      <div class="stat-row"><span>Stage Bonus</span><span>+${bonus}</span></div>
      <div class="stat-row"><span>Score</span><span>${this.score}</span></div>
    `;
    AudioManager.play("stageComplete");
    this.animals = [];
    this.setState(STATES.STAGE_COMPLETE);
  }

  accuracyText() {
    if (this.shotsFired <= 0) return "0%";
    const acc = (this.shotsHit / this.shotsFired) * 100;
    if (!isFinite(acc) || isNaN(acc)) return "0%";
    return `${Math.round(clamp(acc, 0, 100))}%`;
  }

  triggerGameOver() {
    AudioManager.play("gameOver");
    const isNewHigh = this.score > this.highScore;
    if (isNewHigh) {
      this.highScore = this.score;
      safeLocalStorageSet(STORAGE_KEY_HIGHSCORE, String(this.highScore));
    }

    document.getElementById("new-highscore-banner").classList.toggle("hidden", !isNewHigh);
    document.getElementById("game-over-stats").innerHTML = `
      <div class="stat-row"><span>Score</span><span>${this.score}</span></div>
      <div class="stat-row"><span>Stage Reached</span><span>${this.stage}</span></div>
      <div class="stat-row"><span>Targets Hit</span><span>${this.shotsHit}</span></div>
      <div class="stat-row"><span>Accuracy</span><span>${this.accuracyText()}</span></div>
      <div class="stat-row"><span>Best Score</span><span>${this.highScore}</span></div>
    `;
    this.animals = [];
    this.setState(STATES.GAME_OVER);
  }

  /* ---------- shooting / hit detection ---------- */

  tryShoot() {
    if (this.state !== STATES.PLAYING && this.state !== STATES.BOSS_FIGHT) return;
    const now = performance.now();
    if (!this.player.canShoot(now)) {
      if (this.player.ammoMode === "limited" && this.player.ammo <= 0 && !this.player.reloading) {
        AudioManager.play("empty");
      }
      return;
    }

    this.player.nextShotReadyAt = now + SHOOT_COOLDOWN_MS;
    if (this.player.ammoMode === "limited") this.player.ammo -= 1;
    this.player.recoil = 1;
    this.shotsFired += 1;

    const angle = Math.atan2(this.mouseY - this.player.y, this.mouseX - this.player.x);
    const muzzleX = this.player.x + Math.cos(angle) * 40;
    const muzzleY = this.player.y + Math.sin(angle) * 40;
    this.particles.muzzleSpark(muzzleX, muzzleY, angle);
    AudioManager.play("shoot");

    const target = this.findClosestHit(this.player.x, this.player.y, angle);
    if (target) {
      this.registerHit(target);
    }
  }

  findClosestHit(originX, originY, angle) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let best = null;
    let bestT = Infinity;

    for (const a of this.animals) {
      if (a.dead || a.dying) continue;
      const toX = a.x - originX;
      const toY = a.y - originY;
      const t = toX * dirX + toY * dirY; // projection along ray
      if (t < 0 || t > SHOT_MAX_RANGE) continue;
      const closestX = originX + dirX * t;
      const closestY = originY + dirY * t;
      const perpDist = dist(a.x, a.y, closestX, closestY);
      const tolerance = a.radius + SHOT_TOLERANCE;
      if (perpDist <= tolerance && t < bestT) {
        bestT = t;
        best = a;
      }
    }
    return best;
  }

  registerHit(animal) {
    this.shotsHit += 1;
    AudioManager.play("hit");

    animal.applyDamage(1);
    this.particles.burstHit(animal.x, animal.y, animal.color);

    if (animal.isBoss) {
      if (animal.hp <= 0) {
        this.particles.scorePopup(animal.x, animal.y, `+${animal.points}`, "#ffcf4a");
        this.score += animal.points;
        this.bossDefeated = true;
        AudioManager.play("bossDefeated");
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this.particles.burstHit(animal.x + rand(-40, 40), animal.y + rand(-40, 40), "#8e3ab0"), i * 120);
        }
      }
      return;
    }

    this.particles.scorePopup(animal.x, animal.y, `+${animal.points}`, "#2d4a2b");
    this.particles.poofText(animal.x, animal.y);
    this.score += animal.points;
    this.targetsHit += 1;

    if (this.targetsHit >= this.targetsRequired) {
      this.animals.forEach(a => { if (a !== animal) a.dead = true; });
      const bonus = 100 + this.stage * 10;
      this.completeStage(bonus);
    }
  }

  /* ---------- update ---------- */

  updatePlayerMovement(dt) {
    let dx = 0, dy = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) dy -= 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) dy += 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) dx -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) dx += 1;

    this.player.moving = dx !== 0 || dy !== 0;

    if (this.player.moving) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = 260;
      this.player.x = clamp(this.player.x + (dx / len) * speed * dt, this.player.radius, ARENA.width - this.player.radius);
      this.player.y = clamp(this.player.y + (dy / len) * speed * dt, this.player.radius + 40, ARENA.height - this.player.radius);
      this.player.bob += dt * 12;
    }

    this.player.angle = Math.atan2(this.mouseY - this.player.y, this.mouseX - this.player.x);
  }

  updateGameplay(dt, now) {
    this.updatePlayerMovement(dt);
    this.player.update(dt, now);

    if (this.stageToastTimer > 0) this.stageToastTimer -= dt;

    if (this.state === STATES.PLAYING) {
      this.spawner.maybeSpawn(now, this);
    }

    for (const a of this.animals) {
      a.update(dt, this.player.x, this.player.y);

      if (!a.dying && !a.dead) {
        const d = dist(a.x, a.y, this.player.x, this.player.y);
        const hitDist = a.radius + this.player.radius * 0.6;
        if (d < hitDist) {
          const dmg = a.isBoss ? this.diffCfg.animalDamage * 1.5 : this.diffCfg.animalDamage;
          const applied = this.player.takeDamage(dmg, now);
          if (applied) {
            AudioManager.play("damage");
            this.particles.burstHit(this.player.x, this.player.y, "#ff5a3a");
            if (!a.isBoss) a.dead = true;
            if (this.player.hp <= 0) {
              this.triggerGameOver();
              return;
            }
          }
        }
      }
    }

    this.animals = this.animals.filter(a => !a.dead);

    if (this.state === STATES.BOSS_FIGHT && this.bossDefeated) {
      const bonus = 250 + this.stage * 20;
      this.animals = [];
      this.completeStage(bonus);
    }

    this.particles.update(dt);
  }

  updateBossIntro(now) {
    if (now >= this.bossIntroUntil) {
      this.boss = this.spawner.spawnBoss(this);
      this.setState(STATES.BOSS_FIGHT);
    }
  }

  update(dt) {
    const now = performance.now();
    switch (this.state) {
      case STATES.PLAYING:
      case STATES.BOSS_FIGHT:
        this.updateGameplay(dt, now);
        break;
      case STATES.BOSS_INTRO:
        this.updateBossIntro(now);
        break;
      default:
        break; // MENU, PAUSED, STAGE_COMPLETE, GAME_OVER: no world simulation
    }

    for (const c of this.decor.clouds) {
      c.x += c.speed * dt;
      if (c.x > ARENA.width + 100) c.x = -100;
    }
  }

  /* ---------- drawing ---------- */

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);
    this.drawArena(ctx);

    if (this.state !== STATES.MENU) {
      this.drawPlayer(ctx);
      for (const a of this.animals) this.drawAnimal(ctx, a);
      this.particles.draw(ctx);

      if (this.state === STATES.PLAYING || this.state === STATES.BOSS_FIGHT || this.state === STATES.PAUSED) {
        this.drawHud(ctx);
      }
      if (this.state === STATES.BOSS_FIGHT && this.boss) {
        this.drawBossHealthbar(ctx, this.boss);
      }
      if (this.stageToastTimer > 0) {
        this.drawStageToast(ctx);
      }
    }
  }

  drawArena(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, ARENA.height);
    grad.addColorStop(0, "#7ec8e3");
    grad.addColorStop(0.65, "#bfe6f2");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height * 0.72);

    // sun
    ctx.fillStyle = "#ffe27a";
    ctx.beginPath();
    ctx.arc(1120, 90, 46, 0, Math.PI * 2);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const c of this.decor.clouds) {
      this.drawCloud(ctx, c.x, c.y, c.scale);
    }

    // grass
    ctx.fillStyle = "#6fbf5a";
    ctx.fillRect(0, ARENA.height * 0.62, ARENA.width, ARENA.height * 0.38);
    ctx.fillStyle = "#5cab48";
    for (let i = 0; i < ARENA.width; i += 40) {
      ctx.fillRect(i, ARENA.height * 0.62, 20, 6);
    }

    // trees
    for (const t of this.decor.trees) {
      this.drawTree(ctx, t.x, t.y, t.scale);
    }
  }

  drawCloud(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.arc(24, -8, 18, 0, Math.PI * 2);
    ctx.arc(-24, -4, 16, 0, Math.PI * 2);
    ctx.arc(10, 6, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawTree(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = "#7a4a2a";
    ctx.fillRect(-6, -10, 12, 30);
    ctx.fillStyle = "#3f8f3a";
    ctx.beginPath();
    ctx.arc(0, -35, 26, 0, Math.PI * 2);
    ctx.arc(-18, -20, 18, 0, Math.PI * 2);
    ctx.arc(18, -20, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(ctx) {
    const p = this.player;
    const now = performance.now();
    const flashing = p.isInvulnerable(now) && Math.floor(now / 100) % 2 === 0;

    ctx.save();
    ctx.translate(p.x, p.y + (p.moving ? Math.sin(p.bob) * 3 : 0));

    if (flashing) ctx.globalAlpha = 0.4;

    // body
    ctx.fillStyle = "#3a6ea5";
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4c89a";
    ctx.beginPath();
    ctx.arc(0, -6, p.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // weapon, rotated toward mouse
    ctx.save();
    ctx.rotate(p.angle);
    const kick = p.recoil * 10;
    ctx.fillStyle = "#4a3323";
    ctx.fillRect(6 - kick, -6, 46, 12);
    ctx.fillStyle = "#222";
    ctx.fillRect(44 - kick, -4, 14, 8);

    if (p.recoil > 0.5) {
      ctx.fillStyle = "rgba(255, 210, 90, 0.9)";
      ctx.beginPath();
      ctx.moveTo(58 - kick, 0);
      ctx.lineTo(78 - kick, -10);
      ctx.lineTo(78 - kick, 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  }

  drawAnimal(ctx, a) {
    ctx.save();
    const scale = a.dying ? clamp(a.dyingTimer / 0.35, 0, 1) : 1;
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.sin(a.flapPhase) * 0.08);
    ctx.scale(scale, scale);

    if (a.isBoss) {
      this.drawBoss(ctx, a);
      ctx.restore();
      return;
    }

    const wingFlap = Math.sin(a.flapPhase) * (a.visualRadius * 0.5);

    ctx.fillStyle = a.color;
    // wings
    ctx.beginPath();
    ctx.ellipse(-a.visualRadius * 0.6, wingFlap * 0.3, a.visualRadius * 0.6, a.visualRadius * 0.3, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(a.visualRadius * 0.6, -wingFlap * 0.3, a.visualRadius * 0.6, a.visualRadius * 0.3, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, a.visualRadius * 0.75, a.visualRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // head
    ctx.beginPath();
    ctx.arc(a.visualRadius * 0.55, -a.visualRadius * 0.25, a.visualRadius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = "#e07a1f";
    ctx.beginPath();
    ctx.moveTo(a.visualRadius * 0.85, -a.visualRadius * 0.25);
    ctx.lineTo(a.visualRadius * 1.25, -a.visualRadius * 0.15);
    ctx.lineTo(a.visualRadius * 0.85, -a.visualRadius * 0.05);
    ctx.closePath();
    ctx.fill();

    // eye
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(a.visualRadius * 0.62, -a.visualRadius * 0.32, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBoss(ctx, a) {
    const wingFlap = Math.sin(a.flapPhase) * (a.visualRadius * 0.35);
    ctx.fillStyle = "#5c1e78";
    ctx.beginPath();
    ctx.ellipse(-a.visualRadius * 0.7, wingFlap * 0.3, a.visualRadius * 0.7, a.visualRadius * 0.4, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(a.visualRadius * 0.7, -wingFlap * 0.3, a.visualRadius * 0.7, a.visualRadius * 0.4, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, a.visualRadius * 0.85, a.visualRadius * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#6a2a8a";
    ctx.beginPath();
    ctx.arc(a.visualRadius * 0.6, -a.visualRadius * 0.3, a.visualRadius * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // crown spikes for intimidation
    ctx.fillStyle = "#ffcf4a";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(a.visualRadius * 0.6 + i * 14, -a.visualRadius * 0.68);
      ctx.lineTo(a.visualRadius * 0.6 + i * 14 - 6, -a.visualRadius * 0.9);
      ctx.lineTo(a.visualRadius * 0.6 + i * 14 + 6, -a.visualRadius * 0.9);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(a.visualRadius * 0.75, -a.visualRadius * 0.35, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e02020";
    ctx.beginPath();
    ctx.arc(a.visualRadius * 0.77, -a.visualRadius * 0.35, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBossHealthbar(ctx, boss) {
    const w = 460, h = 22;
    const x = ARENA.width / 2 - w / 2, y = 18;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    ctx.fillStyle = "#3a0d0d";
    ctx.fillRect(x, y, w, h);
    const pct = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.fillStyle = "#ff5a3a";
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Trebuchet MS, Arial";
    ctx.textAlign = "center";
    ctx.fillText("BOSS", ARENA.width / 2, y + h + 16);
    ctx.restore();
  }

  drawStageToast(ctx) {
    ctx.save();
    ctx.globalAlpha = clamp(this.stageToastTimer / 0.5, 0, 1);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 46px Trebuchet MS, Arial";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 4;
    ctx.strokeText(this.stageToastText, ARENA.width / 2, ARENA.height / 2 - 80);
    ctx.fillText(this.stageToastText, ARENA.width / 2, ARENA.height / 2 - 80);
    ctx.restore();
  }

  drawHudBox(ctx, x, y, w, h) {
    ctx.fillStyle = "rgba(20, 20, 20, 0.45)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, 8) : ctx.rect(x, y, w, h);
    ctx.fill();
  }

  drawHud(ctx) {
    const p = this.player;
    ctx.save();
    ctx.font = "bold 15px Trebuchet MS, Arial";
    ctx.textAlign = "left";

    // top-left: stage / score / best / targets
    this.drawHudBox(ctx, 10, 10, 230, 96);
    ctx.fillStyle = "#fff";
    ctx.fillText(`STAGE: ${this.stage}`, 20, 30);
    ctx.fillText(`SCORE: ${this.score}`, 20, 50);
    ctx.fillText(`BEST: ${Math.max(this.highScore, this.score)}`, 20, 70);
    if (this.state === STATES.PLAYING) {
      ctx.fillText(`TARGETS: ${this.targetsHit} / ${this.targetsRequired}`, 20, 90);
    } else {
      ctx.fillText(`BOSS FIGHT`, 20, 90);
    }

    // top-right: ammo / accuracy
    const rx = ARENA.width - 230;
    this.drawHudBox(ctx, rx, 10, 220, 96);
    ctx.textAlign = "left";
    const ammoText = p.ammoMode === "unlimited" ? "AMMO: ∞" : `AMMO: ${p.ammo} / ${p.ammoMax}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(ammoText, rx + 10, 30);
    ctx.fillText(`ACCURACY: ${this.accuracyText()}`, rx + 10, 50);
    if (p.reloading) {
      const now = performance.now();
      const pct = clamp((now - p.reloadStart) / p.reloadDuration, 0, 1);
      ctx.fillStyle = "#ffcf4a";
      ctx.fillText("RELOADING...", rx + 10, 70);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(rx + 10, 78, 200, 10);
      ctx.fillStyle = "#ffcf4a";
      ctx.fillRect(rx + 10, 78, 200 * pct, 10);
    } else {
      ctx.fillStyle = "#9be89b";
      ctx.fillText(p.ammoMode === "unlimited" ? "READY" : "READY (R to reload)", rx + 10, 70);
    }

    // health bar bottom-left
    const hbX = 20, hbY = ARENA.height - 34, hbW = 240, hbH = 18;
    this.drawHudBox(ctx, hbX - 6, hbY - 6, hbW + 12, hbH + 12);
    ctx.fillStyle = "#5a1414";
    ctx.fillRect(hbX, hbY, hbW, hbH);
    const hpPct = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = hpPct > 0.4 ? "#4caf50" : "#e04a3a";
    ctx.fillRect(hbX, hbY, hbW * hpPct, hbH);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(hbX, hbY, hbW, hbH);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Trebuchet MS, Arial";
    ctx.textAlign = "center";
    ctx.fillText(`HP: ${Math.ceil(p.hp)} / ${p.maxHp}`, hbX + hbW / 2, hbY + hbH - 5);

    ctx.restore();
  }

  /* ---------- main loop ---------- */

  loop(now) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000); // clamp dt to avoid spiral of death
    this.lastTime = now;

    this.update(dt);
    this.draw();

    requestAnimationFrame(this.loop);
  }
}

/* --------------------------- BOOTSTRAP --------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  try {
    if (!window.CanvasRenderingContext2D) {
      document.body.innerHTML = "<p style='color:#fff;text-align:center;margin-top:40px;'>Your browser does not support HTML5 Canvas, which this game requires.</p>";
      return;
    }
    window.__game = new Game();
  } catch (err) {
    console.error("Failed to start Cartoon Hunt Arena:", err);
    document.body.innerHTML = "<p style='color:#fff;text-align:center;margin-top:40px;'>Something went wrong starting the game. Please refresh the page.</p>";
  }
});
