// 체스 화면: 자리 0 = 백, 자리 1 = 흑
import { Position, bestMove, moveSan, gameOver, sameMove, opponent, FILES } from "../engine/chess.js";
import { pieceSvg } from "../art.js";
import { seatCard } from "../match.js";
import { el, toast, confirmBox, modal } from "../ui.js";

const UNDO_LIMIT = 2;
export const TIME_MODES = { none: ["무제한", null], "10": ["10분", [600, 0]], "3+2": ["3분+2초", [180, 2]] };
const COLOR_NAME = { w: "백", b: "흑" };

export function create(m) {
  const tc = (TIME_MODES[m.settings.time] || TIME_MODES.none)[1];
  const history = [new Position()];
  const moves = [];
  const sans = [];
  const clocks = []; // 수마다 그 전의 시계 상태 (무르기용)
  let clock = tc ? { w: tc[0] * 1000, b: tc[0] * 1000 } : null;
  let lastAt = 0;
  const undoUsed = [0, 0];
  let pending = null;
  let selected = null;
  let anim = null;
  let over = false;
  let aiTimer = null;
  let flipped = m.mode !== "local" && m.controls(1) && !m.controls(0);
  let flagSent = false;

  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip top"></div>
    <div class="chess-board" role="grid" aria-label="체스판"></div>
    <div class="seat-strip bottom"></div>
    <div class="status-line"></div>
    <div class="controls"></div></div>`);
  const boardEl = root.querySelector(".chess-board");
  const topStrip = root.querySelector(".top");
  const bottomStrip = root.querySelector(".bottom");
  const status = root.querySelector(".status-line");
  const controls = root.querySelector(".controls");
  const side = el(`<div class="card"><h3>기보 <span class="muted" style="font-size:14px">${TIME_MODES[m.settings.time]?.[0] || "무제한"}</span></h3><div class="movelist"></div></div>`);
  const moveList = side.querySelector(".movelist");

  const pos = () => history[history.length - 1];
  const seatOf = (color) => (color === "w" ? 0 : 1);
  const turnSeat = () => seatOf(pos().turn);
  const myTurn = () => !over && !m.result && m.controls(turnSeat());
  const lastMover = () => (moves.length ? seatOf(opponent(pos().turn)) : null);

  // ------------------------------------------------------------ 시계
  function remaining(color, now = m.now()) {
    if (!clock) return null;
    let left = clock[color];
    if (!over && !m.result && moves.length >= 1 && pos().turn === color) left -= now - lastAt;
    return left;
  }
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const tick = clock ? setInterval(() => {
    if (over || m.result) return;
    for (const c of ["w", "b"]) {
      const node = root.querySelector(`[data-clock="${c}"]`);
      const left = remaining(c);
      if (node) {
        node.textContent = fmt(left);
        node.classList.toggle("low", left < 20000);
      }
    }
    const left = remaining(pos().turn);
    if (left <= 0 && !flagSent) {
      if (!m.online) { flagSent = true; m.submit({ type: "flag" }, turnSeat()); }
      else if (m.mySeats.length) { flagSent = true; m.submit({ type: "flag" }); }
    }
  }, 200) : null;

  // ------------------------------------------------------------ 판 그리기
  function view(r, c) { return flipped ? [7 - r, 7 - c] : [r, c]; }

  function drawBoard() {
    const p = pos();
    const legal = selected ? p.legalMoves().filter((mv) => mv[0] === selected[0] && mv[1] === selected[1]) : [];
    const last = moves[moves.length - 1];
    const checkSq = p.inCheck(p.turn) ? p.kingSquare(p.turn) : null;
    let html = "";
    for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
      const [r, c] = view(vr, vc);
      const piece = p.board[r][c];
      const cls = ["sq", (r + c) % 2 ? "d" : "l"];
      if (last && ((last[0] === r && last[1] === c) || (last[2] === r && last[3] === c))) cls.push("last");
      if (selected && selected[0] === r && selected[1] === c) cls.push("sel");
      if (checkSq && checkSq[0] === r && checkSq[1] === c) cls.push("check");
      const target = legal.find((mv) => mv[2] === r && mv[3] === c);
      let inner = "";
      if (vc === 0) inner += `<span class="coord r">${8 - r}</span>`;
      if (vr === 7) inner += `<span class="coord f">${FILES[c]}</span>`;
      if (target) inner += piece ? `<span class="ring"></span>` : `<span class="dot"></span>`;
      if (piece) inner += pieceSvg(piece);
      html += `<button class="${cls.join(" ")}" data-r="${r}" data-c="${c}" aria-label="${FILES[c]}${8 - r}${piece ? " " + COLOR_NAME[piece[0]] + piece[1] : ""}">${inner}</button>`;
    }
    boardEl.innerHTML = html;
    if (anim) {
      const node = boardEl.querySelector(`[data-r="${anim[2]}"][data-c="${anim[3]}"] .piece`);
      const sq = boardEl.firstElementChild.offsetWidth;
      if (node) {
        const [fr, fc] = view(anim[0], anim[1]);
        const [tr, tcc] = view(anim[2], anim[3]);
        node.style.transform = `translate(${(fc - tcc) * sq}px, ${(fr - tr) * sq}px)`;
        node.style.zIndex = 5;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          node.style.transition = "transform 0.2s cubic-bezier(.2,.7,.3,1)";
          node.style.transform = "";
        }));
      }
      anim = null;
    }
  }

  boardEl.addEventListener("click", (ev) => {
    const sq = ev.target.closest(".sq");
    if (!sq || !myTurn()) return;
    const r = +sq.dataset.r, c = +sq.dataset.c;
    const p = pos();
    const piece = p.board[r][c];
    if (selected) {
      const options = p.legalMoves().filter((mv) => mv[0] === selected[0] && mv[1] === selected[1] && mv[2] === r && mv[3] === c);
      if (options.length) {
        const from = selected;
        selected = null;
        if (options.length > 1) choosePromo(p.turn, (promo) => send([from[0], from[1], r, c, promo]));
        else send(options[0]);
        drawBoard();
        return;
      }
    }
    selected = piece && piece[0] === p.turn && !(selected && selected[0] === r && selected[1] === c) ? [r, c] : null;
    drawBoard();
  });

  function choosePromo(color, done) {
    const body = el(`<div class="promo">${"QRBN".split("").map((k) => `<button data-k="${k}" aria-label="${k}">${pieceSvg(color + k)}</button>`).join("")}</div>`);
    const close = modal("어떤 기물로 바꿀까요?", body);
    body.querySelectorAll("button").forEach((b) => { b.onclick = () => { close(); done(b.dataset.k); }; });
  }

  function send(mv) { m.submit({ type: "move", m: mv }, turnSeat()); }

  // ------------------------------------------------------------ 컴퓨터
  function maybeAi() {
    if (over || m.result || !m.seats[turnSeat()].ai || aiTimer) return;
    aiTimer = m.later(() => {
      aiTimer = null;
      if (over || !m.seats[turnSeat()].ai) return;
      send(bestMove(pos(), m.level));
    }, 300);
  }

  // ------------------------------------------------------------ 무르기
  function undoMoves(k, at) {
    for (let i = 0; i < k && moves.length; i++) {
      history.pop();
      moves.pop();
      sans.pop();
      const prev = clocks.pop();
      if (prev && clock) { clock = prev.clock; lastAt = prev.lastAt; }
    }
    if (clock && moves.length) lastAt = at; // 무른 뒤에는 무른 시각부터 다시 잼 (모든 기기가 같은 값)
    selected = null;
    flagSent = false;
    if (aiTimer) { clearTimeout(aiTimer); m.timers.delete(aiTimer); aiTimer = null; }
  }

  function canUndo() {
    if (over || m.result || !moves.length) return false;
    if (m.mode === "ai") return moves.some((_, i) => m.controls(i % 2));
    const lm = lastMover();
    if (m.mode === "local") return undoUsed[lm] < UNDO_LIMIT;
    return m.controls(lm) && undoUsed[lm] < UNDO_LIMIT && !pending;
  }

  function askUndo() {
    if (!canUndo()) return;
    if (m.online) m.submit({ type: "undo_req", n: moves.length });
    else m.submit({ type: "undo" }, lastMover());
  }

  async function answerUndo() {
    const req = pending;
    const ok = await confirmBox("무르기 요청", `${m.seats[req.seat].name} 님이 한 수 무르기를 원해요. 들어줄까요?`, "들어주기", "거절");
    if (pending !== req) return;
    m.submit({ type: ok ? "undo_ok" : "undo_no", n: req.n });
  }

  // ------------------------------------------------------------ 행동 적용
  function apply(a, at, seat) {
    if (over) return;
    if (a.type === "move") {
      const p = pos();
      if (seat !== turnSeat() || !Array.isArray(a.m)) return;
      const mv = p.legalMoves().find((x) => sameMove(x, a.m));
      if (!mv) return;
      pending = null;
      clocks.push(clock ? { clock: { ...clock }, lastAt } : null);
      const mover = p.turn;
      if (clock) {
        if (moves.length >= 1) clock[mover] -= at - lastAt;
        if (clock[mover] <= 0) {
          clock[mover] = 0;
          return end([seatOf(opponent(mover))], `${COLOR_NAME[mover]} 시간 초과`);
        }
        clock[mover] += tc[1] * 1000;
        lastAt = at;
      }
      sans.push(moveSan(p, mv));
      const captured = p.board[mv[2]][mv[3]] !== null;
      history.push(p.make(mv));
      moves.push(mv);
      anim = m.replaying ? null : mv;
      m.sfx(captured ? "place" : "move");
      const res = gameOver(history);
      if (res) end(res.winner ? [seatOf(res.winner)] : [], res.text);
    } else if (a.type === "flag") {
      if (!clock) return;
      const turn = pos().turn;
      if (moves.length >= 1 && clock[turn] - (at - lastAt) <= 250) {
        clock[turn] = 0;
        end([seatOf(opponent(turn))], `${COLOR_NAME[turn]} 시간 초과`);
      } else flagSent = false;
    } else if (a.type === "undo" && !m.online) {
      if (m.mode === "ai") {
        const human = m.seats.findIndex((s) => !s.ai);
        undoMoves(1, at);
        if (moves.length && turnSeat() !== human) undoMoves(1, at);
      } else {
        const lm = lastMover();
        if (undoUsed[lm] >= UNDO_LIMIT) return;
        undoUsed[lm]++;
        undoMoves(1, at);
      }
    } else if (a.type === "undo_req") {
      if (seat !== lastMover() || a.n !== moves.length || undoUsed[seat] >= UNDO_LIMIT || pending) return;
      pending = { seat, n: a.n };
      if (!m.replaying && m.controls(1 - seat)) answerUndo();
      else if (!m.replaying && m.controls(seat)) toast("상대에게 무르기를 요청했어요");
    } else if (a.type === "undo_ok") {
      if (!pending || seat === pending.seat || a.n !== moves.length) return;
      undoUsed[pending.seat]++;
      pending = null;
      undoMoves(1, at);
      if (!m.replaying) toast("한 수 물렀어요");
    } else if (a.type === "undo_no") {
      if (!pending || seat === pending.seat) return;
      if (!m.replaying && m.controls(pending.seat)) toast("상대가 무르기를 거절했어요");
      pending = null;
    }
  }

  function resign(seat) {
    if (over || seat > 1) return;
    end([1 - seat], `${m.seats[seat].name} 님 항복`);
  }

  function end(winners, sub) {
    over = true;
    selected = null;
    const losers = [0, 1].filter((i) => !winners.includes(i));
    const title = winners.length ? `${m.seats[winners[0]].name} 승리!` : "무승부";
    m.finish({ title, sub, winners, losers: winners.length ? losers : [], moves: moves.length });
  }

  // ------------------------------------------------------------ 화면
  function seatHtml(i) {
    const color = i === 0 ? "w" : "b";
    const clockHtml = clock ? `<span class="clock ${!over && pos().turn === color && moves.length ? "run" : ""}" data-clock="${color}">${fmt(remaining(color))}</span>` : "";
    return seatCard(m, i, { sub: `${COLOR_NAME[color]}${m.mode === "ai" ? "" : ` · 무르기 ${UNDO_LIMIT - undoUsed[i]}번`}`, turn: !over && turnSeat() === i, extra: clockHtml });
  }

  function render() {
    const bottomSeat = flipped ? 1 : 0;
    topStrip.innerHTML = seatHtml(1 - bottomSeat);
    bottomStrip.innerHTML = seatHtml(bottomSeat);
    const p = pos();
    if (over || m.result) status.textContent = m.result ? `${m.result.title} · ${m.result.sub}` : "";
    else {
      const check = p.inCheck(p.turn) ? " · 체크!" : "";
      status.textContent = myTurn() ? `내 차례 (${COLOR_NAME[p.turn]})${check}` : `${m.seats[turnSeat()].name} 님 차례${m.seats[turnSeat()].ai ? " · 생각 중..." : ""}${check}`;
    }
    let ml = "";
    for (let i = 0; i < sans.length; i += 2) ml += `<span class="n">${i / 2 + 1}.</span><span>${sans[i]}</span><span>${sans[i + 1] || ""}</span>`;
    moveList.innerHTML = ml || `<span class="muted" style="grid-column:1/-1">아직 둔 수가 없어요</span>`;
    moveList.scrollTop = moveList.scrollHeight;
    drawBoard();
    controls.innerHTML = "";
    const flip = el(`<button class="btn ghost">판 돌리기</button>`);
    flip.onclick = () => { flipped = !flipped; render(); };
    if (m.mySeats.length && !over && !m.result) {
      const undo = el(`<button class="btn">무르기</button>`);
      undo.disabled = !canUndo();
      undo.onclick = askUndo;
      const give = el(`<button class="btn ghost">항복</button>`);
      give.onclick = async () => {
        const seat = m.mode === "local" ? turnSeat() : m.mySeats.find((i) => !m.seats[i].ai);
        if (await confirmBox("항복", `${m.seats[seat].name} 님, 정말 항복할까요?`, "항복", "계속")) m.submit({ type: "resign" }, seat);
      };
      controls.append(undo, give);
    }
    controls.append(flip);
    maybeAi();
  }

  return { el: root, sideEl: side, apply, resign, render, destroy: () => clearInterval(tick) };
}
