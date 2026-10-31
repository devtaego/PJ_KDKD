// 야추 다이스 화면: 최대 6명, 컵을 꾹 눌러 흔들다 놓으면 주사위가 쏟아져 나옴
import { YachtGame, UPPER, LOWER, CATEGORIES, CAT_NAMES, CAT_HELP, BONUS_NEED, BONUS, score, rollDie, aiPickCategory, aiShouldStop, aiHolds } from "../engine/yacht.js";
import { avatarHtml, esc } from "../art.js";
import { seatCard } from "../match.js";
import { el, toast, confirmBox } from "../ui.js";
import { DiceTray } from "./dice_tray.js";

const AI_STEP_MS = 750;
const AI_SHAKE_MS = 650; // 컴퓨터도 잠깐 흔든 뒤 던짐
const TAP_SHAKE_MS = 420; // 버튼을 톡 누르면 이만큼 흔든 뒤 자동으로 던짐

export function create(m) {
  const game = new YachtGame(m.seats.map((s) => s.name), m.seats.map((s, i) => (s.ai ? i : -1)).filter((i) => i >= 0));
  let aiTimer = null;
  let shakeStart = null; // 내가 흔들기 시작한 시각
  let tapTimer = null;
  let remoteShake = null; // 다른 사람이 흔드는 중이면 안전장치 타이머

  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div>
    <div class="status-line"></div>
    <div class="yacht-table">
      <div class="tray-slot"></div>
      <div class="held-label"></div>
      <div class="row" style="justify-content:center"><button class="btn big pink cup-btn">컵 흔들기</button></div>
    </div>
    <div class="score-wrap"></div>
    <div class="controls"></div></div>`);
  const strip = root.querySelector(".seat-strip");
  const status = root.querySelector(".status-line");
  const heldLabel = root.querySelector(".held-label");
  const cup = root.querySelector(".cup-btn");
  const scoreWrap = root.querySelector(".score-wrap");
  const controls = root.querySelector(".controls");

  const myTurn = () => !game.over && !m.result && m.controls(game.current);
  const canRoll = () => myTurn() && game.rollsLeft > 0 && !tray.isRolling();

  const tray = new DiceTray({
    onCupDown: () => startShake(),
    onCupUp: () => releaseShake(),
    onDieTap: (i) => {
      if (myTurn() && game.rolled && game.rollsLeft > 0 && !tray.isRolling()) m.submit({ type: "hold", i }, game.current);
    },
  });
  tray.onSettled = () => render();
  root.querySelector(".tray-slot").appendChild(tray.el);

  // ------------------------------------------------------------ 컵: 꾹 눌러 흔들고 놓으면 던지기
  function startShake() {
    if (!canRoll() || shakeStart !== null) return false;
    shakeStart = performance.now();
    tray.setShaking(true);
    cup.classList.add("shaking");
    cup.textContent = "놓으면 던져요!";
    if (m.online) m.fx({ kind: "shake", on: true });
    return true;
  }

  function releaseShake(minMs = 0) {
    if (shakeStart === null) return;
    const held = performance.now() - shakeStart;
    if (held < minMs) { // 톡 누른 경우: 조금 더 흔든 뒤 던짐
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => releaseShake(), minMs - held);
      return;
    }
    shakeStart = null;
    cup.classList.remove("shaking");
    roll(Math.min(0.8 + (held / 1000) * 0.5, 1.45)); // 오래 흔들수록 세게
  }

  cup.addEventListener("pointerdown", (ev) => { if (startShake()) ev.preventDefault(); });
  cup.addEventListener("pointerup", () => releaseShake(TAP_SHAKE_MS));
  cup.addEventListener("pointerleave", () => releaseShake(TAP_SHAKE_MS));
  cup.addEventListener("pointercancel", () => releaseShake(TAP_SHAKE_MS));
  cup.addEventListener("contextmenu", (ev) => ev.preventDefault()); // 폰에서 꾹 누를 때 메뉴가 뜨지 않게
  cup.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.repeat) { ev.preventDefault(); startShake(); } });
  cup.addEventListener("keyup", (ev) => { if (ev.key === "Enter") releaseShake(TAP_SHAKE_MS); });

  // 스페이스바: 누르고 있으면 흔들고, 떼면 던짐 (채팅 입력 중이거나 창이 떠 있으면 무시)
  const typing = (ev) => ev.target.closest?.("input, textarea, [contenteditable]") || document.querySelector(".modal-back");
  const onKeyDown = (ev) => {
    if (ev.code !== "Space" || typing(ev)) return;
    ev.preventDefault(); // 화면이 아래로 스크롤되지 않게
    if (!ev.repeat) startShake();
  };
  const onKeyUp = (ev) => {
    if (ev.code !== "Space" || typing(ev)) return;
    ev.preventDefault();
    releaseShake(TAP_SHAKE_MS);
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  function roll(power) {
    tray.setShaking(false);
    if (!myTurn() || game.rollsLeft === 0) { render(); return; }
    m.submit({ type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie), power: Math.round(power * 100) / 100 }, game.current);
  }

  scoreWrap.addEventListener("click", (ev) => {
    const help = ev.target.closest("[data-help]");
    if (help) { toast(`${CAT_NAMES[help.dataset.help]}: ${CAT_HELP[help.dataset.help]}`, 3200); return; }
    const cell = ev.target.closest("td.pick");
    if (!cell || !myTurn() || tray.isRolling()) return;
    m.submit({ type: "record", cat: cell.dataset.cat }, game.current);
  });

  /** 다른 사람이 컵을 흔드는 모습 (온라인) */
  function onFx(msg) {
    const f = msg.fx;
    if (f.kind !== "shake") return;
    const seat = m.seats.findIndex((s) => s.cid === msg.from);
    if (seat !== game.current || m.controls(seat)) return;
    clearTimeout(remoteShake);
    tray.setShaking(!!f.on, `${m.seats[seat].name} `);
    if (f.on) remoteShake = setTimeout(() => tray.setShaking(false), 5000);
  }

  // ------------------------------------------------------------ 컴퓨터
  function maybeAi() {
    if (game.over || m.result || !m.seats[game.current].ai || aiTimer || tray.isRolling()) return;
    const seat = game.current;
    const throwLater = () => {
      tray.setShaking(true, `${m.seats[seat].name} `);
      aiTimer = m.later(() => {
        aiTimer = null;
        if (game.over || game.current !== seat) return;
        m.submit({ type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie), power: 0.9 + Math.random() * 0.4 }, seat);
      }, AI_SHAKE_MS);
    };
    aiTimer = m.later(() => {
      aiTimer = null;
      if (game.over || game.current !== seat) return;
      if (!game.rolled) throwLater();
      else if (game.rollsLeft > 0 && !aiShouldStop(game)) {
        const want = aiHolds(game);
        want.forEach((h, i) => { if (h !== game.held[i]) m.submit({ type: "hold", i }, seat); });
        aiTimer = m.later(() => { aiTimer = null; throwLater(); }, 450); // 고정한 주사위가 칸으로 올라가는 걸 보여 줌
      } else {
        m.submit({ type: "record", cat: aiPickCategory(game, m.level) }, seat);
      }
    }, AI_STEP_MS + (game.rolled ? 300 : 0));
  }

  // ------------------------------------------------------------ 행동 적용
  function apply(a, at, seat) {
    if (game.over || seat !== game.current) return;
    if (a.type === "roll") {
      const dice = Array.isArray(a.dice) && a.dice.length === 5 && a.dice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6) ? a.dice : null;
      if (!dice) return;
      const free = game.held.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
      if (!game.roll(dice)) return;
      clearTimeout(remoteShake);
      const power = typeof a.power === "number" ? Math.min(Math.max(a.power, 0.8), 1.45) : 1.1;
      if (!m.replaying) tray.throwDice(free, game.dice, power);
    } else if (a.type === "hold") {
      if (Number.isInteger(a.i) && a.i >= 0 && a.i < 5 && game.toggle(a.i)) m.sfx("click");
    } else if (a.type === "record") {
      const scored = typeof a.cat === "string" && game.players[seat].scores[a.cat] === undefined ? score(a.cat, game.dice) : null;
      if (!game.record(a.cat)) return;
      m.sfx(scored > 0 ? "pop" : "place");
      if (!m.replaying && scored !== null) m.popSeat(seat, { text: `${CAT_NAMES[a.cat]} ${scored}점` });
      if (game.over) end("모든 칸을 채웠어요");
    }
  }

  function resign(seat, kind) {
    if (!game.resign(seat)) return;
    if (game.over) end(kind === "leave" ? "다른 사람이 모두 나갔어요" : "남은 사람이 한 명이에요");
  }

  function end(sub) {
    const order = game.ranking();
    const alive = order.filter((i) => !game.players[i].resigned);
    const top = alive.length ? game.total(game.players[alive[0]]) : 0;
    const winners = alive.filter((i) => game.total(game.players[i]) === top);
    const losers = order.length > 1 ? [order[order.length - 1]].filter((i) => !winners.includes(i)) : [];
    const scores = Object.fromEntries(order.map((i) => [i, `${game.total(game.players[i])}점`]));
    const title = winners.length === 1 ? `${m.seats[winners[0]].name} 1등!` : "공동 1등!";
    m.finish({ title, sub, winners, losers, order, scores, moves: game.players.reduce((a, p) => a + Object.keys(p.scores).length, 0) });
  }

  // ------------------------------------------------------------ 화면
  function drawScores() {
    const cur = game.current;
    const settled = game.rolled && !tray.isRolling();
    const canPick = myTurn() && settled;
    const head = game.players.map((p, i) => `<th class="${i === cur && !game.over ? "cur" : ""}"><div class="th-av">${avatarHtml(m.seats[i].avatar, 26)}<span class="nm">${esc(p.name)}</span></div></th>`).join("");
    const row = (cat) => {
      const cells = game.players.map((p, i) => {
        const v = p.scores[cat];
        const curCls = i === cur && !game.over ? " cur" : "";
        if (v !== undefined) return `<td class="${curCls}">${v}</td>`;
        if (i === cur && settled && !game.over && !p.resigned) {
          const pv = score(cat, game.dice);
          return `<td class="pv${canPick ? " pick" : ""}${curCls}" data-cat="${cat}">${pv}</td>`;
        }
        return `<td class="${curCls}">${p.resigned ? "-" : ""}</td>`;
      }).join("");
      return `<tr><td class="cat"><button data-help="${cat}">${CAT_NAMES[cat]}</button></td>${cells}</tr>`;
    };
    const sumRow = (label, fn, cls = "sum") => `<tr class="${cls}"><td class="cat">${label}</td>${game.players.map((p, i) => `<td class="${i === cur && !game.over ? "cur" : ""}">${fn(p)}</td>`).join("")}</tr>`;
    scoreWrap.innerHTML = `<table class="score"><thead><tr><th>항목</th>${head}</tr></thead><tbody>
      ${UPPER.map(row).join("")}
      ${sumRow("소계", (p) => `${YachtGame.upperSum(p)}/${BONUS_NEED}`)}
      ${sumRow(`보너스 +${BONUS}`, (p) => (game.bonus(p) ? `+${BONUS}` : ""))}
      ${LOWER.map(row).join("")}
      ${sumRow("총점", (p) => game.total(p), "total")}</tbody></table>`;
  }

  function render() {
    strip.innerHTML = game.players.map((p, i) => seatCard(m, i, { sub: p.resigned ? "항복" : `${game.total(p)}점`, turn: !game.over && i === game.current })).join("");
    const p = game.players[game.current];
    if (game.over || m.result) status.textContent = m.result ? m.result.title : "";
    else {
      const who = myTurn() ? "내 차례" : `${p.name} 님 차례${m.seats[game.current].ai ? " · 생각 중..." : ""}`;
      status.textContent = `${who} · ${game.round}/12 라운드 · 남은 던지기 ${game.rollsLeft}번`;
    }
    tray.sync(game.dice, game.held, game.rolled);
    if (m.replaying) tray.settleInstant(game.dice);
    const rolling = tray.isRolling();
    heldLabel.textContent = rolling ? "데구르르..." : !game.rolled ? (myTurn() ? "컵(오른쪽)이나 버튼, 스페이스바를 꾹 눌러 흔들다 놓아 보세요" : "") : game.rollsLeft === 0 ? "점수표에서 기록할 칸을 골라요" : myTurn() ? "남길 주사위를 눌러 위 칸에 고정해요" : "";
    cup.disabled = !myTurn() || game.rollsLeft === 0 || rolling;
    if (shakeStart === null) cup.textContent = game.rollsLeft === 3 ? "컵 흔들기" : `다시 던지기 (${game.rollsLeft}번 남음)`;
    drawScores();
    controls.innerHTML = "";
    const mine = m.mySeats.filter((i) => !game.players[i].resigned && !m.seats[i].ai);
    if (mine.length && !game.over && !m.result) {
      const give = el(`<button class="btn ghost">항복</button>`);
      give.onclick = async () => {
        const seat = m.mode === "local" ? (mine.includes(game.current) ? game.current : mine[0]) : mine[0];
        if (await confirmBox("항복", `${m.seats[seat].name} 님, 정말 항복할까요?`, "항복", "계속")) m.submit({ type: "resign" }, seat);
      };
      controls.append(give);
    }
    maybeAi();
  }

  return {
    el: root, apply, resign, render, onFx,
    destroy: () => {
      clearTimeout(tapTimer);
      clearTimeout(remoteShake);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      tray.destroy();
    },
  };
}

export { CATEGORIES };
