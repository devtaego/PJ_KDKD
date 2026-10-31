// 오목 규칙 엔진 + 컴퓨터 (omok/omok_game.py 의 Board, ai_move 를 그대로 옮김)
export const N = 15;
export const EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
export const STARS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
export const RULES = { "33": ["쌍삼 금지", "정확히 5목만 승리 · 3-3 금지"], free: ["자유룰", "5목 이상이면 승리"] };
export const other = (c) => (c === BLACK ? WHITE : BLACK);
export const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

export class Board {
  constructor(rule = "33") {
    this.g = Array.from({ length: N }, () => Array(N).fill(EMPTY));
    this.moves = [];
    this.rule = rule;
  }

  get turn() { return this.moves.length % 2 === 0 ? BLACK : WHITE; }

  /** (r, c)에 color를 놓았다고 칠 때 연속 길이 n, 앞 f, 뒤 b. extra 칸("r,c")도 같은 색으로 침 */
  run(r, c, dr, dc, color, extra = null) {
    const same = (rr, cc) => (extra && extra === rr * N + cc) || (inside(rr, cc) && this.g[rr][cc] === color);
    let f = 0, b = 0;
    while (same(r + (f + 1) * dr, c + (f + 1) * dc)) f++;
    while (same(r - (b + 1) * dr, c - (b + 1) * dc)) b++;
    return [1 + f + b, f, b];
  }

  fiveAt(r, c, color) {
    const exact = this.rule === "33";
    return DIRS.some(([dr, dc]) => {
      const [n] = this.run(r, c, dr, dc, color);
      return n === 5 || (n > 5 && !exact);
    });
  }

  winLine(r, c, color) {
    const exact = this.rule === "33";
    for (const [dr, dc] of DIRS) {
      const [n, f, b] = this.run(r, c, dr, dc, color);
      if (n === 5 || (n > 5 && !exact)) {
        const out = [];
        for (let k = -b; k <= f; k++) out.push([r + k * dr, c + k * dc]);
        return out;
      }
    }
    return [];
  }

  openThreeDirs(r, c, color) {
    let count = 0;
    for (const [dr, dc] of DIRS) {
      for (let k = -4; k <= 4; k++) {
        const qr = r + k * dr, qc = c + k * dc;
        if (k === 0 || !inside(qr, qc) || this.g[qr][qc] !== EMPTY) continue;
        const [n, f, b] = this.run(r, c, dr, dc, color, qr * N + qc);
        if (n !== 4 || !(-b <= k && k <= f)) continue;
        const ends = [[r + (f + 1) * dr, c + (f + 1) * dc], [r - (b + 1) * dr, c - (b + 1) * dc]];
        if (ends.every(([er, ec]) => inside(er, ec) && this.g[er][ec] === EMPTY)) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  forbidden(r, c, color) {
    if (this.rule !== "33" || this.g[r][c] !== EMPTY) return false;
    if (this.fiveAt(r, c, color)) return false;
    return this.openThreeDirs(r, c, color) >= 2;
  }

  legal(r, c) { return inside(r, c) && this.g[r][c] === EMPTY && !this.forbidden(r, c, this.turn); }

  place(r, c) {
    const color = this.turn;
    this.g[r][c] = color;
    this.moves.push([r, c]);
    return color;
  }

  undo() {
    const [r, c] = this.moves.pop();
    this.g[r][c] = EMPTY;
  }

  full() { return this.moves.length === N * N; }
}

const WINDOW_W = [0, 1, 14, 160, 2600, 100000];

function windowScore(board, r, c, color) {
  const opp = other(color);
  let total = 0;
  for (const [dr, dc] of DIRS) {
    for (let start = -4; start <= 0; start++) {
      let cnt = 0;
      for (let k = start; k < start + 5; k++) {
        const rr = r + k * dr, cc = c + k * dc;
        if (!inside(rr, cc) || board.g[rr][cc] === opp) { cnt = -1; break; }
        if (k === 0 || board.g[rr][cc] === color) cnt++;
      }
      if (cnt > 0) total += WINDOW_W[Math.min(cnt, 5)];
    }
  }
  return total;
}

/** level: easy(자주 놓침) / normal / hard */
export function aiMove(board, level = "normal") {
  const color = board.turn;
  const opp = other(color);
  const seen = new Set();
  const cands = [];
  for (const [r, c] of board.moves) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board.g[rr][cc] === EMPTY && !seen.has(rr * N + cc)) {
        seen.add(rr * N + cc);
        cands.push([rr, cc]);
      }
    }
  }
  if (!cands.length) return [7, 7];
  let legal = cands.filter(([r, c]) => !board.forbidden(r, c, color));
  if (!legal.length) {
    legal = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board.legal(r, c)) legal.push([r, c]);
  }
  for (const p of legal) if (board.fiveAt(p[0], p[1], color)) return p;
  for (const p of legal) if (board.fiveAt(p[0], p[1], opp) && (level !== "easy" || Math.random() < 0.6)) return p;
  const noise = { easy: 900, normal: 60 }[level] ?? 1;
  const scored = legal.map((p) => [p, windowScore(board, p[0], p[1], color) * 1.12 + windowScore(board, p[0], p[1], opp) +
    Math.random() * noise]);
  scored.sort((a, b) => b[1] - a[1]);
  if (level === "easy" && Math.random() < 0.35) return scored[Math.floor(Math.random() * Math.min(6, scored.length))][0];
  return scored[0][0];
}
