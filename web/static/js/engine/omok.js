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

const LINE_W = [0, 1, 10, 100, 1400]; // 5칸 안에 내 돌이 n개일 때 점수
const WIN_SCORE = 10000000;

/** 판 전체 점수 (color 쪽에서 봄): 상대 돌이 없는 5칸마다 돌 수에 따라 더함 */
function evalBoard(board, color) {
  const g = board.g, opp = other(color);
  let score = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of DIRS) {
      const er = r + 4 * dr, ec = c + 4 * dc;
      if (!inside(er, ec)) continue;
      let mine = 0, theirs = 0;
      for (let k = 0; k < 5; k++) {
        const v = g[r + k * dr][c + k * dc];
        if (v === color) mine++; else if (v === opp) theirs++;
      }
      if (mine && !theirs) score += LINE_W[mine];
      else if (theirs && !mine) score -= LINE_W[theirs] * 1.15; // 상대 차례일 때 재는 값이라 상대 쪽을 조금 더 무겁게
    }
  }
  return score;
}

function neighbors(board, radius = 2) {
  const seen = new Set(), out = [];
  for (const [r, c] of board.moves) {
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board.g[rr][cc] === EMPTY && !seen.has(rr * N + cc)) {
        seen.add(rr * N + cc);
        out.push([rr, cc]);
      }
    }
  }
  return out;
}

/** 둘 만한 자리 상위 limit개 (공격 + 수비 점수 순, 금수 제외) */
function topMoves(board, color, limit) {
  const opp = other(color);
  const scored = neighbors(board).map((p) => [p, windowScore(board, p[0], p[1], color) * 1.1 + windowScore(board, p[0], p[1], opp)]);
  scored.sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [p] of scored) {
    if (board.forbidden(p[0], p[1], color)) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

function omokSearch(board, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) throw ctx;
  const color = board.turn, opp = other(color);
  const cands = topMoves(board, color, depth >= 4 ? 10 : 7);
  if (!cands.length) return 0;
  for (const p of cands) if (board.fiveAt(p[0], p[1], color)) return WIN_SCORE - ply;
  const mustBlock = cands.filter((p) => board.fiveAt(p[0], p[1], opp)); // 막아야만 하는 자리
  if (depth <= 0) return evalBoard(board, color);
  let best = -Infinity;
  for (const p of (mustBlock.length ? mustBlock : cands)) {
    board.place(p[0], p[1]);
    let score;
    try { score = -omokSearch(board, depth - 1, -beta, -alpha, ply + 1, ctx); } finally { board.undo(); }
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/** 어려움: 시간 안에서 몇 수 앞까지 번갈아 둬 보고 고름 (4 · 3을 만드는 수와 막는 수를 함께 봄) */
function hardOmok(board, legal, timeMs) {
  const color = board.turn;
  const ctx = { nodes: 0, deadline: Date.now() + timeMs };
  const started = Date.now();
  const allowed = new Set(legal.map(([r, c]) => r * N + c));
  let root = topMoves(board, color, 14).filter(([r, c]) => allowed.has(r * N + c));
  if (!root.length) return legal[0];
  let best = root[0];
  try {
    for (let depth = 2; depth <= 12; depth += 2) {
      let alpha = -Infinity, bestNow = null;
      for (const p of root) {
        board.place(p[0], p[1]);
        let score;
        try { score = -omokSearch(board, depth - 1, -Infinity, -alpha, 1, ctx); } finally { board.undo(); }
        if (score > alpha) { alpha = score; bestNow = p; best = p; }
      }
      if (bestNow) root = [bestNow, ...root.filter((x) => x !== bestNow)];
      if (alpha > WIN_SCORE - 100 || Date.now() - started > timeMs * 0.5) break;
    }
  } catch (e) {
    if (e !== ctx) throw e;
  }
  return best;
}

/** level: easy(자주 놓침) / normal(눈앞의 수는 막지만 멀리 못 봄) / hard(몇 수 앞까지 계산). timeMs: hard가 생각할 시간 */
export function aiMove(board, level = "normal", { timeMs = 300 } = {}) {
  const color = board.turn;
  const opp = other(color);
  const cands = neighbors(board);
  if (!cands.length) return [7, 7];
  let legal = cands.filter(([r, c]) => !board.forbidden(r, c, color));
  if (!legal.length) {
    legal = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board.legal(r, c)) legal.push([r, c]);
  }
  for (const p of legal) if (board.fiveAt(p[0], p[1], color) && (level !== "easy" || Math.random() < 0.7)) return p;
  for (const p of legal) if (board.fiveAt(p[0], p[1], opp) && (level !== "easy" || Math.random() < 0.5)) return p;
  if (level === "hard") return hardOmok(board, legal, timeMs);
  const noise = level === "easy" ? 900 : 140;
  const scored = legal.map((p) => [p, windowScore(board, p[0], p[1], color) * 1.12 + windowScore(board, p[0], p[1], opp) +
    Math.random() * noise]);
  scored.sort((a, b) => b[1] - a[1]);
  if (level === "easy" && Math.random() < 0.4) return scored[Math.floor(Math.random() * Math.min(8, scored.length))][0];
  if (level !== "easy" && Math.random() < 0.15) return scored[Math.floor(Math.random() * Math.min(3, scored.length))][0];
  return scored[0][0];
}
