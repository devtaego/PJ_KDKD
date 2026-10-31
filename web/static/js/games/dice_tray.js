// 야추 주사위 트레이: 가죽 컵을 꾹 눌러 흔들다 놓으면 주사위가 쏟아져 나와 튕기고 구르다 멈춤
// (yacht/yacht_game.py 의 tray_image, cup_image, draw_die, start_throw, step_physics 를 캔버스로 옮김)
import { play } from "../sound.js";

const FELT = "#B5232C";
const MAX_ROLL_S = 2.6; // 주사위가 이 시간 안에 반드시 멈춤
const PIPS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
const rand = (a, b) => a + Math.random() * (b - a);
const randFace = () => 1 + Math.floor(Math.random() * 6);

function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

function rrect(ctx, x0, y0, x1, y1, r) {
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x0, y0, x1 - x0, y1 - y0, r) : ctx.rect(x0, y0, x1 - x0, y1 - y0);
}

export class DiceTray {
  /** opts: onCupDown(), onCupUp(), onDieTap(i), canShake() */
  constructor(opts) {
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "dice-tray";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "주사위 트레이");
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.dice = Array.from({ length: 5 }, () => ({ x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0, face: 1, final: 1, rolling: false, visible: false, u: 0.5, v: 0.5, spawn: 0, travel: 0 }));
    this.held = [false, false, false, false, false];
    this.rolled = false;
    this.shakeT0 = null; // 흔들기 시작 시각 (내가 또는 다른 사람이)
    this.shakeLabel = "";
    this.anim = null;
    this.raf = null;
    this.lastT = 0;
    this.lastTick = 0;
    this.onSettled = null;
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.el);
    this.onWinResize = () => this.layout(); // 화면 높이가 바뀌어도 트레이 크기를 다시 맞춤
    window.addEventListener("resize", this.onWinResize);
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) this.canvas.addEventListener(t, () => this.up());
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ------------------------------------------------------------ 크기 · 배치
  layout() {
    const full = this.el.clientWidth;
    if (full < 50) return;
    const ratio = full < 520 ? 0.78 : 0.6;
    // 점수표와 버튼이 같이 보이도록, 트레이는 화면 높이의 일부만 씀 (폰은 조금 더 작게)
    const maxH = Math.max(200, window.innerHeight * (full < 520 ? 0.4 : 0.44));
    const W = Math.round(Math.min(full, maxH / ratio));
    const H = Math.round(W * ratio);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.dpr = dpr;
    const rim = Math.max(W * 0.04, 12);
    const felt = [rim, rim, W - rim, H - rim];
    const shelfH = (felt[3] - felt[1]) * 0.22;
    const pad = rim * 0.6;
    const cupW = (felt[2] - felt[0]) * 0.17;
    const area = [felt[0] + pad, felt[1] + shelfH + pad, felt[2] - pad - cupW, felt[3] - pad];
    const s = Math.min((area[2] - area[0]) / 5.2, (area[3] - area[1]) / 2.6, shelfH * 0.74);
    const sx0 = felt[0] + pad, sx1 = felt[2] - pad;
    const slots = Array.from({ length: 5 }, (_, i) => [sx0 + ((sx1 - sx0) * (i + 0.5)) / 5, felt[1] + shelfH / 2 + pad * 0.15]);
    const cupH = Math.min(s * 2.1, (area[3] - area[1]) * 0.9);
    const old = this.geo?.area;
    this.geo = { W, H, rim, felt, shelf: [felt[0], felt[1], felt[2], felt[1] + shelfH], area, s, slots, cup: [area[2] + cupW * 0.28, (area[1] + area[3]) / 2, cupH] };
    if (old) { // 크기가 바뀌면 굴러가던 주사위도 비율대로
      for (const d of this.dice) if (d.rolling) {
        d.x = area[0] + ((d.x - old[0]) / (old[2] - old[0])) * (area[2] - area[0]);
        d.y = area[1] + ((d.y - old[1]) / (old[3] - old[1])) * (area[3] - area[1]);
      }
    }
    this.tray = this.paintTray();
    this.cupImg = this.paintCup();
    this.snapHeld();
    this.draw();
  }

  /** 층진 금속 테두리 + 빨간 펠트 + 위쪽 금속 받침대의 파인 칸 (한 번만 그려 둠) */
  paintTray() {
    const { W, H, rim, felt, shelf, s, slots } = this.geo;
    const c = document.createElement("canvas");
    c.width = W * this.dpr;
    c.height = H * this.dpr;
    const ctx = c.getContext("2d");
    ctx.scale(this.dpr, this.dpr);
    const layers = [
      [0, 22, [[0, "#FBFCFD"], [0.1, "#DCE1E6"], [0.55, "#AEB5BD"], [1, "#6B7178"]]],
      [0.16, 19, [[0, "#4C5259"], [1, "#2C3035"]]],
      [0.24, 17, [[0, "#E9EDF1"], [0.5, "#B8BEC5"], [1, "#7E848B"]]],
      [0.52, 15, [[0, "#5E646B"], [1, "#3A3F45"]]],
      [0.62, 14, [[0, "#C9CED4"], [1, "#7C8289"]]],
      [0.8, 12, [[0, "#2A2D32"], [1, "#1B1D21"]]],
    ];
    for (const [f, r, stops] of layers) {
      const i = rim * f;
      rrect(ctx, i, i, W - i, H - i, r);
      ctx.fillStyle = vgrad(ctx, i, H - i, stops);
      ctx.fill();
    }
    // 펠트 + 은은한 결
    ctx.save();
    rrect(ctx, ...felt, 10);
    ctx.clip();
    ctx.fillStyle = FELT;
    ctx.fillRect(0, 0, W, H);
    const rnd = mulberry(7);
    for (let k = 0; k < (W * H) / 30; k++) {
      ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.06)";
      ctx.fillRect(felt[0] + rnd() * (felt[2] - felt[0]), felt[1] + rnd() * (felt[3] - felt[1]), 1.2, 1.2);
    }
    // 가장자리 안쪽 그림자
    ctx.shadowColor = "rgba(40,2,6,0.85)";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    rrect(ctx, felt[0] - 5, felt[1] - 3, felt[2] + 5, felt[3] + 5, 14);
    ctx.stroke();
    ctx.shadowColor = "transparent";
    // 받침대
    ctx.fillStyle = vgrad(ctx, shelf[1], shelf[3], [[0, "#565B62"], [0.5, "#3D4147"], [1, "#2B2E33"]]);
    ctx.fillRect(shelf[0], shelf[1], shelf[2] - shelf[0], shelf[3] - shelf[1]);
    const sg = ctx.createLinearGradient(0, shelf[3], 0, shelf[3] + 8);
    sg.addColorStop(0, "rgba(40,2,6,0.7)");
    sg.addColorStop(1, "rgba(40,2,6,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(shelf[0], shelf[3], shelf[2] - shelf[0], 8);
    ctx.fillStyle = "#8C939C";
    ctx.fillRect(shelf[0] + 10, shelf[3] - 1, shelf[2] - shelf[0] - 20, 1);
    for (const [cx, cy] of slots) { // 파인 주사위 칸
      const b = [cx - s * 0.62, cy - s * 0.58, cx + s * 0.62, cy + s * 0.58];
      rrect(ctx, b[0], b[1] + 1.5, b[2], b[3] + 1.5, s * 0.17);
      ctx.fillStyle = "#AAB1BA";
      ctx.fill();
      rrect(ctx, ...b, s * 0.17);
      ctx.fillStyle = vgrad(ctx, b[1], b[3], [[0, "#16181B"], [0.6, "#24272C"], [1, "#30343A"]]);
      ctx.fill();
      ctx.save();
      rrect(ctx, ...b, s * 0.17);
      ctx.clip();
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#000";
      rrect(ctx, b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3, s * 0.2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    rrect(ctx, 0.5, 0.5, W - 0.5, H - 0.5, 22);
    ctx.stroke();
    return c;
  }

  /** 옆으로 눕힌 검은 가죽 컵 (입구는 왼쪽) */
  paintCup() {
    const { W, cup } = this.geo;
    const [mx, , h] = cup;
    const len = W - mx + 10;
    const rx = h * 0.2, pad = Math.ceil(h * 0.18);
    const cw = Math.ceil(len + rx + pad * 2), ch = Math.ceil(h + pad * 2);
    const c = document.createElement("canvas");
    c.width = cw * this.dpr;
    c.height = ch * this.dpr;
    const ctx = c.getContext("2d");
    ctx.scale(this.dpr, this.dpr);
    const ox = rx + pad, top = pad, cy = top + h / 2;
    // 펠트 위 그림자
    ctx.save();
    ctx.shadowColor = "rgba(30,0,4,0.75)";
    ctx.shadowBlur = h * 0.14;
    ctx.shadowOffsetY = h * 0.12;
    ctx.fillStyle = "#000";
    ctx.fillRect(ox, top + h * 0.1, len, h * 0.8);
    ctx.restore();
    // 몸통: 원통처럼 세로 그라데이션
    ctx.fillStyle = vgrad(ctx, top, top + h, [[0, "#060607"], [0.12, "#1E1F23"], [0.27, "#55585F"], [0.35, "#34363C"], [0.62, "#18191C"], [0.88, "#09090B"], [1, "#030304"]]);
    ctx.fillRect(ox, top, len, h);
    const rnd = mulberry(4);
    for (let k = 0; k < (len * h) / 60; k++) { // 가죽 결
      ctx.fillStyle = `rgba(150,150,160,${0.03 + rnd() * 0.05})`;
      ctx.beginPath();
      ctx.arc(ox + rnd() * len, top + 2 + rnd() * (h - 4), 0.4 + rnd() * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    // 금속 띠 (입구와 같은 타원 모양으로 휨)
    const metal = vgrad(ctx, top, top + h, [[0, "#1A1B1E"], [0.22, "#5A5D64"], [0.32, "#8A8E96"], [0.5, "#44474D"], [0.85, "#1D1E21"], [1, "#0E0E10"]]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + h * 0.16 - h * 0.05, 0, cw, ch);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(ox + h * 0.16, cy, rx, h / 2, 0, -Math.PI / 2, Math.PI / 2);
    ctx.ellipse(ox + h * 0.11, cy, rx, h / 2, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.restore();
    // 바느질
    ctx.strokeStyle = "rgba(200,40,45,0.9)";
    ctx.lineWidth = Math.max(h * 0.025, 1.4);
    ctx.lineCap = "round";
    for (const yy of [top + h * 0.12, top + h * 0.88]) {
      for (let x = ox + h * 0.3; x < ox + len; x += h * 0.12) {
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + h * 0.07, yy);
        ctx.stroke();
      }
    }
    // 위쪽 반짝임
    ctx.fillStyle = "rgba(225,230,240,0.35)";
    rrect(ctx, ox + h * 0.6, cy - h * 0.27, ox + len, cy - h * 0.21, h * 0.03);
    ctx.fill();
    // 입구: 금속 테 + 깊은 안쪽
    const lip = h * 0.075;
    ctx.beginPath();
    ctx.ellipse(ox, cy, rx, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ox, cy, rx - lip * 0.55, h / 2 - lip, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#040405";
    ctx.fill();
    const glow = ctx.createRadialGradient(ox + rx * 0.2, cy + h * 0.2, 0, ox + rx * 0.2, cy + h * 0.2, h * 0.3);
    glow.addColorStop(0, "rgba(70,72,80,0.6)");
    glow.addColorStop(1, "rgba(70,72,80,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(ox, cy, rx - lip * 0.55, h / 2 - lip, 0, 0, Math.PI * 2);
    ctx.fill();
    return { canvas: c, ox, oy: top + h / 2, w: cw, h: ch };
  }

  // ------------------------------------------------------------ 상태
  /** 게임 상태 반영. dice: 지금 눈, held: 고정 여부, rolled: 이번 차례에 굴렸는지 */
  sync(dice, held, rolled) {
    if (!this.geo) this.layout(); // 화면 뒤에 있으면 크기 알림이 안 오므로 직접 잼
    this.held = held.slice();
    const wasRolled = this.rolled;
    this.rolled = rolled;
    for (let i = 0; i < 5; i++) {
      const d = this.dice[i];
      if (!rolled) { d.visible = false; d.rolling = false; continue; } // 새 차례: 주사위는 다시 컵 안으로
      if (!d.rolling) d.face = dice[i];
      d.final = dice[i];
      if (!d.visible && !d.rolling) this.placeRandom(d); // 굴리는 모습을 못 본 경우 (다시 들어옴 등)
    }
    if (!wasRolled && !rolled) this.anim = null;
    this.kick();
  }

  placeRandom(d) {
    d.visible = true;
    d.u = rand(0.1, 0.9);
    d.v = rand(0.15, 0.85);
    d.a = rand(-0.5, 0.5);
    if (this.geo) {
      const [ax0, ay0, ax1, ay1] = this.geo.area;
      d.x = ax0 + d.u * (ax1 - ax0);
      d.y = ay0 + d.v * (ay1 - ay0);
    }
  }

  isRolling() { return this.dice.some((d) => d.rolling); }

  /** 흔들기 표시 (label: "흔드는 중..." 옆에 붙는 이름 등) */
  setShaking(on, label = "") {
    if (on && this.shakeT0 === null) this.shakeT0 = performance.now();
    if (!on) this.shakeT0 = null;
    this.shakeLabel = label;
    this.kick();
  }

  /** 던지기: 고정 안 된 주사위가 컵 입구에서 쏟아져 나옴. power 0.8~1.45 */
  throwDice(indices, finals, power = 1.1) {
    if (!this.geo) this.layout();
    this.shakeT0 = null;
    const now = performance.now();
    play("roll");
    const g = this.geo;
    indices.forEach((i, k) => {
      const d = this.dice[i];
      Object.assign(d, { visible: true, rolling: true, final: finals[i], spawn: now + k * 50, a: rand(0, Math.PI * 2), va: rand(-16, 16), travel: 0, face: randFace() });
      if (g) {
        const [ax0, ay0, ax1, ay1] = g.area;
        d.x = ax1 - g.s * 0.5;
        d.y = rand(ay0 + (ay1 - ay0) * 0.3, ay1 - (ay1 - ay0) * 0.3);
        const speed = (ax1 - ax0) * rand(1.6, 2.3) * power;
        d.vx = -speed;
        d.vy = rand(-0.9, 0.9) * (ay1 - ay0);
      }
    });
    this.anim = indices.length ? { t0: now } : null;
    clearTimeout(this.forceTimer);
    if (this.anim) { // 탭이 뒤에 있으면 그림 프레임이 멈추므로, 시간이 되면 반드시 멈춰 세움
      const anim = this.anim;
      this.forceTimer = setTimeout(() => {
        if (this.anim !== anim) return;
        this.step(0, anim.t0 + MAX_ROLL_S * 1000 + 1);
        this.snapHeld();
        this.draw();
      }, MAX_ROLL_S * 1000 + 400);
    }
    this.kick();
  }

  /** 애니메이션 없이 바로 제자리 (기록을 다시 계산할 때) */
  settleInstant(dice) {
    for (let i = 0; i < 5; i++) {
      const d = this.dice[i];
      if (d.rolling) { d.rolling = false; d.face = dice[i]; }
    }
    this.anim = null;
    this.draw();
  }

  // ------------------------------------------------------------ 입력
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    if (!this.geo) return;
    const [x, y] = this.pos(e);
    const [mx, my, h] = this.geo.cup;
    if (x > mx - h * 0.3 && Math.abs(y - my) < h * 0.65) {
      e.preventDefault();
      this.opts.onCupDown?.();
      return;
    }
    const s = this.geo.s;
    for (let i = 4; i >= 0; i--) {
      const d = this.dice[i];
      if (d.visible && !d.rolling && (x - d.x) ** 2 + (y - d.y) ** 2 <= (s * 0.65) ** 2) {
        this.opts.onDieTap?.(i);
        return;
      }
    }
  }

  up() { this.opts.onCupUp?.(); }

  // ------------------------------------------------------------ 움직임
  kick() {
    if (this.raf === null) {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  loop(t) {
    this.raf = null;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    this.step(dt, t);
    const moving = this.glide(dt);
    this.draw(t);
    if (this.anim || this.shakeT0 !== null || moving) this.kick();
  }

  step(dt, now) {
    const g = this.geo;
    if (!this.anim) return;
    if (!g) { // 아직 크기를 모름: 굴리는 모습 없이 바로 멈춤
      for (const d of this.dice) if (d.rolling) { d.rolling = false; d.face = d.final; d.u = rand(0.1, 0.9); d.v = rand(0.15, 0.85); }
      this.anim = null;
      this.onSettled?.();
      return;
    }
    const [ax0, ay0, ax1, ay1] = g.area;
    const s = g.s, r = s * 0.5;
    const rolling = this.dice.filter((d) => d.rolling && now >= d.spawn);
    let hit = false;
    for (const d of rolling) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.va * dt;
      const fr = Math.exp(-1.9 * dt);
      d.vx *= fr;
      d.vy *= fr;
      d.va *= Math.exp(-2.4 * dt);
      for (const [axis, lo, hi] of [["x", ax0 + r, ax1 + r * 0.6], ["y", ay0 + r, ay1 - r]]) {
        const v = "v" + axis;
        if (d[axis] < lo || d[axis] > hi) {
          d[axis] = Math.min(Math.max(d[axis], lo), hi);
          if (Math.abs(d[v]) > 140) hit = true;
          d[v] = -d[v] * 0.55;
          d.va += rand(-8, 8);
        }
      }
      const speed = Math.hypot(d.vx, d.vy);
      d.travel += speed * dt;
      if (speed > 90 && d.travel > s * 0.75) { // 구르며 윗면이 바뀌는 느낌
        d.travel = 0;
        d.face = randFace();
      }
    }
    for (let i = 0; i < rolling.length; i++) { // 주사위끼리 부딪힘
      for (let j = i + 1; j < rolling.length; j++) {
        const a = rolling[i], b = rolling[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < s * 0.95) {
          const nx = dx / dist, ny = dy / dist, push = (s * 0.95 - dist) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * 0.9;
            a.vx -= nx * imp; a.vy -= ny * imp;
            b.vx += nx * imp; b.vy += ny * imp;
            a.va += rand(-6, 6);
            b.va += rand(-6, 6);
            if (imp > 160) hit = true;
          }
        }
      }
    }
    if (hit && now - this.lastTick > 70) { // 벽이나 다른 주사위에 부딪히는 소리
      this.lastTick = now;
      play("tick");
    }
    const force = (now - this.anim.t0) / 1000 > MAX_ROLL_S;
    for (const d of rolling) {
      const slow = Math.hypot(d.vx, d.vy) < 30 && Math.abs(d.va) < 0.6;
      if (force || slow) {
        d.rolling = false;
        d.face = d.final;
        d.x = Math.min(d.x, ax1 - r);
        d.u = (d.x - ax0) / (ax1 - ax0);
        d.v = (d.y - ay0) / (ay1 - ay0);
        if (!slow || this.overlaps(d)) this.freeSpot(d); // 억지로 멈춘 주사위는 겹치지 않게 펼쳐 놓음
      }
    }
    if (!this.dice.some((d) => d.rolling)) {
      this.anim = null;
      this.onSettled?.();
    }
  }

  overlaps(d) {
    const s = this.geo.s;
    return this.dice.some((o, i) => o !== d && o.visible && !o.rolling && !(this.held[i] && this.rolled) &&
      (o.x - d.x) ** 2 + (o.y - d.y) ** 2 < (s * 1.05) ** 2);
  }

  /** 다른 주사위와 겹치지 않는 자리(u, v)를 골라 줌. 주사위는 그 자리로 미끄러져 감 */
  freeSpot(d) {
    const [ax0, ay0, ax1, ay1] = this.geo.area;
    const s = this.geo.s;
    let best = null, bestGap = -1;
    for (let k = 0; k < 40; k++) {
      const u = rand(0.08, 0.92), v = rand(0.12, 0.88);
      const x = ax0 + u * (ax1 - ax0), y = ay0 + v * (ay1 - ay0);
      const gap = Math.min(...this.dice.filter((o, i) => o !== d && o.visible && !(this.held[i] && this.rolled))
        .map((o) => Math.hypot(ax0 + o.u * (ax1 - ax0) - x, ay0 + o.v * (ay1 - ay0) - y)), 1e9);
      if (gap > bestGap) { best = [u, v]; bestGap = gap; }
      if (gap > s * 1.3) break;
    }
    [d.u, d.v] = best;
  }

  /** 고정한 주사위는 위 칸으로, 푼 주사위는 원래 자리로 부드럽게. 아직 움직이면 true */
  glide(dt) {
    const g = this.geo;
    if (!g) return false;
    const [ax0, ay0, ax1, ay1] = g.area;
    const k = 1 - Math.exp(-dt * 16);
    let moving = false;
    this.dice.forEach((d, i) => {
      if (!d.visible || d.rolling) return;
      const held = this.held[i] && this.rolled;
      const [tx, ty] = held ? g.slots[i] : [ax0 + d.u * (ax1 - ax0), ay0 + d.v * (ay1 - ay0)];
      if (Math.abs(d.x - tx) > 0.5 || Math.abs(d.y - ty) > 0.5) {
        d.x += (tx - d.x) * k;
        d.y += (ty - d.y) * k;
        moving = true;
      } else {
        d.x = tx;
        d.y = ty;
      }
      if (held && Math.abs(d.a) > 0.01) {
        d.a -= d.a * k; // 고정 칸에서는 반듯하게
        moving = true;
      }
    });
    return moving;
  }

  snapHeld() {
    for (let n = 0; n < 40; n++) this.glide(1);
  }

  // ------------------------------------------------------------ 그리기
  draw(now = performance.now()) {
    const g = this.geo;
    if (!g) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.drawImage(this.tray, 0, 0, g.W, g.H);
    ctx.save();
    rrect(ctx, ...g.felt, 10);
    ctx.clip();
    const order = [0, 1, 2, 3, 4].sort((a, b) => (this.dice[a].rolling - this.dice[b].rolling) || this.dice[a].y - this.dice[b].y);
    for (const i of order) {
      const d = this.dice[i];
      if (!d.visible || (d.rolling && now < d.spawn)) continue;
      const held = this.held[i] && this.rolled && !d.rolling;
      let lift = 0;
      if (d.rolling) lift = Math.min(Math.hypot(d.vx, d.vy) / 1400, 0.35) * g.s; // 빠를수록 살짝 떠 보이게
      drawDie(ctx, d.x, d.y - lift, g.s * (1 + (lift / g.s) * 0.25), d.face, held, d.a, lift);
    }
    this.drawCup(now);
    ctx.restore();
  }

  drawCup(now) {
    const g = this.geo;
    const [mx, my, h] = g.cup;
    let jx = 0, jy = 0;
    const shaking = this.shakeT0 !== null;
    if (shaking) {
      const t = (now - this.shakeT0) / 1000;
      jx = Math.sin(t * 38) * h * 0.06 - h * 0.05;
      jy = Math.cos(t * 47) * h * 0.08;
      const tick = Math.floor(t * 5);
      if (tick !== this.shakeTick) { // 흔드는 동안 달그락
        this.shakeTick = tick;
        play("shake");
      }
    }
    const c = this.cupImg;
    const ctx = this.ctx;
    ctx.drawImage(c.canvas, mx + jx - c.ox, my + jy - c.oy, c.w, c.h);
    if (shaking) { // 입구 앞에 들썩이는 선
      const t = (now - this.shakeT0) / 1000;
      ctx.lineWidth = Math.max(h * 0.04, 2);
      for (let k = 0; k < 3; k++) {
        const ph = (t * 5 + k / 3) % 1;
        const r = h * (0.32 + ph * 0.3);
        ctx.strokeStyle = `rgba(255,243,214,${1 - ph})`;
        ctx.beginPath();
        ctx.arc(mx + jx, my + jy, r, Math.PI * 0.83, Math.PI * 1.17);
        ctx.stroke();
      }
      ctx.fillStyle = "#FFE9C9";
      ctx.font = `${Math.max(12, h * 0.17)}px Jua, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${this.shakeLabel}흔드는 중...`, g.felt[2] - 6, my - h * 0.55);
    }
  }

  destroy() {
    clearTimeout(this.forceTimer);
    window.removeEventListener("resize", this.onWinResize);
    this.ro.disconnect();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }
}

/** (cx, cy) 중심에 입체감 있는 주사위 (yacht_game.draw_die 와 같은 모양) */
function drawDie(ctx, cx, cy, size, face, held, angle, lift) {
  const half = size / 2, rad = size * 0.22;
  const path = (dx, dy, scale) => {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-half, -half, size, size, rad) : ctx.rect(-half, -half, size, size);
    ctx.restore();
  };
  ctx.fillStyle = held ? "rgba(10,10,14,0.55)" : "rgba(60,4,10,0.5)";
  path(size * 0.06 + lift * 0.3, size * 0.11 + lift * 0.8, 1);
  ctx.fill();
  ctx.fillStyle = held ? "#B8A6F5" : "#CFC6B4";
  path(0, size * 0.07, 1);
  ctx.fill();
  path(0, 0, 1);
  ctx.fillStyle = held ? "#EEE8FF" : "#F4F0E8";
  ctx.fill();
  ctx.lineWidth = held ? Math.max(size * 0.05, 2.5) : 1;
  ctx.strokeStyle = held ? "#7C5CFF" : "#E2DBCD";
  ctx.stroke();
  ctx.fillStyle = held ? "#F8F5FF" : "#FFFFFF";
  path(-size * 0.03, -size * 0.04, 0.8);
  ctx.fill();
  const pr = size * 0.092 * (face === 1 ? 1.55 : 1), step = size * 0.26;
  ctx.fillStyle = face === 1 ? "#C7302E" : "#1F1C19";
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (const [px, py] of PIPS[face] || []) {
    ctx.beginPath();
    ctx.arc(cx + px * step * cos - py * step * sin, cy + px * step * sin + py * step * cos, pr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
