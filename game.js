(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas?.getContext("2d");

  if (!canvas || !ctx) {
    const message = document.createElement("div");
    message.style.padding = "16px";
    message.style.color = "#ffb3b3";
    message.style.fontFamily = "Segoe UI, sans-serif";
    message.textContent =
      "Chrono Serpent could not initialize because this browser does not support Canvas 2D.";
    document.body.prepend(message);
    return;
  }

  const UI = {
    score: document.getElementById("score"),
    level: document.getElementById("level"),
    health: document.getElementById("health"),
    shield: document.getElementById("shield"),
    combo: document.getElementById("combo"),
    missionList: document.getElementById("missionList"),
    overlay: document.getElementById("overlay"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    muteBtn: document.getElementById("muteBtn"),
  };

  const WORLD = {
    width: canvas.width,
    height: canvas.height,
    grid: 16,
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const randRange = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(randRange(min, max + 1));

  class InputManager {
    constructor() {
      this.keys = new Set();
      this.justPressed = new Set();

      window.addEventListener("keydown", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
          e.preventDefault();
        }

        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (!this.keys.has(key)) {
          this.justPressed.add(key);
        }
        this.keys.add(key);
      });

      window.addEventListener("keyup", (e) => {
        const key = e.key.toLowerCase();
        this.keys.delete(key);
      });
    }

    isDown(...keys) {
      return keys.some((k) => this.keys.has(k));
    }

    consume(key) {
      const k = key.toLowerCase();
      const has = this.justPressed.has(k);
      if (has) this.justPressed.delete(k);
      return has;
    }

    endFrame() {
      this.justPressed.clear();
    }
  }

  class AudioManager {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    ensureCtx() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return false;

      if (!this.ctx) {
        this.ctx = new AudioCtor();
      }
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return true;
    }

    toggleMute() {
      this.enabled = !this.enabled;
      return this.enabled;
    }

    beep(type, freq, duration, volume = 0.05) {
      if (!this.enabled) return;
      if (!this.ensureCtx()) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.stop(this.ctx.currentTime + duration);
    }

    hit() {
      this.beep("square", 140, 0.08, 0.08);
    }

    pickup() {
      this.beep("triangle", 560, 0.08, 0.06);
      setTimeout(() => this.beep("triangle", 740, 0.08, 0.05), 40);
    }

    shoot() {
      this.beep("sawtooth", 220, 0.04, 0.03);
    }

    dash() {
      this.beep("triangle", 90, 0.12, 0.06);
    }

    levelUp() {
      [320, 420, 520].forEach((f, i) => {
        setTimeout(() => this.beep("sine", f, 0.09, 0.06), i * 55);
      });
    }

    death() {
      this.beep("sawtooth", 80, 0.4, 0.08);
    }
  }

  class Particle {
    constructor(x, y, vx, vy, life, color, size = 3) {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.life = life;
      this.maxLife = life;
      this.color = color;
      this.size = size;
    }

    update(dt) {
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= 0.99;
      this.vy *= 0.99;
      return this.life > 0;
    }

    draw(ctx) {
      const t = this.life / this.maxLife;
      ctx.save();
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  class ParticleSystem {
    constructor() {
      this.items = [];
    }

    burst(x, y, count, color, speed = 160, size = 3) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random());
        this.items.push(
          new Particle(
            x,
            y,
            Math.cos(angle) * sp,
            Math.sin(angle) * sp,
            randRange(0.25, 0.85),
            color,
            size * randRange(0.7, 1.3)
          )
        );
      }
    }

    trail(x, y, color) {
      this.items.push(
        new Particle(x, y, randRange(-20, 20), randRange(-20, 20), randRange(0.16, 0.3), color, randRange(1.2, 2.3))
      );
    }

    update(dt) {
      this.items = this.items.filter((p) => p.update(dt));
    }

    draw(ctx) {
      for (const p of this.items) p.draw(ctx);
    }
  }

  class Projectile {
    constructor(x, y, vx, vy, damage, color = "#8df2ff", radius = 5, ttl = 1.8) {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.damage = damage;
      this.color = color;
      this.radius = radius;
      this.ttl = ttl;
      this.alive = true;
    }

    update(dt) {
      this.ttl -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.ttl <= 0) this.alive = false;
      if (this.x < -20 || this.y < -20 || this.x > WORLD.width + 20 || this.y > WORLD.height + 20) {
        this.alive = false;
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  class Mine {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.radius = 10;
      this.armTime = 0.65;
      this.ttl = 6;
      this.alive = true;
    }

    update(dt) {
      this.armTime -= dt;
      this.ttl -= dt;
      if (this.ttl <= 0) this.alive = false;
    }

    draw(ctx) {
      ctx.save();
      const armed = this.armTime <= 0;
      ctx.fillStyle = armed ? "#ff9070" : "#7a8aa5";
      ctx.strokeStyle = "#ffe0a0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  class Enemy {
    constructor(type, x, y, levelScale = 1) {
      this.type = type;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.radius = 14;
      this.maxHealth = 20;
      this.health = this.maxHealth;
      this.speed = 85;
      this.contactDamage = 10;
      this.color = "#ff6f8a";
      this.alive = true;
      this.fireCooldown = randRange(0.8, 1.6);
      this.scoreValue = 40;

      if (type === "runner") {
        this.radius = 10;
        this.maxHealth = 14;
        this.health = this.maxHealth;
        this.speed = 140;
        this.contactDamage = 7;
        this.color = "#ffad5b";
        this.scoreValue = 45;
      } else if (type === "tank") {
        this.radius = 18;
        this.maxHealth = 44;
        this.health = this.maxHealth;
        this.speed = 56;
        this.contactDamage = 17;
        this.color = "#ff6262";
        this.scoreValue = 85;
      } else if (type === "sniper") {
        this.radius = 12;
        this.maxHealth = 18;
        this.health = this.maxHealth;
        this.speed = 76;
        this.contactDamage = 8;
        this.color = "#bd89ff";
        this.scoreValue = 60;
      } else if (type === "boss") {
        this.radius = 40;
        this.maxHealth = 320;
        this.health = this.maxHealth;
        this.speed = 48;
        this.contactDamage = 22;
        this.color = "#ff3b73";
        this.scoreValue = 950;
      }

      this.maxHealth = Math.round(this.maxHealth * levelScale);
      this.health = this.maxHealth;
      this.contactDamage = Math.round(this.contactDamage * (0.7 + levelScale * 0.4));
      this.speed *= 0.85 + levelScale * 0.2;
    }

    takeDamage(amount) {
      this.health -= amount;
      if (this.health <= 0) {
        this.alive = false;
      }
    }

    update(dt, game) {
      const player = game.snake;
      const dx = player.head.x - this.x;
      const dy = player.head.y - this.y;
      const d = Math.hypot(dx, dy) || 1;

      if (this.type === "runner") {
        const nx = dx / d;
        const ny = dy / d;
        this.vx = nx * this.speed;
        this.vy = ny * this.speed;
      } else if (this.type === "tank") {
        const nx = dx / d;
        const ny = dy / d;
        this.vx = lerp(this.vx, nx * this.speed, 0.03);
        this.vy = lerp(this.vy, ny * this.speed, 0.03);
      } else if (this.type === "sniper") {
        const desired = 210;
        const nx = dx / d;
        const ny = dy / d;
        if (d > desired + 14) {
          this.vx = nx * this.speed;
          this.vy = ny * this.speed;
        } else if (d < desired - 16) {
          this.vx = -nx * this.speed;
          this.vy = -ny * this.speed;
        } else {
          this.vx *= 0.92;
          this.vy *= 0.92;
        }

        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
          this.fireCooldown = randRange(1.4, 2.2);
          game.enemyProjectiles.push(
            new Projectile(this.x, this.y, nx * 250, ny * 250, 12, "#f4a2ff", 4, 2.6)
          );
          game.particles.burst(this.x, this.y, 8, "#f4a2ff", 95, 2.4);
        }
      } else if (this.type === "boss") {
        const nx = dx / d;
        const ny = dy / d;
        this.vx = lerp(this.vx, nx * this.speed, 0.015);
        this.vy = lerp(this.vy, ny * this.speed, 0.015);
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 1.15;
          for (let i = 0; i < 12; i += 1) {
            const a = (Math.PI * 2 * i) / 12;
            game.enemyProjectiles.push(
              new Projectile(this.x, this.y, Math.cos(a) * 190, Math.sin(a) * 190, 10, "#ff8ca2", 5, 3)
            );
          }
        }
      } else {
        this.vx = (dx / d) * this.speed;
        this.vy = (dy / d) * this.speed;
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.x = clamp(this.x, this.radius, WORLD.width - this.radius);
      this.y = clamp(this.y, this.radius, WORLD.height - this.radius);
    }

    draw(ctx) {
      ctx.save();
      ctx.shadowColor = this.color;
      ctx.shadowBlur = this.type === "boss" ? 30 : 14;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();

      const w = this.radius * 2;
      const h = 5;
      const ratio = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 13, w, h);
      ctx.fillStyle = "#9cffc2";
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 13, w * ratio, h);
      ctx.restore();
    }
  }

  class Core {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.radius = 8;
      this.value = 25;
      this.pulse = Math.random() * Math.PI * 2;
      this.kind = ["energy", "health", "shield"][randInt(0, 2)];
    }

    update(dt) {
      this.pulse += dt * 5;
    }

    draw(ctx) {
      const colors = {
        energy: "#7cf7ff",
        health: "#8bff96",
        shield: "#95aaff",
      };
      ctx.save();
      ctx.shadowColor = colors[this.kind];
      ctx.shadowBlur = 16;
      ctx.fillStyle = colors[this.kind];
      const r = this.radius + Math.sin(this.pulse) * 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  class Mission {
    constructor(id, text, target, type, timer = null) {
      this.id = id;
      this.text = text;
      this.target = target;
      this.type = type;
      this.progress = 0;
      this.done = false;
      this.failed = false;
      this.timer = timer;
      this.maxTimer = timer;
      this.reward = 180;
    }

    update(dt) {
      if (this.done || this.failed) return;
      if (this.timer !== null) {
        this.timer -= dt;
        if (this.timer <= 0 && this.progress < this.target) {
          this.failed = true;
        }
      }
    }

    inc(amount = 1) {
      if (this.done || this.failed) return;
      this.progress += amount;
      if (this.progress >= this.target) {
        this.done = true;
      }
    }

    displayText() {
      if (this.failed) return `${this.text} [FAILED]`;
      if (this.done) return `${this.text} [DONE]`;
      const timer = this.timer !== null ? ` (${Math.ceil(this.timer)}s)` : "";
      return `${this.text}: ${this.progress}/${this.target}${timer}`;
    }
  }

  class MissionSystem {
    constructor() {
      this.missions = [];
      this.pool = [
        () => new Mission("kill_runners", "Eliminate runner units", 6, "runnerKills"),
        () => new Mission("collect_cores", "Absorb unstable cores", 8, "coreCollect"),
        () => new Mission("no_hit", "No damage for 30s", 30, "secondsNoHit", 30),
        () => new Mission("mine_kill", "Destroy enemies with mines", 5, "mineKills"),
        () => new Mission("combo", "Reach combo x10", 10, "comboPeak"),
      ];
    }

    startLevel(level) {
      this.missions = [];
      const rngCount = level % 3 === 0 ? 3 : 2;
      const bag = [...this.pool].sort(() => Math.random() - 0.5);
      for (let i = 0; i < rngCount; i += 1) {
        this.missions.push(bag[i]());
      }
    }

    update(dt, game) {
      for (const mission of this.missions) {
        mission.update(dt);

        if (mission.type === "secondsNoHit" && !game.flags.tookDamageThisLevel) {
          mission.progress = clamp(mission.maxTimer - mission.timer, 0, mission.target);
          if (mission.progress >= mission.target) mission.done = true;
        }

        if (mission.type === "comboPeak") {
          mission.progress = Math.max(mission.progress, game.comboTier);
          if (mission.progress >= mission.target) mission.done = true;
        }
      }
    }

    onEvent(type, amount = 1) {
      for (const mission of this.missions) {
        if (mission.type === type) mission.inc(amount);
      }
    }

    rewardScore() {
      return this.missions.filter((m) => m.done).reduce((sum, m) => sum + m.reward, 0);
    }
  }

  class Snake {
    constructor(x, y) {
      this.head = { x, y };
      this.segments = [];
      this.segmentSpacing = 12;
      this.baseSpeed = 170;
      this.speed = this.baseSpeed;
      this.turnRate = 6.5;
      this.dir = { x: 1, y: 0 };
      this.targetDir = { x: 1, y: 0 };

      this.maxHealth = 100;
      this.health = 100;
      this.shield = 0;

      this.invulnTimer = 0;
      this.dashCooldown = 0;
      this.dashTime = 0;
      this.temporalCooldown = 0;
      this.temporalTime = 0;
      this.primaryCooldown = 0;
      this.mineCooldown = 0;

      this.trailHistory = [];
      this.length = 18;
      for (let i = 0; i < this.length; i += 1) {
        this.segments.push({ x: x - i * this.segmentSpacing, y });
      }
    }

    setAimFromInput(input) {
      let x = 0;
      let y = 0;
      if (input.isDown("arrowup", "w")) y -= 1;
      if (input.isDown("arrowdown", "s")) y += 1;
      if (input.isDown("arrowleft", "a")) x -= 1;
      if (input.isDown("arrowright", "d")) x += 1;
      if (x !== 0 || y !== 0) {
        const mag = Math.hypot(x, y) || 1;
        this.targetDir.x = x / mag;
        this.targetDir.y = y / mag;
      }
    }

    grow(amount) {
      this.length += amount;
      for (let i = 0; i < amount; i += 1) {
        const tail = this.segments[this.segments.length - 1];
        this.segments.push({ x: tail.x, y: tail.y });
      }
    }

    heal(amount) {
      this.health = clamp(this.health + amount, 0, this.maxHealth);
    }

    addShield(amount) {
      this.shield = clamp(this.shield + amount, 0, 120);
    }

    applyDamage(amount) {
      if (this.invulnTimer > 0) return 0;
      let remaining = amount;
      if (this.shield > 0) {
        const absorbed = Math.min(this.shield, remaining);
        this.shield -= absorbed;
        remaining -= absorbed;
      }
      if (remaining > 0) {
        this.health -= remaining;
      }
      this.invulnTimer = 0.2;
      return amount;
    }

    update(dt, input, game) {
      this.setAimFromInput(input);

      const smoothing = 1 - Math.exp(-this.turnRate * dt);
      this.dir.x = lerp(this.dir.x, this.targetDir.x, smoothing);
      this.dir.y = lerp(this.dir.y, this.targetDir.y, smoothing);
      const m = Math.hypot(this.dir.x, this.dir.y) || 1;
      this.dir.x /= m;
      this.dir.y /= m;

      this.invulnTimer -= dt;
      this.primaryCooldown -= dt;
      this.dashCooldown -= dt;
      this.temporalCooldown -= dt;
      this.mineCooldown -= dt;

      if (this.dashTime > 0) {
        this.dashTime -= dt;
      }
      if (this.temporalTime > 0) {
        this.temporalTime -= dt;
      }

      if (input.consume("shift") && this.dashCooldown <= 0) {
        this.dashCooldown = 3.5;
        this.dashTime = 0.24;
        game.audio.dash();
        game.particles.burst(this.head.x, this.head.y, 18, "#a6f7ff", 190, 3);
      }

      if (input.consume("e") && this.temporalCooldown <= 0) {
        this.temporalCooldown = 8;
        this.temporalTime = 2.2;
        game.particles.burst(this.head.x, this.head.y, 25, "#a08cff", 240, 4);
      }

      if (input.consume("q") && this.mineCooldown <= 0) {
        this.mineCooldown = 2.2;
        game.mines.push(new Mine(this.head.x, this.head.y));
      }

      if ((input.consume(" ") || input.consume("space") || input.consume("spacebar")) && this.primaryCooldown <= 0) {
        this.primaryCooldown = 0.18;
        const spread = 0.09;
        for (let i = -1; i <= 1; i += 1) {
          const a = Math.atan2(this.dir.y, this.dir.x) + i * spread;
          game.projectiles.push(
            new Projectile(this.head.x, this.head.y, Math.cos(a) * 360, Math.sin(a) * 360, 12, "#87faff", 4, 1.5)
          );
        }
        game.audio.shoot();
      }

      let speed = this.baseSpeed + (this.length - 18) * 0.35;
      if (this.dashTime > 0) speed *= 2.6;
      if (this.temporalTime > 0) speed *= 1.3;
      this.speed = speed;

      this.head.x += this.dir.x * this.speed * dt;
      this.head.y += this.dir.y * this.speed * dt;

      if (this.head.x < 0) this.head.x += WORLD.width;
      if (this.head.x > WORLD.width) this.head.x -= WORLD.width;
      if (this.head.y < 0) this.head.y += WORLD.height;
      if (this.head.y > WORLD.height) this.head.y -= WORLD.height;

      this.trailHistory.unshift({ x: this.head.x, y: this.head.y });
      const maxTrail = this.length * 14;
      if (this.trailHistory.length > maxTrail) this.trailHistory.length = maxTrail;

      for (let i = 0; i < this.segments.length; i += 1) {
        const idx = Math.min(this.trailHistory.length - 1, Math.floor((i + 1) * 10));
        const p = this.trailHistory[idx] || this.head;
        this.segments[i].x = lerp(this.segments[i].x, p.x, 0.65);
        this.segments[i].y = lerp(this.segments[i].y, p.y, 0.65);
      }

      game.particles.trail(this.head.x, this.head.y, this.temporalTime > 0 ? "#a08cff" : "#6cefff");
    }

    draw(ctx) {
      for (let i = this.segments.length - 1; i >= 0; i -= 1) {
        const seg = this.segments[i];
        const t = i / this.segments.length;
        const radius = lerp(6, 11, 1 - t);
        ctx.save();
        ctx.fillStyle = `rgba(${Math.round(120 + 80 * (1 - t))}, ${Math.round(220 - 60 * t)}, 255, 0.95)`;
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      if (this.invulnTimer > 0) {
        ctx.globalAlpha = 0.6;
      }
      ctx.shadowColor = "#7ef8ff";
      ctx.shadowBlur = this.temporalTime > 0 ? 30 : 18;
      ctx.fillStyle = this.temporalTime > 0 ? "#cabdff" : "#8cf8ff";
      ctx.beginPath();
      ctx.arc(this.head.x, this.head.y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#f0fdff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.head.x, this.head.y);
      ctx.lineTo(this.head.x + this.dir.x * 17, this.head.y + this.dir.y * 17);
      ctx.stroke();

      if (this.shield > 0) {
        ctx.strokeStyle = "rgba(150,170,255,0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.head.x, this.head.y, 15 + Math.sin(performance.now() * 0.008) * 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  class Game {
    constructor() {
      this.input = new InputManager();
      this.audio = new AudioManager();
      this.particles = new ParticleSystem();
      this.missionSystem = new MissionSystem();

      this.state = "menu";
      this.snake = null;
      this.projectiles = [];
      this.enemyProjectiles = [];
      this.enemies = [];
      this.cores = [];
      this.mines = [];

      this.score = 0;
      this.level = 1;
      this.xp = 0;
      this.combo = 1;
      this.comboTimer = 0;
      this.comboTier = 1;

      this.waveTime = 0;
      this.spawnTimer = 0;
      this.coreSpawnTimer = 0;
      this.bgTime = 0;
      this.flags = {
        tookDamageThisLevel: false,
      };

      this.cameraShake = 0;
      this.lastTime = performance.now();

      this.starField = Array.from({ length: 180 }, () => ({
        x: Math.random() * WORLD.width,
        y: Math.random() * WORLD.height,
        s: randRange(0.4, 2.0),
        p: Math.random() * Math.PI * 2,
      }));

      this.bindButtons();
      this.reset();
      requestAnimationFrame((t) => this.frame(t));
    }

    bindButtons() {
      UI.startBtn.addEventListener("click", () => {
        this.audio.ensureCtx();
        this.startGame();
      });

      UI.pauseBtn.addEventListener("click", () => {
        if (this.state === "running") {
          this.state = "paused";
          this.showOverlay("PAUSED<br/>Press Start/Restart or P to continue");
        } else if (this.state === "paused") {
          this.state = "running";
          this.hideOverlay();
        }
      });

      UI.muteBtn.addEventListener("click", () => {
        const enabled = this.audio.toggleMute();
        UI.muteBtn.textContent = enabled ? "Mute" : "Unmute";
      });

      window.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        if (key === "p") {
          if (this.state === "running") {
            this.state = "paused";
            this.showOverlay("PAUSED");
          } else if (this.state === "paused") {
            this.state = "running";
            this.hideOverlay();
          }
        }
      });
    }

    reset() {
      this.snake = new Snake(WORLD.width * 0.5, WORLD.height * 0.5);
      this.projectiles.length = 0;
      this.enemyProjectiles.length = 0;
      this.enemies.length = 0;
      this.cores.length = 0;
      this.mines.length = 0;
      this.particles.items.length = 0;

      this.score = 0;
      this.level = 1;
      this.xp = 0;
      this.combo = 1;
      this.comboTier = 1;
      this.comboTimer = 0;
      this.waveTime = 0;
      this.spawnTimer = 0;
      this.coreSpawnTimer = 1.6;
      this.flags.tookDamageThisLevel = false;

      this.missionSystem.startLevel(this.level);
      this.hideOverlay();
      this.updateHud();
    }

    startGame() {
      this.reset();
      this.state = "running";
    }

    showOverlay(text) {
      UI.overlay.innerHTML = text;
      UI.overlay.classList.remove("hidden");
    }

    hideOverlay() {
      UI.overlay.classList.add("hidden");
    }

    spawnEnemy() {
      let type = "drone";
      const roll = Math.random();
      if (roll < 0.35) type = "runner";
      else if (roll < 0.55) type = "sniper";
      else if (roll < 0.7) type = "tank";

      if (this.level % 4 === 0 && !this.enemies.some((e) => e.type === "boss")) {
        type = "boss";
      }

      const side = randInt(0, 3);
      let x;
      let y;
      if (side === 0) {
        x = randRange(0, WORLD.width);
        y = -20;
      } else if (side === 1) {
        x = WORLD.width + 20;
        y = randRange(0, WORLD.height);
      } else if (side === 2) {
        x = randRange(0, WORLD.width);
        y = WORLD.height + 20;
      } else {
        x = -20;
        y = randRange(0, WORLD.height);
      }

      const scale = 1 + (this.level - 1) * 0.16;
      this.enemies.push(new Enemy(type, x, y, scale));
    }

    spawnCore() {
      const margin = 30;
      this.cores.push(new Core(randRange(margin, WORLD.width - margin), randRange(margin, WORLD.height - margin)));
    }

    gainScore(points) {
      const value = Math.round(points * this.combo);
      this.score += value;
      this.xp += points;
      this.comboTimer = 4;
      this.combo = clamp(this.combo + 0.05, 1, 6);
      this.comboTier = Math.max(this.comboTier, Math.floor(this.combo));

      const needed = 450 + this.level * 170;
      if (this.xp >= needed) {
        this.xp -= needed;
        this.level += 1;
        this.flags.tookDamageThisLevel = false;
        const missionReward = this.missionSystem.rewardScore();
        this.score += missionReward;
        this.missionSystem.startLevel(this.level);
        this.audio.levelUp();
        this.snake.maxHealth += 6;
        this.snake.health = Math.min(this.snake.maxHealth, this.snake.health + 18);
        this.snake.addShield(18);
        this.showOverlay(`LEVEL ${this.level}<br/>Mission Reward: ${missionReward}`);
        setTimeout(() => {
          if (this.state === "running") this.hideOverlay();
        }, 950);
      }
    }

    explodeEnemy(enemy, isMine = false) {
      this.particles.burst(enemy.x, enemy.y, enemy.type === "boss" ? 60 : 22, enemy.color, 220, enemy.type === "boss" ? 5 : 3);
      this.gainScore(enemy.scoreValue);
      this.snake.grow(enemy.type === "boss" ? 4 : 1);
      this.audio.hit();

      if (enemy.type === "runner") this.missionSystem.onEvent("runnerKills", 1);
      if (isMine) this.missionSystem.onEvent("mineKills", 1);
    }

    handleCollisions(dt) {
      for (const core of this.cores) {
        if (distance(core.x, core.y, this.snake.head.x, this.snake.head.y) < 18) {
          core.collected = true;
          if (core.kind === "energy") {
            this.gainScore(core.value);
          } else if (core.kind === "health") {
            this.snake.heal(15);
            this.gainScore(core.value + 10);
          } else {
            this.snake.addShield(20);
            this.gainScore(core.value + 5);
          }
          this.missionSystem.onEvent("coreCollect", 1);
          this.audio.pickup();
          this.particles.burst(core.x, core.y, 18, "#9bf7ff", 140, 3);
        }
      }
      this.cores = this.cores.filter((c) => !c.collected);

      for (const proj of this.projectiles) {
        if (!proj.alive) continue;
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (distance(proj.x, proj.y, enemy.x, enemy.y) < proj.radius + enemy.radius) {
            proj.alive = false;
            enemy.takeDamage(proj.damage);
            this.particles.burst(proj.x, proj.y, 6, "#8fffff", 90, 2);
            if (!enemy.alive) this.explodeEnemy(enemy);
            break;
          }
        }
      }

      for (const mine of this.mines) {
        if (!mine.alive || mine.armTime > 0) continue;
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (distance(mine.x, mine.y, enemy.x, enemy.y) < mine.radius + enemy.radius + 3) {
            mine.alive = false;
            this.particles.burst(mine.x, mine.y, 32, "#ffaf8f", 230, 4);
            for (const target of this.enemies) {
              if (!target.alive) continue;
              const d = distance(mine.x, mine.y, target.x, target.y);
              if (d < 90 + target.radius) {
                target.takeDamage(65 - d * 0.35);
                if (!target.alive) this.explodeEnemy(target, true);
              }
            }
            break;
          }
        }
      }

      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        if (distance(enemy.x, enemy.y, this.snake.head.x, this.snake.head.y) < enemy.radius + 11) {
          const dealt = this.snake.applyDamage(enemy.contactDamage * dt * 3.5);
          if (dealt > 0) {
            this.flags.tookDamageThisLevel = true;
            this.combo = 1;
            this.comboTimer = 0;
            this.cameraShake = 7;
            this.audio.hit();
            this.particles.burst(this.snake.head.x, this.snake.head.y, 14, "#ff8094", 180, 3);
          }
        }
      }

      for (const proj of this.enemyProjectiles) {
        if (!proj.alive) continue;
        if (distance(proj.x, proj.y, this.snake.head.x, this.snake.head.y) < proj.radius + 10) {
          proj.alive = false;
          const dealt = this.snake.applyDamage(proj.damage);
          if (dealt > 0) {
            this.flags.tookDamageThisLevel = true;
            this.combo = 1;
            this.comboTimer = 0;
            this.cameraShake = 5;
          }
        }
      }

      this.projectiles = this.projectiles.filter((p) => p.alive);
      this.enemyProjectiles = this.enemyProjectiles.filter((p) => p.alive);
      this.mines = this.mines.filter((m) => m.alive);
      this.enemies = this.enemies.filter((e) => e.alive);
    }

    update(dt) {
      if (this.state !== "running") {
        this.input.endFrame();
        return;
      }

      const slowFactor = this.snake.temporalTime > 0 ? 0.5 : 1;
      const scaledDt = dt * slowFactor;

      this.waveTime += scaledDt;
      this.bgTime += dt;
      this.spawnTimer -= scaledDt;
      this.coreSpawnTimer -= scaledDt;
      this.comboTimer -= dt;

      if (this.comboTimer <= 0) {
        this.combo = lerp(this.combo, 1, 0.08);
      }

      this.snake.update(dt, this.input, this);

      if (this.spawnTimer <= 0) {
        const base = clamp(2.2 - this.level * 0.08, 0.45, 2.2);
        this.spawnTimer = base * randRange(0.75, 1.25);
        const amount = this.level >= 6 ? 2 : 1;
        for (let i = 0; i < amount; i += 1) this.spawnEnemy();
      }

      if (this.coreSpawnTimer <= 0 && this.cores.length < 9) {
        this.coreSpawnTimer = randRange(1.2, 2.6);
        this.spawnCore();
      }

      for (const core of this.cores) core.update(dt);
      for (const enemy of this.enemies) enemy.update(scaledDt, this);
      for (const p of this.projectiles) p.update(dt);
      for (const p of this.enemyProjectiles) p.update(scaledDt);
      for (const mine of this.mines) mine.update(dt);

      this.handleCollisions(dt);

      this.missionSystem.update(dt, this);
      this.particles.update(dt);
      this.cameraShake = Math.max(0, this.cameraShake - 16 * dt);

      if (this.snake.health <= 0) {
        this.state = "gameover";
        this.audio.death();
        this.showOverlay(
          `SYSTEM FAILURE<br/>Final Score: ${Math.floor(this.score)}<br/>Level Reached: ${this.level}<br/><br/>Press Start / Restart`
        );
      }

      this.updateHud();
      this.input.endFrame();
    }

    updateHud() {
      UI.score.textContent = Math.floor(this.score);
      UI.level.textContent = this.level;
      UI.health.textContent = Math.max(0, Math.floor(this.snake.health));
      UI.shield.textContent = Math.floor(this.snake.shield);
      UI.combo.textContent = `x${this.combo.toFixed(2)}`;

      UI.missionList.innerHTML = "";
      for (const mission of this.missionSystem.missions) {
        const li = document.createElement("li");
        li.textContent = mission.displayText();
        if (mission.done) li.classList.add("done");
        if (mission.failed) li.classList.add("failed");
        UI.missionList.appendChild(li);
      }
    }

    drawBackground(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, WORLD.height);
      g.addColorStop(0, "#0a1536");
      g.addColorStop(1, "#050916");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      for (const star of this.starField) {
        const a = 0.35 + Math.sin(this.bgTime * star.s + star.p) * 0.3;
        ctx.fillStyle = `rgba(190,220,255,${a})`;
        ctx.fillRect(star.x, star.y, star.s, star.s);
      }

      const grid = WORLD.grid;
      ctx.strokeStyle = "rgba(65,95,160,0.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x < WORLD.width; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD.height);
        ctx.stroke();
      }
      for (let y = 0; y < WORLD.height; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD.width, y);
        ctx.stroke();
      }
    }

    drawTopBanner(ctx) {
      ctx.save();
      ctx.fillStyle = "rgba(8,16,36,0.68)";
      ctx.fillRect(0, 0, WORLD.width, 34);
      ctx.fillStyle = "#cdeaff";
      ctx.font = "15px Segoe UI";
      ctx.fillText(`Enemies: ${this.enemies.length}`, 12, 22);
      ctx.fillText(`Cores: ${this.cores.length}`, 132, 22);
      ctx.fillText(`XP: ${Math.floor(this.xp)}`, 230, 22);
      ctx.fillText(`Combo Tier: ${this.comboTier}`, 330, 22);
      ctx.fillText(`State: ${this.state.toUpperCase()}`, 490, 22);

      const drawCd = (label, cd, max, x) => {
        const ratio = clamp(1 - cd / max, 0, 1);
        ctx.fillStyle = "rgba(20,40,78,0.95)";
        ctx.fillRect(x, 8, 80, 16);
        ctx.fillStyle = ratio >= 1 ? "#86ffbf" : "#80baff";
        ctx.fillRect(x, 8, 80 * ratio, 16);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.strokeRect(x, 8, 80, 16);
        ctx.fillStyle = "#eaf7ff";
        ctx.font = "11px Segoe UI";
        ctx.fillText(label, x + 3, 20);
      };

      drawCd("Dash", this.snake.dashCooldown, 3.5, 610);
      drawCd("Burst", this.snake.temporalCooldown, 8, 700);
      drawCd("Mine", this.snake.mineCooldown, 2.2, 790);
      ctx.restore();
    }

    draw() {
      ctx.save();
      if (this.cameraShake > 0) {
        const mag = this.cameraShake;
        ctx.translate(randRange(-mag, mag), randRange(-mag, mag));
      }

      this.drawBackground(ctx);

      for (const core of this.cores) core.draw(ctx);
      for (const mine of this.mines) mine.draw(ctx);
      for (const enemy of this.enemies) enemy.draw(ctx);
      for (const p of this.projectiles) p.draw(ctx);
      for (const p of this.enemyProjectiles) p.draw(ctx);
      this.snake.draw(ctx);
      this.particles.draw(ctx);

      this.drawTopBanner(ctx);

      if (this.state === "menu") {
        ctx.fillStyle = "rgba(4,7,20,0.74)";
        ctx.fillRect(0, 0, WORLD.width, WORLD.height);
        ctx.fillStyle = "#e4f2ff";
        ctx.font = "32px Segoe UI";
        ctx.fillText("Chrono Serpent: Nexus Protocol", 180, 220);
        ctx.font = "18px Segoe UI";
        ctx.fillText("Use WASD / Arrows to move. Space shoot, Shift dash, E temporal burst, Q mine.", 130, 274);
        ctx.fillText("Press Start / Restart to deploy.", 320, 318);
      }

      if (this.state === "paused") {
        ctx.fillStyle = "rgba(5, 8, 24, 0.52)";
        ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      }

      ctx.restore();
    }

    frame(now) {
      const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
      this.lastTime = now;
      this.update(dt);
      this.draw();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  const game = new Game();
  window.__chronoSnake = game;
})();
