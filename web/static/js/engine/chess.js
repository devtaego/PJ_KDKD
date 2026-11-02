// 체스 규칙 엔진 + 컴퓨터 (chess/chess_game.py 의 Position, best_move 를 그대로 옮김)
// move = [fromR, fromC, toR, toC, promo|null], row 0 = 8랭크
export const FILES = "abcdefgh";
export const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const SLIDE_DIRS = { R: ROOK_DIRS, B: BISHOP_DIRS, Q: ROOK_DIRS.concat(BISHOP_DIRS) };
const CASTLE_SQUARES = [[7, 4, "KQ"], [0, 4, "kq"], [7, 7, "K"], [7, 0, "Q"], [0, 7, "k"], [0, 0, "q"]];
const PAWN_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0], [50, 50, 50, 50, 50, 50, 50, 50], [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5], [0, 0, 0, 20, 20, 0, 0, 0], [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5], [0, 0, 0, 0, 0, 0, 0, 0]];
const KNIGHT_PST = [
  [-50, -40, -30, -30, -30, -30, -40, -50], [-40, -20, 0, 0, 0, 0, -20, -40], [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30], [-30, 0, 15, 20, 20, 15, 0, -30], [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40], [-50, -40, -30, -30, -30, -30, -40, -50]];

export const opponent = (c) => (c === "w" ? "b" : "w");
export const squareName = (r, c) => `${FILES[c]}${8 - r}`;
const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

export class Position {
  constructor(empty = false) {
    this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    this.turn = "w";
    this.castling = "KQkq";
    this.ep = null; // [r, c]
    this.halfmove = 0;
    if (!empty) {
      const back = "RNBQKBNR";
      for (let c = 0; c < 8; c++) {
        this.board[0][c] = "b" + back[c];
        this.board[1][c] = "bP";
        this.board[6][c] = "wP";
        this.board[7][c] = "w" + back[c];
      }
    }
  }

  copy() {
    const n = new Position(true);
    n.board = this.board.map((row) => row.slice());
    n.turn = this.turn;
    n.castling = this.castling;
    n.ep = this.ep;
    n.halfmove = this.halfmove;
    return n;
  }

  key() {
    return this.board.map((row) => row.map((p) => p || "..").join("")).join("") + this.turn + this.castling +
      (this.ep ? this.ep.join(",") : "-");
  }

  isAttacked(r, c, by) {
    const b = this.board;
    const pr = by === "w" ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      for (const pc of [c - 1, c + 1]) if (pc >= 0 && pc < 8 && b[pr][pc] === by + "P") return true;
    }
    for (const [dr, dc] of KNIGHT_STEPS) {
      const nr = r + dr, nc = c + dc;
      if (inside(nr, nc) && b[nr][nc] === by + "N") return true;
    }
    for (const [dr, dc] of KING_STEPS) {
      const nr = r + dr, nc = c + dc;
      if (inside(nr, nc) && b[nr][nc] === by + "K") return true;
    }
    for (const [dirs, kinds] of [[ROOK_DIRS, "RQ"], [BISHOP_DIRS, "BQ"]]) {
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inside(nr, nc)) {
          const p = b[nr][nc];
          if (p) {
            if (p[0] === by && kinds.includes(p[1])) return true;
            break;
          }
          nr += dr; nc += dc;
        }
      }
    }
    return false;
  }

  kingSquare(color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (this.board[r][c] === color + "K") return [r, c];
    return null;
  }

  inCheck(color) {
    const ks = this.kingSquare(color);
    return ks !== null && this.isAttacked(ks[0], ks[1], opponent(color));
  }

  pseudoMoves() {
    const moves = [];
    const b = this.board;
    const color = this.turn;
    const enemy = opponent(color);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (!p || p[0] !== color) continue;
        const kind = p[1];
        if (kind === "P") {
          const d = color === "w" ? -1 : 1;
          const start = color === "w" ? 6 : 1;
          const last = color === "w" ? 0 : 7;
          const nr = r + d;
          if (b[nr][c] === null) {
            addPawn(moves, r, c, nr, c, last);
            if (r === start && b[r + 2 * d][c] === null) moves.push([r, c, r + 2 * d, c, null]);
          }
          for (const nc of [c - 1, c + 1]) {
            if (nc < 0 || nc > 7) continue;
            const t = b[nr][nc];
            if (t && t[0] === enemy) addPawn(moves, r, c, nr, nc, last);
            else if (this.ep && this.ep[0] === nr && this.ep[1] === nc) moves.push([r, c, nr, nc, null]);
          }
        } else if (kind === "N" || kind === "K") {
          for (const [dr, dc] of kind === "N" ? KNIGHT_STEPS : KING_STEPS) {
            const nr = r + dr, nc = c + dc;
            if (inside(nr, nc)) {
              const t = b[nr][nc];
              if (t === null || t[0] === enemy) moves.push([r, c, nr, nc, null]);
            }
          }
          if (kind === "K") this.addCastling(moves, color);
        } else {
          for (const [dr, dc] of SLIDE_DIRS[kind]) {
            let nr = r + dr, nc = c + dc;
            while (inside(nr, nc)) {
              const t = b[nr][nc];
              if (t === null) moves.push([r, c, nr, nc, null]);
              else {
                if (t[0] === enemy) moves.push([r, c, nr, nc, null]);
                break;
              }
              nr += dr; nc += dc;
            }
          }
        }
      }
    }
    return moves;
  }

  addCastling(moves, color) {
    const row = color === "w" ? 7 : 0;
    const b = this.board;
    if (b[row][4] !== color + "K") return;
    const enemy = opponent(color);
    const [kr, qr] = color === "w" ? ["K", "Q"] : ["k", "q"];
    if (this.castling.includes(kr) && b[row][7] === color + "R" && b[row][5] === null && b[row][6] === null &&
        ![4, 5, 6].some((c) => this.isAttacked(row, c, enemy))) moves.push([row, 4, row, 6, null]);
    if (this.castling.includes(qr) && b[row][0] === color + "R" && b[row][1] === null && b[row][2] === null &&
        b[row][3] === null && ![4, 3, 2].some((c) => this.isAttacked(row, c, enemy))) moves.push([row, 4, row, 2, null]);
  }

  make(move) {
    const [fr, fc, tr, tc, promo] = move;
    const n = this.copy();
    const b = n.board;
    const p = b[fr][fc];
    let captured = b[tr][tc];
    if (p[1] === "P" && this.ep && this.ep[0] === tr && this.ep[1] === tc && captured === null) {
      b[fr][tc] = null; // 앙파상
      captured = "xP";
    }
    b[tr][tc] = promo ? p[0] + promo : p;
    b[fr][fc] = null;
    if (p[1] === "K" && Math.abs(tc - fc) === 2) {
      if (tc === 6) { b[tr][5] = b[tr][7]; b[tr][7] = null; } else { b[tr][3] = b[tr][0]; b[tr][0] = null; }
    }
    for (const [sr, sc, rights] of CASTLE_SQUARES) {
      if ((sr === fr && sc === fc) || (sr === tr && sc === tc)) n.castling = [...n.castling].filter((x) => !rights.includes(x)).join("");
    }
    n.ep = p[1] === "P" && Math.abs(tr - fr) === 2 && fc === tc ? [(fr + tr) / 2, fc] : null;
    n.halfmove = p[1] === "P" || captured ? 0 : this.halfmove + 1;
    n.turn = opponent(this.turn);
    return n;
  }

  legalMoves() {
    const color = this.turn;
    return this.pseudoMoves().filter((m) => !this.make(m).inCheck(color));
  }

  insufficientMaterial() {
    let minors = 0;
    for (const row of this.board) for (const p of row) {
      if (p && p[1] !== "K") {
        if ("PRQ".includes(p[1])) return false;
        minors++;
      }
    }
    return minors <= 1;
  }
}

function addPawn(moves, r, c, nr, nc, last) {
  if (nr === last) for (const promo of "QRBN") moves.push([r, c, nr, nc, promo]);
  else moves.push([r, c, nr, nc, null]);
}

const POINTS = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const START_COUNT = { Q: 1, R: 2, B: 2, N: 2, P: 8 }; // 큰 기물부터

/** 판만 보고 계산: taken[색] = 그 색이 잡은 기물 종류들, diff = 백 점수 - 흑 점수 (승급한 기물은 그 기물 점수로 셈) */
export function materialInfo(board) {
  const count = { w: {}, b: {} };
  let diff = 0;
  for (const row of board) for (const piece of row) {
    if (!piece) continue;
    count[piece[0]][piece[1]] = (count[piece[0]][piece[1]] || 0) + 1;
    diff += piece[0] === "w" ? POINTS[piece[1]] : -POINTS[piece[1]];
  }
  const missing = (color) => {
    let promoted = 0; // 시작보다 많은 기물은 폰이 승급한 것이라 그만큼 폰은 잡힌 게 아님
    for (const kind of "QRBN") promoted += Math.max(0, (count[color][kind] || 0) - START_COUNT[kind]);
    const out = [];
    for (const [kind, start] of Object.entries(START_COUNT)) {
      const left = (count[color][kind] || 0) + (kind === "P" ? promoted : 0);
      for (let i = left; i < start; i++) out.push(kind);
    }
    return out;
  };
  return { taken: { w: missing("b"), b: missing("w") }, diff };
}

export const sameMove = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && (a[4] || null) === (b[4] || null);

// ---------------------------------------------------------------- 컴퓨터
// 난이도 목표 (체스닷컴 레이팅 기준의 대략적인 수준, 실제 레이팅으로 측정한 값은 아님)
//   easy   약 300: 바로 앞만 보고 자주 엉뚱한 수를 둠, 한 수 메이트도 자주 놓침
//   normal 약 700: 상대 응수까지 보지만 가끔 말을 그냥 내줌
//   hard   약 1600: 정해진 시간 동안 깊이를 늘려 가며 찾고, 잡기가 끝날 때까지 계산함
const BISHOP_PST = [
  [-20, -10, -10, -10, -10, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10], [-10, 0, 10, 10, 10, 10, 0, -10], [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10], [-20, -10, -10, -10, -10, -10, -10, -20]];
const ROOK_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0], [5, 10, 10, 10, 10, 10, 10, 5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [0, 0, 0, 5, 5, 0, 0, 0]];
const QUEEN_PST = [
  [-20, -10, -10, -5, -5, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5], [0, 0, 5, 5, 5, 5, 0, -5], [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10], [-20, -10, -10, -5, -5, -10, -10, -20]];
const KING_MID_PST = [
  [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30], [-20, -30, -30, -40, -40, -30, -30, -20], [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20], [20, 30, 10, 0, 0, 10, 30, 20]];
const KING_END_PST = [
  [-50, -40, -30, -20, -20, -30, -40, -50], [-30, -20, -10, 0, 0, -10, -20, -30], [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30], [-30, -10, 30, 40, 40, 30, -10, -30], [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -30, 0, 0, 0, 0, -30, -30], [-50, -30, -30, -30, -30, -30, -30, -50]];
const PST = { P: PAWN_PST, N: KNIGHT_PST, B: BISHOP_PST, R: ROOK_PST, Q: QUEEN_PST };
const PHASE = { N: 1, B: 1, R: 2, Q: 4 };
const PASSED_BONUS = [0, 5, 10, 20, 35, 60, 100, 0]; // 얼마나 전진했는지 (칸 수)
const MATE = 100000;
const INF = 1000000;

/** 지금 둘 차례 쪽에서 본 점수: 기물값 · 자리 · 비숍 쌍 · 폰 구조 · 열린 줄의 룩 · 끝판 킹 */
function evaluate(pos) {
  let score = 0, phase = 0, wKingMid = 0, wKingEnd = 0, bKingMid = 0, bKingEnd = 0, wBishops = 0, bBishops = 0;
  const wPawns = [0, 0, 0, 0, 0, 0, 0, 0], bPawns = [0, 0, 0, 0, 0, 0, 0, 0];
  const wMost = [8, 8, 8, 8, 8, 8, 8, 8], bMost = [-1, -1, -1, -1, -1, -1, -1, -1]; // 줄마다 가장 앞선 폰 (통과한 폰 판단)
  const wFront = [-1, -1, -1, -1, -1, -1, -1, -1], bFront = [8, 8, 8, 8, 8, 8, 8, 8]; // 줄마다 가장 뒤처진 폰
  const rooks = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = pos.board[r][c];
    if (!p) continue;
    const white = p[0] === "w", kind = p[1], pr = white ? r : 7 - r;
    if (kind === "K") {
      if (white) { wKingMid = KING_MID_PST[pr][c]; wKingEnd = KING_END_PST[pr][c]; } else { bKingMid = KING_MID_PST[pr][c]; bKingEnd = KING_END_PST[pr][c]; }
      continue;
    }
    phase += PHASE[kind] || 0;
    const v = VALUES[kind] + PST[kind][pr][c];
    score += white ? v : -v;
    if (kind === "B") { if (white) wBishops++; else bBishops++; }
    else if (kind === "R") rooks.push([white, c]);
    else if (kind === "P") {
      if (white) { wPawns[c]++; wMost[c] = Math.min(wMost[c], r); wFront[c] = Math.max(wFront[c], r); }
      else { bPawns[c]++; bMost[c] = Math.max(bMost[c], r); bFront[c] = Math.min(bFront[c], r); }
    }
  }
  if (wBishops >= 2) score += 30;
  if (bBishops >= 2) score -= 30;
  for (let c = 0; c < 8; c++) {
    const lo = Math.max(0, c - 1), hi = Math.min(7, c + 1);
    if (wPawns[c]) {
      score -= (wPawns[c] - 1) * 12;
      if (!(c > 0 && wPawns[c - 1]) && !(c < 7 && wPawns[c + 1])) score -= 12;
      let passed = true;
      for (let f = lo; f <= hi; f++) if (bPawns[f] && bFront[f] < wMost[c]) passed = false;
      if (passed) score += PASSED_BONUS[7 - wMost[c]];
    }
    if (bPawns[c]) {
      score += (bPawns[c] - 1) * 12;
      if (!(c > 0 && bPawns[c - 1]) && !(c < 7 && bPawns[c + 1])) score += 12;
      let passed = true;
      for (let f = lo; f <= hi; f++) if (wPawns[f] && wFront[f] > bMost[c]) passed = false;
      if (passed) score -= PASSED_BONUS[bMost[c]];
    }
  }
  for (const [white, c] of rooks) {
    const own = white ? wPawns[c] : bPawns[c], opp = white ? bPawns[c] : wPawns[c];
    const bonus = !own ? (opp ? 8 : 16) : 0;
    score += white ? bonus : -bonus;
  }
  const mid = Math.min(phase, 24); // 말이 많을수록 중반, 적을수록 끝판 킹 자리
  score += Math.trunc(((wKingMid - bKingMid) * mid + (wKingEnd - bKingEnd) * (24 - mid)) / 24);
  return pos.turn === "w" ? score : -score;
}

const captureGain = (pos, m) => {
  const target = pos.board[m[2]][m[3]];
  return target ? VALUES[target[1]] * 10 - VALUES[pos.board[m[0]][m[1]][1]] + 10000 : 0;
};
function orderKey(pos, m, ctx, ply) {
  let k = captureGain(pos, m) + (m[4] === "Q" ? 9000 : 0);
  if (!k && ctx) {
    const killers = ctx.killers[ply];
    if (killers && ((killers[0] && sameMove(killers[0], m)) || (killers[1] && sameMove(killers[1], m)))) k = 8000;
    else k = Math.min(ctx.hist[(m[0] * 8 + m[1]) * 64 + m[2] * 8 + m[3]] || 0, 7000);
  }
  return k;
}

function tick(ctx) {
  ctx.nodes++;
  if (ctx.deadline && (ctx.nodes & 511) === 0 && Date.now() > ctx.deadline) throw ctx;
}

/** 조용한 자리까지 잡기만 계속 계산 (말을 잡히는 걸 못 보는 일을 막음) */
function quiesce(pos, alpha, beta, ctx, depth) {
  tick(ctx);
  const stand = evaluate(pos);
  if (stand >= beta || depth <= 0) return stand;
  if (stand > alpha) alpha = stand;
  const me = pos.turn;
  const caps = pos.pseudoMoves().filter((m) => pos.board[m[2]][m[3]] || m[4] === "Q");
  caps.sort((x, y) => captureGain(pos, y) - captureGain(pos, x));
  let best = stand;
  for (const m of caps) {
    const target = pos.board[m[2]][m[3]];
    if (target && stand + VALUES[target[1]] + 200 < alpha) continue;
    const next = pos.make(m);
    if (next.inCheck(me)) continue;
    const score = -quiesce(next, -beta, -alpha, ctx, depth - 1);
    if (score > best) best = score;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return best;
}

function search(pos, depth, alpha, beta, ply, ctx) {
  tick(ctx);
  if (pos.halfmove >= 100) return 0;
  const moves = pos.legalMoves();
  const inCheck = pos.inCheck(pos.turn);
  if (!moves.length) return inCheck ? -MATE + ply : 0;
  if (inCheck && ply < 16) depth++; // 체크를 당하면 한 수 더 봄
  if (depth <= 0) return ctx.quiesce ? quiesce(pos, alpha, beta, ctx, 6) : evaluate(pos);
  moves.sort((a, b) => orderKey(pos, b, ctx, ply) - orderKey(pos, a, ctx, ply));
  let best = -INF, index = 0;
  for (const m of moves) {
    const quiet = !pos.board[m[2]][m[3]] && !m[4];
    const next = pos.make(m);
    let score;
    if (ctx.quiesce && quiet && !inCheck && depth >= 3 && index >= 4) { // 뒤쪽 조용한 수는 얕게 본 뒤 좋아 보일 때만 다시
      score = -search(next, depth - 2, -alpha - 1, -alpha, ply + 1, ctx);
      if (score > alpha) score = -search(next, depth - 1, -beta, -alpha, ply + 1, ctx);
    } else score = -search(next, depth - 1, -beta, -alpha, ply + 1, ctx);
    index++;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (score >= beta) {
      if (quiet) {
        const killers = ctx.killers[ply] || (ctx.killers[ply] = [null, null]);
        if (!killers[0] || !sameMove(killers[0], m)) { killers[1] = killers[0]; killers[0] = m; }
        const h = (m[0] * 8 + m[1]) * 64 + m[2] * 8 + m[3];
        ctx.hist[h] = (ctx.hist[h] || 0) + depth * depth;
      }
      return score;
    }
  }
  return best;
}

const newCtx = (extra = {}) => ({ nodes: 0, killers: [], hist: {}, deadline: 0, quiesce: false, ...extra });

/** 모든 수의 점수를 정확히 매김 (쉬움 · 보통용 얕은 탐색) */
function scoreMoves(pos, moves, depth) {
  const ctx = newCtx();
  return moves.map((m) => [m, -search(pos.make(m), depth - 1, -INF, INF, 1, ctx)]);
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const pickNoisy = (scored, sigma) => {
  let best = scored[0][0], top = -Infinity;
  for (const [m, score] of scored) {
    const v = score + gauss() * sigma;
    if (v > top) { top = v; best = m; }
  }
  return best;
};

function hardMove(pos, moves, timeMs, seen) {
  const started = Date.now();
  const ctx = newCtx({ deadline: started + timeMs, quiesce: true });
  const repeats = new Set(seen);
  const early = seen.length <= 10; // 초반은 수가 매번 조금 달라지게
  let root = moves.map((m) => ({ m, jitter: early ? Math.random() * 12 : 0, next: pos.make(m) }));
  root.sort((a, b) => orderKey(pos, b.m, ctx, 0) - orderKey(pos, a.m, ctx, 0) || b.jitter - a.jitter);
  let best = root[0].m;
  try {
    for (let depth = 1; depth <= 30; depth++) {
      let alpha = -INF, bestNow = null;
      for (const item of root) {
        // 같은 자리가 또 나오는 수는 무승부로 봄 (앞서 있을 때 같은 수만 반복하지 않게)
        const repeated = repeats.has(item.next.key());
        const score = repeated ? 0 : -search(item.next, depth - 1, -INF, -(alpha - item.jitter), 1, ctx);
        const v = score + item.jitter;
        if (v > alpha) { alpha = v; bestNow = item; best = item.m; }
      }
      if (bestNow) root = [bestNow, ...root.filter((x) => x !== bestNow)];
      if (alpha > MATE - 100 || Date.now() - started > timeMs * 0.55) break; // 다음 깊이는 시간 안에 못 끝남
    }
  } catch (e) {
    if (e !== ctx) throw e; // 시간이 다 됨: 지금까지 찾은 가장 좋은 수를 씀
  }
  return best;
}

/** level: easy / normal / hard. timeMs: hard가 생각할 시간, seen: 지금까지 나온 자리(반복 피하기) */
export function bestMove(pos, level = "normal", { timeMs = 300, seen = [] } = {}) {
  const moves = pos.legalMoves();
  if (moves.length <= 1) return moves[0];
  if (level === "hard") return hardMove(pos, moves, timeMs, seen);
  const shallow = scoreMoves(pos, moves, 1);
  const mates = shallow.filter(([, score]) => score > MATE - 100);
  if (level === "easy") {
    if (mates.length && Math.random() < 0.5) return mates[0][0];
    if (Math.random() < 0.35) return moves[Math.floor(Math.random() * moves.length)];
    return pickNoisy(shallow, 130);
  }
  if (mates.length && Math.random() < 0.9) return mates[0][0];
  if (Math.random() < 0.15) return pickNoisy(shallow, 40); // 가끔 상대 응수를 못 보고 둠
  return pickNoisy(scoreMoves(pos, moves, 2), 35);
}

// ---------------------------------------------------------------- 기보 (SAN)
export function moveSan(pos, m) {
  const [fr, fc, tr, tc, promo] = m;
  const p = pos.board[fr][fc];
  const kind = p[1];
  let s;
  if (kind === "K" && Math.abs(tc - fc) === 2) s = tc === 6 ? "O-O" : "O-O-O";
  else {
    const capture = pos.board[tr][tc] !== null || (kind === "P" && pos.ep && pos.ep[0] === tr && pos.ep[1] === tc);
    if (kind === "P") s = (capture ? FILES[fc] + "x" : "") + squareName(tr, tc) + (promo ? "=" + promo : "");
    else {
      const others = pos.legalMoves().filter((o) => o[2] === tr && o[3] === tc && !(o[0] === fr && o[1] === fc) &&
        pos.board[o[0]][o[1]] === p);
      let dis = "";
      if (others.length) {
        if (others.every((o) => o[1] !== fc)) dis = FILES[fc];
        else if (others.every((o) => o[0] !== fr)) dis = String(8 - fr);
        else dis = squareName(fr, fc);
      }
      s = kind + dis + (capture ? "x" : "") + squareName(tr, tc);
    }
  }
  const n = pos.make(m);
  if (n.inCheck(n.turn)) s += n.legalMoves().length ? "+" : "#";
  return s;
}

/** 판이 끝났는지: null 또는 {winner: "w"|"b"|null, text} */
export function gameOver(history) {
  const pos = history[history.length - 1];
  const moves = pos.legalMoves();
  if (!moves.length) {
    if (pos.inCheck(pos.turn)) return { winner: opponent(pos.turn), text: "체크메이트!" };
    return { winner: null, text: "스테일메이트 - 무승부" };
  }
  if (pos.insufficientMaterial()) return { winner: null, text: "기물 부족 - 무승부" };
  if (pos.halfmove >= 100) return { winner: null, text: "50수 규칙 - 무승부" };
  const key = pos.key();
  if (history.filter((h) => h.key() === key).length >= 3) return { winner: null, text: "3회 동형 반복 - 무승부" };
  return null;
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pos.legalMoves()) n += perft(pos.make(m), depth - 1);
  return n;
}
