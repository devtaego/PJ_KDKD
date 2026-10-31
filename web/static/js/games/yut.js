// 윷놀이 화면: 2~4명, 한 기기 또는 온라인 (컴퓨터 대전 없음)
// 판은 비스듬히 내려다본 입체 마름모(출발이 아래), 말은 서 있는 캐릭터. 대기 말은 판 귀퉁이에 두고 눌러서 올림
// 윷은 판 위로 크게 던져서 떨어지고, 아래에는 결과만 작게
import { YutGame, START, HOME, CENTER, RESULT_NAMES } from "../engine/yut.js";
import { ABILITY_BY_ID, TIERS, START_HAND, abilityOdds, THROW_ODDS } from "../data/yut_abilities.js";
import { seatCard } from "../match.js";
import { el, confirmBox, modal } from "../ui.js";
import { esc } from "../art.js";
import { CHARACTERS, CHAR_IDS, charSvg } from "./yut_chars.js";

export const PLAYER_COLORS = ["#FF5C8A", "#4DABF7", "#FFC94D", "#3DDC97"];
export const MODES = { basic: "기본", special: "특수능력", chaos: "개막장" };

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
// 비스듬히 본 화면 좌표: 45도 돌려 출발(0)이 아래로 오게 하고, 세로를 눌러 기울어진 느낌
const SCALE = 1.5, TILT = 0.6, CX = 100, CY = 76;
const proj = (x, y) => {
  const u = x - 50, v = y - 50;
  return [CX + (u - v) * 0.7071 * SCALE, CY + (u + v) * 0.7071 * SCALE * TILT];
};
const SP = Object.fromEntries(Object.entries(POS).map(([n, [x, y]]) => [n, proj(x, y)]));
const BIG = new Set([0, 5, 10, 15, CENTER]);
// 대기 말 자리 (판 귀퉁이): 0 왼쪽 아래, 1 오른쪽 아래, 2 오른쪽 위, 3 왼쪽 위
const DOCKS = [[14, 136], [150, 136], [150, 32], [14, 32]];
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
  const game = new YutGame(m.seats.map((s) => s.name), { pieces, mode, seed: Number(m.settings.seed) || 1 });
  // 말 캐릭터: 자리마다 다른 캐릭터로 시작, 자리 카드의 '말' 버튼으로 바꿈
  const skins = m.seats.map((_, i) => CHARACTERS[i % CHARACTERS.length].id);
  let sel = null; // 고른 내 말 번호 (업힌 말은 맨 앞 번호)
  let targeting = null; // { hand, def, own? }
  let tossing = false;

  m.root.classList.add("yut-screen");
  const root = el(`<div class="board-wrap" style="width:100%">
    <div class="seat-strip yut-seats"></div>
    <div class="yut-stage">
      <div class="yut-board" role="img" aria-label="윷판"></div>
      <div class="yut-toss" aria-hidden="true"></div>
      <div class="yut-fx" aria-live="polite"></div>
    </div>
    <div class="yut-panel">
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
  const throwBtn = root.querySelector(".throw-btn");
  const resultsEl = root.querySelector(".results");
  const hintEl = root.querySelector(".yut-hint");
  const handEl = root.querySelector(".hand");
  const logEl = side.querySelector(".yut-log");
  side.querySelector(".mode-line").textContent = `${MODES[mode]} 모드 · 말 ${pieces}개씩${mode !== "basic" ? ` · 시작할 때 능력 카드 ${START_HAND[mode]}장` : ""}`;
  side.querySelector(".odds-btn").onclick = () => showOdds(mode);

  const myTurn = () => !game.over && !m.result && m.controls(game.current);
  const seed = () => Math.floor(Math.random() * 2 ** 31); // 온라인에서는 서버가 덮어씀
  const act = (a) => m.submit({ ...a, seed: seed() }, game.current);
  const cur = () => game.players[game.current];
  const firstWaiting = (s = game.current) => game.players[s].pieces.findIndex((q) => q.node === START);

  /** 이 말로 갈 수 있는 칸 → 쓸 결과 번호들 */
  function destinations(idx) {
    const out = new Map();
    const pc = cur().pieces[idx];
    if (!pc) return out;
    game.pending.forEach((r, i) => {
      const d = game.destOf(pc, r);
      if (d !== null) { if (!out.has(d)) out.set(d, []); out.get(d).push(i); }
    });
    return out;
  }
  /** 옮길 수 있는 말 묶음 (칸마다 대표 번호 하나, 대기 말은 하나로) */
  function movableGroups() {
    const seen = new Set(), out = [];
    cur().pieces.forEach((pc, i) => {
      if (pc.node === HOME || seen.has(pc.node)) return;
      seen.add(pc.node);
      if (destinations(i).size) out.push(i);
    });
    return out;
  }
  /** 고른 말이 아직 쓸 수 있는지 보고, 고를 게 하나뿐이면 저절로 고름 */
  function fixSelection() {
    if (!myTurn() || game.phase !== "move" || targeting) { sel = null; return; }
    if (sel !== null && !destinations(sel).size) sel = null;
    if (sel === null) {
      const g = movableGroups();
      if (g.length === 1) sel = g[0];
    }
  }

  // ------------------------------------------------------------ 입력
  throwBtn.onclick = () => { if (myTurn() && game.phase === "throw" && !tossing) act({ type: "throw" }); };
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
    if (game.phase !== "move") return;
    if (dest && sel !== null) { act({ type: "move", piece: sel, res: +dest.dataset.dest }); return; }
    if (pc && seat === game.current) {
      if (sel === idx) { // 같은 말을 한 번 더 누르면, 갈 곳이 하나뿐일 때 바로 옮김
        const ds = [...destinations(idx).values()];
        if (ds.length === 1) act({ type: "move", piece: idx, res: ds[0][0] });
        return;
      }
      if (destinations(idx).size) { sel = idx; m.sfx("click"); render(); }
      return;
    }
    if (nd && +nd.dataset.node === 0 && firstWaiting() >= 0) { sel = firstWaiting(); render(); }
  });

  // 자리 카드의 '말' 버튼: 말 캐릭터 고르기
  seatsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-skin]");
    if (!b) return;
    const s = +b.dataset.skin;
    if (!m.controls(s) || m.result) return;
    const body = el(`<div class="skin-pick"></div>`);
    for (const { id, name } of CHARACTERS) {
      const btn = el(`<button type="button" class="skin-opt${skins[s] === id ? " on" : ""}" aria-label="${esc(name)}"><svg viewBox="-11 -27 22 29">${tokenSvg(0, 0, s, { skin: id })}</svg><span>${esc(name)}</span></button>`);
      btn.onclick = () => { m.submit({ type: "skin", skin: id }, s); close(); };
      body.appendChild(btn);
    }
    const close = modal(`${m.seats[s].name} 님의 말 고르기`, body);
  });

  // ------------------------------------------------------------ 행동 적용
  function apply(a, at, seat) {
    if (a.type === "skin") { // 겉모습만 바뀜 (누구 차례든 상관없음)
      if (CHAR_IDS.has(a.skin)) skins[seat] = a.skin;
      return;
    }
    if (game.over || seat !== game.current) return;
    const sd = Number.isInteger(a.seed) ? a.seed : 0;
    let ok = false;
    if (a.type === "throw") ok = game.throw(sd);
    else if (a.type === "move" && Number.isInteger(a.piece) && Number.isInteger(a.res)) ok = game.move(a.piece, a.res, sd);
    else if (a.type === "ability" && Number.isInteger(a.hand)) ok = game.use(a.hand, a.t || {}, sd);
    if (!ok) return;
    sel = null;
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
        tossSticks(e.value);
        m.later(() => { tossing = false; shout(RESULT_NAMES[e.value], e.value >= 4 ? "good" : e.value === -1 ? "bad" : ""); render(); }, 900);
      } else if (e.kind === "move") m.sfx("move");
      else if (e.kind === "catch") { m.sfx("thud"); shout("잡았다!", "good"); }
      else if (e.kind === "boom") { m.sfx("thud"); shout("펑!!", "bad"); }
      else if (e.kind === "home") { m.sfx("pop"); shout("도착!", "good"); }
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
      <p class="muted" style="font-size:13px">시작할 때 한 장씩 ${START_HAND[md]}번 뽑아요 (카드마다 위 확률). 한 차례에 1장만 쓸 수 있어요.</p>`;
    const throws = THROW_ODDS.map((o) => `${o.name} ${Math.round(o.p * 100)}%`).join(" · ");
    modal(`${MODES[md]} 모드 확률표`, el(`<div><p class="muted" style="margin-top:0">윷 결과: ${throws}</p>${rows}</div>`));
  }

  // ------------------------------------------------------------ 그리기
  /** 윷가락 4개를 판 위로 크게 던져서 떨어뜨림 (떨어진 모양 = 나온 결과) */
  function tossSticks(value) {
    const flats = FLATS[value] ?? [0, 0, 0, 0];
    const lay = [[-27, -14, -18], [-9, 8, 9], [9, -10, -6], [27, 12, 21]]; // 떨어질 자리 (가로 %, 세로 %, 기울기)
    tossEl.innerHTML = `<div class="toss-sticks">${flats.map((f, i) => `<div class="stick big ${f ? "flat" : "round"}" style="--x:${lay[i][0]}%;--y:${lay[i][1]}%;--r:${lay[i][2] + 90}deg;--d:${i * 50}ms">${f && i === 0 ? '<i class="mark"></i>' : ""}${f ? "<b></b><b></b><b></b>" : ""}</div>`).join("")}</div>`;
    m.later(() => tossEl.firstElementChild?.classList.add("out"), 1900);
    m.later(() => { if (!tossing) tossEl.innerHTML = ""; }, 2300);
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
    // 판 바탕: 두께가 있는 마름모
    const [T, R, B, L] = [proj(4, 4), proj(96, 4), proj(96, 96), proj(4, 96)];
    const d = 7, pt = (p, dy = 0) => `${p[0]},${p[1] + dy}`;
    parts.push(`<polygon class="yb-side-l" points="${pt(L)} ${pt(B)} ${pt(B, d)} ${pt(L, d)}"/><polygon class="yb-side-r" points="${pt(B)} ${pt(R)} ${pt(R, d)} ${pt(B, d)}"/>`);
    parts.push(`<polygon class="yb-top" points="${pt(T)} ${pt(R)} ${pt(B)} ${pt(L)}"/>`);
    const inner = [proj(8, 8), proj(92, 8), proj(92, 92), proj(8, 92)];
    parts.push(`<polygon class="yb-inner" points="${inner.map((p) => pt(p)).join(" ")}"/>`);
    // 길
    parts.push(`<g class="yb-lines">`);
    for (const [a, b] of [[0, 5], [5, 10], [10, 15], [15, 0], [5, 15], [10, 0]]) parts.push(`<line x1="${SP[a][0]}" y1="${SP[a][1]}" x2="${SP[b][0]}" y2="${SP[b][1]}"/>`);
    parts.push(`</g>`);
    // 가는 방향 화살표: 바깥 길(빨강)은 출발에서 오른쪽 위로 한 바퀴, 지름길(파랑)은 모서리에서 가운데로
    const arrow = (a, b, cls, size = 1.6) => {
      const [x1, y1] = SP[a], [x2, y2] = SP[b], ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return `<path class="yb-arrow ${cls}" d="M-1.6 -1.7 L1.8 0 L-1.6 1.7 L-0.7 0z" transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${ang}) scale(${size})"/>`;
    };
    parts.push(arrow(0, 1, "main first", 2.6)); // 출발하자마자 가는 쪽은 크게
    for (let k = 1; k < 19; k++) parts.push(arrow(k, k + 1, "main"));
    parts.push(arrow(19, 0, "main"));
    for (const [a, b] of [[5, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 15], [10, 25], [25, 26], [26, 22], [22, 27], [27, 28], [28, 0]]) parts.push(arrow(a, b, "short"));
    // 고른 말이 갈 수 있는 곳
    fixSelection();
    const dests = sel !== null ? destinations(sel) : new Map();
    // 칸 (뒤에서 앞 순서로)
    const order = Object.keys(SP).map(Number).sort((a, b) => SP[a][1] - SP[b][1]);
    for (const n of order) {
      const [x, y] = SP[n];
      const rb = BIG.has(n) ? 4.6 : 3.2, rx = rb * SCALE, ry = rx * TILT, h = BIG.has(n) ? 3 : 2.2;
      const cls = ["yb-tile"];
      if (n === 0) cls.push("start");
      else if (BIG.has(n)) cls.push("corner");
      if (dests.has(n)) cls.push("dest");
      if (targeting?.def.target === "node") cls.push("pickable");
      parts.push(`<g data-node="${n}" class="${cls.join(" ")}"${dests.has(n) ? ` data-dest="${dests.get(n)[0]}"` : ""}>
        <ellipse class="side" cx="${x}" cy="${y + h}" rx="${rx}" ry="${ry}"/><rect class="side" x="${x - rx}" y="${y}" width="${rx * 2}" height="${h}"/>
        <ellipse class="top" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>${n === 0 ? `<text x="${x}" y="${y + 1.3}" class="yb-label">출발</text>` : ""}</g>`);
    }
    for (const [n, t] of [[5, "지름길"], [10, "지름길"], [CENTER, "가운데"]]) parts.push(`<text x="${SP[n][0]}" y="${SP[n][1] + 1.2}" class="yb-corner-label">${t}</text>`);
    { // 출발 · 골인 팻말 (판 앞쪽 모서리)
      const [x, y] = SP[0];
      parts.push(`<g class="yb-start-sign" transform="translate(${x} ${y + 10})"><rect x="-17" y="-4" width="34" height="8" rx="2.4"/><text y="1.5">출발 · 골인</text></g>`);
    }
    for (const [node, owner] of Object.entries(game.bombs)) {
      const [x, y] = SP[node];
      parts.push(`<g class="yb-bomb" transform="translate(${x} ${y - 2.6})"><circle r="2.8" fill="#1E1B18" stroke="${PLAYER_COLORS[owner]}" stroke-width="0.6"/><circle cx="-0.9" cy="-0.9" r="0.8" fill="rgba(255,255,255,0.4)"/><path d="M1.6 -2 q1.5 -2 3 -1" stroke="#C9A36B" stroke-width="0.6" fill="none"/><circle cx="4.6" cy="-3" r="0.9" fill="#FF8A3D"/></g>`);
    }
    // 말 (판 위): 칸마다 주인별로 묶어서, 앞(아래)에 있는 말을 나중에 그림
    const tokens = [];
    const pickableFor = (seat, onBoard) => targeting && ((targeting.def.target === "oppPiece" && seat !== game.current && onBoard) ||
      (targeting.def.target === "ownPiece" && seat === game.current && (onBoard || ["gazua", "yeongkkeul"].includes(targeting.def.id))) ||
      (targeting.def.target === "swap" && onBoard && (targeting.own === undefined ? seat === game.current : seat !== game.current)));
    const byNode = {};
    game.players.forEach((p, s) => p.pieces.forEach((pc, i) => {
      if (pc.node === START || pc.node === HOME) return;
      ((byNode[pc.node] ||= {})[s] ||= []).push(i);
    }));
    for (const [node, owners] of Object.entries(byNode)) {
      const list = Object.entries(owners);
      list.forEach(([s, idxs], k) => {
        const seat = +s, [x, y] = SP[node];
        const off = list.length > 1 ? (k - (list.length - 1) / 2) * 6 : 0;
        const own = mine && seat === game.current;
        const canMove = moving && own && destinations(idxs[0]).size > 0;
        const ring = moving && own && sel === idxs[0] ? "sel" : canMove && sel === null ? "can" : "";
        const pick = pickableFor(seat, true);
        tokens.push([y, tokenSvg(x + off, y, seat, { sc: 0.88,
          cls: `${canMove ? "movable" : ""}${pick ? " pickable" : ""}${ring === "sel" ? " selected" : ""}`, data: `data-seat="${seat}" data-idx="${idxs[0]}"`,
          count: idxs.length, shield: game.players[seat].pieces[idxs[0]].shield >= game.turnNo, ring: pick ? "pick" : ring,
        })]);
      });
    }
    // 대기 말: 자리마다 판 귀퉁이에
    game.players.forEach((p, s) => {
      const [dx, dy] = DOCKS[s];
      const waiting = p.pieces.map((pc, i) => [pc, i]).filter(([pc]) => pc.node === START);
      const fin = game.finished(s);
      const turn = game.current === s && !game.over;
      const right = s === 1 || s === 2;
      tokens.push([dy - 30, `<g class="yb-dock${turn ? " on" : ""}"><rect x="${dx - 7}" y="${dy - 21}" width="${36 + 4}" height="26" rx="6" style="--pc:${PLAYER_COLORS[s]}"/>
        <text x="${right ? dx + 31 : dx - 5}" y="${dy + 9.5}" class="yb-dock-name" text-anchor="${right ? "end" : "start"}" fill="${PLAYER_COLORS[s]}">${esc(p.name.slice(0, 6))} · 대기 ${waiting.length}${fin ? ` · 골인 ${fin}` : ""}</text></g>`]);
      const rep = waiting.length ? waiting[0][1] : -1;
      waiting.forEach(([, i], k) => {
        const own = mine && s === game.current;
        const canMove = moving && own && destinations(rep).size > 0;
        const ring = own && moving && sel === rep ? (k === 0 ? "sel" : "") : canMove && sel === null && k === 0 ? "can" : "";
        const pick = pickableFor(s, false);
        tokens.push([dy, tokenSvg(dx + k * 8.5, dy, s, {
          sc: 0.74, cls: `${canMove ? "movable" : ""}${pick ? " pickable" : ""}`, data: `data-seat="${s}" data-idx="${rep}"`, ring: pick ? "pick" : ring,
        })]);
      });
    });
    tokens.sort((a, b) => a[0] - b[0]).forEach(([, t]) => parts.push(t));
    // 도착할 곳 말풍선 (결과 이름). 골인은 출발 칸 옆에
    for (const [node, resIdx] of dests) {
      const label = node === HOME ? `골인! ${resIdx.map((i) => RESULT_NAMES[game.pending[i]]).join("/")}` : resIdx.map((i) => RESULT_NAMES[game.pending[i]]).join("/");
      const [x, y] = node === HOME ? [SP[0][0] + 20, SP[0][1] - 2] : SP[node];
      const busy = node !== HOME && byNode[node];
      const w = 6 + label.length * 4.2, top = y - (busy ? 24 : 8);
      parts.push(`<g class="yb-dest" data-dest="${resIdx[0]}" transform="translate(${x} ${top})"><g class="yb-dest-in">
        <path d="M${-w / 2} -9 h${w} a2.5 2.5 0 0 1 2.5 2.5 v3 a2.5 2.5 0 0 1 -2.5 2.5 h${-(w / 2 - 2)} l-2 2.6 l-2 -2.6 h${-(w / 2 - 2)} a2.5 2.5 0 0 1 -2.5 -2.5 v-3 a2.5 2.5 0 0 1 2.5 -2.5z"/>
        <text y="-3.6">${esc(label)}</text></g></g>`);
    }
    boardEl.innerHTML = `<svg viewBox="0 0 200 150">${parts.join("")}</svg>`;
    boardEl.classList.toggle("upside", game.upside !== null && game.upside === game.current && m.controls(game.current));
  }

  function render() {
    // 자리 카드: 도착 수 · 대기 말 · 카드 수, 내 자리는 '말' 버튼으로 캐릭터 바꾸기
    seatsEl.innerHTML = game.players.map((p, i) => {
      const waiting = p.pieces.filter((q) => q.node === START).length;
      const fin = game.finished(i);
      const turn = !game.over && !m.result && game.current === i;
      const skinBtn = m.controls(i) && !m.result ? `<button class="skin-btn" data-skin="${i}" title="말 캐릭터 고르기" aria-label="${esc(m.seats[i].name)} 말 캐릭터 고르기"><svg viewBox="-9 -26 18 28">${tokenSvg(0, 0, i)}</svg>말</button>` : "";
      const extra = skinBtn;
      const flags = [`대기 ${waiting}`, `도착 ${fin}/${pieces}`];
      if (game.abilitiesOn) flags.push(`카드 ${p.hand.length}`);
      if (p.ward) flags.push("어쩔티비 준비");
      if (p.resigned) flags.push("기권");
      return seatCard(m, i, { sub: flags.join(" · "), turn, extra });
    }).join("");
    seatsEl.querySelectorAll(".person").forEach((c, i) => c.style.setProperty("--pc", PLAYER_COLORS[i]));

    const p = cur();
    drawBoard();
    // 던지기 버튼과 남은 결과
    const mine = myTurn();
    throwBtn.disabled = game.over || !mine || game.phase !== "throw" || tossing;
    throwBtn.innerHTML = game.over ? "게임 끝" : !mine ? `${esc(p.name)} 님 차례` : game.phase === "throw" ? `윷 던지기${game.throws > 1 ? ` ×${game.throws}` : ""} <kbd>Space</kbd>` : "말을 옮겨요";
    resultsEl.innerHTML = game.pending.map((r) => `<span class="res-chip${r === -1 ? " back" : ""}">${RESULT_NAMES[r]}</span>`).join("");
    // 안내
    if (game.over || m.result) hintEl.textContent = m.result ? m.result.title : "";
    else if (targeting) {
      const t = targeting.def.target;
      hintEl.textContent = `「${targeting.def.name}」 ${t === "oppPiece" ? "상대 말을 눌러요" : t === "ownPiece" ? "내 말을 눌러요" : t === "node" ? "폭탄을 놓을 빈칸을 눌러요" : targeting.own === undefined ? "먼저 내 말을 눌러요" : "바꿀 상대 말을 눌러요"} · 카드를 다시 누르면 취소`;
    } else if (!mine) hintEl.textContent = `${p.name} 님 차례${game.phase === "move" ? " · 말 옮기는 중" : ""}`;
    else if (game.phase === "throw") hintEl.textContent = game.pending.length ? "한 번 더 던져요!" : `윷을 던져요${game.abilitiesOn ? " (능력 카드는 한 차례에 한 장)" : ""}`;
    else hintEl.textContent = sel !== null ? "말풍선이 뜬 칸을 눌러 옮겨요 · 다른 말을 눌러 바꾸기" : "옮길 말을 눌러요 (기다리는 말은 판 귀퉁이에)";
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
  }

  async function resignMine() {
    const seat = m.mode === "local" ? game.current : m.mySeats[0];
    if (await confirmBox("기권", `${m.seats[seat].name} 님, 정말 기권할까요?`, "기권", "계속")) m.submit({ type: "resign" }, seat);
  }

  return { el: root, sideEl: side, apply, resign, render, destroy: () => document.removeEventListener("keydown", onKey) };
}
