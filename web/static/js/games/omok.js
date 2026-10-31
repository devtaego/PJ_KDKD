// 오목 화면: 자리 0 = 흑, 자리 1 = 백
import { Board, N, BLACK, WHITE, EMPTY, STARS, RULES, aiMove } from "../engine/omok.js";
import { seatCard } from "../match.js";
import { el, toast, confirmBox } from "../ui.js";

const UNDO_LIMIT = 2;
const COLOR_NAME = { [BLACK]: "흑", [WHITE]: "백" };

export function create(m) {
  const rule = m.settings.rule === "free" ? "free" : "33";
  const board = new Board(rule);
  const undoUsed = [0, 0];
  let pending = null; // 온라인 무르기 요청 {seat, n}
  let ghost = null; // 미리 보기 [r, c]
  let winLine = [];
  let aiTimer = null;
  let over = false;

  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip omok-strip"></div>
    <div class="omok-board" role="grid" aria-label="오목판"></div></div>`);
  const strip = root.querySelector(".seat-strip");
  const boardEl = root.querySelector(".omok-board");
  const side = el(`<div class="card"><h3>오목 · ${RULES[rule][0]}</h3><div class="muted">${RULES[rule][1]}</div><div class="muted info" style="margin-top:6px"></div></div>`);

  const seatOf = (color) => (color === BLACK ? 0 : 1);
  const turnSeat = () => seatOf(board.turn);
  const myTurn = () => !over && !m.result && m.controls(turnSeat());
  const lastMover = () => (board.moves.length ? seatOf(board.moves.length % 2 === 1 ? BLACK : WHITE) : null);

  // ------------------------------------------------------------ 판 그리기
  function drawBoard() {
    const cells = [];
    const pad = 1;
    const size = N + 1;
    cells.push(`<rect x="0" y="0" width="${size}" height="${size}" rx="0.45" fill="#E3B36E"/>`);
    cells.push(`<rect x="0.2" y="0.2" width="${size - 0.4}" height="${size - 0.4}" rx="0.32" fill="none" stroke="#C9934A" stroke-width="0.06"/>`);
    let lines = "";
    for (let i = 0; i < N; i++) {
      lines += `M${pad} ${pad + i}H${pad + N - 1}M${pad + i} ${pad}V${pad + N - 1}`;
    }
    cells.push(`<path d="${lines}" stroke="#5B3A1A" stroke-width="0.045" fill="none"/>`);
    for (const [r, c] of STARS) cells.push(`<circle cx="${pad + c}" cy="${pad + r}" r="0.12" fill="#5B3A1A"/>`);
    const forbid = myTurn() && board.turn === BLACK && rule === "33";
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = board.g[r][c];
      const x = pad + c, y = pad + r;
      if (v === BLACK) cells.push(`<circle cx="${x}" cy="${y}" r="0.45" fill="url(#ob)"/>`);
      else if (v === WHITE) cells.push(`<circle cx="${x}" cy="${y}" r="0.45" fill="url(#ow)" stroke="#BDB3A3" stroke-width="0.04"/>`);
      else if (forbid && board.forbidden(r, c, BLACK)) cells.push(`<path d="M${x - 0.18} ${y - 0.18}L${x + 0.18} ${y + 0.18}M${x + 0.18} ${y - 0.18}L${x - 0.18} ${y + 0.18}" stroke="#E03131" stroke-width="0.08" stroke-linecap="round"/>`);
    }
    for (const [r, c] of winLine) cells.push(`<circle cx="${pad + c}" cy="${pad + r}" r="0.5" fill="none" stroke="#FFC94D" stroke-width="0.12"/>`);
    if (board.moves.length) {
      const [r, c] = board.moves[board.moves.length - 1];
      cells.push(`<circle cx="${pad + c}" cy="${pad + r}" r="0.12" fill="#FF3B3B"/>`);
    }
    if (ghost && myTurn() && board.g[ghost[0]][ghost[1]] === EMPTY) {
      const ok = board.legal(ghost[0], ghost[1]);
      cells.push(`<circle cx="${pad + ghost[1]}" cy="${pad + ghost[0]}" r="0.45" fill="${board.turn === BLACK ? "#1E1B18" : "#FAF7F0"}" opacity="${ok ? 0.5 : 0.2}"/>`);
    }
    boardEl.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><defs>
      <radialGradient id="ob" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#5A5A5E"/><stop offset="1" stop-color="#121214"/></radialGradient>
      <radialGradient id="ow" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCD5C8"/></radialGradient></defs>${cells.join("")}</svg>`;
  }

  function cellFrom(ev) {
    const r = boardEl.getBoundingClientRect();
    const unit = r.width / (N + 1);
    const c = Math.round((ev.clientX - r.left) / unit - 1);
    const row = Math.round((ev.clientY - r.top) / unit - 1);
    return row >= 0 && row < N && c >= 0 && c < N ? [row, c] : null;
  }

  boardEl.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || !myTurn()) return;
    const p = cellFrom(ev);
    if (String(p) !== String(ghost)) { ghost = p; drawBoard(); }
  });
  boardEl.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType === "mouse" && ghost) { ghost = null; drawBoard(); }
  });
  let lastPointer = "mouse";
  boardEl.addEventListener("pointerdown", (ev) => { lastPointer = ev.pointerType; });
  boardEl.addEventListener("click", (ev) => {
    if (!myTurn()) return;
    const p = cellFrom(ev);
    if (!p) return;
    const touch = lastPointer !== "mouse";
    if (touch && String(p) !== String(ghost)) { // 폰: 처음 누르면 미리 보기, 한 번 더 누르면 놓기
      ghost = p;
      drawBoard();
      return;
    }
    if (!board.legal(p[0], p[1])) {
      if (board.g[p[0]][p[1]] === EMPTY) toast("쌍삼 금지 자리예요");
      return;
    }
    ghost = null;
    m.submit({ type: "place", r: p[0], c: p[1] }, turnSeat());
  });

  // ------------------------------------------------------------ 컴퓨터
  function maybeAi() {
    if (over || m.result || !m.seats[turnSeat()].ai || aiTimer) return;
    aiTimer = m.later(() => {
      aiTimer = null;
      if (over || !m.seats[turnSeat()].ai) return;
      const [r, c] = aiMove(board, m.level);
      m.submit({ type: "place", r, c }, turnSeat());
    }, 380 + Math.random() * 300);
  }

  // ------------------------------------------------------------ 무르기
  function undoMoves(k) {
    for (let i = 0; i < k && board.moves.length; i++) board.undo();
    winLine = [];
    if (aiTimer) { clearTimeout(aiTimer); m.timers.delete(aiTimer); aiTimer = null; }
  }

  function canUndo() {
    if (over || m.result || !board.moves.length) return false;
    if (m.mode === "ai") return board.moves.some((_, i) => m.controls(i % 2 === 0 ? 0 : 1));
    const lm = lastMover();
    if (m.mode === "local") return undoUsed[lm] < UNDO_LIMIT;
    return m.controls(lm) && undoUsed[lm] < UNDO_LIMIT && !pending;
  }

  function askUndo() {
    if (!canUndo()) return;
    if (m.online) {
      m.submit({ type: "undo_req", n: board.moves.length });
      return;
    }
    m.submit({ type: "undo" }, lastMover());
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
    if (a.type === "place") {
      if (seat !== turnSeat() || !Number.isInteger(a.r) || !Number.isInteger(a.c) || !board.legal(a.r, a.c)) return;
      pending = null;
      const color = board.place(a.r, a.c);
      m.sfx("place");
      winLine = board.winLine(a.r, a.c, color);
      if (winLine.length) end([seatOf(color)], `${COLOR_NAME[color]} 5목 완성!`);
      else if (board.full()) end([], "판이 꽉 찼어요");
    } else if (a.type === "undo" && !m.online) {
      if (m.mode === "ai") {
        const human = m.seats.findIndex((s) => !s.ai);
        undoMoves(1);
        if (board.moves.length && turnSeat() !== human) undoMoves(1);
        if (turnSeat() !== human && !board.moves.length) maybeAi();
      } else {
        const lm = lastMover();
        if (undoUsed[lm] >= UNDO_LIMIT) return;
        undoUsed[lm]++;
        undoMoves(1);
      }
    } else if (a.type === "undo_req") {
      if (seat !== lastMover() || a.n !== board.moves.length || undoUsed[seat] >= UNDO_LIMIT || pending) return;
      pending = { seat, n: a.n };
      if (!m.replaying && m.controls(1 - seat)) answerUndo();
      else if (!m.replaying && m.controls(seat)) toast("상대에게 무르기를 요청했어요");
    } else if (a.type === "undo_ok") {
      if (!pending || seat === pending.seat || a.n !== board.moves.length) return;
      undoUsed[pending.seat]++;
      pending = null;
      undoMoves(1);
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
    const losers = [0, 1].filter((i) => !winners.includes(i));
    const title = winners.length ? `${m.seats[winners[0]].name} 승리!` : "무승부";
    m.finish({ title, sub, winners, losers: winners.length ? losers : [], moves: board.moves.length });
  }

  // ------------------------------------------------------------ 화면
  async function resignMine() {
    const seat = m.mode === "local" ? turnSeat() : m.mySeats.find((i) => !m.seats[i].ai);
    if (await confirmBox("항복", `${m.seats[seat].name} 님, 정말 항복할까요?`, "항복", "계속")) m.submit({ type: "resign" }, seat);
  }

  function render() {
    const ts = turnSeat();
    strip.innerHTML = [0, 1].map((i) => {
      const turn = !over && !m.result && ts === i;
      const bits = [i === 0 ? "흑" : "백"];
      if (turn && m.seats[i].ai) bits.push("생각 중...");
      else if (turn && m.controls(i) && m.mode !== "local") bits.push("내 차례");
      if (m.mode !== "ai") bits.push(`무르기 ${UNDO_LIMIT - undoUsed[i]}번`);
      return seatCard(m, i, { sub: bits.join(" · "), turn, extra: `<span class="stone ${i === 0 ? "b" : "w"}"></span>` });
    }).join("");
    side.querySelector(".info").textContent = `${board.moves.length}수째`;
    drawBoard();
    m.setTopActions(m.mySeats.length && !over && !m.result
      ? [{ label: "무르기", onClick: askUndo, disabled: !canUndo() }, { label: "항복", onClick: resignMine }] : []);
    maybeAi();
  }

  return { el: root, sideEl: side, apply, resign, render };
}
