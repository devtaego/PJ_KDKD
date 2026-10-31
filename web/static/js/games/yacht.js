// 야추 다이스 화면: 최대 6명, 컵을 꾹 눌러 흔들다 놓으면 던짐
import { YachtGame, UPPER, LOWER, CATEGORIES, CAT_NAMES, CAT_HELP, BONUS_NEED, BONUS, score, rollDie, aiPickCategory, aiShouldStop, aiHolds } from "../engine/yacht.js";
import { dieSvg, avatarHtml, esc } from "../art.js";
import { seatCard } from "../match.js";
import { el, toast, confirmBox } from "../ui.js";
import { play } from "../sound.js";

const AI_STEP_MS = 750;

export function create(m) {
  const game = new YachtGame(m.seats.map((s) => s.name), m.seats.map((s, i) => (s.ai ? i : -1)).filter((i) => i >= 0));
  let rolling = new Set(); // 굴러가는 중인 주사위 자리
  let aiTimer = null;
  let shaking = false;
  let shakeSound = null;

  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div>
    <div class="status-line"></div>
    <div class="yacht-table">
      <div class="dice-row"></div>
      <div class="held-label"></div>
      <div class="row" style="justify-content:center"><button class="btn big pink cup-btn">컵 흔들기</button></div>
    </div>
    <div class="score-wrap"></div>
    <div class="controls"></div></div>`);
  const strip = root.querySelector(".seat-strip");
  const status = root.querySelector(".status-line");
  const diceRow = root.querySelector(".dice-row");
  const heldLabel = root.querySelector(".held-label");
  const cup = root.querySelector(".cup-btn");
  const scoreWrap = root.querySelector(".score-wrap");
  const controls = root.querySelector(".controls");

  const myTurn = () => !game.over && !m.result && m.controls(game.current);

  // ------------------------------------------------------------ 컵: 꾹 눌러 흔들고 놓으면 던지기
  const startShake = (ev) => {
    if (!myTurn() || game.rollsLeft === 0 || rolling.size) return;
    ev.preventDefault();
    shaking = true;
    cup.classList.add("shaking");
    cup.textContent = "놓으면 던져요!";
    play("shake");
    shakeSound = setInterval(() => play("shake"), 340);
  };
  const stopShake = () => {
    if (!shaking) return;
    shaking = false;
    clearInterval(shakeSound);
    cup.classList.remove("shaking");
    roll();
  };
  cup.addEventListener("pointerdown", startShake);
  cup.addEventListener("pointerup", stopShake);
  cup.addEventListener("pointerleave", stopShake);
  cup.addEventListener("pointercancel", stopShake);
  cup.addEventListener("contextmenu", (ev) => ev.preventDefault()); // 폰에서 꾹 누를 때 메뉴가 뜨지 않게
  cup.addEventListener("keydown", (ev) => { if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) startShake(ev); });
  cup.addEventListener("keyup", (ev) => { if (ev.key === " " || ev.key === "Enter") stopShake(); });

  function roll() {
    if (!myTurn() || game.rollsLeft === 0) return;
    m.submit({ type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie) }, game.current);
  }

  diceRow.addEventListener("click", (ev) => {
    const b = ev.target.closest(".die");
    if (!b || !myTurn() || !game.rolled || game.rollsLeft === 0 || rolling.size) return;
    m.submit({ type: "hold", i: +b.dataset.i }, game.current);
  });

  scoreWrap.addEventListener("click", (ev) => {
    const help = ev.target.closest("[data-help]");
    if (help) { toast(`${CAT_NAMES[help.dataset.help]}: ${CAT_HELP[help.dataset.help]}`, 3200); return; }
    const cell = ev.target.closest("td.pick");
    if (!cell || !myTurn() || rolling.size) return;
    m.submit({ type: "record", cat: cell.dataset.cat }, game.current);
  });

  // ------------------------------------------------------------ 컴퓨터
  function maybeAi() {
    if (game.over || m.result || !m.seats[game.current].ai || aiTimer) return;
    aiTimer = m.later(() => {
      aiTimer = null;
      if (game.over || !m.seats[game.current].ai) return;
      const seat = game.current;
      if (!game.rolled) {
        m.submit({ type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie) }, seat);
      } else if (game.rollsLeft > 0 && !aiShouldStop(game)) {
        const want = aiHolds(game);
        want.forEach((h, i) => { if (h !== game.held[i]) m.submit({ type: "hold", i }, seat); });
        m.submit({ type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie) }, seat);
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
      if (!m.replaying) {
        rolling = new Set(free);
        m.sfx("roll");
        m.later(() => { rolling = new Set(); render(); }, 600);
      }
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
  function drawDice() {
    diceRow.innerHTML = game.dice.map((v, i) => {
      const cls = ["die"];
      if (game.held[i]) cls.push("held");
      if (rolling.has(i)) cls.push("rolling");
      if (!game.rolled) cls.push("blank");
      const style = rolling.has(i) ? `style="--dx:${Math.round((Math.random() - 0.5) * 80)}px;--rot:${Math.round(Math.random() * 720 - 360)}deg"` : "";
      return `<button class="${cls.join(" ")}" data-i="${i}" ${style} aria-label="주사위 ${v}${game.held[i] ? " 고정" : ""}">${dieSvg(v)}</button>`;
    }).join("");
  }

  function drawScores() {
    const cur = game.current;
    const canPick = myTurn() && game.rolled && !rolling.size;
    const head = game.players.map((p, i) => `<th class="${i === cur && !game.over ? "cur" : ""}"><div class="th-av">${avatarHtml(m.seats[i].avatar, 26)}<span class="nm">${esc(p.name)}</span></div></th>`).join("");
    const row = (cat) => {
      const cells = game.players.map((p, i) => {
        const v = p.scores[cat];
        const curCls = i === cur && !game.over ? " cur" : "";
        if (v !== undefined) return `<td class="${curCls}">${v}</td>`;
        if (i === cur && game.rolled && !game.over && !p.resigned) {
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
    drawDice();
    heldLabel.textContent = !game.rolled ? "컵을 꾹 눌러 흔들다 놓아 보세요" : game.rollsLeft === 0 ? "점수표에서 기록할 칸을 골라요" : "남길 주사위를 눌러 고정해요";
    cup.disabled = !myTurn() || game.rollsLeft === 0 || rolling.size > 0;
    if (!shaking) cup.textContent = game.rollsLeft === 3 ? "컵 흔들기" : `다시 던지기 (${game.rollsLeft}번 남음)`;
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

  return { el: root, apply, resign, render, destroy: () => clearInterval(shakeSound) };
}

export { CATEGORIES };
