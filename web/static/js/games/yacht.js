// 야추 다이스 화면: 최대 6명, 컵을 꾹 눌러 흔들다 놓으면 주사위가 쏟아져 나옴
import { YachtGame, UPPER, LOWER, CATEGORIES, CAT_NAMES, CAT_HELP, CAT_EXAMPLES, BONUS_NEED, BONUS, AI_BASE, score, rollDie, aiPickCategory, aiShouldStop, aiHolds } from "../engine/yacht.js";
import { avatarHtml, esc, dieSvg } from "../art.js";
import { el, confirmBox } from "../ui.js";
import { DiceTray } from "./dice_tray.js";

const AI_STEP_MS = 750;
const AI_SHAKE_MS = 650; // 컴퓨터도 잠깐 흔든 뒤 던짐
const TAP_SHAKE_MS = 420; // 버튼을 톡 누르면 이만큼 흔든 뒤 자동으로 던짐
const TAKEOVER_MS = 6000; // 차례인 사람의 연결이 이만큼 끊겨 있으면 컴퓨터가 대신 둠

export function create(m) {
  const game = new YachtGame(m.seats.map((s) => s.name), m.seats.map((s, i) => (s.ai ? i : -1)).filter((i) => i >= 0));
  let aiTimer = null;
  let shakeStart = null; // 내가 흔들기 시작한 시각
  let tapTimer = null;
  let remoteShake = null; // 다른 사람이 흔드는 중이면 안전장치 타이머
  let lastRec = null; // 방금 기록한 칸 (반짝 효과)

  m.root.classList.add("yacht-screen"); // 트레이 옆에 점수표가 오는 배치
  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="yacht-table">
      <div class="yacht-head">
        <div class="turn"></div>
        <div class="rolls" aria-label="남은 던지기"></div>
      </div>
      <div class="tray-slot"></div>
      <div class="yacht-actions"><button class="btn big pink cup-btn"></button><div class="quick" aria-label="추천 기록"></div></div>
      <div class="held-label"></div>
    </div></div>`);
  const side = el(`<div class="card score-card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">점수표</h3><span class="muted round" style="font-size:14px"></span></div><div class="score-wrap"></div></div>`);
  const turnEl = root.querySelector(".turn");
  const rollsEl = root.querySelector(".rolls");
  const heldLabel = root.querySelector(".held-label");
  const cup = root.querySelector(".cup-btn");
  const quick = root.querySelector(".quick");
  const scoreWrap = side.querySelector(".score-wrap");
  const roundEl = side.querySelector(".round");

  // 항복은 오른쪽 위(상단바), 채팅은 트레이 아래 왼쪽으로 옮겨서 한 화면에 깔끔하게
  const mySeatsLeft = () => m.mySeats.filter((i) => !game.players[i].resigned && !m.seats[i].ai);
  const resignMine = async () => {
    const mine = mySeatsLeft();
    if (!mine.length) return;
    const seat = m.mode === "local" ? (mine.includes(game.current) ? game.current : mine[0]) : mine[0];
    if (await confirmBox("항복", `${m.seats[seat].name} 님, 정말 항복할까요?`, "항복", "계속")) m.submit({ type: "resign" }, seat);
  };
  m.chat.root.classList.add("yacht-chat");
  m.root.querySelector(".game-layout").appendChild(m.chat.root);

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

  const pickCat = (ev) => {
    const help = ev.target.closest("[data-help]");
    if (help) { // 항목 이름을 누르면 설명 + 예시 주사위 말풍선 (한 번 더 누르면 닫힘)
      if (tip?.dataset.cat === help.dataset.help) hideTip();
      else showTip(help.dataset.help, help);
      return;
    }
    const cell = ev.target.closest("[data-pick]");
    if (!cell || !myTurn() || tray.isRolling()) return;
    hideTip();
    m.submit({ type: "record", cat: cell.dataset.pick }, game.current);
  };
  scoreWrap.addEventListener("click", pickCat);
  quick.addEventListener("click", pickCat);

  // ------------------------------------------------------------ 점수표 도움말 말풍선 (데스크톱판 show_tip 과 같은 내용)
  let tip = null;
  let tipTimer = null;
  const SPECIAL = {
    _bonus: ["보너스", `에이스~식스 점수의 합(소계)이 ${BONUS_NEED}점 이상이면 +${BONUS}점을 받아요. 각 숫자를 3개씩 모으면 딱 ${BONUS_NEED}점!`],
    _total: ["총점", "모든 칸 점수 + 보너스. 12칸을 다 채우면 총점이 가장 높은 사람이 이겨요."],
  };
  function showTip(cat, anchor) {
    hideTip();
    let html;
    if (SPECIAL[cat]) {
      html = `<b class="tip-title">${SPECIAL[cat][0]}</b><p>${esc(SPECIAL[cat][1])}</p>`;
    } else {
      const ex = CAT_EXAMPLES[cat];
      const p = game.players[game.current];
      const now = game.rolled && !game.over && !tray.isRolling() && p.scores[cat] === undefined
        ? `<div class="tip-now">지금 주사위로 기록하면 <b>${score(cat, game.dice)}점</b></div>` : "";
      html = `<b class="tip-title">${CAT_NAMES[cat]}</b><p>${esc(CAT_HELP[cat])}</p>
        <div class="tip-ex"><span class="tip-label">예시</span>${ex.map((v) => `<span class="tip-die">${dieSvg(v)}</span>`).join("")}<span class="tip-score">→ ${score(cat, ex)}점</span></div>${now}`;
    }
    tip = el(`<div class="yacht-tip" role="tooltip" data-cat="${cat}">${html}</div>`);
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    const sheet = scoreWrap.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    // 점수 칸을 가리지 않게 점수표 바깥 왼쪽에, 자리가 없으면(폰) 항목 바로 아래에
    let x = sheet.left - w - 12, y = r.top + window.scrollY - 8;
    if (x < 8) {
      x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      y = r.bottom + window.scrollY + 6;
    }
    y = Math.min(y, window.scrollY + window.innerHeight - h - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(window.scrollY + 8, y)}px`;
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tip?.remove();
    tip = null;
  }
  // 마우스는 올려 두기만 해도 잠깐 뒤에 보여 줌
  scoreWrap.addEventListener("pointerover", (ev) => {
    const help = ev.target.closest("[data-help]");
    if (ev.pointerType !== "mouse" || !help) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(help.dataset.help, help), 250);
  });
  scoreWrap.addEventListener("pointerout", (ev) => {
    if (ev.pointerType === "mouse" && ev.target.closest("[data-help]")) hideTip();
  });
  const outside = (ev) => { if (tip && !ev.target.closest("[data-help], .yacht-tip")) hideTip(); };
  document.addEventListener("pointerdown", outside);

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
  /**
   * 온라인에서 차례인 사람의 연결이 끊긴 지 TAKEOVER_MS가 지나면 방장 기기의 컴퓨터가 대신 둠
   * (데스크톱판과 같은 방식. 다시 들어오면 바로 자기 차례를 돌려받음)
   */
  const offlineSince = new Map();
  function takeover(seat) {
    if (!m.online || !m.isHost || !m.offline.has(seat) || m.controls(seat)) return false;
    const left = TAKEOVER_MS - (Date.now() - offlineSince.get(seat));
    if (left > 0) {
      if (!aiTimer) aiTimer = m.later(() => { aiTimer = null; render(); }, left + 50);
      return false;
    }
    return true;
  }
  const actFor = (seat, a) => (m.seats[seat].ai ? m.submit(a, seat) : m.submitAs(a, seat));

  function maybeAi() {
    if (game.over || m.result || aiTimer || tray.isRolling()) return;
    const seat = game.current;
    if (!m.seats[seat].ai && !takeover(seat)) return;
    const stillMine = () => !game.over && game.current === seat && (m.seats[seat].ai || m.offline.has(seat));
    const throwLater = () => {
      tray.setShaking(true, `${m.seats[seat].name} `);
      aiTimer = m.later(() => {
        aiTimer = null;
        tray.setShaking(false);
        if (!stillMine()) return;
        actFor(seat, { type: "roll", dice: [0, 1, 2, 3, 4].map(rollDie), power: 0.9 + Math.random() * 0.4 });
      }, AI_SHAKE_MS);
    };
    aiTimer = m.later(() => {
      aiTimer = null;
      if (!stillMine()) return;
      if (!game.rolled) throwLater();
      else if (game.rollsLeft > 0 && !aiShouldStop(game)) {
        const want = aiHolds(game);
        want.forEach((h, i) => { if (h !== game.held[i]) actFor(seat, { type: "hold", i }); });
        aiTimer = m.later(() => { aiTimer = null; throwLater(); }, 450); // 고정한 주사위가 칸으로 올라가는 걸 보여 줌
      } else {
        actFor(seat, { type: "record", cat: aiPickCategory(game, m.level) });
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
      lastRec = { seat, cat: a.cat };
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
  /**
   * 지금 주사위로 기록하기 좋은 칸 3개.
   * 점수가 나는 칸을 평소 기대 점수보다 얼마나 더 받는지(보너스 진행 포함)로 먼저 고르고,
   * 모자라면 0점으로 버려도 덜 아까운 칸(기대 점수가 낮은 칸)을 채움.
   */
  function suggestions() {
    const p = game.players[game.current];
    const open = CATEGORIES.filter((c) => p.scores[c] === undefined);
    const upper = YachtGame.upperSum(p);
    const gain = (c) => {
      let g = score(c, game.dice) - AI_BASE[c];
      if (UPPER.includes(c) && upper < BONUS_NEED) {
        const face = UPPER.indexOf(c) + 1;
        g += (game.dice.filter((d) => d === face).length - 3) * face * 0.5;
      }
      return g;
    };
    const scoring = open.filter((c) => score(c, game.dice) > 0).sort((a, b) => gain(b) - gain(a));
    const scrap = open.filter((c) => score(c, game.dice) === 0).sort((a, b) => AI_BASE[a] - AI_BASE[b]);
    return scoring.concat(scrap).slice(0, 3);
  }

  function drawScores() {
    const cur = game.current;
    const settled = game.rolled && !tray.isRolling() && !game.over;
    const canPick = myTurn() && settled;
    const best = canPick ? suggestions()[0] : null;
    const curCls = (i) => (i === cur && !game.over ? " cur" : "");
    const head = game.players.map((p, i) => {
      const baseTot = p.resigned ? "항복" : m.offline.has(i) ? "끊김" : `${game.total(p)}점`;
      const me = m.controls(i) && m.mode !== "local" ? " (나)" : "";
      const streak = m.streaks?.get(m.seats[i].cid) || 0;
      const tot = streak >= 2 && !p.resigned && !m.offline.has(i) ? `${game.total(p)}점 · ${streak}연승` : baseTot;
      return `<th class="${curCls(i)}${p.resigned ? " out" : ""}${m.offline.has(i) ? " off" : ""}" data-seat="${i}"><div class="th-av">${avatarHtml(m.seats[i].avatar, 28)}<span class="nm">${esc(p.name + me)}</span><span class="tot">${tot}</span></div></th>`;
    }).join("");
    const row = (cat) => {
      const cells = game.players.map((p, i) => {
        const v = p.scores[cat];
        if (v !== undefined) {
          const flash = lastRec && lastRec.seat === i && lastRec.cat === cat ? " flash" : "";
          return `<td class="${curCls(i)}${v === 0 ? " zero" : ""}${flash}">${v}</td>`;
        }
        if (i === cur && settled && !p.resigned) {
          const pv = score(cat, game.dice);
          if (!canPick) return `<td class="pv${curCls(i)}">${pv}</td>`;
          return `<td class="${curCls(i)}"><button class="pick${pv === 0 ? " nil" : ""}${cat === best ? " best" : ""}" data-pick="${cat}" aria-label="${CAT_NAMES[cat]}에 ${pv}점 기록">${pv}</button></td>`;
        }
        return `<td class="${curCls(i)}">${p.resigned ? "-" : ""}</td>`;
      }).join("");
      return `<tr><td class="cat"><button data-help="${cat}" title="${esc(CAT_HELP[cat])}">${CAT_NAMES[cat]}</button></td>${cells}</tr>`;
    };
    const bonusCell = (p, i) => {
      const sum = YachtGame.upperSum(p);
      const pct = Math.min(100, Math.round((sum / BONUS_NEED) * 100));
      return `<td class="${curCls(i)}"><div class="bonus-bar${sum >= BONUS_NEED ? " done" : ""}"><i style="width:${pct}%"></i></div><span class="bonus-num">${sum >= BONUS_NEED ? `+${BONUS}` : `${sum}/${BONUS_NEED}`}</span></td>`;
    };
    scoreWrap.innerHTML = `<table class="score"><thead><tr><th class="cat-h">항목</th>${head}</tr></thead><tbody>
      ${UPPER.map(row).join("")}
      <tr class="sum"><td class="cat"><button data-help="_bonus">보너스 <span class="hint">63↑ +35</span></button></td>${game.players.map(bonusCell).join("")}</tr>
      ${LOWER.map(row).join("")}
      <tr class="total"><td class="cat"><button data-help="_total">총점</button></td>${game.players.map((p, i) => `<td class="${curCls(i)}">${game.total(p)}</td>`).join("")}</tr></tbody></table>`;
    lastRec = null; // 반짝임은 한 번만
  }

  function render() {
    for (const i of m.offline) if (!offlineSince.has(i)) offlineSince.set(i, Date.now());
    for (const i of [...offlineSince.keys()]) if (!m.offline.has(i)) offlineSince.delete(i);
    const p = game.players[game.current];
    const rolling = tray.isRolling();
    const ai = m.seats[game.current].ai || m.offline.has(game.current);
    roundEl.textContent = game.over ? "끝" : `${game.round} / 12 라운드`;
    if (game.over || m.result) {
      turnEl.innerHTML = `<span class="who">${esc(m.result ? m.result.title : "게임 끝")}</span>`;
      turnEl.classList.remove("mine");
    } else {
      const who = myTurn() ? (m.mode === "local" ? `${p.name} 차례` : "내 차례!") : `${p.name} 님 차례${m.offline.has(game.current) ? " · 연결 끊김 (컴퓨터가 대신)" : ai ? " · 컴퓨터" : ""}`;
      turnEl.innerHTML = `${avatarHtml(m.seats[game.current].avatar, 30)}<span class="who">${esc(who)}</span>`;
      turnEl.classList.toggle("mine", myTurn());
    }
    rollsEl.innerHTML = `<span>던지기</span>${[0, 1, 2].map((k) => `<i class="${k < game.rollsLeft ? "on" : ""}"></i>`).join("")}`;
    tray.sync(game.dice, game.held, game.rolled);
    if (m.replaying) tray.settleInstant(game.dice);

    // 컵 버튼 + 추천 기록
    cup.disabled = !myTurn() || game.rollsLeft === 0 || rolling;
    if (shakeStart === null) {
      cup.innerHTML = !myTurn() ? `${esc(p.name)} 님 차례` : game.rollsLeft === 0 ? "점수를 골라요" : `${game.rollsLeft === 3 ? "컵 흔들기" : "다시 던지기"} <kbd>Space</kbd>`;
    }
    const canPick = myTurn() && game.rolled && !rolling && !game.over;
    quick.innerHTML = canPick ? suggestions().map((c, k) => {
      const v = score(c, game.dice);
      return `<button class="chip${k === 0 ? " best" : ""}${v === 0 ? " nil" : ""}" data-pick="${c}">${CAT_NAMES[c]} <b>${v}</b></button>`;
    }).join("") : "";
    quick.hidden = !canPick;

    heldLabel.textContent = rolling ? "데구르르..." : game.over ? "" : !game.rolled ? (myTurn() ? "컵이나 버튼을 꾹 누르면 흔들고, 놓으면 던져요" : "") :
      myTurn() ? (game.rollsLeft === 0 ? "기록할 칸을 골라요 · 점수표에서 다른 칸도 고를 수 있어요" : "남길 주사위를 누르면 위 칸에 고정돼요 · 바로 기록해도 돼요") : "";
    drawScores();
    m.setTopActions(mySeatsLeft().length && !game.over && !m.result ? [{ label: "항복", onClick: resignMine }] : []);
    maybeAi();
  }

  return {
    el: root, sideEl: side, apply, resign, render, onFx,
    destroy: () => {
      clearTimeout(tapTimer);
      clearTimeout(remoteShake);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerdown", outside);
      hideTip();
      tray.destroy();
    },
  };
}

export { CATEGORIES };
