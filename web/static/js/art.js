// 그림: 동물 프로필, 스티커, 체스 기물, 왕관을 SVG 문자열로 (hub/avatars.py, hub/chat.py, chess_game.py 와 같은 모양)
export const ANIMALS = [
  ["cat", "고양이", "#FFB570", "#FFE7CC"], ["bear", "곰", "#B98157", "#F1DCC8"],
  ["rabbit", "토끼", "#FFFFFF", "#FFD6E6"], ["frog", "개구리", "#7ED67A", "#DDF7D2"],
  ["chick", "병아리", "#FFD84D", "#FFF4C2"], ["pig", "돼지", "#FFB3C1", "#FFE1E7"],
  ["panda", "판다", "#FFFFFF", "#DCEBFF"], ["fox", "여우", "#FF8A4C", "#FFE0CF"],
  ["penguin", "펭귄", "#4A4E57", "#E7ECF2"], ["tiger", "호랑이", "#FFA43A", "#FFF0D9"],
];
const ROBOT = ["robot", "로봇", "#C9D3E3", "#E6ECF5"];
const BY_ID = Object.fromEntries(ANIMALS.concat([ROBOT]).map((a) => [a[0], a]));
export const STICKERS = [["laugh", "웃음"], ["cry", "눈물"], ["angry", "화남"], ["love", "하트"],
  ["wow", "놀람"], ["cool", "쿨"], ["fire", "불꽃"], ["gg", "GG"]];

const f = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { esc };

// ---------------------------------------------------------------- 동물 프로필
function animalSvg(kind) {
  const [, , face, bg] = BY_ID[kind] || ANIMALS[0];
  const line = "#3B2F2A";
  const out = [`<circle r="0.5" fill="${bg}"/>`];
  const oval = (x, y, rx, ry, fill, outline) =>
    out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${outline ? ` stroke="${outline}" stroke-width="0.012"` : ""}/>`);
  const poly = (pts, fill) => out.push(`<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="${fill}"/>`);
  const pline = (pts, stroke, w) =>
    out.push(`<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  const hy = 0.06, hr = 0.3;
  if (kind === "cat" || kind === "fox") {
    for (const sx of [-1, 1]) {
      poly([[sx * 0.28, -0.08], [sx * 0.2, -0.36], [sx * 0.06, -0.18]], face);
      poly([[sx * 0.24, -0.11], [sx * 0.19, -0.28], [sx * 0.11, -0.17]], kind === "cat" ? "#FFD9E0" : "#FFFFFF");
    }
  } else if (kind === "bear" || kind === "panda") {
    const ear = kind === "panda" ? "#2A2A2E" : face;
    for (const sx of [-1, 1]) {
      oval(sx * 0.22, -0.17, 0.1, 0.1, ear);
      if (kind === "bear") oval(sx * 0.22, -0.17, 0.05, 0.05, "#E8BFA0");
    }
  } else if (kind === "rabbit") {
    for (const sx of [-1, 1]) {
      oval(sx * 0.11, -0.3, 0.07, 0.19, face, "#E9D9E0");
      oval(sx * 0.11, -0.28, 0.035, 0.13, "#FFC2D6");
    }
  } else if (kind === "pig") {
    for (const sx of [-1, 1]) poly([[sx * 0.26, -0.1], [sx * 0.24, -0.3], [sx * 0.1, -0.2]], "#F59AAD");
  } else if (kind === "chick") {
    poly([[-0.04, -0.22], [0, -0.36], [0.03, -0.22]], face);
    poly([[0.02, -0.22], [0.1, -0.33], [0.08, -0.2]], face);
  } else if (kind === "robot") {
    pline([[0, -0.24], [0, -0.36]], "#7D8BA3", 0.03);
    oval(0, -0.37, 0.045, 0.045, "#FF5C7A");
  }
  if (kind === "robot") {
    out.push(`<rect x="-0.28" y="-0.24" width="0.56" height="0.54" rx="0.08" fill="${face}" stroke="#7D8BA3" stroke-width="0.02"/>`);
    for (const sx of [-1, 1]) out.push(`<rect x="${f(sx * 0.12 - 0.06)}" y="-0.06" width="0.12" height="0.1" rx="0.02" fill="#3DDC97"/>`);
    pline([[-0.1, 0.17], [0.1, 0.17]], "#7D8BA3", 0.03);
    return out.join("");
  }
  oval(0, hy, hr, hr * 0.92, face, face === "#FFFFFF" ? "#E5E0DA" : null);
  if (kind === "fox") poly([[-0.27, 0.08], [0, 0.32], [0.27, 0.08], [0.12, 0.22], [-0.12, 0.22]], "#FFFFFF");
  if (kind === "panda") for (const sx of [-1, 1]) oval(sx * 0.11, 0.04, 0.075, 0.09, "#2A2A2E");
  const eyeY = 0.04;
  if (kind === "frog") {
    for (const sx of [-1, 1]) {
      oval(sx * 0.15, -0.2, 0.1, 0.1, face);
      oval(sx * 0.15, -0.2, 0.065, 0.065, "#FFFFFF");
      oval(sx * 0.15, -0.19, 0.035, 0.035, "#1E1B18");
    }
  } else {
    for (const sx of [-1, 1]) {
      oval(sx * 0.11, eyeY, 0.034, 0.042, kind === "panda" ? "#FFFFFF" : "#1E1B18");
      oval(sx * 0.11 + 0.012, eyeY - 0.014, 0.012, 0.012, kind === "panda" ? "#1E1B18" : "#FFFFFF");
    }
  }
  for (const sx of [-1, 1]) oval(sx * 0.2, 0.13, 0.045, 0.03, "#FF9DB0");
  if (kind === "pig") {
    oval(0, 0.15, 0.09, 0.065, "#F59AAD");
    oval(-0.03, 0.15, 0.015, 0.02, "#B8566C");
    oval(0.03, 0.15, 0.015, 0.02, "#B8566C");
  } else if (kind === "chick") {
    poly([[-0.06, 0.12], [0.06, 0.12], [0, 0.2]], "#FF9F43");
  } else if (kind === "bear") {
    oval(0, 0.15, 0.1, 0.075, "#E8BFA0");
    oval(0, 0.12, 0.035, 0.025, line);
  } else {
    oval(0, 0.12, 0.025, 0.018, kind === "rabbit" ? "#FF8FB0" : line);
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push([sx * t * 0.07, 0.15 + Math.sin(t * Math.PI) * 0.035]);
      }
      pline(pts, line, 0.022);
    }
  }
  return out.join("");
}

const avatarCache = new Map();
const photos = new Map(); // 공개 번호(pid) -> 사진 data URL (서버가 방에 들어갈 때 한 번만 보내 줌)
export const setPhoto = (pid, url) => {
  if (typeof url === "string" && url.startsWith("data:image/")) photos.set(String(pid), url);
};

/** 프로필 그림 HTML. spec = 동물 id, 사진 data URL, 또는 "photo:<pid>:<해시>" (온라인에서 받은 사진) */
export function avatarHtml(spec, size = 44, extraClass = "") {
  const cls = `avatar ${extraClass}`.trim();
  if (typeof spec === "string" && spec.startsWith("photo:")) spec = photos.get(spec.split(":")[1]) || "cat";
  if (typeof spec === "string" && spec.startsWith("data:image/")) {
    return `<span class="${cls}" style="width:${size}px;height:${size}px"><img src="${esc(spec)}" alt=""></span>`;
  }
  const kind = BY_ID[spec] ? spec : "cat";
  if (!avatarCache.has(kind)) avatarCache.set(kind, `<svg viewBox="-0.5 -0.5 1 1" aria-hidden="true">${animalSvg(kind)}</svg>`);
  return `<span class="${cls}" style="width:${size}px;height:${size}px">${avatarCache.get(kind)}</span>`;
}
export const animalName = (id) => (BY_ID[id] || ANIMALS[0])[1];

/** 사진을 가운데 정사각형으로 잘라 96px JPEG data URL로 */
export function photoToSpec(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const cv = document.createElement("canvas");
      cv.width = cv.height = 96;
      cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------- 스티커
function stickerBody(sid) {
  const ink = "#3A2A1A", w = 0.045;
  const out = [];
  const lineP = (pts, stroke, width) =>
    out.push(`<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (sid === "love") {
    const pts = [];
    for (let k = 0; k < 80; k++) {
      const t = (k / 80) * 2 * Math.PI;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push(`${f(hx / 34)},${f(hy / 34 + 0.02)}`);
    }
    out.push(`<polygon points="${pts.join(" ")}" fill="#FF4D6D" stroke="#C9184A" stroke-width="${w}" stroke-linejoin="round"/>`);
    out.push(`<ellipse cx="-0.18" cy="-0.16" rx="0.07" ry="0.05" fill="#FFB3C1"/>`);
  } else if (sid === "fire") {
    out.push(`<path d="${smoothPath([[0, -0.5], [0.16, -0.22], [0.28, -0.32], [0.4, 0.05], [0.36, 0.32], [0, 0.48], [-0.36, 0.32], [-0.4, 0.02], [-0.24, -0.18], [-0.14, -0.08]], 1)}" fill="#FF7A1A" stroke="#D9480F" stroke-width="${w}"/>`);
    out.push(`<path d="${smoothPath([[0, -0.12], [0.18, 0.12], [0.16, 0.3], [0, 0.4], [-0.16, 0.3], [-0.16, 0.12]], 1)}" fill="#FFD43B"/>`);
  } else if (sid === "gg") {
    out.push(`<rect x="-0.5" y="-0.31" width="1" height="0.62" rx="0.2" fill="#7C5CFF" stroke="#4C2EDB" stroke-width="${w}"/>`);
    out.push(`<text x="0" y="0.02" text-anchor="middle" dominant-baseline="middle" font-size="0.42" font-weight="bold" fill="white" font-family="Arial, sans-serif">GG</text>`);
  } else {
    const face = { angry: "#FF8A5B", cry: "#FFD866" }[sid] || "#FFD43B";
    out.push(`<circle r="${0.5 - w / 2}" fill="${face}" stroke="${sid === "angry" ? "#E0552B" : "#E0A800"}" stroke-width="${w}"/>`);
    const ey = -0.08;
    if (sid === "laugh") {
      for (const sx of [-1, 1]) {
        lineP([[sx * 0.24, ey + 0.03], [sx * 0.16, ey - 0.05], [sx * 0.08, ey + 0.03]], ink, w * 1.4);
        out.push(`<ellipse cx="${sx * 0.34}" cy="${ey + 0.08}" rx="0.05" ry="0.07" fill="#74C0FC"/>`);
      }
      out.push(`<path d="M -0.24 0.1 A 0.24 0.22 0 0 0 0.24 0.1 Z" fill="#8B2E2E" stroke="${ink}" stroke-width="${w}"/>`);
    } else if (sid === "cry") {
      for (const sx of [-1, 1]) {
        lineP([[sx * 0.08, ey - 0.02], [sx * 0.24, ey + 0.04]], ink, w * 1.4);
        out.push(`<path d="M ${sx * 0.16} ${ey + 0.06} Q ${sx * 0.24} ${ey + 0.3} ${sx * 0.16} ${ey + 0.3} Q ${sx * 0.08} ${ey + 0.3} ${sx * 0.16} ${ey + 0.06} Z" fill="#4DABF7"/>`);
      }
      out.push(`<path d="M -0.16 0.28 A 0.16 0.1 0 0 1 0.16 0.28" fill="none" stroke="${ink}" stroke-width="${w * 1.3}" stroke-linecap="round"/>`);
    } else if (sid === "angry") {
      for (const sx of [-1, 1]) {
        lineP([[sx * 0.28, ey - 0.12], [sx * 0.08, ey - 0.02]], ink, w * 1.6);
        out.push(`<ellipse cx="${sx * 0.16}" cy="${ey + 0.06}" rx="0.045" ry="0.05" fill="${ink}"/>`);
      }
      out.push(`<path d="M -0.16 0.3 A 0.16 0.1 0 0 1 0.16 0.3" fill="none" stroke="${ink}" stroke-width="${w * 1.4}" stroke-linecap="round"/>`);
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 2 + Math.PI / 4;
        lineP([[0.3 + Math.cos(ang) * 0.03, -0.32 + Math.sin(ang) * 0.03], [0.3 + Math.cos(ang) * 0.1, -0.32 + Math.sin(ang) * 0.1]], "#E03131", w * 1.3);
      }
    } else if (sid === "wow") {
      for (const sx of [-1, 1]) {
        out.push(`<ellipse cx="${sx * 0.16}" cy="${ey}" rx="0.07" ry="0.09" fill="white" stroke="${ink}" stroke-width="${w}"/>`);
        out.push(`<ellipse cx="${sx * 0.16}" cy="${ey + 0.01}" rx="0.035" ry="0.045" fill="${ink}"/>`);
      }
      out.push(`<ellipse cx="0" cy="0.22" rx="0.08" ry="0.1" fill="#8B2E2E" stroke="${ink}" stroke-width="${w}"/>`);
    } else if (sid === "cool") {
      out.push(`<polygon points="-0.38,${ey - 0.08} 0.38,${ey - 0.08} 0.34,${ey + 0.08} 0.06,${ey + 0.08} 0,${ey} -0.06,${ey + 0.08} -0.34,${ey + 0.08}" fill="#1E1E24"/>`);
      lineP([[-0.3, ey - 0.04], [-0.2, ey - 0.04]], "#6C6C7A", w);
      out.push(`<path d="M -0.14 0.22 Q 0.02 0.34 0.2 0.18" fill="none" stroke="${ink}" stroke-width="${w * 1.4}" stroke-linecap="round"/>`);
    }
  }
  return out.join("");
}

const stickerCache = new Map();
export function stickerSvg(sid, size = 40) {
  if (!stickerCache.has(sid)) stickerCache.set(sid, `<svg viewBox="-0.55 -0.55 1.1 1.1" aria-hidden="true">${stickerBody(sid)}</svg>`);
  return `<span class="sticker" style="width:${size}px;height:${size}px">${stickerCache.get(sid)}</span>`;
}

// ---------------------------------------------------------------- 체스 기물
const BASE_HIGH = ["poly", [[27, 76], [73, 76], [76, 85], [24, 85]], false];
const BASE_LOW = ["poly", [[20, 84], [80, 84], [82, 93], [18, 93]], false];
const PIECE_SHAPES = {
  P: [
    ["poly", [[44, 42], [56, 42], [57, 54], [62, 66], [68, 76], [68, 76], [68, 79], [68, 79], [32, 79], [32, 79], [32, 76], [32, 76], [38, 66], [43, 54]], true],
    ["poly", [[29, 76], [71, 76], [74, 84], [26, 84]], false],
    ["poly", [[23, 83], [77, 83], [79, 92], [21, 92]], false],
    ["oval", 34, 38, 66, 47], ["oval", 38, 14, 62, 38],
  ],
  R: [
    ["poly", [[35, 36], [65, 36], [67, 68], [33, 68]], false],
    ["poly", [[29, 66], [71, 66], [73, 77], [27, 77]], false],
    BASE_HIGH, BASE_LOW,
    ["poly", [[26, 9], [36, 9], [36, 17], [45, 17], [45, 9], [55, 9], [55, 17], [64, 17], [64, 9], [74, 9], [74, 27], [67, 36], [33, 36], [26, 27]], false],
    ["line", [[31, 27], [69, 27]]],
  ],
  B: [
    ["poly", [[43, 57], [57, 57], [59, 66], [66, 75], [66, 75], [66, 78], [66, 78], [34, 78], [34, 78], [34, 75], [34, 75], [41, 66]], true],
    BASE_HIGH, BASE_LOW, ["oval", 34, 52, 66, 60],
    ["poly", [[50, 14], [50, 14], [61, 25], [66, 37], [63, 48], [57, 54], [57, 54], [43, 54], [43, 54], [37, 48], [34, 37], [39, 25]], true],
    ["oval", 45, 5, 55, 15], ["line", [[55, 27], [46, 40]]],
  ],
  N: [
    ["poly", [[71, 79], [71, 79], [74, 60], [72, 42], [65, 27], [56, 18], [52, 6], [52, 6], [46, 15], [37, 19], [27, 30], [18, 44], [16, 52], [16, 52], [20, 56], [27, 57], [35, 53], [42, 48], [46, 51], [39, 62], [33, 72], [31, 79], [31, 79]], true],
    BASE_HIGH, BASE_LOW, ["oval", 37, 27, 44, 33], ["oval", 20, 47, 24, 51], ["line", [[61, 24], [68, 40], [70, 58]]],
  ],
  Q: [
    ["poly", [[33, 68], [33, 68], [28, 48], [22, 28], [22, 28], [36, 46], [39, 24], [39, 24], [48, 44], [50, 20], [50, 20], [52, 44], [61, 24], [61, 24], [64, 46], [78, 28], [78, 28], [72, 48], [67, 68], [67, 68]], true],
    ["oval", 18, 24, 26, 32], ["oval", 35, 20, 43, 28], ["oval", 46, 15, 54, 23], ["oval", 57, 20, 65, 28], ["oval", 74, 24, 82, 32],
    ["poly", [[31, 66], [69, 66], [72, 77], [28, 77]], false], BASE_HIGH, BASE_LOW, ["line", [[36, 58], [64, 58]]],
  ],
  K: [
    ["poly", [[47, 3], [53, 3], [53, 9], [59, 9], [59, 15], [53, 15], [53, 24], [47, 24], [47, 15], [41, 15], [41, 9], [47, 9]], false],
    ["oval", 41, 21, 59, 35],
    ["poly", [[31, 68], [31, 68], [22, 50], [25, 38], [37, 34], [50, 44], [50, 44], [63, 34], [75, 38], [78, 50], [69, 68], [69, 68]], true],
    ["poly", [[30, 66], [70, 66], [73, 77], [27, 77]], false], BASE_HIGH, BASE_LOW, ["line", [[50, 46], [50, 62]]],
  ],
};
const PIECE_COLORS = { w: ["#FFFFFF", "#D6CFBF", "#222222", "#222222"], b: ["#5C5C5C", "#1B1B1B", "#0C0C0C", "#E4E4E4"] };

/** tk의 smooth 다각형과 같은 2차 곡선: 같은 점을 두 번 쓰면 뾰족한 모서리 */
function smoothPath(pts, scale = 1) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2 * scale, (a[1] + b[1]) / 2 * scale];
  const start = mid(pts[n - 1], pts[0]);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], m = mid(p, pts[(i + 1) % n]);
    d += ` Q${f(p[0] * scale)} ${f(p[1] * scale)} ${f(m[0])} ${f(m[1])}`;
  }
  return d + "Z";
}

const pieceCache = new Map();
export function pieceSvg(piece) {
  if (pieceCache.has(piece)) return pieceCache.get(piece);
  const color = piece[0], kind = piece[1];
  const [top, bottom, outline, deco] = PIECE_COLORS[color];
  const gid = `pg${color}`;
  const parts = [];
  for (const sh of PIECE_SHAPES[kind]) {
    const common = `fill="url(#${gid})" stroke="${outline}" stroke-width="2.6" stroke-linejoin="round"`;
    if (sh[0] === "oval") {
      const [, x0, y0, x1, y1] = sh;
      parts.push(`<ellipse cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" rx="${(x1 - x0) / 2}" ry="${(y1 - y0) / 2}" ${common}/>`);
    } else if (sh[0] === "line") {
      parts.push(`<polyline points="${sh[1].map((p) => p.join(",")).join(" ")}" fill="none" stroke="${deco}" stroke-width="2.4" stroke-linecap="round"/>`);
    } else if (sh[2]) {
      parts.push(`<path d="${smoothPath(sh[1])}" ${common}/>`);
    } else {
      parts.push(`<polygon points="${sh[1].map((p) => p.join(",")).join(" ")}" ${common}/>`);
    }
  }
  const svg = `<svg viewBox="0 0 100 100" class="piece"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>${parts.join("")}</svg>`;
  pieceCache.set(piece, svg);
  return svg;
}

export const CROWN_SVG = `<svg viewBox="-50 -64 100 70" class="crown" aria-hidden="true"><polygon points="-50,0 -50,-34 -25,-15 0,-62 25,-15 50,-34 50,0" fill="#FFC94D" stroke="#C98A12" stroke-width="4" stroke-linejoin="round"/><circle cx="-50" cy="-34" r="7" fill="#FF5C8A"/><circle cx="0" cy="-62" r="7" fill="#FF5C8A"/><circle cx="50" cy="-34" r="7" fill="#FF5C8A"/></svg>`;

export const GAME_ICONS = {
  chess: pieceSvg("wN"),
  omok: `<svg viewBox="0 0 100 100"><rect x="6" y="6" width="88" height="88" rx="14" fill="#E3B36E"/><g stroke="#5B3A1A" stroke-width="2.5">${[22, 40, 58, 76].map((v) => `<line x1="${v}" y1="14" x2="${v}" y2="86"/><line x1="14" y1="${v}" x2="86" y2="${v}"/>`).join("")}</g><circle cx="40" cy="40" r="11" fill="#1E1B18"/><circle cx="58" cy="58" r="11" fill="#1E1B18"/><circle cx="58" cy="40" r="11" fill="#FAF7F0" stroke="#BDB3A3" stroke-width="2"/><circle cx="40" cy="58" r="11" fill="#FAF7F0" stroke="#BDB3A3" stroke-width="2"/></svg>`,
  yacht: `<svg viewBox="0 0 100 100"><g transform="rotate(-12 40 52)"><rect x="12" y="30" width="46" height="46" rx="10" fill="#FFFCF5" stroke="#C9BFA8" stroke-width="3"/><circle cx="25" cy="43" r="5" fill="#2E2923"/><circle cx="35" cy="53" r="5" fill="#2E2923"/><circle cx="45" cy="63" r="5" fill="#2E2923"/></g><g transform="rotate(14 66 46)"><rect x="46" y="20" width="42" height="42" rx="9" fill="#FF5C8A"/><circle cx="57" cy="31" r="4.6" fill="#fff"/><circle cx="77" cy="31" r="4.6" fill="#fff"/><circle cx="57" cy="51" r="4.6" fill="#fff"/><circle cx="77" cy="51" r="4.6" fill="#fff"/></g></svg>`,
  yut: `<svg viewBox="0 0 100 100"><rect x="8" y="58" width="84" height="30" rx="14" fill="#7C5CFF" opacity="0.25"/>${[0, 1, 2, 3].map((k) => `<g transform="rotate(${-22 + k * 15} 50 60) translate(${18 + k * 17} 18)"><rect width="13" height="60" rx="6.5" fill="${k === 3 ? "#B8763E" : "#F3D9A4"}" stroke="#7A4A22" stroke-width="2.5"/>${k === 3 ? "" : `<path d="M3 16l7 6M10 16l-7 6M3 30l7 6M10 30l-7 6M3 44l7 6M10 44l-7 6" stroke="#7A4A22" stroke-width="2"/>`}</g>`).join("")}</svg>`,
};

const PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]] };
export function dieSvg(v) {
  const pips = (PIPS[v] || []).map(([r, c]) => `<circle cx="${25 + c * 25}" cy="${25 + r * 25}" r="${v === 1 ? 11 : 8.5}" fill="${v === 1 ? "#E03131" : "#2E2923"}"/>`).join("");
  return `<svg viewBox="0 0 100 100"><rect x="3" y="3" width="94" height="94" rx="20" fill="#FFFCF5" stroke="#D9CFB8" stroke-width="3"/>${pips}</svg>`;
}
