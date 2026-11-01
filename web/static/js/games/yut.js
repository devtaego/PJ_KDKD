// 윷놀이 화면: 2~4명, 한 기기 또는 온라인 (컴퓨터 대전 없음)
// 판은 위에서 내려다본 정사각형(출발은 오른쪽 아래), 말은 서 있는 캐릭터. 대기 말은 판 위아래에 두고 눌러서 올림
// 윷은 판 위로 크게 던져서 떨어지고, 아래에는 결과만 작게
import { YutGame, START, HOME, CENTER, RESULT_NAMES, pathFrom } from "../engine/yut.js";
import { ABILITY_BY_ID, TIERS, START_HAND, abilityOdds, THROW_ODDS } from "../data/yut_abilities.js";
import { el, confirmBox, modal } from "../ui.js";
import { esc } from "../art.js";
import { CHARACTERS, CHAR_IDS, charSvg } from "./yut_chars.js";

export const PLAYER_COLORS = ["#FF5C8A", "#4DABF7", "#FFC94D", "#3DDC97"];
export const MODES = { basic: "기본", special: "특수능력", chaos: "막장" };

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
const DOCKS = [[10, 202], [132, 202], [132, 24], [10, 24]];
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
  const game = new YutGame(m.seats.map((s) => s.name), { pieces, mode, seed: Number(m.settings.seed) || 1, teams: m.settings.team === "1" });
  const TEAM_NAMES = ["A팀", "B팀"];
  const teamOf = (i) => TEAM_NAMES[i % 2];
  // 말 캐릭터: 자리마다 다른 캐릭터로 시작, 자리 카드의 '말' 버튼으로 바꿈
  const skins = m.seats.map((_, i) => CHARACTERS[i % CHARACTERS.length].id);
  let sel = null; // 고른 말 번호 (업힌 말은 맨 앞 번호)
  let selOwner = null; // 고른 말의 주인 (팀전에서 내 말이 다 들어오면 같은 팀 말을 옮김)
  let targeting = null; // { hand, def, own? }
  let tossing = false;
  // 지금 움직이는 말 { seat, node, count, victims }: 그동안 옮긴 말만 숨기고(도착 칸에 원래 있던 내 말은 그대로),
  // 잡힌 말은 잡는 말이 도착할 때까지 그 칸에 남겨 둠. 유령 말이 길을 따라 콩콩
  let anim = null;
  const picked = new Set(); // 말을 고른 자리
  let picking = null; // 지금 열린 고르기 창 { seat, close }
  const pickSent = {}; // 자리 -> 고른 걸 보낸 시각 (온라인에서 답이 오기 전에 창이 다시 뜨지 않게)
  const allPicked = () => game.players.every((p, i) => picked.has(i) || p.resigned || m.offline.has(i));
  const takenBy = (id, except) => skins.findIndex((k, i) => i !== except && picked.has(i) && k === id);

  m.root.classList.add("yut-screen");
  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip yut-seats"></div>
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
      <div class="hand"></div>
    </div></div>`);
  const side = el(`<div class="card yut-log-card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">진행 상황</h3><button class="btn ghost small odds-btn">확률표</button></div>
    <div class="muted mode-line" style="font-size:13px;margin-bottom:6px"></div><div class="yut-log"></div></div>`);
  const seatsEl = root.querySelector(".yut-seats");
  const boardEl = root.querySelector(".yut-board");
  const fxEl = root.querySelector(".yut-fx");
  const tossEl = root.querySelector(".yut-toss");
  const ghostEl = root.querySelector(".yut-ghost");
  const throwBtn = root.querySelector(".throw-btn");
  const turnStatusEl = root.querySelector(".yut-turn-status");
  const resultsEl = root.querySelector(".results");
  const hintEl = root.querySelector(".yut-hint");
  const handEl = root.querySelector(".hand");
  const logEl = side.querySelector(".yut-log");
  side.querySelector(".mode-line").textContent = `${MODES[mode]} 모드${game.teams ? ` · 2:2 팀전 (A팀 ${m.seats[0].name} · ${m.seats[2].name} / B팀 ${m.seats[1].name} · ${m.seats[3].name})` : ""} · 말 ${pieces}개씩${mode !== "basic" ? ` · 시작할 때 능력 카드 ${START_HAND[mode]}장` : ""}`;
  side.querySelector(".odds-btn").onclick = () => showOdds(mode);

  const myTurn = () => !game.over && !m.result && m.controls(game.current);
  const seed = () => Math.floor(Math.random() * 2 ** 31); // 온라인에서는 서버가 덮어씀
  const act = (a) => m.submit({ ...a, seed: seed() }, game.current);
  const cur = () => game.players[game.current];
  const firstWaiting = (s = game.current) => game.players[s].pieces.findIndex((q) => q.node === START);

  const canMoveOwner = (s2) => game.movers(game.current).includes(s2);
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
    if (!myTurn() || game.phase !== "move" || targeting) { sel = null; selOwner = null; return; }
    if (sel !== null && !destinations(sel, selOwner).size) sel = null;
    if (sel === null) {
      const g = movableGroups();
      if (g.length === 1) [selOwner, sel] = g[0];
    }
  }

  // ------------------------------------------------------------ 입력
  throwBtn.onclick = () => { if (myTurn() && game.phase === "throw" && !tossing && allPicked()) act({ type: "throw" }); };
  resultsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (b && myTurn() && game.phase === "move" && sel !== null) act({ type: "move", piece: sel, res: +b.dataset.res, owner: selOwner });
  });
  const onKey = (e) => {
    if (e.code !== "Space" || e.target.closest?.("input, textarea") || document.querySelector(".modal-back")) return;
    e.preventDefault();
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
    if (!myTurn()) return;
    const dest = e.target.closest("[data-dest]");
    const pc = e.target.closest("[data-seat]");
    const nd = e.target.closest("[data-node]");
    const seat = pc ? +pc.dataset.seat : null, idx = pc ? +pc.dataset.idx : null;
    if (targeting) {
      const tg = targeting.def.target;
      if (tg === "oppPiece" && pc && !game.ally(game.current, seat)) act({ type: "ability", hand: targeting.hand, t: { opp: { seat, idx } } });
      else if (tg === "ownPiece" && pc && seat === game.current) act({ type: "ability", hand: targeting.hand, t: { own: idx } });
      else if (tg === "node" && nd && !pc) act({ type: "ability", hand: targeting.hand, t: { node: +nd.dataset.node } });
      else if (tg === "swap") {
        if (targeting.own === undefined && pc && seat === game.current) { targeting.own = idx; render(); return; }
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
    if (nd && +nd.dataset.node === 0 && firstWaiting() >= 0) { sel = firstWaiting(); selOwner = game.current; render(); }
  });

  // 말 캐릭터 고르기 창: 시작할 때 한 번만 (꼭 골라야 해서 닫기 없음, 게임 중에는 못 바꿈)
  function openPicker(s, first) {
    picking?.close();
    const body = el(`<div><p class="muted" style="margin:0 0 10px">판에 세울 내 말을 골라요. 다른 사람이 고른 캐릭터는 못 고르고, 한 번 고르면 게임 끝까지 그대로예요.</p><div class="skin-pick"></div></div>`);
    const grid = body.querySelector(".skin-pick");
    let done = () => {};
    for (const { id, name } of CHARACTERS) {
      const owner = takenBy(id, s);
      const btn = el(`<button type="button" class="skin-opt${skins[s] === id && picked.has(s) ? " on" : ""}" aria-label="${esc(name)}" ${owner >= 0 ? "disabled" : ""}><svg viewBox="-11 -27 22 29">${tokenSvg(0, 0, s, { skin: id })}</svg><span>${owner >= 0 ? `${esc(m.seats[owner].name.slice(0, 5))} 님` : esc(name)}</span></button>`);
      btn.onclick = () => { pickSent[s] = Date.now(); m.submit({ type: "skin", skin: id }, s); done(); };
      grid.appendChild(btn);
    }
    const close = modal(`${m.seats[s].name} 님, 말을 골라요`, body, { closable: !first });
    done = () => { close(); picking = null; };
    picking = { seat: s, close: done };
  }
  seatsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-skin]");
    if (!b) return;
    const s = +b.dataset.skin;
    if (!m.controls(s) || m.result || picked.has(s)) return; // 한 번 고르면 끝까지 그 캐릭터
    openPicker(s, true);
  });
  /** 아직 말을 안 고른 내 자리가 있으면 고르기 창을 띄움 (한 기기면 자리 순서대로) */
  function promptPick() {
    if (m.replaying || game.over || m.result || picking) return;
    const s = game.players.findIndex((p, i) => !picked.has(i) && !p.resigned && m.controls(i));
    if (s < 0) return;
    if (Date.now() - (pickSent[s] || 0) < 2500) { m.later(promptPick, 2600); return; } // 이미 보냄: 남이 먼저 고른 캐릭터였으면 그때 다시
    m.later(() => { if (!picking && !picked.has(s)) openPicker(s, true); }, 150);
  }

  // ------------------------------------------------------------ 행동 적용
  function apply(a, at, seat) {
    if (a.type === "skin") { // 시작할 때 한 번만 (이미 고른 자리는 무시)
      if (!picked.has(seat) && CHAR_IDS.has(a.skin) && takenBy(a.skin, seat) < 0) { skins[seat] = a.skin; picked.add(seat); }
      if (picking && picking.seat !== seat) openPicker(picking.seat, !picked.has(picking.seat)); // 남이 방금 고른 캐릭터를 내 창에서도 막음
      return;
    }
    if (game.over || seat !== game.current) return;
    const sd = Number.isInteger(a.seed) ? a.seed : 0;
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
    const scores = Object.fromEntries(order.map((i) => [i, `${game.teams ? `${teamOf(i)} · ` : ""}${game.finished(i)}/${pieces} 도착`]));
    const title = !winners.length ? "게임 끝" : game.teams ? `${teamOf(winners[0])} (${winners.map((i) => m.seats[i].name).join(" · ")}) 승리!` : `${m.seats[winners[0]].name} 승리!`;
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

  function playEvents() {
    // 말이 길을 따라가는 동안에는 잡기 · 도착 · 폭탄 연출을 도착한 뒤로 미룸
    const mv = game.events.find((e) => e.kind === "move");
    const arrive = mv ? 60 + routeNodes(mv.from, mv.to).length * 150 : 0;
    const atArrival = (fn) => (arrive ? m.later(fn, arrive) : fn());
    for (const e of game.events) {
      if (e.kind === "throw") {
        tossing = true;
        m.sfx("yut");
        tossSticks(e.value);
        // Keep the extra throw locked until the result animation is readable.
        m.later(() => { tossing = false; render(); }, 2600);
      } else if (e.kind === "move") hopAlong(e);
      else if (e.kind === "catch") atArrival(() => { m.sfx("thud"); shout("잡았다!", "good"); });
      else if (e.kind === "boom") atArrival(() => { m.sfx("thud"); shout("펑!!", "bad"); });
      else if (e.kind === "home") atArrival(() => { m.sfx("pop"); shout("도착!", "good"); });
      else if (e.kind === "ability") {
        const d = ABILITY_BY_ID[e.id];
        m.sfx("pop");
        shout(d.shout, `tier-${d.tier} big`, `${TIERS[d.tier].name} · ${d.name}`);
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
    const steps = routeNodes(e.from, e.to).map(posOf);
    const mover = (e.parts && e.parts[0] && e.parts[0][0]) ?? e.seat; // 팀전에서 같은 팀 말을 옮겼으면 그 말의 주인
    const start = e.from === START ? [DOCKS[mover][0], DOCKS[mover][1]] : posOf(e.from);
    // 잡힌 말: 지금은 이미 출발점(START)에 있지만, 도착 전까지 그 칸에 그려 둠
    const victims = game.events.filter((c) => c.kind === "catch" && c.node === e.to).map((c) => ({
      seat: c.victim, idxs: game.players[c.victim].pieces.map((q, i) => [q, i]).filter(([q]) => q.node === START).slice(-c.count).map(([, i]) => i),
    }));
    const atDest = game.players.reduce((n, pl, s2) => n + (game.ally(e.seat, s2) ? pl.pieces.filter((q) => q.node === e.to).length : 0), 0);
    const stacked = e.to !== HOME && atDest > e.count;
    anim = { seat: e.seat, node: e.to, count: e.count, parts: e.parts || [[e.seat, e.count]], victims };
    ghostEl.innerHTML = `<g class="ghost" style="transform:translate(${start[0]}px,${start[1]}px)">${tokenSvg(0, 0, mover, { sc: 0.78, count: e.count })}</g>`;
    const g = ghostEl.firstElementChild;
    steps.forEach(([x, y], i) => m.later(() => { g.style.transform = `translate(${x}px,${y}px)`; m.sfx("tick"); }, 60 + i * 150));
    m.later(() => { anim = null; ghostEl.innerHTML = ""; render(); if (stacked) shout("업었다!", "good"); }, 60 + steps.length * 150 + 120);
  }

  function showOdds(md) {
    const rows = md === "basic" ? "<p class=\"muted\">기본 모드는 능력이 없어요.</p>" : `<table class="rank odds"><thead><tr><th>등급</th><th>능력</th><th>확률</th></tr></thead><tbody>${abilityOdds(md).map((a) =>
      `<tr><td><span class="tier-dot" style="background:${TIERS[a.tier].color}"></span>${TIERS[a.tier].name}</td><td style="text-align:left"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.desc)}</div></td><td>${a.pct.toFixed(1)}%</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:13px">시작할 때 한 장씩 ${START_HAND[md]}번 뽑아요 (카드마다 위 확률). 한 차례에 1장만 쓸 수 있어요.</p>`;
    const throws = THROW_ODDS.map((o) => `${o.name} ${Math.round(o.p * 100)}%`).join(" · ");
    modal(`${MODES[md]} 모드 확률표`, el(`<div><p class="muted" style="margin-top:0">윷 결과: ${throws}</p>${rows}</div>`));
  }

  // ------------------------------------------------------------ 그리기
  /** 윷가락 4개를 판 위로 크게 던져서 떨어뜨림 (떨어진 모양 = 나온 결과) */
  /** 윷가락 하나 (SVG): 둥근 윗머리, 나뭇결, 아래 끝은 반달 단면 */
  function stickSvg(flat, back) {
    const x = (y) => `<path d="M11.4 ${y - 3.4} l7.2 6.8 M18.6 ${y - 3.4} l-7.2 6.8"/>`;
    const id = flat ? "ysf" : "ysr";
    return `<svg viewBox="0 0 30 132" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="1">${flat
        ? '<stop offset="0" stop-color="#FFE4B8"/><stop offset="0.45" stop-color="#F9CF95"/><stop offset="1" stop-color="#E9AE70"/>'
        : '<stop offset="0" stop-color="#B9692E"/><stop offset="0.4" stop-color="#D58C4E"/><stop offset="1" stop-color="#9A5322"/>'}</linearGradient></defs>
      <path d="M3 116 Q15 129 27 116Z" fill="${flat ? "#EFC08C" : "#7E4320"}" stroke="#4A2E1A" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M3 14 Q3 3 15 3 Q27 3 27 14 V116 H3Z" fill="url(#${id})" stroke="#4A2E1A" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M7 12 V110" stroke="rgba(255,255,255,${flat ? 0.45 : 0.22})" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M12 20 Q13 60 11.5 104 M20 16 Q19 52 20.5 98" fill="none" stroke="${flat ? "rgba(196,120,60,0.22)" : "rgba(60,30,10,0.18)"}" stroke-width="0.8"/>
      ${flat ? "" : `<g stroke="#4A2E1A" stroke-width="1.2" stroke-linecap="round">${x(32)}${x(60)}${x(88)}</g>`}
      ${back ? '<g stroke="#E03131" stroke-width="2.6" stroke-linecap="round"><path d="M9 52 l12 12 M21 52 l-12 12"/></g>' : ""}
    </svg>`;
  }

  /** 윷가락 4개를 판 위로 던져서 나란히 세우고, 옆에 결과와 몇 칸 가는지 적음
   *  평평한 면은 밝은 나무 그대로, 둥근 등은 진한 나무에 × 무늬, 빽도는 표시 가락의 평평한 면에 빨간 × */
  function tossSticks(value) {
    const flats = FLATS[value] ?? [0, 0, 0, 0];
    const sticks = flats.map((f, i) => `<div class="stick big" style="--d:${i * 60}ms;--s:${(i - 1.5) * 14}deg">${stickSvg(f, f && value === -1 && i === 0)}</div>`).join("");
    const steps = value === -1 ? "1칸 뒤로" : `${value}칸 앞으로`;
    tossEl.innerHTML = `<div class="toss-row"><div class="toss-sticks">${sticks}</div>
      <div class="toss-cap${value >= 4 ? " good" : value === -1 ? " bad" : ""}"><b>${RESULT_NAMES[value]}</b><span>${steps}</span>${value >= 4 ? "<span>한 번 더 던지기!</span>" : ""}</div></div>`;
    m.later(() => tossEl.firstElementChild?.classList.add("out"), 2100);
    m.later(() => { if (!tossing) tossEl.innerHTML = ""; }, 2500);
  }

  /** 서 있는 말 하나 (발끝이 x, y): 자리 색 받침 위에 캐릭터 */
  function tokenSvg(x, y, seat, { sc = 1, cls = "", data = "", count = 0, shield = false, ring = "", skin = skins[seat] } = {}) {
    const c = PLAYER_COLORS[seat];
    return `<g class="yb-piece ${cls}" ${data} transform="translate(${x} ${y}) scale(${sc})">
      <ellipse class="yb-hit" rx="7" ry="11" cy="-10"/>
      <ellipse class="yb-shadow" rx="5.6" ry="2.3" cy="0.8"/>
      ${ring ? `<ellipse class="yb-ring ${ring}" rx="6.8" ry="2.9" cy="0.2"/>` : ""}
      ${shield ? `<ellipse class="yb-shield" rx="7.6" ry="3.3" cy="0.2"/>` : ""}
      <g class="yb-bob">
        <ellipse rx="5" ry="2.1" cy="0.7" fill="${shade(c, -0.45)}"/>
        <ellipse rx="5" ry="2.1" cy="-0.5" fill="${c}"/>
        <ellipse rx="3.4" ry="1.2" cy="-0.8" fill="${shade(c, 0.35)}"/>
        <g transform="translate(0 -0.6)">${charSvg(skin)}</g>
        ${count > 1 ? `<g transform="translate(5.2 -19)"><circle r="2.8" class="yb-badge"/><text y="1.15" class="yb-count">×${count}</text></g>` : ""}
      </g></g>`;
  }

  function drawBoard() {
    const parts = [];
    const mine = myTurn();
    const moving = mine && game.phase === "move" && !targeting;
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
    const dests = sel !== null ? destinations(sel, selOwner) : new Map();
    // 칸 (뒤에서 앞 순서로)
    const order = Object.keys(SP).map(Number).sort((a, b) => SP[a][1] - SP[b][1]);
    for (const n of order) {
      const [x, y] = SP[n];
      const rb = BIG.has(n) ? 4.6 : 3.2, rx = rb * SX, ry = rb * SY, h = 1.2;
      const cls = ["yb-tile"];
      if (n === 0) cls.push("start");
      else if (BIG.has(n)) cls.push("corner");
      if (dests.has(n)) cls.push("dest");
      if (targeting?.def.target === "node") cls.push("pickable");
      parts.push(`<g data-node="${n}" class="${cls.join(" ")}"${dests.has(n) ? ` data-dest="${dests.get(n)[0]}"` : ""}>
        <ellipse class="side" cx="${x}" cy="${y + h}" rx="${rx}" ry="${ry}"/><rect class="side" x="${x - rx}" y="${y}" width="${rx * 2}" height="${h}"/>
        <ellipse class="top" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>${BIG.has(n) ? `<ellipse class="ring" cx="${x}" cy="${y}" rx="${rx * 0.7}" ry="${ry * 0.7}"/>` : ""}</g>`);
    }
    // 고른 말이 결과마다 지나갈 길
    if (sel !== null) {
      const pc = game.players[selOwner].pieces[sel];
      for (const [node] of dests) {
        const pts = [pc.node === START ? SP[0] : posOf(pc.node), ...routeNodes(pc.node, node).map(posOf)];
        parts.push(`<polyline class="yb-route" points="${pts.map((q) => q.join(",")).join(" ")}"/>`);
      }
    }
    for (const [n, t] of [[5, "지름길"], [10, "지름길"], [CENTER, "가운데"]]) parts.push(`<text x="${SP[n][0]}" y="${SP[n][1] + 1.2}" class="yb-corner-label">${t}</text>`);
    // 출발 칸 오른쪽 판 밖에 ⬆ (처음 가는 쪽). 글자는 아래 '출발 · 골인' 팻말 하나만
    parts.push(`<g class="yb-go" transform="translate(${BR[0] + 9.5} ${SP[0][1] + 2})"><g class="yb-go-in"><path d="M0 -36 L8 -25 H3.2 V0 H-3.2 V-25 H-8Z" transform="scale(0.55)"/></g></g>`);
    { // 출발 · 골인 팻말 (판 앞면, 출발 칸 아래)
      const [x] = SP[0];
      parts.push(`<g class="yb-start-sign" transform="translate(${x - 8} ${BR[1] + 3.6})"><rect x="-15" y="-3.6" width="30" height="7.2" rx="2.2"/><text y="1.4">출발 · 골인</text></g>`);
    }
    for (const [node, owner] of Object.entries(game.bombs)) {
      const [x, y] = SP[node];
      parts.push(`<g class="yb-bomb" transform="translate(${x} ${y - 2.6})"><circle r="2.8" fill="#1E1B18" stroke="${PLAYER_COLORS[owner]}" stroke-width="0.6"/><circle cx="-0.9" cy="-0.9" r="0.8" fill="rgba(255,255,255,0.4)"/><path d="M1.6 -2 q1.5 -2 3 -1" stroke="#C9A36B" stroke-width="0.6" fill="none"/><circle cx="4.6" cy="-3" r="0.9" fill="#FF8A3D"/></g>`);
    }
    // 말 (판 위): 칸마다 주인별로 묶어서, 앞(아래)에 있는 말을 나중에 그림
    const tokens = [];
    const pickableFor = (seat, onBoard) => targeting && ((targeting.def.target === "oppPiece" && !game.ally(game.current, seat) && onBoard) ||
      (targeting.def.target === "ownPiece" && seat === game.current && (onBoard || ["gazua", "yeongkkeul"].includes(targeting.def.id))) ||
      (targeting.def.target === "swap" && onBoard && (targeting.own === undefined ? seat === game.current : !game.ally(game.current, seat))));
    const byNode = {};
    game.players.forEach((p, s) => p.pieces.forEach((pc, i) => {
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
      if (byNode[anim.node] && !Object.keys(byNode[anim.node]).length) delete byNode[anim.node];
    }
    for (const [node, owners] of Object.entries(byNode)) {
      const list = Object.entries(owners);
      list.forEach(([s, idxs], k) => {
        const seat = +s, [x, y] = SP[node];
        const off = list.length > 1 ? (k - (list.length - 1) / 2) * 6 : 0;
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
    // 대기 말: 자리마다 판 위아래 띠에
    game.players.forEach((p, s) => {
      const [dx, dy] = DOCKS[s];
      const waiting = p.pieces.map((pc, i) => [pc, i]).filter(([pc, i]) => pc.node === START && !hiddenStart.has(`${s}:${i}`));
      const fin = game.finished(s);
      const turn = game.current === s && !game.over;
      tokens.push([dy - 30, `<g class="yb-dock${turn ? " on" : ""}"><rect x="${dx - 6}" y="${dy - 17}" width="64" height="20" rx="5" style="--pc:${PLAYER_COLORS[s]}"/>
        <text x="${dx + 30}" y="${dy - 9.5}" class="yb-dock-name" fill="${PLAYER_COLORS[s]}">${game.teams ? `${teamOf(s)} · ` : `${s + 1}P · `}출발</text>
        <text x="${dx + 30}" y="${dy - 4.6}" class="yb-dock-sub">말 대기</text>
        ${turn ? `<g transform="translate(${dx + 50} ${dy - 17})"><g class="yb-turn-tag"><rect x="-8" y="-3.4" width="16" height="6.8" rx="3.4" style="--pc:${PLAYER_COLORS[s]}"/><text y="1.3">차례!</text></g></g>` : ""}</g>`]);
      const rep = waiting.length ? waiting[0][1] : -1;
      waiting.forEach(([, i], k) => {
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
      const tag = node === HOME ? "골인!" : boom ? "폭탄!" : opp ? "잡기!" : mineThere ? "업기" : "";
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

  function render() {
    // 자리 카드: 도착 수 · 대기 말 · 카드 수, 내 자리는 '말' 버튼으로 캐릭터 바꾸기
    seatsEl.style.setProperty("--n", game.players.length);
    seatsEl.innerHTML = game.players.map((p, i) => {
      const waiting = p.pieces.filter((q) => q.node === START).length;
      const fin = game.finished(i);
      const turn = !game.over && !m.result && game.current === i;
      const off = m.offline.has(i), left = off ? m.secondsLeft(i) : null;
      const status = p.resigned ? "기권" : off ? (left !== null ? `연결 끊김 · ${left}초` : "연결 끊김") : !picked.has(i) ? "말 고르는 중…" : p.ward ? "어쩔티비 준비" : "";
      const me = m.controls(i) && m.mode !== "local" ? " (나)" : "";
      const choose = m.controls(i) && !m.result && !picked.has(i);
      return `<div class="ys-card${turn ? " turn" : ""}${p.resigned ? " out" : ""}" style="--pc:${PLAYER_COLORS[i]}">
        ${choose ? `<button class="ys-char" data-skin="${i}" title="말 캐릭터 고르기" aria-label="${esc(m.seats[i].name)} 말 캐릭터 고르기">` : `<div class="ys-char">`}<svg viewBox="-9 -25 18 27">${tokenSvg(0, 0, i)}</svg>${choose ? "</button>" : "</div>"}
        <div class="ys-info"><div class="ys-name">${esc(m.seats[i].name + me)}</div>
          <div class="ys-stats">${game.teams ? `<span class="ys-team t${i % 2}">${teamOf(i)}</span>` : ""}<span>남은 <b>${waiting}</b></span><span>골인 <b>${fin}/${pieces}</b></span>${game.abilitiesOn ? `<span>카드 <b>${p.hand.length}</b></span>` : ""}</div>
          ${status ? `<div class="ys-status">${esc(status)}</div>` : ""}</div>
        ${turn ? `<span class="ys-turn">차례</span>` : ""}</div>`;
    }).join("");

    const p = cur();
    turnStatusEl.innerHTML = `<b style="color:${PLAYER_COLORS[game.current]}">${esc(p.name)}</b> ${game.teams ? `<span class="ys-team t${game.current % 2}">${teamOf(game.current)}</span>` : ""} 차례 <span>${game.phase === "move" ? `말 이동 · 남은 결과 ${game.pending.length}개` : game.throws > 1 ? `추가로 ${game.throws}번 던질 수 있어요` : "윷 던지기"}</span>`;
    drawBoard();
    // 던지기 버튼과 남은 결과
    const mine = myTurn();
    throwBtn.disabled = game.over || !mine || game.phase !== "throw" || tossing || !allPicked();
    throwBtn.innerHTML = game.over ? "게임 끝" : !mine ? `${esc(p.name)} 님 차례` : game.phase === "throw" ? `${game.throws > 1 ? "한 번 더 던지기" : "윷 던지기"}${game.throws > 1 ? ` ×${game.throws}` : ""} <kbd>Space</kbd>` : "말을 움직여요";
    const can = sel !== null ? destinations(sel, selOwner) : new Map();
    const usable = new Set([...can.values()].flat());
    resultsEl.innerHTML = game.pending.map((r, i) => usable.has(i)
      ? `<button class="res-chip go${r === -1 ? " back" : ""}" data-res="${i}" title="고른 말을 ${RESULT_NAMES[r]}만큼 옮기기">${RESULT_NAMES[r]} ▶</button>`
      : `<span class="res-chip${r === -1 ? " back" : ""}">${RESULT_NAMES[r]}</span>`).join("");
    // 안내
    if (game.over || m.result) hintEl.textContent = m.result ? m.result.title : "";
    else if (targeting) {
      const t = targeting.def.target;
      hintEl.textContent = `「${targeting.def.name}」 ${t === "oppPiece" ? "상대 말을 눌러요" : t === "ownPiece" ? "내 말을 눌러요" : t === "node" ? "폭탄을 놓을 빈칸을 눌러요" : targeting.own === undefined ? "먼저 내 말을 눌러요" : "바꿀 상대 말을 눌러요"} · 카드를 다시 누르면 취소`;
    } else if (!mine) hintEl.textContent = `${p.name} 님 차례${game.phase === "move" ? " · 말 옮기는 중" : ""}`;
    else if (!allPicked()) hintEl.textContent = `모두 말을 고르면 시작해요 (${picked.size}/${game.players.length})`;
    else if (game.phase === "throw") hintEl.textContent = game.pending.length ? `윷·모가 나왔어요! 한 번 더 던져요 (${game.throws}회 남음) · 결과 ${game.pending.length}개는 다음에 옮겨요` : `윷을 던져요${game.abilitiesOn ? " (능력 카드는 한 차례에 한 장)" : ""}`;
    else hintEl.textContent = sel !== null ? `선택한 말로 결과 ${game.pending.length}개 중 하나를 옮겨요 · 말풍선 또는 아래 결과 버튼 누르기` : "옮길 말을 눌러요. 갈 수 있는 칸의 결과 말풍선이나 아래 결과 버튼을 누르면 이동해요.";
    // 능력 카드
    if (game.abilitiesOn) {
      const showHand = m.mode === "local" ? p.hand : (m.mySeats.length ? game.players[m.mySeats[0]].hand : []);
      handEl.innerHTML = showHand.length ? showHand.map((id, i) => {
        const d = ABILITY_BY_ID[id];
        const usable = mine && !game.usedAbility && (m.mode === "local" || m.mySeats[0] === game.current);
        return `<button class="ability-card tier-${d.tier}${targeting?.hand === i ? " on" : ""}" data-hand="${i}" ${usable ? "" : "disabled"} style="--tier:${TIERS[d.tier].color}">
          <span class="ac-tier">${TIERS[d.tier].name}</span><span class="ac-name">${esc(d.name)}</span><span class="ac-desc">${esc(d.desc)}</span></button>`;
      }).join("") : `<div class="muted hand-empty">능력 카드를 다 썼어요</div>`;
    } else handEl.innerHTML = "";
    // 기록
    logEl.innerHTML = game.log.slice(-9).map((l) => `<div class="yl yl-${l.kind}">${esc(l.text)}</div>`).join("");
    logEl.scrollTop = logEl.scrollHeight;
    m.setTopActions(m.mySeats.length && !game.over && !m.result ? [{ label: "기권", onClick: resignMine }] : []);
    promptPick();
  }

  async function resignMine() {
    const seat = m.mode === "local" ? game.current : m.mySeats[0];
    if (await confirmBox("기권", `${m.seats[seat].name} 님, 정말 기권할까요?`, "기권", "계속")) m.submit({ type: "resign" }, seat);
  }

  return { el: root, sideEl: side, apply, resign, render, destroy: () => { picking?.close(); document.removeEventListener("keydown", onKey); } };
}
