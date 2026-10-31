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

export const sameMove = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && (a[4] || null) === (b[4] || null);

// ---------------------------------------------------------------- 컴퓨터
function evaluate(pos) {
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = pos.board[r][c];
    if (!p) continue;
    const kind = p[1];
    const pr = p[0] === "w" ? r : 7 - r;
    let v = VALUES[kind];
    if (kind === "P") v += PAWN_PST[pr][c];
    else if (kind === "N") v += KNIGHT_PST[pr][c];
    else if (kind === "B" || kind === "Q") v += Math.trunc(8 - Math.abs(3.5 - r) - Math.abs(3.5 - c)) * 2;
    score += p[0] === "w" ? v : -v;
  }
  return pos.turn === "w" ? score : -score;
}

function orderKey(pos, m) {
  const target = pos.board[m[2]][m[3]];
  const gain = target ? VALUES[target[1]] * 10 - VALUES[pos.board[m[0]][m[1]][1]] : 0;
  return gain + (m[4] === "Q" ? 900 : 0);
}

function negamax(pos, depth, alpha, beta, ply) {
  if (depth === 0) return evaluate(pos);
  const moves = pos.legalMoves();
  if (!moves.length) return pos.inCheck(pos.turn) ? -100000 + ply : 0;
  moves.sort((a, b) => orderKey(pos, b) - orderKey(pos, a));
  for (const m of moves) {
    const score = -negamax(pos.make(m), depth - 1, -beta, -alpha, ply + 1);
    if (score >= beta) return score;
    alpha = Math.max(alpha, score);
  }
  return alpha;
}

/** level: easy(가끔 실수, 1수) / normal(2수 앞) / hard(3수 앞) */
export function bestMove(pos, level = "normal") {
  const moves = pos.legalMoves();
  let depth = 3;
  if (level === "easy") {
    depth = 1;
    if (Math.random() < 0.3) return moves[Math.floor(Math.random() * moves.length)];
  } else if (level === "normal") depth = 2;
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  moves.sort((a, b) => orderKey(pos, b) - orderKey(pos, a));
  let best = moves[0], alpha = -1e9;
  for (const m of moves) {
    const score = -negamax(pos.make(m), depth - 1, -1e9, -alpha, 1);
    if (score > alpha) { alpha = score; best = m; }
  }
  return best;
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
