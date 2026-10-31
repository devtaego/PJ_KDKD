// 타이틀 화면 배경: 테마마다 다른 픽셀 아트 장면을 코드로 직접 그림 (작게 그려서 크게 늘림 → 또렷한 도트 느낌)
// night: 별이 반짝이는 밤의 도시 / pastel: 햇살 아래 언덕 위 학교 / arcade: 네온 해와 달리는 격자 바닥
const H = 180; // 세로 도트 수 (가로는 화면 비율에 맞춤)

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TitleScene {
  constructor(canvas, theme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.theme = theme;
    this.raf = null;
    this.last = 0;
    this.resize = () => this.fit();
    window.addEventListener("resize", this.resize);
    this.fit();
    const loop = (t) => {
      if (t - this.last > 50) { // 초당 20장이면 충분 (배터리 아끼기)
        this.last = t;
        this.draw(t / 1000);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  fit() {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    this.W = Math.max(110, Math.min(480, Math.round(H * aspect)));
    this.canvas.width = this.W;
    this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.draw(performance.now() / 1000);
  }

  setTheme(theme) { this.theme = theme; this.draw(performance.now() / 1000); }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
  }

  // ------------------------------------------------------------ 도트 그리기 도구
  rect(x, y, w, h, c) { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  /** 위에서 아래로 색 띠 (경계는 바둑판 무늬로 섞어 도트 그라데이션처럼) */
  bands(y0, y1, colors) {
    const n = colors.length, h = (y1 - y0) / n;
    colors.forEach((c, i) => this.rect(0, y0 + i * h, this.W, h + 1, c));
    for (let i = 1; i < n; i++) {
      const y = Math.round(y0 + i * h);
      for (let x = 0; x < this.W; x += 2) {
        this.rect(x + (y % 2), y - 1, 1, 1, colors[i]);
        this.rect(x + ((y + 1) % 2), y, 1, 1, colors[i - 1]);
      }
    }
  }

  disc(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      this.rect(cx - w, cy + y, w * 2 + 1, 1, c);
    }
  }

  draw(t) {
    if (this.theme === "pastel") this.pastel(t);
    else if (this.theme === "arcade") this.arcade(t);
    else this.night(t);
  }

  // ------------------------------------------------------------ 밤하늘: 별 · 달 · 불 켜진 도시
  night(t) {
    const W = this.W;
    this.bands(0, H, ["#0B0A2A", "#120E36", "#1A1446", "#22175A", "#2B1A5E", "#3E1D5C"]);
    const r = mulberry(7);
    for (let i = 0; i < W * 0.5; i++) { // 별 (몇 개는 반짝)
      const x = r() * W, y = r() * H * 0.62, tw = r();
      const on = tw > 0.85 ? Math.sin(t * 3 + i) > 0 : true;
      if (on) this.rect(x, y, 1, 1, tw > 0.93 ? "#FFE9A8" : "#C9C2FF");
    }
    const mx = W * 0.8, my = 30;
    this.disc(mx, my, 12, "#FFF1B8");
    this.disc(mx - 4, my - 3, 3, "#EADB9A");
    this.disc(mx + 5, my + 4, 2, "#EADB9A");
    this.skyline(r, H - 62, 34, "#241B4F", ["#FFD86B", "#FFB547"], t, 0.18);
    this.skyline(r, H - 38, 30, "#150F31", ["#FF8FB1", "#7CE7FF", "#FFD86B"], t, 0.3);
    this.rect(0, H - 10, W, 10, "#0D0A22");
  }

  skyline(r, base, maxH, color, lights, t, lit) {
    let x = -2;
    while (x < this.W) {
      const w = 8 + Math.floor(r() * 14), h = 10 + Math.floor(r() * maxH);
      this.rect(x, base - h, w, h + 60, color);
      if (r() > 0.6) this.rect(x + w / 2 - 1, base - h - 4, 1, 4, color); // 안테나
      for (let wy = base - h + 3; wy < base + 20; wy += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3) {
          const k = r();
          if (k < lit) this.rect(wx, wy, 1, 2, lights[Math.floor(k * 97) % lights.length]);
        }
      }
      x += w + 1;
    }
  }

  // ------------------------------------------------------------ 말랑말랑: 하늘 · 구름 · 언덕 위 학교
  pastel(t) {
    const W = this.W, ground = H - 34;
    this.bands(0, ground, ["#8FD8FF", "#A6E1FF", "#BDE9FF", "#D3F1FF", "#E7F9FF"]);
    this.disc(W * 0.86, 26, 11, "#FFE07A");
    this.disc(W * 0.86, 26, 8, "#FFF1B0");
    for (let i = 0; i < 4; i++) { // 천천히 흘러가는 구름
      const span = W + 60;
      const x = ((i * 97 + t * (3 + i)) % span) - 40;
      this.cloud(x, 18 + i * 14, 1 + (i % 2) * 0.4);
    }
    this.hill(ground + 4, 26, "#C5ECB1", 0.03, 1.2);
    for (let x = 6; x < W; x += 19) this.pine(x + ((x * 7) % 5), ground - 6, "#5FB772", "#4C9E61");
    this.hill(ground + 4, 14, "#9EDC8C", 0.05, 0.4);
    // 땅: 풀 + 흙
    this.rect(0, ground, W, H - ground, "#B07A4F");
    this.rect(0, ground, W, 5, "#6BCB5A");
    this.rect(0, ground, W, 2, "#8FE07A");
    const r = mulberry(3);
    for (let i = 0; i < W / 3; i++) this.rect(r() * W, ground + 8 + r() * 24, 2, 1, r() > 0.5 ? "#9A6741" : "#C48C5C");
    for (let x = 2; x < W; x += 7) this.rect(x, ground - 2, 1, 2, "#6BCB5A"); // 풀잎
    this.school(Math.max(8, W * 0.08), ground);
    this.fence(Math.max(8, W * 0.08) + 50, ground, Math.min(40, W * 0.18));
    this.sign(W - 22, ground, t);
  }

  cloud(x, y, s) {
    const c = "#FFFFFF", sh = "#D6EEFF";
    this.rect(x + 4 * s, y + 6 * s, 26 * s, 5 * s, sh);
    this.rect(x, y + 4 * s, 30 * s, 6 * s, c);
    this.rect(x + 5 * s, y, 12 * s, 6 * s, c);
    this.rect(x + 14 * s, y - 3 * s, 10 * s, 8 * s, c);
  }

  hill(base, amp, color, freq, phase) {
    for (let x = 0; x < this.W; x++) {
      const h = amp * (0.6 + 0.4 * Math.sin(x * freq + phase));
      this.rect(x, base - h, 1, h, color);
    }
  }

  pine(x, base, c, dark) {
    this.rect(x + 3, base, 2, 6, "#8A5A3A");
    for (let k = 0; k < 4; k++) {
      const w = 8 - k * 2;
      this.rect(x + 4 - w / 2, base - 3 - k * 4, w, 4, k % 2 ? dark : c);
    }
  }

  school(x, ground) {
    const w = 44, h = 26, y = ground - h;
    this.rect(x, y, w, h, "#FFF4DC");
    this.rect(x, y + h - 3, w, 3, "#E9D9B8");
    for (let k = 0; k < 9; k++) this.rect(x - 4 + k, y - 1 - k, w + 8 - k * 2, 1, k % 3 === 2 ? "#E86F96" : "#FF8FB1"); // 세모 지붕
    this.rect(x + w / 2 - 5, y - 18, 10, 9, "#FFF4DC"); // 시계탑
    this.disc(x + w / 2, y - 14, 3, "#FFFFFF");
    this.rect(x + w / 2, y - 16, 1, 2, "#5B3E58");
    this.rect(x + w / 2 - 6, y - 20, 12, 2, "#FF8FB1");
    this.rect(x + w / 2 + 6, y - 32, 1, 14, "#8A5A3A"); // 깃발
    this.rect(x + w / 2 + 7, y - 32, 7, 4, "#FFB547");
    for (const wx of [5, 14, 27, 36]) { // 창문
      this.rect(x + wx, y + 6, 6, 6, "#8FD8FF");
      this.rect(x + wx, y + 6, 6, 1, "#5BB7E6");
      this.rect(x + wx + 2, y + 6, 1, 6, "#FFF4DC");
    }
    this.rect(x + w / 2 - 4, y + h - 13, 8, 13, "#B07A4F"); // 문
    this.rect(x + w / 2 + 2, y + h - 7, 1, 1, "#FFE07A");
  }

  fence(x, ground, len) {
    for (let k = 0; k < len; k += 6) this.rect(x + k, ground - 9, 3, 9, "#FFFFFF");
    this.rect(x, ground - 7, len, 2, "#FFFFFF");
    this.rect(x, ground - 3, len, 1, "#E0E6EE");
  }

  sign(x, ground, t) {
    this.rect(x + 6, ground - 12, 2, 12, "#8A5A3A");
    const bob = Math.round(Math.sin(t * 2) * 1);
    this.rect(x, ground - 20 + bob, 15, 8, "#C48C5C");
    this.rect(x + 3, ground - 17 + bob, 7, 2, "#FFF4DC");
    this.rect(x + 9, ground - 18 + bob, 2, 4, "#FFF4DC");
  }

  // ------------------------------------------------------------ 오락실: 네온 해 · 산 · 달리는 격자
  arcade(t) {
    const W = this.W, horizon = Math.round(H * 0.7);
    this.bands(0, horizon, ["#07071A", "#0D0B2A", "#160C38", "#220B45", "#33094F"]);
    const r = mulberry(11);
    for (let i = 0; i < W * 0.4; i++) this.rect(r() * W, r() * horizon * 0.7, 1, 1, r() > 0.8 ? "#7CF7FF" : "#B9A8FF");
    // 줄무늬 해
    const cx = W / 2, cy = horizon - 4, R = Math.min(34, W * 0.3);
    const sun = ["#FFE600", "#FFC300", "#FF9A1F", "#FF5C8A", "#FF2BD6"];
    for (let y = -R; y <= 0; y++) {
      const w = Math.round(Math.sqrt(R * R - y * y));
      const band = Math.floor(((y + R) / R) * sun.length);
      const gap = y > -R * 0.55 && ((y + Math.floor(t * 6)) % 6 === 0);
      if (!gap) this.rect(cx - w, cy + y, w * 2 + 1, 1, sun[Math.min(band, sun.length - 1)]);
    }
    // 산 실루엣
    for (let x = 0; x < W; x++) {
      const h = 10 + 9 * Math.abs(Math.sin(x * 0.07)) + 6 * Math.abs(Math.sin(x * 0.19 + 1));
      this.rect(x, horizon - h, 1, h, "#2A0A4A");
      this.rect(x, horizon - h, 1, 1, "#00E5FF");
    }
    // 격자 바닥 (앞으로 달려오는 가로줄 + 가운데로 모이는 세로줄)
    this.rect(0, horizon, W, H - horizon, "#0A0420");
    this.rect(0, horizon, W, 1, "#FF2BD6");
    const depth = H - horizon;
    for (let k = 0; k < 10; k++) {
      const p = ((k + (t * 1.2) % 1) / 10);
      const y = horizon + Math.round(depth * p * p);
      this.rect(0, y, W, 1, k % 2 ? "#FF2BD6" : "#B51FA8");
    }
    for (let k = -12; k <= 12; k++) {
      const x0 = cx + k * 4, x1 = cx + k * 28;
      for (let s = 0; s <= depth; s += 1) {
        const f = s / depth;
        this.rect(Math.round(x0 + (x1 - x0) * f), horizon + s, 1, 1, "#00C8E0");
      }
    }
  }
}
