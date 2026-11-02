// 윷놀이 화면: 2~4명, 한 기기 또는 온라인 (컴퓨터 대전 없음)
// 판은 위에서 내려다본 정사각형(출발은 오른쪽 아래), 말은 서 있는 캐릭터. 대기 말은 판 위아래에 두고 눌러서 올림
// 윷은 판 위로 크게 던져서 떨어지고, 아래에는 결과만 작게
import { YutGame, START, HOME, CENTER, RESULT_NAMES, pathFrom } from "../engine/yut.js";
import { ABILITY_BY_ID, TIERS, START_HAND, abilityOdds, THROW_ODDS } from "../data/yut_abilities.js";
import { el, confirmBox, modal } from "../ui.js";
import { esc } from "../art.js";
import { CHARACTERS, CHAR_IDS, charSvg } from "./yut_chars.js";
import { animateYutToss } from "./yut_toss.js";

export const PLAYER_COLORS = ["#FF5C8A", "#4DABF7", "#FFC94D", "#3DDC97"];
export const MODES = { basic: "기본", special: "특수능력", chaos: "막장" };
const ABILITY_NOTE_MS = 4500; // 쓴 능력 카드 설명이 떠 있는 시간 (읽을 시간을 넉넉히)

/** 판의 칸 좌표 (위에서 내려다본 0~100 정사각형) */
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
// 화면 좌표: 위에서 내려다본 정사각형 그대로 (가로세로 같은 배율)
const SX = 1.5, SY = 1.5, CX = 100, CY = 104;
const proj = (x, y) => [CX + (x - 50) * SX, CY + (y - 50) * SY];
const SP = Object.fromEntries(Object.entries(POS).map(([n, [x, y]]) => [n, proj(x, y)]));
const BIG = new Set([0, 5, 10, 15, CENTER]);
// 대기 말 자리 (판 위아래 띠): 0 왼쪽 아래, 1 오른쪽 아래, 2 오른쪽 위, 3 왼쪽 위
const DOCKS = [[10, 202], [118, 202], [118, 24], [10, 24]];
// 윷가락 4개의 평평한 면 개수 (빽도는 표시가 있는 첫 가락만 평평)
const FLATS = { "-1": [1, 0, 0, 0], 1: [0, 1, 0, 0], 2: [1, 1, 0, 0], 3: [1, 1, 1, 0], 4: [1, 1, 1, 1], 5: [0, 0, 0, 0] };

/** #RRGGBB 색을 밝게(+) / 어둡게(-) */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export function create(m) {
  const pieces = Number(m.settings.pieces) || 3;
  const mode = MODES[m.settings.chaos] ? m.settings.chaos : "special";
  const seatNames = m.seats.map((seat, i) => {
    const name = typeof seat?.name === "string" ? seat.name.trim() : !Array.isArray(seat?.name) && typeof seat?.name?.name === "string" ? seat.name.name.trim() : "";
    return name && !name.includes("[object Object]") ? name.slice(0, 12) : `플레이어 ${i + 1}`;
  });
  const game = new YutGame(seatNames, { pieces, mode, seed: Number(m.settings.seed) || 1, teams: m.settings.team === "1" });
  const seatDocks = seatNames.length === 2 || game.teams ? [DOCKS[3], DOCKS[2]] : DOCKS;
  const TEAM_NAMES = ["A팀", "B팀"];
  const teamOf = (i) => TEAM_NAMES[i % 2];
  // 온라인은 대기실에서 미리 고른 말을 사용하고, 한 기기 모드는 게임 시작 때 직접 고름
  const skins = m.seats.map((s, i) => CHAR_IDS.has(s.avatar) ? s.avatar : CHARACTERS[i % CHARACTERS.length].id);
  let sel = null; // 고른 말 번호 (업힌 말은 맨 앞 번호)
  let selOwner = null; // 고른 말의 주인 (팀전에서 내 말이 다 들어오면 같은 팀 말을 옮김)
  let targeting = null; // { hand, def, own? }
  let tossing = false;
  let tossingSeat = null;
  let tossCancel = null;
  let dealing = game.abilitiesOn && !m.replaying && (m.mode === "local" || m.mySeats.length > 0);
  let dealStarted = false;
  let dealInterval = null;
  let dealModalClose = null;
  let skipCardRoulette = null;
  // 지금 움직이는 말 { seat, node, count, victims }: 그동안 옮긴 말만 숨기고(도착 칸에 원래 있던 내 말은 그대로),
  // 잡힌 말은 잡는 말이 도착할 때까지 그 칸에 남겨 둠. 유령 말이 길을 따라 콩콩
  let anim = null;
  const pickSent = {}; // 자리 -> 고른 걸 보낸 시각 (온라인에서 답이 오기 전에 창이 다시 뜨지 않게)

  m.root.classList.add("yut-screen");
  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="yut-stage">
      <div class="yut-board" role="img" aria-label="윷판"></div>
      <svg class="yut-ghost" viewBox="0 0 200 208" aria-hidden="true"></svg>
      <div class="yut-toss" aria-hidden="true"></div>
      <div class="yut-fx" aria-live="polite"></div>
    </div>
    <div class="yut-panel">
      <div class="yut-turn-status" aria-live="polite"></div>
      <div class="yut-throw">
        <button class="btn big pink throw-btn"></button>
        <div class="yut-result"><span class="muted">나온 결과</span><div class="results"></div></div>
      </div>
      <div class="yut-hint"></div>
      ${game.abilitiesOn ? `<div class="hand-header"><strong>시작 능력 카드</strong><span>카드는 한 줄로 넘겨 볼 수 있어요</span></div>` : ""}
      <div class="hand"></div>
    </div></div>`);
  const side = el(`<div class="card yut-log-card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">진행 상황</h3><button class="btn ghost small odds-btn">확률표</button></div>
    <div class="muted mode-line" style="font-size:13px;margin-bottom:6px"></div><div class="yut-log"></div></div>`);
  const sideStack = el(`<div class="yut-side-stack"><section class="card yut-player-card-list"><h3>참가자</h3><div class="yut-player-cards"></div></section></div>`);
  const playerCardsEl = sideStack.querySelector(".yut-player-cards");
  const controlPanel = root.querySelector(".yut-panel");
  controlPanel.classList.add("card", "yut-control-card");
  sideStack.append(controlPanel, side);
  const boardEl = root.querySelector(".yut-board");
  const fxEl = root.querySelector(".yut-fx");
  const tossEl = root.querySelector(".yut-toss");
  const ghostEl = root.querySelector(".yut-ghost");
  const throwBtn = sideStack.querySelector(".throw-btn");
  const turnStatusEl = sideStack.querySelector(".yut-turn-status");
  const resultsEl = sideStack.querySelector(".results");
  const hintEl = sideStack.querySelector(".yut-hint");
  const handEl = sideStack.querySelector(".hand");
  const logEl = side.querySelector(".yut-log");
  side.querySelector(".mode-line").textContent = `${MODES[mode]} 모드${game.teams ? ` · 2:2 팀전 (A팀 ${seatNames[0]} · ${seatNames[2]} / B팀 ${seatNames[1]} · ${seatNames[3]})` : ""} · ${game.teams ? "팀마다 말" : "말"} ${game.pieceCount}개${game.teams ? "" : "씩"}${mode !== "basic" ? ` · 시작할 때 ${game.teams ? "팀마다 " : ""}능력 카드 ${START_HAND[mode]}장` : ""}`;
  side.querySelector(".odds-btn").onclick = () => showOdds(mode);

  const myTurn = () => !game.over && !m.result && m.controls(game.current);
  const seed = () => Math.floor(Math.random() * 2 ** 31); // 온라인에서는 서버가 덮어씀
  const act = (a) => { if (tossing || anim) return; m.submit({ ...a, seed: seed() }, game.current); };
  const cur = () => game.players[game.current];
  const firstWaiting = (s = game.current) => game.players[s].pieces.findIndex((q) => q.node === START);

  const canMoveOwner = (s2) => game.ally(game.current, s2);
  /** 이 말로 갈 수 있는 칸 → 쓸 결과 번호들 */
  function destinations(idx, owner = game.current) {
    const out = new Map();
    if (!canMoveOwner(owner)) return out;
    const pc = game.players[owner].pieces[idx];
    if (!pc) return out;
    game.pending.forEach((r, i) => {
      const d = game.destOf(pc, r);
      if (d !== null) { if (!out.has(d)) out.set(d, []); out.get(d).push(i); }
    });
    return out;
  }
  /** 옮길 수 있는 말 묶음 [주인, 대표 번호] (칸마다 하나, 대기 말은 주인마다 하나로) */
  function movableGroups() {
    const seen = new Set(), out = [];
    for (const o of game.movers(game.current)) {
      game.players[o].pieces.forEach((pc, i) => {
        const key = pc.node === START ? `S${o}` : pc.node;
        if (pc.node === HOME || seen.has(key)) return;
        seen.add(key);
        if (destinations(i, o).size) out.push([o, i]);
      });
    }
    return out;
  }
  /** 고른 말이 아직 쓸 수 있는지 보고, 고를 게 하나뿐이면 저절로 고름 */
  function fixSelection() {
    if (tossing || anim || !myTurn() || game.phase !== "move" || targeting) { sel = null; selOwner = null; return; }
    if (sel !== null && !destinations(sel, selOwner).size) sel = null;
    if (sel === null) {
      const g = movableGroups();
      if (g.length === 1) [selOwner, sel] = g[0];
    }
  }

  // ------------------------------------------------------------ 입력
  throwBtn.onclick = () => { if (myTurn() && game.phase === "throw" && !tossing) act({ type: "throw" }); };
  resultsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (b && !anim && !tossing && myTurn() && game.phase === "move" && sel !== null) act({ type: "move", piece: sel, res: +b.dataset.res, owner: selOwner });
  });
  const onKey = (e) => {
    if (e.code === "Escape" && dealing && skipCardRoulette) {
      e.preventDefault();
      e.stopImmediatePropagation();
      skipCardRoulette();
      return;
    }
    if (e.target.closest?.("input, textarea") || document.querySelector(".modal-back")) return;
    const canMoveNow = sel !== null && !tossing && !anim && !targeting && myTurn() && game.phase === "move";
    const digit = /^Digit([1-9])$/.exec(e.code); // 숫자키: 고른 말을 N번째 결과로 옮기기
    if (digit && canMoveNow) {
      const res = +digit[1] - 1;
      if ([...destinations(sel, selOwner).values()].flat().includes(res)) act({ type: "move", piece: sel, res, owner: selOwner });
      return;
    }
    if (e.code !== "Space") return;
    e.preventDefault();
    if (canMoveNow) { // 스페이스: 갈 곳이 하나뿐이면 바로 옮김
      const ds = [...destinations(sel, selOwner).values()];
      if (ds.length === 1) act({ type: "move", piece: sel, res: ds[0][0], owner: selOwner });
      return;
    }
    throwBtn.click();
  };
  document.addEventListener("keydown", onKey);

  handEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hand]");
    if (!b || !myTurn() || game.usedAbility) return;
    const idx = +b.dataset.hand;
    const def = ABILITY_BY_ID[cur().hand[idx]];
    if (targeting?.hand === idx) { targeting = null; render(); return; }
    if (def.target === "none" || def.target === "nextPlayer") { targeting = null; act({ type: "ability", hand: idx, t: {} }); return; }
    targeting = { hand: idx, def };
    render();
  });

  boardEl.addEventListener("click", (e) => {
    if (tossing || anim || !myTurn()) return;
    const dest = e.target.closest("[data-dest]");
    const pc = e.target.closest("[data-seat]");
    const nd = e.target.closest("[data-node]");
    const seat = pc ? +pc.dataset.seat : null, idx = pc ? +pc.dataset.idx : null;
    if (targeting) {
      const tg = targeting.def.target;
      if (tg === "oppPiece" && pc && !game.ally(game.current, seat)) act({ type: "ability", hand: targeting.hand, t: { opp: { seat, idx } } });
      else if (tg === "ownPiece" && pc && game.ally(game.current, seat)) act({ type: "ability", hand: targeting.hand, t: { own: idx } });
      else if (tg === "node" && nd && !pc && +nd.dataset.node > 0) act({ type: "ability", hand: targeting.hand, t: { node: +nd.dataset.node } });
      else if (tg === "swap") {
        if (targeting.own === undefined && pc && game.ally(game.current, seat)) { targeting.own = idx; render(); return; }
        if (targeting.own !== undefined && pc && !game.ally(game.current, seat)) act({ type: "ability", hand: targeting.hand, t: { own: targeting.own, opp: { seat, idx } } });
        else return;
      } else return;
      targeting = null;
      return;
    }
    if (game.phase !== "move") return;
    if (dest && sel !== null) { act({ type: "move", piece: sel, res: +dest.dataset.dest, owner: selOwner }); return; }
    if (pc && canMoveOwner(seat)) {
      if (sel === idx && selOwner === seat) { // 같은 말을 한 번 더 누르면, 갈 곳이 하나뿐일 때 바로 옮김
        const ds = [...destinations(idx, seat).values()];
        if (ds.length === 1) act({ type: "move", piece: idx, res: ds[0][0], owner: seat });
        return;
      }
      if (destinations(idx, seat).size) { sel = idx; selOwner = seat; m.sfx("click"); render(); }
      return;
    }
    if (nd && +nd.dataset.node === 0 && firstWaiting() >= 0) { sel = firstWaiting(); selOwner = game.team(game.current); render(); }
  });

  function apply(a, at, seat) {
    if (game.over || seat !== game.current) return;
    const sd = Number.isInteger(a.seed) ? a.seed : 0;
    const before = game.current;
    let ok = false;
    if (a.type === "throw") ok = game.throw(sd);
    else if (a.type === "move" && Number.isInteger(a.piece) && Number.isInteger(a.res)) ok = game.move(a.piece, a.res, sd, Number.isInteger(a.owner) ? a.owner : game.current);
    else if (a.type === "ability" && Number.isInteger(a.hand)) ok = game.use(a.hand, a.t || {}, sd);
    if (!ok) return;
    sel = null;
    selOwner = null;
    targeting = null;
    if (!m.replaying) playEvents();
    if (game.over) end();
    else if (!m.replaying && m.online && before !== game.current && m.controls(game.current)) { // 다른 일을 보다가도 내 차례를 놓치지 않게
      m.later(() => { if (m.controls(game.current) && !game.over) { m.sfx("pop"); shout("내 차례!", "good"); } }, 1300);
    }
  }

  function resign(seat) {
    game.resign(seat);
    if (game.over) end();
  }

  function end() {
    const order = game.ranking();
    const winners = game.winners.length ? game.winners : game.winner !== null ? [game.winner] : [];
    const losers = game.teams ? order.filter((i) => !winners.includes(i))
      : order.length > 1 ? [order[order.length - 1]].filter((i) => !winners.includes(i)) : [];
    const scores = Object.fromEntries(order.map((i) => [i, `${game.teams ? `${teamOf(i)} · ` : ""}${game.finished(i)}/${game.pieceCount} 도착`]));
    const title = !winners.length ? "게임 끝" : game.teams ? `${teamOf(winners[0])} (${winners.map((i) => seatNames[i]).join(" · ")}) 승리!` : `${seatNames[winners[0]]} 승리!`;
    m.finish({ title, sub: `${MODES[mode]} 윷놀이${game.teams ? " · 2:2 팀전" : ""}`, winners, losers, order, scores, moves: game.turnNo });
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

  /** 쓴 능력 카드의 이름과 설명을 판 위쪽에 띄움 (클릭을 막지 않고, 읽을 시간이 지나면 저절로 사라짐) */
  function showAbilityNote(def, seat) {
    fxEl.querySelector(".yut-ability-note")?.remove();
    const note = el(`<div class="yut-ability-note" style="--tier:${TIERS[def.tier].color};--life:${ABILITY_NOTE_MS}ms"><small>${esc(seatNames[seat])} · ${TIERS[def.tier].name}</small><b>${esc(def.name)}</b><span>${esc(def.desc)}</span></div>`);
    fxEl.appendChild(note);
    m.later(() => note.remove(), ABILITY_NOTE_MS);
  }

  function playEvents() {
    // 말이 길을 따라가는 동안에는 잡기 · 도착 · 폭탄 연출을 도착한 뒤로 미룸
    const mv = game.events.find((e) => e.kind === "move");
    const arrive = mv ? 60 + routeNodes(mv.from, mv.to).length * 150 : 0;
    const atArrival = (fn) => (arrive ? m.later(fn, arrive) : fn());
    for (const e of game.events) {
      if (e.kind === "throw") {
        tossing = true;
        tossingSeat = e.seat ?? game.current;
        m.sfx("yut");
        tossSticks(e.value);
      } else if (e.kind === "move") hopAlong(e);
      else if (e.kind === "catch") atArrival(() => { m.sfx("thud"); shout("잡았다!", "good"); });
      else if (e.kind === "boom") {
        const delay = mv && Number.isInteger(e.step) ? 60 + e.step * 150 + 70 : arrive;
        const boom = () => { m.sfx("thud"); shout("펑!!", "bad"); };
        if (delay) m.later(boom, delay); else boom();
      }
      else if (e.kind === "home") atArrival(() => { m.sfx("pop"); shout("도착!", "good"); });
      else if (e.kind === "ability") {
        const d = ABILITY_BY_ID[e.id];
        m.sfx("pop");
        shout(d.shout, `tier-${d.tier} big`);
        showAbilityNote(d, e.seat);
        if (d.tier === "legend") { root.classList.remove("shake"); void root.offsetWidth; root.classList.add("shake"); }
      } else if (e.kind === "blocked") shout("어쩔티비~ 막았다!", "good");
      else if (e.kind === "coin") shout(e.heads ? "앞면! 가즈아!!" : "뒷면… 출발점으로", e.heads ? "good" : "bad");
    }
  }

  /** 말이 지나가는 칸들 (from에서 to까지, 골인이면 출발 칸까지) */
  function routeNodes(from, to) {
    const p = pathFrom(from), k = p.indexOf(to);
    return (k >= 0 ? p.slice(0, k + 1) : [to]).map((n) => (n === HOME ? 0 : n));
  }
  const posOf = (n) => SP[n === HOME ? 0 : n];

  /** 옮긴 말을 출발한 칸에서 도착한 칸까지 한 칸씩 콩콩 */
  function hopAlong(e) {
    const bomb = game.events.find((event) => event.kind === "boom" && Number.isInteger(event.step));
    const fullRoute = (e.traversed?.length ? e.traversed : routeNodes(e.from, e.to)).map((node) => node === HOME ? 0 : node);
    const stepCount = bomb ? Math.min(fullRoute.length, bomb.step + 1) : fullRoute.length;
    const steps = fullRoute.slice(0, stepCount).map(posOf);
    const mover = (e.parts && e.parts[0] && e.parts[0][0]) ?? e.seat; // 팀전에서 같은 팀 말을 옮겼으면 그 말의 주인
    // 출발 말은 대기 카드 위치에서 보이는 이동을 하지 않고, 출발점에서 곧바로 경로를 시작한다.
    const start = e.from === START ? posOf(0) : posOf(e.from);
    // 잡힌 말: 지금은 이미 출발점(START)에 있지만, 도착 전까지 그 칸에 그려 둠
    const victims = game.events.filter((c) => c.kind === "catch" && c.node === e.to).map((c) => ({
      seat: c.victim, idxs: game.players[c.victim].pieces.map((q, i) => [q, i]).filter(([q]) => q.node === START).slice(-c.count).map(([, i]) => i),
    }));
    const atDest = game.players[game.team(e.seat)].pieces.filter((q) => q.node === e.to).length;
    const stacked = e.to !== HOME && atDest > e.count;
    const parts = e.parts || [[e.seat, e.count, []]];
    const bombed = bomb ? parts.flatMap(([s, , idxs = []]) => idxs.map((i) => [s, i])) : [];
    anim = { seat: e.seat, node: e.to, count: e.count, parts, victims, bombed };
    ghostEl.innerHTML = `<g class="ghost" style="transform:translate(${start[0]}px,${start[1]}px)">${tokenSvg(0, 0, mover, { sc: 0.78, count: e.count })}</g>`;
    const g = ghostEl.firstElementChild;
    steps.forEach(([x, y], i) => m.later(() => { g.style.transform = `translate(${x}px,${y}px)`; m.sfx("tick"); }, 60 + i * 150));
    m.later(() => { anim = null; ghostEl.innerHTML = ""; render(); if (stacked) shout("업었다!", "good"); }, 60 + steps.length * 150 + 120);
  }

  function showOdds(md) {
    const rows = md === "basic" ? "<p class=\"muted\">기본 모드는 능력이 없어요.</p>" : `<table class="rank odds"><thead><tr><th>등급</th><th>능력</th><th>확률</th></tr></thead><tbody>${abilityOdds(md).map((a) =>
      `<tr><td><span class="tier-dot" style="background:${TIERS[a.tier].color}"></span>${TIERS[a.tier].name}</td><td style="text-align:left"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.desc)}</div></td><td>${a.pct.toFixed(1)}%</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:13px">시작할 때 한 장씩 ${START_HAND[md]}번 뽑아요 (카드마다 위 확률). 한 차례에 1장만 쓸 수 있어요.</p>`;
    const throws = THROW_ODDS.map((o) => `${o.name} ${(o.p * 100).toFixed(1)}%`).join(" · ");
    modal(`${MODES[md]} 모드 확률표`, el(`<div><p class="muted" style="margin-top:0">윷 결과: ${throws}</p>${rows}</div>`));
  }

  // ------------------------------------------------------------ 그리기
  /** 윷가락 4개를 판 위로 크게 던져서 떨어뜨림 (떨어진 모양 = 나온 결과) */
  /** 윷가락 하나 (SVG): 둥근 윗머리, 나뭇결, 아래 끝은 반달 단면 */
  function tossSticks(value) {
    tossCancel?.();
    const faces = FLATS[value] ?? Array.from({ length: 4 }, () => Math.random() < .5 ? 1 : 0);
    tossCancel = animateYutToss(tossEl, {
      faces,
      markedIndex: value === -1 ? 0 : -1,
      onImpact: () => {
        m.sfx("thud");
        const stage = tossEl.parentElement;
        stage?.classList.remove("throw-impact");
        if (stage) { void stage.offsetWidth; stage.classList.add("throw-impact"); }
        m.later(() => stage?.classList.remove("throw-impact"), 360);
      },
      onSettled: () => {
        const nakKept = value === 0 && game.pending.length > 0; // 낙이어도 앞에서 던진 결과는 남음
        const steps = value === -1 ? "1칸 뒤로" : value === 0 ? (nakKept ? "앞 결과는 그대로 써요" : "차례를 넘깁니다") : `${value}칸 앞으로`;
        const result = el(value === 0
          ? `<div class="toss-cap revealed bad toss-result"><b>낙</b><span>${steps}</span></div>`
          : `<div class="toss-cap revealed toss-result${value >= 4 ? " good" : value === -1 ? " bad" : ""}"><b>${RESULT_NAMES[value]}</b><span>${steps}</span>${value >= 4 ? "<span>한 번 더 던지기!</span>" : ""}</div>`);
        tossEl.append(result);
        if (value === 0) shout(nakKept ? "낙! 앞 결과로 옮겨요" : "낙! 차례를 넘겨요", "bad");
        else if (value >= 4) m.sfx("pop");
        tossing = false;
        tossingSeat = null;
        tossCancel = null;
        render();
        m.later(() => result.classList.add("out"), 850);
      },
    });
  }

  /** 서 있는 말 하나 (발끝이 x, y): 자리 색 받침 위에 캐릭터 */
  function tokenSvg(x, y, seat, { sc = 1, cls = "", data = "", count = 0, shield = false, ring = "", skin = skins[seat] } = {}) {
    const c = PLAYER_COLORS[seat];
    // 업힌 말: 뒤에 겹쳐 그리고, 머리 옆에 큰 배지로 개수 표시
    const behind = Array.from({ length: Math.max(0, Math.min(count, 4) - 1) }, (_, k) =>
      `<g transform="translate(${-3.4 * (k + 1)} ${-1.3 * (k + 1)}) scale(0.92)" opacity="${0.92 - k * 0.14}">${charSvg(skin)}</g>`).reverse().join("");
    return `<g class="yb-piece ${cls}" ${data} transform="translate(${x} ${y}) scale(${sc})">
      ${count > 1 ? `<title>말 ${count}개 업힘</title>` : ""}
      <ellipse class="yb-hit" rx="7" ry="11" cy="-10"/>
      <ellipse class="yb-shadow" rx="5.6" ry="2.3" cy="0.8"/>
      ${ring ? `<ellipse class="yb-ring ${ring}" rx="6.8" ry="2.9" cy="0.2"/>` : ""}
      ${shield ? `<ellipse class="yb-shield" rx="7.6" ry="3.3" cy="0.2"/>` : ""}
      <g class="yb-bob">
        <ellipse rx="5" ry="2.1" cy="0.7" fill="${shade(c, -0.45)}"/>
        <ellipse rx="5" ry="2.1" cy="-0.5" fill="${c}"/>
        <ellipse rx="3.4" ry="1.2" cy="-0.8" fill="${shade(c, 0.35)}"/>
        ${behind}
        <g transform="translate(0 -0.6)">${charSvg(skin)}</g>
        ${count > 1 ? `<g transform="translate(7.6 -20.5)"><circle r="5" class="yb-badge"/><text y="1.9" class="yb-count">×${count}</text></g>` : ""}
      </g></g>`;
  }

  function drawBoard() {
    const parts = [];
    const mine = myTurn();
    const moving = mine && game.phase === "move" && !targeting && !tossing && !anim;
    parts.push(`<defs>
      <linearGradient id="ywood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3D29B"/><stop offset="1" stop-color="#DDB06C"/></linearGradient></defs>`);
    // 판 바탕: 두께가 있는 사각형 (앞면이 보임)
    const [TL, TR, BR, BL] = [proj(4, 4), proj(96, 4), proj(96, 96), proj(4, 96)];
    const pt = (p, dy = 0) => `${p[0]},${p[1] + dy}`;
    parts.push(`<polygon class="yb-top" points="${pt(TL)} ${pt(TR)} ${pt(BR)} ${pt(BL)}"/>`);
    // 가장자리 테 (진한 나무 띠) + 옅은 나뭇결
    const ring = (a) => [proj(a, a), proj(100 - a, a), proj(100 - a, 100 - a), proj(a, 100 - a)].map((q) => pt(q)).join(" ");
    parts.push(`<path class="yb-trim" fill-rule="evenodd" d="M${ring(4)}Z M${ring(6.5)}Z"/>`);
    for (const gy of [18, 31, 44, 57, 70, 83]) {
      const pts = [];
      for (let gx = 8; gx <= 92; gx += 6) pts.push(pt(proj(gx, gy + Math.sin(gx / 9 + gy) * 1.2)));
      parts.push(`<polyline class="yb-grain" points="${pts.join(" ")}"/>`);
    }
    const inner = [proj(8, 8), proj(92, 8), proj(92, 92), proj(8, 92)];
    parts.push(`<polygon class="yb-inner" points="${inner.map((p) => pt(p)).join(" ")}"/>`);
    // 길
    parts.push(`<g class="yb-lines">`);
    for (const [a, b] of [[0, 5], [5, 10], [10, 15], [15, 0], [5, 15], [10, 0]]) parts.push(`<line x1="${SP[a][0]}" y1="${SP[a][1]}" x2="${SP[b][0]}" y2="${SP[b][1]}"/>`);
    parts.push(`</g>`);
    // 가는 방향 화살표: 바깥 길(빨강)은 출발(오른쪽 아래)에서 위로 올라가 한 바퀴, 지름길(파랑)은 모서리에서 가운데로
    const arrow = (a, b, cls, size = 1.6) => {
      const [x1, y1] = SP[a], [x2, y2] = SP[b], ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return `<path class="yb-arrow ${cls}" d="M-1.6 -1.7 L1.8 0 L-1.6 1.7 L-0.7 0z" transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${ang}) scale(${size})"/>`;
    };
    for (let k = 0; k < 19; k++) parts.push(arrow(k, k + 1, "main"));
    parts.push(arrow(19, 0, "main"));
    for (const [a, b] of [[5, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 15], [10, 25], [25, 26], [26, 22], [22, 27], [27, 28], [28, 0]]) parts.push(arrow(a, b, "short"));
    // 고른 말이 갈 수 있는 곳
    fixSelection();
    const dests = !tossing && !anim && sel !== null ? destinations(sel, selOwner) : new Map();
    // 칸 (뒤에서 앞 순서로)
    const order = Object.keys(SP).map(Number).sort((a, b) => SP[a][1] - SP[b][1]);
    for (const n of order) {
      const [x, y] = SP[n];
      const rb = BIG.has(n) ? 4.6 : 3.2, rx = rb * SX, ry = rb * SY, h = 1.2;
      const cls = ["yb-tile"];
      if (n === 0) cls.push("start");
      else if (BIG.has(n)) cls.push("corner");
      if (dests.has(n)) cls.push("dest");
      if (targeting?.def.target === "node" && n > 0 && !game.players.some((p) => p.pieces.some((piece) => piece.node === n))) cls.push("pickable");
      parts.push(`<g data-node="${n}" class="${cls.join(" ")}"${dests.has(n) ? ` data-dest="${dests.get(n)[0]}"` : ""}>
        <ellipse class="side" cx="${x}" cy="${y + h}" rx="${rx}" ry="${ry}"/><rect class="side" x="${x - rx}" y="${y}" width="${rx * 2}" height="${h}"/>
        <ellipse class="top" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>${BIG.has(n) ? `<ellipse class="ring" cx="${x}" cy="${y}" rx="${rx * 0.7}" ry="${ry * 0.7}"/>` : ""}</g>`);
    }
    // 고른 말이 결과마다 지나갈 길
    if (!tossing && !anim && sel !== null) {
      const pc = game.players[selOwner].pieces[sel];
      for (const [node, resultIndexes] of dests) {
        for (const resultIndex of resultIndexes) {
          const resultPath = game.pending[resultIndex] === -1
            ? game.backPath(pc.node, pc.prev)
            : routeNodes(pc.node, node);
          const pts = [pc.node === START ? SP[0] : posOf(pc.node), ...resultPath.map(posOf)];
          parts.push(`<polyline class="yb-route${game.pending[resultIndex] === -1 ? " back" : ""}" points="${pts.map((q) => q.join(",")).join(" ")}"/>`);
        }
      }
    }
    for (const [n, t] of [[5, "지름길"], [10, "지름길"], [CENTER, "가운데"]]) parts.push(`<text x="${SP[n][0]}" y="${SP[n][1] + 1.2}" class="yb-corner-label">${t}</text>`);
    parts.push(`<text x="${SP[0][0]}" y="${SP[0][1] + 1.4}" class="yb-start-label">출발</text>`);
    // 출발 칸 오른쪽 판 밖에 ⬆ (처음 가는 쪽). 글자는 아래 '출발 · 골인' 팻말 하나만
    parts.push(`<g class="yb-go" transform="translate(${BR[0] + 9.5} ${SP[0][1] + 2})"><g class="yb-go-in"><path d="M0 -36 L8 -25 H3.2 V0 H-3.2 V-25 H-8Z" transform="scale(0.55)"/></g></g>`);
    for (const [node, owner] of Object.entries(game.bombs)) {
      const [x, y] = SP[node];
      parts.push(`<g class="yb-bomb" transform="translate(${x} ${y - 2.6})"><circle r="2.8" fill="#1E1B18" stroke="${PLAYER_COLORS[game.team(owner)]}" stroke-width="0.6"/><circle cx="-0.9" cy="-0.9" r="0.8" fill="rgba(255,255,255,0.4)"/><path d="M1.6 -2 q1.5 -2 3 -1" stroke="#C9A36B" stroke-width="0.6" fill="none"/><circle cx="4.6" cy="-3" r="0.9" fill="#FF8A3D"/></g>`);
    }
    // 말 (판 위): 칸마다 주인별로 묶어서, 앞(아래)에 있는 말을 나중에 그림
    const tokens = [];
    const pickableFor = (seat, onBoard) => targeting && ((targeting.def.target === "oppPiece" && !game.ally(game.current, seat) && onBoard) ||
      (targeting.def.target === "ownPiece" && game.ally(game.current, seat) && (onBoard || ["gazua", "yeongkkeul"].includes(targeting.def.id))) ||
      (targeting.def.target === "swap" && onBoard && (targeting.own === undefined ? game.ally(game.current, seat) : !game.ally(game.current, seat))));
    const byNode = {};
    game.sides().forEach((s) => game.players[s].pieces.forEach((pc, i) => {
      if (pc.node === START || pc.node === HOME) return;
      ((byNode[pc.node] ||= {})[s] ||= []).push(i);
    }));
    const hiddenStart = new Set(); // 대기 자리에서 잠깐 빼고 판 위에 그리는 잡힌 말
    if (anim && anim.node !== HOME) {
      for (const [s2, k] of anim.parts) { // 옮긴 말만 숨기고, 원래 있던 말은 남김
        const at = byNode[anim.node]?.[s2];
        if (!at) continue;
        at.splice(-k);
        if (!at.length) delete byNode[anim.node][s2];
      }
      for (const v of anim.victims) {
        if (!v.idxs.length) continue;
        ((byNode[anim.node] ||= {})[v.seat] ||= []).push(...v.idxs);
        v.idxs.forEach((i) => hiddenStart.add(`${v.seat}:${i}`));
      }
      for (const [seat, idx] of anim.bombed || []) hiddenStart.add(`${seat}:${idx}`);
      if (byNode[anim.node] && !Object.keys(byNode[anim.node]).length) delete byNode[anim.node];
    }
    for (const [node, owners] of Object.entries(byNode)) {
      const list = Object.entries(owners);
      list.forEach(([s, idxs], k) => {
        const seat = +s, [x, y] = SP[node];
        const off = list.length > 1 ? (k - (list.length - 1) / 2) * 9 : 0;
        const own = mine && canMoveOwner(seat);
        const canMove = moving && own && destinations(idxs[0], seat).size > 0;
        const ring = moving && own && sel === idxs[0] && selOwner === seat ? "sel" : canMove && sel === null ? "can" : "";
        const pick = pickableFor(seat, true);
        tokens.push([y, tokenSvg(x + off, y, seat, { sc: 0.78,
          cls: `${canMove ? "movable" : ""}${pick ? " pickable" : ""}${ring === "sel" ? " selected" : ""}`, data: `data-seat="${seat}" data-idx="${idxs[0]}"`,
          count: idxs.length, shield: game.players[seat].pieces[idxs[0]].shield >= game.turnNo, ring: pick ? "pick" : ring,
        })]);
      });
    }
    // 대기 말: 자리마다(팀전은 팀마다) 판 위아래 띠에
    game.sides().forEach((s) => {
      const p = game.players[s];
      const [dx, dy] = seatDocks[s];
      const waiting = p.pieces.map((pc, i) => [pc, i]).filter(([pc, i]) => pc.node === START && !hiddenStart.has(`${s}:${i}`));
      const finished = p.pieces.map((pc, i) => [pc, i]).filter(([pc]) => pc.node === HOME).map(([, i]) => i);
      const turn = game.team(game.current) === s && !game.over;
      const tagX = dx + Math.max(37, (p.pieces.length - 1) * 7.6 + 26); // 차례 표시가 대기 말을 가리지 않게
      tokens.push([dy - 30, `<g class="yb-dock${turn ? " on" : ""}"><rect x="${dx - 8}" y="${dy - 18}" width="90" height="22" rx="5" style="--pc:${PLAYER_COLORS[s]}"/>
        <text x="${dx + 77}" y="${dy - 5.5}" class="yb-dock-name" fill="${PLAYER_COLORS[s]}" text-anchor="end">${esc(game.sideName(s).slice(0, 10))}</text>
        ${turn ? `<g transform="translate(${tagX} ${dy - 13})"><g class="yb-turn-tag"><rect x="-19" y="-6" width="38" height="12" rx="6" style="--pc:${PLAYER_COLORS[s]}"/><text y="2.1">\uCC28\uB840!</text></g></g>` : ""}</g>`]);
      const dockPieces = [...waiting.map(([, i]) => ({ i, finished: false })), ...finished.map((i) => ({ i, finished: true }))];
      dockPieces.forEach(({ i, finished: isFinished }, k) => {
        if (isFinished) {
          tokens.push([dy, tokenSvg(dx + k * 7.6, dy, s, { sc: 0.62, cls: "finished" })]);
          return;
        }
        const rep = i;
        const own = mine && canMoveOwner(s);
        const canMove = moving && own && destinations(rep, s).size > 0;
        const ring = own && moving && sel === rep && selOwner === s ? (k === 0 ? "sel" : "") : canMove && sel === null && k === 0 ? "can" : "";
        const pick = pickableFor(s, false);
        tokens.push([dy, tokenSvg(dx + k * 7.6, dy, s, {
          sc: 0.62, cls: `${canMove ? "movable" : ""}${pick ? " pickable" : ""}`, data: `data-seat="${s}" data-idx="${rep}"`, ring: pick ? "pick" : ring,
        })]);
      });
    });
    tokens.sort((a, b) => a[0] - b[0]).forEach(([, t]) => parts.push(t));
    // 도착할 곳 말풍선 (결과 이름). 골인은 출발 칸 위. 겹치면 위로 비켜 쌓고 칸까지 점선
    const bubbles = [...dests].map(([node, resIdx]) => {
      const names = resIdx.map((i) => RESULT_NAMES[game.pending[i]]).join("/");
      const opp = node !== HOME && game.players.some((p, s2) => !game.ally(game.current, s2) && p.pieces.some((q) => q.node === node && q.shield < game.turnNo));
      const mineThere = node !== HOME && game.players.some((p, s2) => game.ally(game.current, s2) && p.pieces.some((q) => q.node === node));
      const boom = node !== HOME && game.bombs[node] !== undefined;
      const tag = node === HOME ? "골인!" : boom ? "폭탄!" : opp ? "잡기!" : mineThere ? "업기" : node === 0 ? "출발점" : "";
      const kind = node === HOME ? "home" : boom || opp ? "hot" : mineThere ? "stack" : "";
      const label = tag ? `${names} · ${tag}` : names;
      const [x, y] = SP[node === HOME ? 0 : node];
      const busy = byNode[node === HOME ? 0 : node];
      return { res: resIdx[0], label, kind, x, y, w: 7 + label.length * 4.2, top: y - (busy ? 20 : 6) };
    }).sort((a, b) => b.top - a.top);
    const placed = [];
    for (const b of bubbles) {
      while (placed.some((o) => Math.abs(o.x - b.x) < (o.w + b.w) / 2 + 1.5 && Math.abs(o.top - b.top) < 11)) b.top -= 11;
      placed.push(b);
    }
    for (const b of placed) {
      if (b.top < b.y - 22) parts.push(`<line class="yb-dest-lead" x1="${b.x}" y1="${b.top + 1}" x2="${b.x}" y2="${b.y - 2}"/>`);
    }
    for (const b of placed) {
      const w = b.w;
      parts.push(`<g class="yb-dest ${b.kind}" data-dest="${b.res}" transform="translate(${b.x} ${b.top})"><g class="yb-dest-in">
        <path d="M${-w / 2} -9 h${w} a2.5 2.5 0 0 1 2.5 2.5 v3 a2.5 2.5 0 0 1 -2.5 2.5 h${-(w / 2 - 2)} l-2 2.6 l-2 -2.6 h${-(w / 2 - 2)} a2.5 2.5 0 0 1 -2.5 -2.5 v-3 a2.5 2.5 0 0 1 2.5 -2.5z"/>
        <text y="-3.6">${esc(b.label)}</text></g></g>`);
    }
    boardEl.innerHTML = `<svg viewBox="0 0 200 208">${parts.join("")}</svg>`;
    const flip = game.upside !== null && game.upside === game.current && m.controls(game.current);
    boardEl.classList.toggle("upside", flip);
    ghostEl.classList.toggle("upside", flip);
  }

  function visibleHand() {
    const player = cur();
    return m.mode === "local" ? player.hand : (m.mySeats.length ? game.players[m.mySeats[0]].hand : []); // 팀전이면 팀이 같이 쓰는 카드
  }

  function renderHand() {
    if (!game.abilitiesOn) { handEl.innerHTML = ""; return; }
    const showHand = visibleHand();
    if (!showHand.length) { handEl.innerHTML = `<div class="muted hand-empty">표시할 능력 카드가 없어요</div>`; return; }
    const mine = myTurn();
    handEl.innerHTML = `<div class="hand-track" style="--hand-count:${showHand.length}">${showHand.map((id, i) => {
      const d = ABILITY_BY_ID[id];
      const usable = mine && !game.usedAbility && (m.mode === "local" || m.mySeats[0] === game.current);
      return `<button class="ability-card tier-${d.tier}${targeting?.hand === i ? " on" : ""}" data-hand="${i}" data-tooltip="${esc(d.desc)}" title="${esc(`${d.name} · ${d.desc}`)}" aria-label="${esc(`${d.name}. ${d.desc}`)}" ${usable ? "" : "disabled"} style="--tier:${TIERS[d.tier].color};--deal-delay:${i * 100}ms">
        <span class="ac-tier">${TIERS[d.tier].name}</span><span class="ac-name">${esc(d.name)}</span><span class="ac-desc">${esc(d.desc)}</span></button>`;
    }).join("")}</div>`;
  }

  function startCardRoulette() {
    const amount = START_HAND[mode];
    const body = el(`<div class="deal-popup"><div class="deal-popup-head"><p class="muted deal-caption">시작 능력 카드 ${amount}장을 뽑아요</p><button class="btn ghost small deal-skip" type="button"><kbd>Esc</kbd> 건너뛰기</button></div><div class="deal-roulette-cards" aria-live="polite"></div><p class="deal-result-label">카드를 섞고 있어요 · Esc로 바로 넘길 수 있어요</p></div>`);
    const cards = body.querySelector(".deal-roulette-cards");
    const caption = body.querySelector(".deal-result-label");
    const pool = Object.keys(ABILITY_BY_ID);
    const close = modal("시작 능력 카드 룰렛", body, { closable: false });
    dealModalClose = close;
    body.closest(".modal")?.classList.add("deal-modal");
    const actual = visibleHand().slice(0, amount);
    const locked = Array(amount).fill(false);
    const slotIds = Array.from({ length: amount }, () => pool[Math.floor(Math.random() * pool.length)]);
    cards.innerHTML = `<div class="hand-track" style="--hand-count:${amount}">${slotIds.map((id, i) => {
      const def = ABILITY_BY_ID[id];
      return `<div class="deal-card-slot" data-slot="${i}"><div class="ability-card deal-roulette-card rolling tier-${def.tier}" style="--tier:${TIERS[def.tier].color}"><span class="ac-tier">추첨 중</span><span class="ac-name">${esc(def.name)}</span><span class="ac-desc">${esc(def.desc)}</span></div></div>`;
    }).join("")}</div>`;
    const slots = [...cards.querySelectorAll(".deal-card-slot")];
    let completed = false;
    const paintSlot = (i, id, final = false) => {
      const def = ABILITY_BY_ID[id];
      const slot = slots[i];
      slot.innerHTML = `<div class="ability-card deal-roulette-card tier-${def.tier}${final ? " revealed" : " rolling"}" style="--tier:${TIERS[def.tier].color}"><span class="ac-tier">${final ? TIERS[def.tier].name : "추첨 중"}</span><span class="ac-name">${esc(def.name)}</span><span class="ac-desc">${esc(def.desc)}</span></div>`;
    };
    const finishDeal = (skipped = false) => {
      if (completed) return;
      completed = true;
      clearInterval(dealInterval); dealInterval = null;
      skipCardRoulette = null;
      const skipButton = body.querySelector(".deal-skip");
      skipButton.disabled = true;
      skipButton.innerHTML = skipped ? "카드 확정" : "추첨 완료";
      if (skipped) {
        actual.forEach((id, i) => {
          const cardId = id || slotIds[i];
          slotIds[i] = cardId;
          paintSlot(i, cardId, true);
          slots[i].classList.add("stopped");
        });
        caption.textContent = "룰렛을 건너뛰고 이번 판 카드를 바로 확정했어요.";
        m.sfx("pop");
      } else {
        caption.textContent = "이번 판에 사용할 카드가 정해졌어요!";
      }
      body.classList.add("revealed");
      m.later(() => { close(); dealModalClose = null; dealing = false; render(); }, skipped ? 750 : 1250);
    };
    skipCardRoulette = () => finishDeal(true);
    body.querySelector(".deal-skip").onclick = () => skipCardRoulette?.();
    let lastRouletteTick = 0;
    dealInterval = setInterval(() => {
      slotIds.forEach((id, i) => { if (!locked[i]) { slotIds[i] = pool[Math.floor(Math.random() * pool.length)]; paintSlot(i, slotIds[i]); } });
      const now = performance.now();
      if (now - lastRouletteTick >= 190) { m.sfx("tick"); lastRouletteTick = now; }
    }, 95);
    const stopSlot = (i) => {
      if (completed) return;
      if (i >= amount) {
        finishDeal();
        return;
      }
      const cardId = actual[i] || slotIds[i];
      m.sfx("pop");
      locked[i] = true;
      slotIds[i] = cardId;
      paintSlot(i, cardId, true);
      slots[i].classList.add("stopped");
      caption.textContent = `${i + 1} / ${amount}장 확정!`;
      m.later(() => stopSlot(i + 1), 560);
    };
    m.later(() => stopSlot(0), 1550);
  }

  function renderPlayerCards() {
    playerCardsEl.innerHTML = game.players.map((player, seat) => {
      const finished = player.pieces.filter((piece) => piece.node === HOME).length;
      const waiting = player.pieces.filter((piece) => piece.node === START).length;
      const onBoardCount = player.pieces.length - finished - waiting;
      const turn = (tossing ? tossingSeat : game.current) === seat && !game.over;
      const side = game.team(seat);
      return `<article class="yut-player-mini${turn ? " turn" : ""}" style="--pc:${PLAYER_COLORS[side]}">
        <span class="yut-mini-avatar"><svg viewBox="-11 -27 22 29" aria-hidden="true">${charSvg(skins[side])}</svg></span>
        <span class="yut-mini-info"><strong>${esc(seatNames[seat])}</strong><small>골인 ${finished} · 판 ${onBoardCount} · 대기 ${waiting}</small></span>
        ${game.teams ? `<span class="yut-mini-team t${seat % 2}">${teamOf(seat)}</span>` : ""}
        ${turn ? `<span class="yut-mini-turn">차례</span>` : ""}</article>`;
    }).join("");
  }

  function render() {

    const p = cur();
    const shownSeat = tossing && tossingSeat !== null ? tossingSeat : game.current;
    const shownPlayer = game.players[shownSeat];
    turnStatusEl.innerHTML = `<b style="color:${PLAYER_COLORS[game.team(shownSeat)]}">${esc(shownPlayer.name)}</b> ${game.teams ? `<span class="ys-team t${shownSeat % 2}">${teamOf(shownSeat)}</span>` : ""} 차례 <span>${tossing ? "윷 결과 확인 중" : game.phase === "move" ? `말 이동 · 남은 결과 ${game.pending.length}개` : game.throws > 1 ? `추가로 ${game.throws}번 던질 수 있어요` : "윷 던지기"}</span>`;
    drawBoard();
    renderPlayerCards();
    // 던지기 버튼과 남은 결과
    const mine = myTurn();
    throwBtn.disabled = game.over || dealing || !mine || game.phase !== "throw" || tossing;
    throwBtn.innerHTML = game.over ? "게임 끝" : dealing ? "카드 섞는 중…" : tossing ? "윷 결과 확인 중…" : !mine ? `${esc(p.name)} 님 차례` : game.phase === "throw" ? `${game.throws > 1 ? "한 번 더 던지기" : "윷 던지기"}${game.throws > 1 ? ` ×${game.throws}` : ""} <kbd>Space</kbd>` : "말을 움직여요";
    const can = sel !== null ? destinations(sel, selOwner) : new Map();
    const usable = new Set([...can.values()].flat());
    resultsEl.innerHTML = tossing || anim ? "" : game.pending.map((r, i) => usable.has(i)
      ? `<button class="res-chip go${r === -1 ? " back" : ""}" data-res="${i}" title="고른 말을 ${RESULT_NAMES[r]}만큼 옮기기">${RESULT_NAMES[r]} ▶</button>`
      : `<span class="res-chip${r === -1 ? " back" : ""}">${RESULT_NAMES[r]}</span>`).join("");
    // 안내
    if (game.over || m.result) hintEl.textContent = m.result ? m.result.title : "";
    else if (tossing) hintEl.textContent = "윷이 멈출 때까지 잠시 기다려 주세요. 결과가 나온 뒤 말 이동이나 추가 던지기를 할 수 있어요.";
    else if (anim) hintEl.textContent = "말이 이동 중이에요. 이동이 끝나면 다음 결과를 확인할 수 있어요.";
    else if (dealing) hintEl.textContent = "시작 능력 카드를 뽑고 있어요. 잠시만 기다려 주세요.";
    else if (targeting) {
      const t = targeting.def.target;
      hintEl.textContent = `「${targeting.def.name}」 ${t === "oppPiece" ? "상대 말을 눌러요" : t === "ownPiece" ? "내 말을 눌러요" : t === "node" ? "폭탄을 놓을 빈칸을 눌러요 (말 있는 칸·출발점 제외)" : targeting.own === undefined ? "먼저 내 말을 눌러요" : "바꿀 상대 말을 눌러요"} · 카드를 다시 누르거나 Esc로 취소`;
    } else if (!mine) hintEl.textContent = `${p.name} 님 차례${game.phase === "move" ? " · 말 옮기는 중" : ""}`;
    else if (game.phase === "throw") hintEl.textContent = game.pending.length ? `윷·모가 나왔어요! 한 번 더 던져요 (${game.throws}회 남음) · 결과 ${game.pending.length}개는 다음에 옮겨요` : `윷을 던져요${game.abilitiesOn ? " (능력 카드는 한 차례에 한 장)" : ""}`;
    else hintEl.textContent = sel !== null ? `선택한 말로 결과 ${game.pending.length}개 중 하나를 옮겨요 · 말풍선 · 결과 버튼 · 숫자키(갈 곳이 하나면 Space)` : "옮길 말을 눌러요. 갈 수 있는 칸의 결과 말풍선이나 아래 결과 버튼을 누르면 이동해요.";
    renderHand();
    if (game.abilitiesOn && game.teams) { // 팀전: 지금 보이는 카드가 어느 팀 카드인지
      const handSeat = m.mode === "local" ? game.current : m.mySeats[0];
      if (handSeat !== undefined) sideStack.querySelector(".hand-header strong").textContent = `${teamOf(handSeat)} 공용 능력 카드`;
    }
    // 기록
    logEl.innerHTML = game.log.slice(-9).map((l) => `<div class="yl yl-${l.kind}">${esc(l.text)}</div>`).join("");
    logEl.scrollTop = logEl.scrollHeight;
    m.setTopActions(m.mySeats.length && !game.over && !m.result ? [{ label: "기권", onClick: resignMine }] : []);
    if (dealing && !dealStarted) {
      dealStarted = true;
      m.later(startCardRoulette, 80);
    }
  }

  async function resignMine() {
    const seat = m.mode === "local" ? game.current : m.mySeats[0];
    if (await confirmBox("기권", `${seatNames[seat]} 님, 정말 기권할까요?`, "기권", "계속")) m.submit({ type: "resign" }, seat);
  }

  /** Esc: 능력 대상을 고르는 중이면 나가기 대신 고르기만 취소 */
  function cancelInput() {
    if (!targeting) return false;
    targeting = null;
    render();
    return true;
  }

  return { el: root, sideEl: sideStack, apply, resign, render, cancelInput, destroy: () => { clearInterval(dealInterval); skipCardRoulette = null; dealModalClose?.(); dealModalClose = null; tossCancel?.(); tossCancel = null; document.removeEventListener("keydown", onKey); } };
}
