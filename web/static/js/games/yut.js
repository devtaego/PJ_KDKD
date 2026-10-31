// 특수능력 윷놀이 화면: 2~4명, 한 기기 또는 온라인 (컴퓨터 대전 없음)
import { YutGame, START, HOME, CENTER, RESULT_NAMES, pathFrom } from "../engine/yut.js";
import { ABILITY_BY_ID, TIERS, ABILITY_TILES, abilityOdds, THROW_ODDS } from "../data/yut_abilities.js";
import { seatCard } from "../match.js";
import { el, confirmBox, modal } from "../ui.js";
import { esc } from "../art.js";

export const PLAYER_COLORS = ["#FF5C8A", "#4DABF7", "#FFC94D", "#3DDC97"];
export const MODES = { basic: "기본", special: "특수능력", chaos: "개막장" };

/** 판의 칸 좌표 (0~100) */
const POS = (() => {
  const p = {};
  const lo = 10, hi = 90, step = 16;
  p[0] = [hi, hi];
  for (let k = 1; k <= 4; k++) p[k] = [hi, hi - step * k];
  p[5] = [hi, lo];
  for (let k = 6; k <= 9; k++) p[k] = [hi - step * (k - 5), lo];
  p[10] = [lo, lo];
  for (let k = 11; k <= 14; k++) p[k] = [lo, lo + step * (k - 10)];
  p[15] = [lo, hi];
  for (let k = 16; k <= 19; k++) p[k] = [lo + step * (k - 15), hi];
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const c = [50, 50];
  p[20] = lerp(p[5], c, 1 / 3); p[21] = lerp(p[5], c, 2 / 3); p[22] = c;
  p[23] = lerp(c, p[15], 1 / 3); p[24] = lerp(c, p[15], 2 / 3);
  p[25] = lerp(p[10], c, 1 / 3); p[26] = lerp(p[10], c, 2 / 3);
  p[27] = lerp(c, p[0], 1 / 3); p[28] = lerp(c, p[0], 2 / 3);
  return p;
})();
const BIG = new Set([0, 5, 10, 15, CENTER]);
// 윷가락 4개의 평평한 면 개수 (빽도는 표시가 있는 첫 가락만 평평)
const FLATS = { "-1": [1, 0, 0, 0], 1: [0, 1, 0, 0], 2: [1, 1, 0, 0], 3: [1, 1, 1, 0], 4: [1, 1, 1, 1], 5: [0, 0, 0, 0] };

export function create(m) {
  const pieces = Number(m.settings.pieces) || 3;
  const mode = MODES[m.settings.chaos] ? m.settings.chaos : "special";
  const game = new YutGame(m.seats.map((s) => s.name), { pieces, mode });
  let selRes = 0;
  let targeting = null; // { hand, def, own? }
  let hover = null;
  let tossing = false;

  m.root.classList.add("yut-screen");
  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip yut-seats"></div>
    <div class="yut-stage">
      <div class="yut-board" role="img" aria-label="윷판"></div>
      <div class="yut-fx" aria-live="polite"></div>
    </div>
    <div class="yut-panel">
      <div class="yut-throw">
        <div class="sticks"></div>
        <div class="yut-actions"><button class="btn big pink throw-btn"></button><div class="results"></div></div>
      </div>
      <div class="yut-hint"></div>
      <div class="hand"></div>
    </div></div>`);
  const side = el(`<div class="card yut-log-card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">진행 상황</h3><button class="btn ghost small odds-btn">확률표</button></div>
    <div class="muted mode-line" style="font-size:13px;margin-bottom:6px"></div><div class="yut-log"></div></div>`);
  const seatsEl = root.querySelector(".yut-seats");
  const boardEl = root.querySelector(".yut-board");
  const fxEl = root.querySelector(".yut-fx");
  const sticksEl = root.querySelector(".sticks");
  const throwBtn = root.querySelector(".throw-btn");
  const resultsEl = root.querySelector(".results");
  const hintEl = root.querySelector(".yut-hint");
  const handEl = root.querySelector(".hand");
  const logEl = side.querySelector(".yut-log");
  side.querySelector(".mode-line").textContent = `${MODES[mode]} 모드 · 말 ${pieces}개씩${mode !== "basic" ? " · ★ 칸에 멈추면 능력 카드" : ""}`;
  side.querySelector(".odds-btn").onclick = () => showOdds(mode);

  const myTurn = () => !game.over && !m.result && m.controls(game.current);
  const seed = () => Math.floor(Math.random() * 2 ** 31); // 온라인에서는 서버가 덮어씀
  const act = (a) => m.submit({ ...a, seed: seed() }, game.current);

  // ------------------------------------------------------------ 입력
  throwBtn.onclick = () => { if (myTurn() && game.phase === "throw" && !tossing) act({ type: "throw" }); };
  const onKey = (e) => {
    if (e.code !== "Space" || e.target.closest?.("input, textarea") || document.querySelector(".modal-back")) return;
    e.preventDefault();
    throwBtn.click();
  };
  document.addEventListener("keydown", onKey);

  resultsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (b) { selRes = +b.dataset.res; render(); }
  });

  handEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hand]");
    if (!b || !myTurn() || game.usedAbility) return;
    const idx = +b.dataset.hand;
    const def = ABILITY_BY_ID[game.players[game.current].hand[idx]];
    if (targeting?.hand === idx) { targeting = null; render(); return; }
    if (def.target === "none" || def.target === "nextPlayer") { targeting = null; act({ type: "ability", hand: idx, t: {} }); return; }
    targeting = { hand: idx, def };
    render();
  });

  boardEl.addEventListener("click", (e) => {
    if (!myTurn()) return;
    const pc = e.target.closest("[data-seat]");
    const nd = e.target.closest("[data-node]");
    const seat = pc ? +pc.dataset.seat : null, idx = pc ? +pc.dataset.idx : null;
    if (targeting) {
      const tg = targeting.def.target;
      if (tg === "oppPiece" && pc && seat !== game.current) act({ type: "ability", hand: targeting.hand, t: { opp: { seat, idx } } });
      else if (tg === "ownPiece" && pc && seat === game.current) act({ type: "ability", hand: targeting.hand, t: { own: idx } });
      else if (tg === "node" && nd && !pc) act({ type: "ability", hand: targeting.hand, t: { node: +nd.dataset.node } });
      else if (tg === "swap") {
        if (targeting.own === undefined && pc && seat === game.current) { targeting.own = idx; render(); return; }
        if (targeting.own !== undefined && pc && seat !== game.current) act({ type: "ability", hand: targeting.hand, t: { own: targeting.own, opp: { seat, idx } } });
        else return;
      } else return;
      targeting = null;
      return;
    }
    if (game.phase === "move" && pc && seat === game.current) act({ type: "move", piece: idx, res: Math.min(selRes, game.pending.length - 1) });
  });
  boardEl.addEventListener("pointerover", (e) => {
    const pc = e.target.closest("[data-seat]");
    const h = pc && +pc.dataset.seat === game.current ? +pc.dataset.idx : null;
    if (h !== hover) { hover = h; drawBoard(); }
  });

  // 출발 전 말 올리기 (판에 말이 없을 때 누를 곳)
  seatsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-enter]");
    if (!b || !myTurn()) return;
    const p = game.players[game.current];
    const i = p.pieces.findIndex((q) => q.node === START);
    if (i < 0) return;
    if (targeting?.def.target === "ownPiece" && ["gazua", "yeongkkeul"].includes(targeting.def.id)) {
      act({ type: "ability", hand: targeting.hand, t: { own: i } });
      targeting = null;
    } else if (game.phase === "move") act({ type: "move", piece: i, res: Math.min(selRes, game.pending.length - 1) });
  });

  // ------------------------------------------------------------ 행동 적용
  function apply(a, at, seat) {
    if (game.over || seat !== game.current) return;
    const sd = Number.isInteger(a.seed) ? a.seed : 0;
    let ok = false;
    if (a.type === "throw") ok = game.throw(sd);
    else if (a.type === "move" && Number.isInteger(a.piece) && Number.isInteger(a.res)) ok = game.move(a.piece, a.res, sd);
    else if (a.type === "ability" && Number.isInteger(a.hand)) ok = game.use(a.hand, a.t || {}, sd);
    if (!ok) return;
    selRes = 0;
    targeting = null;
    if (!m.replaying) playEvents();
    if (game.over) end();
  }

  function resign(seat) {
    game.resign(seat);
    if (game.over) end();
  }

  function end() {
    const order = game.ranking();
    const winners = game.winner !== null ? [game.winner] : [];
    const losers = order.length > 1 ? [order[order.length - 1]].filter((i) => !winners.includes(i)) : [];
    const scores = Object.fromEntries(order.map((i) => [i, `${game.finished(i)}/${pieces} 도착`]));
    m.finish({ title: winners.length ? `${m.seats[winners[0]].name} 승리!` : "게임 끝", sub: `${MODES[mode]} 윷놀이`, winners, losers, order, scores, moves: game.turnNo });
  }

  // ------------------------------------------------------------ 연출
  // 한꺼번에 여러 개 터지면 겹치지 않게 0.7초 간격으로 차례차례
  let shoutFree = 0;
  function shout(text, cls = "", label = "") {
    const now = Date.now(), at = Math.max(now, shoutFree);
    shoutFree = at + 700;
    setTimeout(() => {
      const s = el(`<div class="yut-shout ${cls}">${label ? `<small>${esc(label)}</small>` : ""}<span></span></div>`);
      s.querySelector("span").textContent = text;
      fxEl.appendChild(s);
      setTimeout(() => s.remove(), 1600);
    }, at - now);
  }

  function playEvents() {
    for (const e of game.events) {
      if (e.kind === "throw") {
        tossing = true;
        m.sfx("roll");
        drawSticks(e.value, true);
        m.later(() => { tossing = false; shout(RESULT_NAMES[e.value], e.value >= 4 ? "good" : e.value === -1 ? "bad" : ""); render(); }, 650);
      } else if (e.kind === "move") m.sfx("move");
      else if (e.kind === "catch") { m.sfx("thud"); shout("잡았다!", "good"); }
      else if (e.kind === "boom") { m.sfx("thud"); shout("펑!!", "bad"); }
      else if (e.kind === "home") { m.sfx("pop"); shout("도착!", "good"); }
      else if (e.kind === "draw") { m.sfx("pop"); if (m.controls(e.seat) || m.mode === "local") shout(`카드 획득: ${ABILITY_BY_ID[e.id].name}`, `tier-${ABILITY_BY_ID[e.id].tier}`); }
      else if (e.kind === "ability") {
        const d = ABILITY_BY_ID[e.id];
        m.sfx("pop");
        shout(d.shout, `tier-${d.tier} big`, `${TIERS[d.tier].name} · ${d.name}`);
        if (d.tier === "legend") { root.classList.remove("shake"); void root.offsetWidth; root.classList.add("shake"); }
      } else if (e.kind === "blocked") shout("어쩔티비~ 막았다!", "good");
      else if (e.kind === "coin") shout(e.heads ? "앞면! 가즈아!!" : "뒷면… 출발점으로", e.heads ? "good" : "bad");
    }
  }

  function showOdds(md) {
    const rows = md === "basic" ? "<p class=\"muted\">기본 모드는 능력이 없어요.</p>" : `<table class="rank odds"><thead><tr><th>등급</th><th>능력</th><th>확률</th></tr></thead><tbody>${abilityOdds(md).map((a) =>
      `<tr><td><span class="tier-dot" style="background:${TIERS[a.tier].color}"></span>${TIERS[a.tier].name}</td><td style="text-align:left"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.desc)}</div></td><td>${a.pct.toFixed(1)}%</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:13px">꼴찌는 희귀 × 1.5, 전설 × 2 로 더 잘 나와요. 카드는 최대 2장까지 들고, 한 차례에 1장만 써요.</p>`;
    const throws = THROW_ODDS.map((o) => `${o.name} ${Math.round(o.p * 100)}%`).join(" · ");
    modal(`${MODES[md]} 모드 확률표`, el(`<div><p class="muted" style="margin-top:0">윷 결과: ${throws}</p>${rows}</div>`));
  }

  // ------------------------------------------------------------ 그리기
  function drawSticks(value, toss) {
    const flats = FLATS[value] ?? [0, 0, 0, 0];
    sticksEl.innerHTML = flats.map((f, i) => `<div class="stick ${f ? "flat" : "round"}${toss ? " toss" : ""}" style="--d:${i * 60}ms;--r:${(i - 1.5) * 9}deg">${f && i === 0 ? "<i class=\"mark\"></i>" : ""}${f ? "<b></b><b></b><b></b>" : ""}</div>`).join("");
  }

  function drawBoard() {
    const tiles = new Set(game.abilitiesOn ? ABILITY_TILES[mode] : []);
    const parts = [];
    const line = (a, b) => parts.push(`<line x1="${POS[a][0]}" y1="${POS[a][1]}" x2="${POS[b][0]}" y2="${POS[b][1]}"/>`);
    parts.push(`<rect x="2" y="2" width="96" height="96" rx="6" class="yb-bg"/>`);
    parts.push(`<g class="yb-lines">`);
    line(0, 5); line(5, 10); line(10, 15); line(15, 0); line(5, 15); line(10, 0);
    parts.push(`</g>`);
    // 다음에 갈 칸 미리 보기
    let preview = null;
    if (myTurn() && game.phase === "move" && hover !== null && game.pending.length) {
      const pc = game.players[game.current].pieces[hover];
      preview = pc ? game.destOf(pc, game.pending[Math.min(selRes, game.pending.length - 1)]) : null;
    }
    for (let n = 0; n <= 28; n++) {
      const [x, y] = POS[n];
      const r = BIG.has(n) ? 4.6 : 3.1;
      const cls = ["yb-node"];
      if (tiles.has(n)) cls.push("tile");
      if (preview === n) cls.push("preview");
      if (targeting?.def.target === "node") cls.push("pickable");
      parts.push(`<g data-node="${n}"><circle cx="${x}" cy="${y}" r="${r}" class="${cls.join(" ")}"/>${tiles.has(n) ? `<text x="${x}" y="${y + 1.4}" class="yb-star">★</text>` : ""}${n === 0 ? `<text x="${x}" y="${y + 1.2}" class="yb-label">출발</text>` : ""}</g>`);
    }
    for (const [node, owner] of Object.entries(game.bombs)) {
      const [x, y] = POS[node];
      parts.push(`<g class="yb-bomb"><circle cx="${x}" cy="${y + 0.5}" r="2.6" fill="#1E1B18" stroke="${PLAYER_COLORS[owner]}" stroke-width="0.6"/><path d="M${x + 1.4} ${y - 1.6} q1.5 -2 3 -1" stroke="#C9A36B" stroke-width="0.6" fill="none"/><circle cx="${x + 4.4}" cy="${y - 2.6}" r="0.8" fill="#FF8A3D"/></g>`);
    }
    // 말: 칸마다 주인별로 묶어서
    const byNode = {};
    game.players.forEach((p, s) => p.pieces.forEach((pc, i) => {
      if (pc.node === START || pc.node === HOME) return;
      ((byNode[pc.node] ||= {})[s] ||= []).push(i);
    }));
    for (const [node, owners] of Object.entries(byNode)) {
      const list = Object.entries(owners);
      list.forEach(([s, idxs], k) => {
        const [x, y] = POS[node];
        const off = list.length > 1 ? (k - (list.length - 1) / 2) * 4.2 : 0;
        const seat = +s;
        const mine = myTurn() && seat === game.current;
        const pickable = targeting && ((targeting.def.target === "oppPiece" && seat !== game.current) || (targeting.def.target === "ownPiece" && mine) ||
          (targeting.def.target === "swap" && (targeting.own === undefined ? mine : seat !== game.current)));
        const sh = game.players[seat].pieces[idxs[0]].shield >= game.turnNo;
        parts.push(`<g data-seat="${seat}" data-idx="${idxs[0]}" class="yb-piece${mine && game.phase === "move" && !targeting ? " movable" : ""}${pickable ? " pickable" : ""}" transform="translate(${x + off} ${y - 1})">
          ${sh ? `<circle r="5.2" class="yb-shield"/>` : ""}<circle r="3.6" fill="${PLAYER_COLORS[seat]}" class="yb-token"/><circle r="1.4" cx="-1" cy="-1.2" fill="rgba(255,255,255,0.55)"/>
          ${idxs.length > 1 ? `<text y="1.4" class="yb-count">${idxs.length}</text>` : ""}</g>`);
      });
    }
    boardEl.innerHTML = `<svg viewBox="0 0 100 100">${parts.join("")}</svg>`;
    boardEl.classList.toggle("upside", game.upside !== null && game.upside === game.current && m.controls(game.current));
  }

  function render() {
    // 자리 카드: 도착 수 · 대기 말 · 카드 수
    seatsEl.innerHTML = game.players.map((p, i) => {
      const waiting = p.pieces.filter((q) => q.node === START).length;
      const fin = game.finished(i);
      const turn = !game.over && !m.result && game.current === i;
      const canEnter = turn && myTurn() && waiting > 0 && (game.phase === "move" && game.pending.some((r) => r > 0) ||
        (targeting && ["gazua", "yeongkkeul"].includes(targeting.def.id)));
      const extra = `<span class="yut-dots">${Array.from({ length: pieces }, (_, k) => `<i style="background:${k < fin ? PLAYER_COLORS[i] : "transparent"};border-color:${PLAYER_COLORS[i]}"></i>`).join("")}</span>${canEnter ? `<button class="btn small primary" data-enter="1">새 말 올리기</button>` : ""}`;
      const flags = [`대기 ${waiting}`, `도착 ${fin}/${pieces}`];
      if (game.abilitiesOn) flags.push(`카드 ${p.hand.length}`);
      if (p.ward) flags.push("어쩔티비 준비");
      if (p.resigned) flags.push("기권");
      return seatCard(m, i, { sub: flags.join(" · "), turn, extra });
    }).join("");
    seatsEl.querySelectorAll(".person").forEach((c, i) => c.style.setProperty("--pc", PLAYER_COLORS[i]));

    const p = game.players[game.current];
    drawBoard();
    if (!tossing) drawSticks(game.lastThrow ?? 4, false);
    // 던지기 버튼과 결과 칩
    const mine = myTurn();
    throwBtn.disabled = game.over || !mine || game.phase !== "throw" || tossing;
    throwBtn.innerHTML = game.over ? "게임 끝" : !mine ? `${esc(p.name)} 님 차례` : game.phase === "throw" ? `윷 던지기${game.throws > 1 ? ` ×${game.throws}` : ""} <kbd>Space</kbd>` : "말을 골라 옮겨요";
    resultsEl.innerHTML = game.pending.map((r, i) => `<button class="res-chip${i === Math.min(selRes, game.pending.length - 1) ? " on" : ""}${r === -1 ? " back" : ""}" data-res="${i}">${RESULT_NAMES[r]}</button>`).join("");
    // 안내
    if (game.over || m.result) hintEl.textContent = m.result ? m.result.title : "";
    else if (targeting) {
      const t = targeting.def.target;
      hintEl.textContent = `「${targeting.def.name}」 ${t === "oppPiece" ? "상대 말을 눌러요" : t === "ownPiece" ? "내 말을 눌러요" : t === "node" ? "폭탄을 놓을 빈칸을 눌러요" : targeting.own === undefined ? "먼저 내 말을 눌러요" : "바꿀 상대 말을 눌러요"} · 카드를 다시 누르면 취소`;
    } else if (!mine) hintEl.textContent = `${p.name} 님 차례${game.phase === "move" ? " · 말 옮기는 중" : ""}`;
    else if (game.phase === "throw") hintEl.textContent = game.pending.length ? "한 번 더 던져요!" : "윷을 던져요 (능력 카드는 언제든 한 장)";
    else hintEl.textContent = "결과를 고르고 옮길 말을 눌러요 (같은 칸의 내 말은 업혀서 같이 가요)";
    // 능력 카드
    if (game.abilitiesOn) {
      const showHand = m.mode === "local" ? p.hand : (m.mySeats.length ? game.players[m.mySeats[0]].hand : []);
      handEl.innerHTML = showHand.length ? showHand.map((id, i) => {
        const d = ABILITY_BY_ID[id];
        const usable = mine && !game.usedAbility && (m.mode === "local" || m.mySeats[0] === game.current);
        return `<button class="ability-card tier-${d.tier}${targeting?.hand === i ? " on" : ""}" data-hand="${i}" ${usable ? "" : "disabled"} style="--tier:${TIERS[d.tier].color}">
          <span class="ac-tier">${TIERS[d.tier].name}</span><span class="ac-name">${esc(d.name)}</span><span class="ac-desc">${esc(d.desc)}</span></button>`;
      }).join("") : `<div class="muted hand-empty">★ 칸에 멈추면 능력 카드를 받아요 (최대 2장)</div>`;
    } else handEl.innerHTML = "";
    // 기록
    logEl.innerHTML = game.log.slice(-9).map((l) => `<div class="yl yl-${l.kind}">${esc(l.text)}</div>`).join("");
    logEl.scrollTop = logEl.scrollHeight;
    m.setTopActions(m.mySeats.length && !game.over && !m.result ? [{ label: "기권", onClick: resignMine }] : []);
  }

  async function resignMine() {
    const seat = m.mode === "local" ? game.current : m.mySeats[0];
    if (await confirmBox("기권", `${m.seats[seat].name} 님, 정말 기권할까요?`, "기권", "계속")) m.submit({ type: "resign" }, seat);
  }

  drawSticks(4, false);
  return { el: root, sideEl: side, apply, resign, render, destroy: () => document.removeEventListener("keydown", onKey) };
}
