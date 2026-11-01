// KI득KI득 웹판: 첫 화면 · 프로필 · 게임 고르기 · 온라인 방 목록 · 대기실 · 랭킹
import * as net from "./net.js";
import { ANIMALS, avatarHtml, photoToSpec, GAME_ICONS, esc, setPhoto } from "./art.js";
import { el, toast, modal, confirmBox, segment, option, store, ChatPanel, personHtml, soundButton } from "./ui.js";
import { play } from "./sound.js";
import { Match, showRules } from "./match.js";
import { GAME_NAMES, GAME_DESC } from "./rules.js";
import { THEMES, applyTheme, currentTheme } from "./theme.js";
import { TitleScene } from "./scene.js";
import * as chess from "./games/chess.js";
import * as omok from "./games/omok.js";
import * as yacht from "./games/yacht.js";
import * as yut from "./games/yut.js";
import { CHARACTERS as YUT_CHARACTERS, CHAR_IDS as YUT_CHAR_IDS, charSvg as yutCharSvg } from "./games/yut_chars.js";

const APP_VERSION = "2.2.0-web";
const APP_SUB = "처음 만난 우리, 한 판이면 친구";
const DEVELOPER = "KDA 5기 송재혁";
const REPO_URL = "https://github.com/devtaego/PJ_KDKD";
const YUT_SOUND_URL = "https://www.youtube.com/watch?v=rLSAQLD6xos"; // 윷 던지는 소리 출처
const MODULES = { chess, omok, yacht, yut };
const YUT_ROOM_SKINS = YUT_CHARACTERS.filter((c) => YUT_CHAR_IDS.has(c.id));
const MAX_PLAYERS = { chess: 2, omok: 2, yacht: 6, yut: 4 };
const LEVELS = [["easy", "쉬움"], ["normal", "보통"], ["hard", "어려움"]];
const ROBOT_NAMES = ["컴퓨터", "로봇 철수", "로봇 영희", "로봇 민수", "로봇 지수", "로봇 하나"];

const app = document.getElementById("app");
let profile = { name: "", avatar: "cat", intro: "", ...store.get("profile", {}) };
let current = null; // 지금 화면 { root, back?, destroy? }
let match = null;
const online = { room: null, status: "closed", chat: null, lobby: null, wait: null };
let pendingCode = new URLSearchParams(location.search).get("room");

// ---------------------------------------------------------------- 배경: 타이틀과 같은 픽셀 장면을 모든 화면 뒤에 은은하게
const backdrop = (() => {
  const box = document.querySelector(".backdrop");
  let scene = null;
  return {
    show(on) {
      if (on && !scene) {
        const cv = el(`<canvas class="bg-scene"></canvas>`);
        box.replaceChildren(cv, el(`<div class="bg-veil"></div>`));
        box.classList.add("scene");
        scene = new TitleScene(cv, currentTheme(), { fps: 6 });
      } else if (!on && scene) { scene.destroy(); scene = null; }
    },
    theme() { scene?.setTheme(currentTheme()); },
  };
})();
window.addEventListener("themechange", () => backdrop.theme());

// ---------------------------------------------------------------- 화면 바꾸기
function show(screen, { push = true } = {}) {
  if (current && current !== screen) current.destroy?.();
  if (match && screen.root !== match.root) { match.destroy(); match = null; }
  const bar = screen.root.querySelector(".topbar");
  if (bar && !bar.querySelector(".sound-btn")) bar.appendChild(soundButton()); // 어느 화면이든 오른쪽 위에 스피커
  if (bar && !bar.querySelector(".theme-btn")) bar.appendChild(themeButton());
  backdrop.show(!screen.root.classList.contains("title-screen"));
  app.replaceChildren(screen.root);
  current = screen;
  window.scrollTo(0, 0);
  if (push && screen.back) history.pushState({ kidk: true }, "");
}
window.addEventListener("popstate", () => {
  if (current?.back) {
    current.back();
    if (current?.back) history.pushState({ kidk: true }, ""); // 아직 나가지 않았으면 (확인 창 등) 다시 막아 둠
  }
});

const saveProfile = () => {
  store.set("profile", profile);
  if (net.isOpen()) net.updateProfile(profile);
};

function needName() {
  if (profile.name.trim()) return false;
  toast("먼저 닉네임을 정해 주세요!");
  const input = document.querySelector("#nick");
  input?.focus();
  return true;
}

// ---------------------------------------------------------------- 타이틀 화면 (게임 시작 화면)
function titleScreen() {
  const root = el(`<section class="title-screen">
    <canvas class="title-scene" aria-hidden="true"></canvas>
    <div class="title-ui">
      <div class="title-player"></div>
      <h1 class="title-logo" aria-label="KI득KI득"><span>K</span><span>I</span><b>득</b><span>K</span><span>I</span><em>득</em></h1>
      <div class="title-sub">${esc(APP_SUB)}</div>
      <nav class="title-menu" aria-label="메뉴"></nav>
      <div class="title-hint">↑ ↓ 고르기 · Enter 결정</div>
      <div class="title-credit">제작자 · ${esc(DEVELOPER)}</div>
    </div></section>`);
  root.querySelector(".title-ui").append(soundButton("title-sound"), themeButton("title-theme"));
  const scene = new TitleScene(root.querySelector(".title-scene"), currentTheme());
  const syncSceneTheme = () => scene.setTheme(currentTheme());
  window.addEventListener("themechange", syncSceneTheme);
  const menu = root.querySelector(".title-menu");
  const items = [
    { label: () => "게임 시작", go: () => homeScreen() },
    { label: () => "방 목록", go: () => (profile.name ? lobbyScreen() : homeScreen(true)) },
    { label: () => "기록", go: () => rankingModal() },
    { label: () => "게임 기획 의도", go: () => about() },
  ];
  let sel = 0;
  function draw() {
    menu.innerHTML = "";
    items.forEach((it, i) => {
      const b = el(`<button class="title-item${i === sel ? " on" : ""}" type="button"></button>`);
      b.textContent = it.label();
      b.onpointerenter = () => { if (sel !== i) { sel = i; play("click"); draw(); } };
      b.onclick = () => { sel = i; play("pop"); it.go(); };
      menu.appendChild(b);
    });
    root.querySelector(".title-player").innerHTML = profile.name
      ? `${avatarHtml(profile.avatar, 34)}<span>PLAYER</span><b>${esc(profile.name)}</b>` : `<span>PLAYER</span><b>닉네임을 정해 주세요</b>`;
  }
  draw();
  const onKey = (e) => {
    if (document.querySelector(".modal-back")) return;
    if (e.key === "ArrowDown" || e.key === "s") { sel = (sel + 1) % items.length; play("click"); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp" || e.key === "w") { sel = (sel - 1 + items.length) % items.length; play("click"); draw(); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play("pop"); items[sel].go(); }
  };
  document.addEventListener("keydown", onKey);
  show({ root, destroy: () => { scene.destroy(); window.removeEventListener("themechange", syncSceneTheme); document.removeEventListener("keydown", onKey); } }, { push: false });
}

// ---------------------------------------------------------------- 첫 화면
const GAME_META = {
  chess: { people: "1~2명", modes: "컴퓨터 · 한 기기 · 온라인" },
  omok: { people: "1~2명", modes: "컴퓨터 · 한 기기 · 온라인" },
  yacht: { people: "1~6명", modes: "컴퓨터 · 한 기기 · 온라인" },
  yut: { people: "2~4명", modes: "한 기기 · 온라인" },
};

function homeScreen(focusName = false) {
  const root = el(`<section class="screen home">
    <header class="home-head">
      <button class="icon-btn home-back" aria-label="타이틀 화면으로">←</button>
      <span class="home-sound"></span>
      <h1 class="logo" aria-label="KI득KI득"><span>K</span><span>I</span><b>득</b><span>K</span><span>I</span><em>득</em></h1>
      <div class="tagline"><span class="muted">체스 · 오목 · 야추 · 윷놀이 아이스브레이킹 게임룸</span></div>
    </header>
    <div class="home-grid">
      <aside class="card player-card">
        <div class="pc-top"><div class="pc-avatar"></div><div class="pc-who"><div class="pc-label">PLAYER</div><div class="pc-name"></div><div class="pc-intro"></div></div></div>
        <label class="field"><span>닉네임</span><input id="nick" type="text" maxlength="12" placeholder="예: 홍길동" autocomplete="nickname"></label>
        <div class="field-label">캐릭터 또는 내 사진</div>
        <div class="avatar-pick"></div>
        <label class="field"><span>한 줄 소개 (MBTI, 관심사...)</span><input id="intro" type="text" maxlength="30" placeholder="예: ENFP · 떡볶이 좋아해요"></label>
      </aside>
      <div class="home-main">
        <div class="section-title">게임 고르기 <span class="muted">눌러서 바로 시작!</span></div>
        <div class="games"></div>
        <div class="card online-card">
          <div class="online-head"><h3>친구들과 온라인으로</h3><span class="muted">와이파이가 달라도, 폰이어도 OK</span></div>
          <div class="join-code"><input id="code" type="text" maxlength="4" placeholder="방 코드 4자리" aria-label="방 코드" autocomplete="off"><button class="btn primary" data-k="join">참가</button></div>
          <div class="home-tools"><button class="btn" data-k="lobby">열린 방 보기</button><button class="btn" data-k="rank">랭킹</button><button class="btn ghost" data-k="rules">규칙 보기</button></div>
        </div>
      </div>
    </div></section>`);
  const preview = () => { // 왼쪽 위 '플레이어 카드'에 지금 프로필을 바로 보여 줌
    root.querySelector(".pc-avatar").innerHTML = avatarHtml(profile.avatar, 76);
    root.querySelector(".pc-name").textContent = profile.name || "닉네임을 정해 주세요";
    root.querySelector(".pc-intro").textContent = profile.intro || "한 줄 소개로 말 걸 거리를 만들어요";
  };
  preview();
  const nick = root.querySelector("#nick");
  const intro = root.querySelector("#intro");
  nick.value = profile.name;
  intro.value = profile.intro;
  nick.oninput = () => { profile.name = nick.value.trim(); saveProfile(); preview(); };
  intro.oninput = () => { profile.intro = intro.value.trim(); saveProfile(); preview(); };

  const pick = root.querySelector(".avatar-pick");
  const drawPick = () => {
    pick.innerHTML = "";
    for (const [id, label] of ANIMALS) {
      const b = el(`<button type="button" aria-label="${label}" aria-pressed="${profile.avatar === id}">${avatarHtml(id, 52)}</button>`);
      b.onclick = () => { profile.avatar = id; saveProfile(); play("pop"); drawPick(); preview(); };
      pick.appendChild(b);
    }
    const isPhoto = profile.avatar.startsWith("data:");
    const ph = el(`<button type="button" aria-label="내 사진" aria-pressed="${isPhoto}">${isPhoto ? avatarHtml(profile.avatar, 52) : `<span class="photo" style="width:100%;height:100%">사진</span>`}</button>`);
    const file = el(`<input type="file" accept="image/*" hidden>`);
    ph.onclick = () => file.click();
    file.onchange = async () => {
      if (!file.files[0]) return;
      try {
        profile.avatar = await photoToSpec(file.files[0]);
        saveProfile();
        drawPick();
        preview();
      } catch { toast("사진을 열 수 없어요"); }
    };
    pick.append(ph, file);
  };
  drawPick();

  const games = root.querySelector(".games");
  for (const g of ["chess", "omok", "yacht", "yut"]) {
    const meta = GAME_META[g];
    const card = el(`<button class="game-card g-${g}"><span class="gband"></span><div class="gart"><div class="gicon">${GAME_ICONS[g]}</div></div><div class="gbody"><div class="gname">${GAME_NAMES[g]}</div><div class="gdesc">${GAME_DESC[g]}</div><dl class="ginfo"><div><dt>인원</dt><dd>${meta.people}</dd></div><div><dt>모드</dt><dd>${meta.modes}</dd></div></dl></div><span class="gplay">▶ 플레이</span></button>`);
    card.onclick = () => { if (!needName()) { play("click"); chooseMode(g); } };
    games.appendChild(card);
  }

  root.querySelector(".home-sound").replaceWith(soundButton("home-sound"), themeButton("home-theme"));
  root.querySelector('[data-k="rules"]').onclick = () => rulesPicker();
  root.querySelector('[data-k="rank"]').onclick = rankingModal;
  root.querySelector('[data-k="lobby"]').onclick = () => { if (!needName()) lobbyScreen(); };
  const code = root.querySelector("#code");
  if (pendingCode) code.value = pendingCode.toUpperCase();
  const join = () => {
    const c = code.value.trim().toUpperCase();
    if (needName()) return;
    if (c.length !== 4) { toast("방 코드 4자리를 넣어 주세요"); return; }
    joinRoom(c);
  };
  root.querySelector('[data-k="join"]').onclick = join;
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  root.querySelector(".home-back").onclick = () => titleScreen();
  show({ root, back: () => titleScreen() });
  if (pendingCode && !profile.name) toast("닉네임을 정하고 '참가'를 누르면 친구 방에 들어가요", 3500);
  if (focusName) { toast("먼저 닉네임을 정해 주세요!"); nick.focus(); }
}

function rulesPicker() {
  const body = el(`<div class="row"></div>`);
  let close;
  for (const g of ["chess", "omok", "yacht", "yut"]) {
    const b = el(`<button class="btn">${GAME_NAMES[g]}</button>`);
    b.onclick = () => { close(); showRules(g); };
    body.appendChild(b);
  }
  close = modal("어떤 게임 규칙을 볼까요?", body);
}

function themeButton(cls = "") {
  const b = el(`<button class="icon-btn theme-btn ${cls}" type="button" aria-label="화면 테마 고르기" title="화면 테마 고르기">🎨</button>`);
  b.onclick = (e) => { e.stopPropagation(); themePicker(); };
  return b;
}

function themePicker() {
  const body = el(`<div class="theme-picker-list"></div>`);
  for (const t of THEMES) {
    const b = el(`<button class="theme-preview${currentTheme() === t.id ? " selected" : ""}" type="button" aria-pressed="${currentTheme() === t.id}">
      <span class="theme-preview-shot" style="--preview-bg:${t.swatch[0]};--preview-accent:${t.swatch[1]};--preview-pop:${t.swatch[2]}"><i></i><i></i><i></i></span>
      <span class="theme-preview-name">${esc(t.name)}</span></button>`);
    b.onclick = () => {
      applyTheme(t.id);
      body.querySelectorAll(".theme-preview").forEach((item) => {
        const selected = item === b;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      play("pop");
    };
    body.appendChild(b);
  }
  modal("기기 테마", body);
}

function about() {
  const body = el(`<div class="rules">
    <p><b>KI득KI득</b> v${APP_VERSION} — ${esc(APP_SUB)}</p>
    <p>새 기수가 처음 만났을 때 어색함 없이 친해질 수 있도록 만든 미니게임 모음이에요. 체스 · 오목 · 야추 다이스는 컴퓨터와, 한 기기에서, 또는 온라인으로 함께 해요.</p>
    <p><b>윷놀이</b>는 2~4명이 한 기기나 온라인으로 해요. 시작할 때 각자 동물 캐릭터 말을 고르고, 밈 이름이 붙은 능력 카드(특수능력 3장 · 막장 4장)로 판을 뒤집어요. 카드별 확률은 게임 화면의 '확률표'에서 볼 수 있어요.</p>
    <p>만든 사람: ${esc(DEVELOPER)}</p>
    <p class="muted">글꼴: 주아체 (SIL Open Font License 1.1) · 기물 · 주사위 · 캐릭터 · 윷판 · 윷가락 · 스티커는 모두 코드로 직접 그렸어요. 채팅은 서버를 거쳐 전달되고 따로 저장하지 않아요.</p>
    <p class="muted">윷 던지는 소리: <a href="${YUT_SOUND_URL}" target="_blank" rel="noopener" style="color:var(--gold)">「[무료효과음] 프로가 직접 만드는 윷놀이 소리 SoundEffects / Yutnori」 (YouTube)</a>에서 가져왔어요.</p>
    <p><a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--gold)">GitHub 저장소</a> · 데스크톱(exe)판도 있어요</p></div>`);
  modal("게임 기획 의도", body);
}

// ---------------------------------------------------------------- 게임 · 모드 고르기
function localYutSetup(o) {
  const count = Math.min(4, Math.max(2, Number(o.people) || 2));
  const ids = YUT_ROOM_SKINS.map((skin) => skin.id);
  const savedSkins = Array.isArray(o.yutSkins) ? o.yutSkins : [];
  const used = new Set();
  o.yutSkins = Array.from({ length: 4 }, (_, i) => {
    const wanted = savedSkins[i] || (i === 0 && YUT_CHAR_IDS.has(profile.avatar) ? profile.avatar : "");
    const id = ids.includes(wanted) && !used.has(wanted) ? wanted : ids.find((skin) => !used.has(skin));
    used.add(id);
    return id;
  });
  if (!Array.isArray(o.teamPick) || o.teamPick.length !== 4) o.teamPick = ["A", "B", "A", "B"];
  const root = el(`<section class="yut-room-setup local-yut-setup" aria-label="플레이어와 말 준비">
    <div class="yut-setup-head"><div><strong>${o.team === "1" ? "팀과 말 정하기" : "플레이어별 말 고르기"}</strong>
      <span>${o.team === "1" ? "플레이어 카드를 끌어 팀을 나누고, 각자 말을 골라요" : "각 플레이어가 사용할 말을 골라요. 말은 서로 달라야 해요"}</span></div>
      ${o.team === "1" ? `<div class="team-totals"><span class="team-count team-a"><b data-team-count="A">0</b> / 2 A팀</span><span class="team-count team-b"><b data-team-count="B">0</b> / 2 B팀</span></div>` : ""}
    </div><div class="yut-roster-board ${o.team === "1" ? "teams" : "solo"}"></div>
    ${o.team === "1" ? `<p class="team-status" aria-live="polite"></p>` : ""}<p class="yut-skin-status" aria-live="polite"></p>
  </section>`);
  const board = root.querySelector(".yut-roster-board");
  const lists = {};
  const teamMode = o.team === "1";
  const columns = teamMode ? [["A", "A팀"], ["B", "B팀"]] : [["A", "플레이어"]];
  for (const [team, label] of columns) {
    const column = el(`<section class="yut-team-column team-${team.toLowerCase()}" data-local-team="${team}">
      <div class="yut-team-column-head"><strong>${label}</strong>${teamMode ? `<span><b data-column-count="${team}">0</b>명</span>` : `<span>${count}명</span>`}</div>
      <div class="yut-team-members"></div></section>`);
    lists[team] = column.querySelector(".yut-team-members");
    if (teamMode) {
      column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drop-over"); });
      column.addEventListener("dragleave", (event) => { if (!column.contains(event.relatedTarget)) column.classList.remove("drop-over"); });
      column.addEventListener("drop", (event) => {
        event.preventDefault(); column.classList.remove("drop-over");
        const index = Number(event.dataTransfer?.getData("text/plain"));
        if (Number.isInteger(index) && index >= 0 && index < count) { o.teamPick[index] = team; drawCards(); }
      });
    }
    board.appendChild(column);
  }
  const playerNames = Array.from({ length: count }, (_, i) => i === 0 ? `${profile.name || "나"} (나)` : `친구 ${i}`);
  function drawCards() {
    for (const list of Object.values(lists)) list.replaceChildren();
    playerNames.forEach((name, i) => {
      const skin = YUT_ROOM_SKINS.find((item) => item.id === o.yutSkins[i]) || YUT_ROOM_SKINS[0];
      const team = teamMode ? (o.teamPick[i] === "B" ? "B" : "A") : "A";
      const card = el(`<article class="yut-room-player local-yut-player" data-local-player="${i}">
        <div class="yut-player-top"><span class="yut-character-preview"><svg viewBox="-11 -27 22 29" aria-hidden="true">${yutCharSvg(skin.id)}</svg></span><div class="yut-player-label"><strong>${esc(name)}</strong><span class="yut-picked-name">${esc(skin.name)} 말</span></div></div>
        <div class="yut-character-picker" role="group" aria-label="${esc(name)} 말 캐릭터 선택"></div>
        ${teamMode ? `<button type="button" class="team-move-btn">${team === "A" ? "B팀으로 →" : "← A팀으로"}</button>` : ""}
      </article>`);
      if (teamMode) {
        card.draggable = true;
        card.addEventListener("dragstart", (event) => { event.dataTransfer?.setData("text/plain", String(i)); event.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
        card.addEventListener("dragend", () => { card.classList.remove("dragging"); board.querySelectorAll(".drop-over").forEach((node) => node.classList.remove("drop-over")); });
        card.querySelector(".team-move-btn").onclick = () => { o.teamPick[i] = team === "A" ? "B" : "A"; drawCards(); };
      }
      const picker = card.querySelector(".yut-character-picker");
      YUT_ROOM_SKINS.forEach((choice) => {
        const owner = o.yutSkins.findIndex((id, player) => player !== i && player < count && id === choice.id);
        const button = el(`<button type="button" class="yut-character-choice${skin.id === choice.id ? " selected" : ""}" aria-pressed="${skin.id === choice.id}" aria-label="${esc(choice.name)} 말" title="${owner >= 0 ? `${esc(playerNames[owner])} 선택 중` : `${esc(choice.name)} 선택`}" ${owner >= 0 ? "disabled" : ""}><svg viewBox="-11 -27 22 29" aria-hidden="true">${yutCharSvg(choice.id)}</svg><span>${esc(choice.name)}</span></button>`);
        button.onclick = () => { o.yutSkins[i] = choice.id; drawCards(); };
        picker.appendChild(button);
      });
      lists[team].appendChild(card);
    });
    if (teamMode) {
      const nA = o.teamPick.slice(0, count).filter((team) => team !== "B").length;
      const nB = count - nA;
      root.querySelector('[data-team-count="A"]').textContent = nA;
      root.querySelector('[data-team-count="B"]').textContent = nB;
      root.querySelector('[data-column-count="A"]').textContent = nA;
      root.querySelector('[data-column-count="B"]').textContent = nB;
      const ready = count === 4 && nA === 2 && nB === 2;
      const status = root.querySelector(".team-status");
      status.textContent = ready ? "팀 배정 완료 · A팀과 B팀 2명씩" : `${count}명 선택 · 네 명을 A팀과 B팀 2명씩 나눠요`;
      status.classList.toggle("ready", ready);
    }
    const skinIds = o.yutSkins.slice(0, count);
    const skinsReady = new Set(skinIds).size === count;
    const skinStatus = root.querySelector(".yut-skin-status");
    skinStatus.textContent = skinsReady ? `${count}명 모두 다른 말을 골랐어요` : "플레이어마다 서로 다른 말을 골라 주세요";
    skinStatus.classList.toggle("ready", skinsReady);
  }
  drawCards();
  return { root, ready: () => new Set(o.yutSkins.slice(0, count)).size === count && (!teamMode || (count === 4 && o.teamPick.slice(0, count).filter((team) => team !== "B").length === 2)) };
}

function chooseMode(game) {
  const saved = store.get(`opts.${game}`, {});
  const o = { mode: "ai", level: "normal", time: "none", color: game === "omok" ? "b" : "w", rule: "33", bots: 1, people: 2, friend: "친구", pieces: "3", chaos: "chaos", ...saved };
  if (game === "yut" && o.mode === "ai") o.mode = "local"; // 윷놀이는 사람끼리만 (컴퓨터 대전 없음)
  const body = el(`<div></div>`);
  let close;
  const draw = () => {
    body.innerHTML = "";
    let yutSetup = null;
    const modes = [["ai", "컴퓨터 대전"], ["local", game === "yacht" || game === "yut" ? "한 기기 여럿" : "한 기기 2인"], ["online", "온라인"]]
      .filter(([m]) => !(game === "yut" && m === "ai"));
    body.appendChild(option("어떻게 할까요?", segment(modes, o.mode, (v) => { o.mode = v; draw(); })));
    if (o.mode === "ai") body.appendChild(option("컴퓨터 난이도", segment(LEVELS, o.level, (v) => { o.level = v; })));
    if (game === "chess") {
      body.appendChild(option("시간", segment(Object.entries(chess.TIME_MODES).map(([k, v]) => [k, v[0]]), o.time, (v) => { o.time = v; })));
      if (o.mode !== "local") body.appendChild(option(o.mode === "online" ? "방장(나)의 색" : "내 색", segment([["w", "백 (먼저)"], ["b", "흑"], ["random", "무작위"]], o.color, (v) => { o.color = v; })));
    }
    if (game === "omok") {
      body.appendChild(option("규칙", segment([["33", "쌍삼 금지"], ["free", "자유룰"]], o.rule, (v) => { o.rule = v; })));
      if (o.mode !== "local") body.appendChild(option(o.mode === "online" ? "방장(나)의 돌" : "내 돌", segment([["b", "흑 (먼저)"], ["w", "백"], ["random", "무작위"]], o.color, (v) => { o.color = v; })));
    }
    if (game === "yacht" && o.mode === "ai") body.appendChild(option("컴퓨터 수", segment([1, 2, 3, 4, 5].map((n) => [n, `${n}명`]), o.bots, (v) => { o.bots = v; })));
    if (game === "yacht" && o.mode === "local") body.appendChild(option("같이 하는 사람 수 (나 포함)", segment([2, 3, 4, 5, 6].map((n) => [n, `${n}명`]), o.people, (v) => { o.people = v; })));
    if (game === "yut") {
      if (o.mode === "local" && Number(o.people) !== 4) o.team = "";
      body.appendChild(option("모드", segment(Object.entries(yut.MODES), o.chaos, (v) => { o.chaos = v; })));
      body.appendChild(option("말 개수", segment([["2", "2개 (빨리)"], ["3", "3개"], ["4", "4개 (길게)"]], o.pieces, (v) => { o.pieces = v; })));
      if (o.mode === "local") body.appendChild(option("같이 하는 사람 수 (나 포함)", segment([2, 3, 4].map((n) => [n, `${n}명`]), Math.min(4, o.people), (v) => { o.people = v; if (Number(v) !== 4) o.team = ""; draw(); })));
      if (o.mode === "online" || Number(o.people) === 4) { // 팀전은 4명일 때만 (1 · 3번 자리 A팀, 2 · 4번 자리 B팀)
        body.appendChild(option("팀", segment([["", "개인전"], ["1", "2:2 팀전"]], o.team || "", (v) => { o.team = v; draw(); })));
        if (o.mode === "online") body.appendChild(el(`<p class="muted" style="margin:-4px 0 8px;font-size:13px">팀전은 4명이 모였을 때만 돼요. 팀은 대기실에서 방장이 나눠요.</p>`));
      }
      if (o.mode === "local") {
        yutSetup = localYutSetup(o);
        body.appendChild(yutSetup.root);
      }
    }
    if (game !== "yacht" && game !== "yut" && o.mode === "local") {
      const f = el(`<label class="field"><span>같이 하는 친구 이름</span><input type="text" maxlength="12"></label>`);
      const input = f.querySelector("input");
      input.value = o.friend;
      input.oninput = () => { o.friend = input.value.trim() || "친구"; };
      body.appendChild(f);
    }
    if (o.mode === "online") {
      body.appendChild(option("방 공개", segment([["", "열린 방 목록에 보이기"], ["1", "비공개 (코드로만)"]], o.private || "", (v) => { o.private = v; })));
      body.appendChild(el(`<p class="muted" style="margin-top:0">방을 만들면 4자리 코드와 링크가 생겨요. 친구에게 보내면 폰에서도 바로 들어와요.</p>`));
    }
    const row = el(`<div class="row modal-actions"></div>`);
    if (close) { // 처음엔 modal()이 '닫기'를 넣어 주고, 옵션을 바꿔 다시 그릴 때는 여기서 넣음
      const x = el(`<button class="btn ghost">닫기</button>`);
      x.onclick = () => close();
      row.appendChild(x);
    }
    if (o.mode === "online") {
      const find = el(`<button class="btn ghost">열린 방 찾기</button>`);
      find.onclick = () => { close(); lobbyScreen(game); };
      row.appendChild(find);
    }
    const go = el(`<button class="btn primary big">${o.mode === "online" ? "방 만들기" : "시작!"}</button>`);
    go.onclick = () => {
      if (game === "yut" && o.mode === "local") {
        if (!yutSetup?.ready()) {
          toast(o.team === "1" ? "팀을 2명씩 나누고 서로 다른 말을 골라 주세요" : "각 플레이어가 서로 다른 말을 골라 주세요");
          return;
        }
      }
      store.set(`opts.${game}`, o);
      close();
      if (o.mode === "online") {
        const base = game === "chess" ? { time: o.time, color: o.color } : game === "omok" ? { rule: o.rule, color: o.color }
          : game === "yut" ? { pieces: o.pieces, chaos: o.chaos, team: o.team || "" } : {};
        createRoom(game, { ...base, private: o.private || "" });
      }
      else startLocal(game, o);
    };
    row.appendChild(go);
    body.appendChild(row);
  };
  draw();
  close = modal(GAME_NAMES[game], body, { closable: true });
}

function resolveColor(game, color) {
  if (color === "random") return Math.random() < 0.5 ? (game === "chess" ? "w" : "b") : (game === "chess" ? "b" : "w");
  return color;
}

/** 팀전 자리 순서: A팀 · B팀이 번갈아 앉게 [A, B, A, B] (isB(사람, 번호)가 B팀이면 true) */
function teamOrder(list, isB) {
  const a = list.filter((x, i) => !isB(x, i)), b = list.filter((x, i) => isB(x, i));
  return a.length === 2 && b.length === 2 ? [a[0], b[0], a[1], b[1]] : list;
}
/** 대기실의 B팀 명단 (방장이 나눔, 아직 안 나눴으면 들어온 순서로 2 · 4번째) */
function roomTeamB(r, players) {
  if (typeof r.settings.tb === "string") return new Set(r.settings.tb.split(",").filter(Boolean));
  return new Set(players.filter((_, i) => i % 2 === 1).map((x) => x.cid));
}

function startLocal(game, o) {
  const me = { name: profile.name, avatar: profile.avatar, intro: profile.intro, ai: false };
  const botAvatar = { name: ROBOT_NAMES[0], avatar: "robot", intro: "", ai: true };
  let seats, mySeats;
  if (game === "yut") {
    const n = Math.min(4, Math.max(2, o.people));
    const skins = Array.isArray(o.yutSkins) ? o.yutSkins : [];
    seats = Array.from({ length: n }, (_, i) => ({
      ...(i === 0 ? me : { name: `친구 ${i}`, intro: "", ai: false }),
      avatar: YUT_CHAR_IDS.has(skins[i]) ? skins[i] : YUT_ROOM_SKINS[i % YUT_ROOM_SKINS.length].id,
    }));
    if (n === 4 && o.team === "1" && Array.isArray(o.teamPick)) seats = teamOrder(seats, (_, i) => o.teamPick[i] === "B");
    mySeats = seats.map((_, i) => i);
  } else if (game === "yacht") {
    if (o.mode === "ai") {
      seats = [me, ...Array.from({ length: o.bots }, (_, i) => ({ ...botAvatar, name: o.bots === 1 ? ROBOT_NAMES[0] : ROBOT_NAMES[i + 1] }))];
      mySeats = [0];
    } else {
      seats = [me, ...Array.from({ length: o.people - 1 }, (_, i) => ({ name: `친구 ${i + 1}`, avatar: ANIMALS[(i + 1) % ANIMALS.length][0], intro: "", ai: false }))];
      mySeats = seats.map((_, i) => i);
    }
  } else {
    const firstColor = game === "chess" ? "w" : "b";
    const other = o.mode === "ai" ? botAvatar : { name: o.friend || "친구", avatar: profile.avatar === "fox" ? "panda" : "fox", intro: "", ai: false };
    const meFirst = o.mode === "local" || resolveColor(game, o.color) === firstColor;
    seats = meFirst ? [me, other] : [other, me];
    mySeats = o.mode === "local" ? [0, 1] : [meFirst ? 0 : 1];
  }
  const settings = game === "chess" ? { time: o.time } : game === "omok" ? { rule: o.rule } : game === "yut" ? { pieces: o.pieces, chaos: o.chaos, team: Number(o.people) === 4 ? o.team || "" : "" } : {};
  const begin = () => {
    if (match) { match.destroy(); match = null; }
    match = new Match({
      game, mode: o.mode, seats, mySeats, settings: { ...settings, seed: Math.floor(Math.random() * 2 ** 31) }, level: o.level, module: MODULES[game],
      onExit: () => homeScreen(), onAgain: () => begin(),
    });
    show({ root: match.root, back: () => match?.exit(), destroy: () => {} });
  };
  begin();
}

// ---------------------------------------------------------------- 온라인
function connect() {
  if (!net.isOpen()) net.connect(profile);
}

net.on("status", (s) => {
  online.status = s;
  document.querySelectorAll(".net-dot").forEach((d) => { d.className = `net-dot ${s}`; });
  match?.setNet?.(s);
  if (s === "closed" && (online.lobby || online.wait || match?.online)) toast("연결이 끊겼어요. 다시 연결하는 중...");
});

net.on("welcome", (msg) => {
  if (msg.room) {
    online.room = msg.room;
    if (msg.room.status === "waiting" || !match?.online) waitingScreen(); // 판이 진행 중이면 곧 오는 log로 이어짐
  } else if (online.room || match?.online) {
    online.room = null;
    if (match?.online || online.wait) { toast("방이 사라졌어요"); lobbyScreen(); }
  }
  online.lobby?.update(msg.rooms);
  if (pendingCode && profile.name && !msg.room) {
    const c = pendingCode.toUpperCase();
    pendingCode = null;
    history.replaceState(null, "", location.pathname);
    net.send({ t: "join", room: c });
  }
});

net.on("rooms", (msg) => online.lobby?.update(msg.rooms));
net.on("error", (msg) => toast(msg.msg));
net.on("sleep", () => toast("오래 쉬어서 연결을 잠시 쉬게 했어요. 화면을 누르면 다시 이어져요", 4000));

net.on("photos", (msg) => { // 방 사람들의 프로필 사진 (한 번만 받아 두고 계속 씀)
  for (const [pid, url] of Object.entries(msg.photos || {})) setPhoto(pid, url);
  online.wait?.update();
  match?.g.render();
});

net.on("kicked", () => {
  online.room = null;
  if (match) { match.destroy(); match = null; }
  toast("방장이 방에서 내보냈어요", 3500);
  lobbyScreen();
});

/** 연승이 늘어난 사람이 있으면 모두에게 알려 줌 (2연승부터) */
function announceStreaks(prev, room) {
  if (!prev || prev.id !== room.id) return;
  const before = new Map(prev.members.map((x) => [x.cid, x.streak || 0]));
  for (const x of room.members) {
    if ((x.streak || 0) >= 2 && x.streak > (before.get(x.cid) || 0)) {
      toast(`${x.name} ${x.streak}연승!`, 3000);
      (match?.online ? match.chat : online.chat)?.system(`${x.name} 님 ${x.streak}연승 중!`);
    }
  }
}

net.on("room", (msg) => {
  const prev = online.room;
  online.room = msg.room;
  announceStreaks(prev, msg.room);
  if (match?.online) {
    match.isHost = msg.room.host === net.myId();
    match.streaks = new Map(msg.room.members.map((x) => [x.cid, x.streak || 0]));
    const on = new Map(msg.room.members.map((x) => [x.cid, x.online]));
    const gone = new Map(msg.room.members.map((x) => [x.cid, x.gone]));
    match.setOffline(new Set(match.seats.map((s, i) => (on.get(s.cid) === false ? i : -1)).filter((i) => i >= 0)),
      new Map(match.seats.map((s, i) => [i, gone.get(s.cid) || null])), msg.room.grace || 30);
    return;
  }
  if (!prev || prev.id !== msg.room.id || !online.wait) waitingScreen();
  else online.wait.update();
});

net.on("log", (msg) => {
  const start = msg.acts.findIndex((e) => e.a.type === "start");
  if (start < 0) return;
  startOnline(msg.acts[start]);
  match.replaying = true;
  for (const e of msg.acts.slice(start + 1)) match.receive(e);
  match.replaying = false;
  match.g.render();
});

net.on("act", (entry) => {
  if (entry.a.type === "start") {
    play("join");
    startOnline(entry);
  } else match?.online && match.receive(entry);
});

net.on("chat", (msg) => {
  if (match?.online) match.onChat(msg);
  else if (online.chat) {
    online.chat.add(msg.name, msg);
    if (msg.sticker) play("pop");
  }
});

net.on("fx", (msg) => match?.online && match.onFx(msg));

net.on("notice", (msg) => {
  const text = msg.kind === "join" ? `${msg.name} 님이 들어왔어요${msg.role === "spectator" ? " (관전)" : ""}`
    : msg.kind === "kick" ? `방장이 ${msg.name} 님을 내보냈어요` : `${msg.name} 님이 나갔어요`;
  if (msg.kind === "join") play("join");
  (match?.online ? match.chat : online.chat)?.system(text);
});

net.on("reset", () => {
  if (match?.online) { match.destroy(); match = null; }
  waitingScreen();
});

function createRoom(game, settings) {
  connect();
  const go = () => net.send({ t: "create", game, settings });
  if (net.isOpen()) go();
  else {
    toast("서버에 연결하는 중...");
    const off = net.on("welcome", () => { off(); go(); });
  }
}

function joinRoom(code) {
  connect();
  const go = () => net.send({ t: "join", room: code });
  if (net.isOpen()) go();
  else {
    toast("서버에 연결하는 중...");
    const off = net.on("welcome", () => { off(); go(); });
  }
}

function leaveRoom() {
  net.send({ t: "leave" });
  online.room = null;
  if (match) { match.destroy(); match = null; }
  lobbyScreen();
}

function startOnline(entry) {
  const a = entry.a;
  if (!MODULES[a.game] || !Array.isArray(a.seats)) return;
  if (match) { match.destroy(); match = null; }
  online.wait = null;
  online.chat = null;
  const seats = a.seats.map((s) => ({ cid: String(s.cid), name: String(s.name).slice(0, 12), avatar: s.avatar, intro: String(s.intro || "").slice(0, 30), ai: false }));
  const me = seats.findIndex((s) => s.cid === net.myId());
  match = new Match({
    game: a.game, mode: "online", seats, mySeats: me >= 0 ? [me] : [], settings: { ...(a.settings || {}), seed: a.seed }, level: "normal",
    module: MODULES[a.game], isHost: online.room?.host === net.myId(),
    onExit: () => leaveRoom(), onAgain: () => net.send({ t: "reset" }),
  });
  match.lastSeq = entry.seq;
  match.streaks = new Map((online.room?.members || []).map((x) => [x.cid, x.streak || 0]));
  match.setNet(online.status);
  show({ root: match.root, back: () => match?.exit() });
}

// ---------------------------------------------------------------- 방 목록
function lobbyScreen(filter = "all") {
  connect();
  let rooms = [];
  const root = el(`<section class="screen">
    <div class="topbar"><button class="icon-btn" aria-label="뒤로">←</button><h1>온라인 방</h1><span class="net-dot ${online.status}"></span><button class="icon-btn" data-k="refresh" aria-label="새로고침">↻</button></div>
    <div class="lobby-grid"><div class="card"><div class="sec-title">열린 방 <span class="muted">누르면 참가 · 꽉 찼으면 줄 서기</span></div><div class="filter" style="margin-bottom:12px"></div><div class="room-list"></div></div>
    <div class="card"><h3>방 만들기</h3><div class="row"></div>
      <h3 style="margin-top:16px">코드로 들어가기</h3><div class="join-code" style="margin-top:0"><input type="text" maxlength="4" placeholder="ABCD" aria-label="방 코드" autocomplete="off"><button class="btn primary">참가</button></div>
      <p class="muted" style="font-size:14px">진행 중인 방에 들어가면 관전자로 같이 구경하고 채팅할 수 있어요.</p></div></div></section>`);
  const list = root.querySelector(".room-list");
  root.querySelector(".filter").appendChild(segment([["all", "전체"], ["chess", "체스"], ["omok", "오목"], ["yacht", "야추"], ["yut", "윷놀이"]], filter, (v) => { filter = v; draw(); }));
  const make = root.querySelector(".lobby-grid .card:last-child .row");
  for (const g of ["chess", "omok", "yacht", "yut"]) {
    const b = el(`<button class="btn">${GAME_NAMES[g]}</button>`);
    b.onclick = () => chooseModeOnline(g);
    make.appendChild(b);
  }
  const codeInput = root.querySelector(".join-code input");
  const joinBtn = root.querySelector(".join-code button");
  const join = () => {
    const c = codeInput.value.trim().toUpperCase();
    if (c.length !== 4) { toast("방 코드 4자리를 넣어 주세요"); return; }
    joinRoom(c);
  };
  joinBtn.onclick = join;
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  root.querySelector(".icon-btn").onclick = () => homeScreen();
  root.querySelector('[data-k="refresh"]').onclick = () => { net.send({ t: "rooms" }); play("click"); };

  function draw() {
    const shown = rooms.filter((r) => filter === "all" || r.game === filter);
    list.innerHTML = "";
    if (!shown.length) {
      list.appendChild(el(`<div class="empty">${online.status === "open" ? "지금 열린 방이 없어요. 먼저 방을 만들어 보세요!" : "서버에 연결하는 중... (잠들어 있던 서버는 깨어나는 데 30초쯤 걸려요)"}</div>`));
      return;
    }
    for (const r of shown) {
      const playing = r.status !== "waiting";
      const king = r.king ? ` · ${esc(r.king.name)} ${r.king.streak}연승 중` : "";
      const line = r.queue ? ` · 대기 ${r.queue}명` : "";
      const full = r.players >= r.max;
      const item = el(`<button class="room-item g-${r.game}"><span class="gicon">${GAME_ICONS[r.game]}</span><span class="grow"><div>${esc(r.name)} <span class="muted" style="font-size:14px">${esc(r.id)}</span></div><div class="muted" style="font-size:14px">${GAME_NAMES[r.game]} · 방장 ${esc(r.host)} · ${r.players}/${r.max}명${line}${king}</div></span><span class="pill ${playing ? "live" : "wait"}">${playing ? "대전 중 · 줄 서기" : full ? "꽉 참 · 줄 서기" : "참가 가능"}</span></button>`);
      item.onclick = () => net.send({ t: "join", room: r.id }); // 꽉 찼거나 대전 중이면 서버가 줄을 세움
      list.appendChild(item);
    }
  }
  draw();
  online.lobby = { update: (rs) => { rooms = rs || []; draw(); } };
  if (net.isOpen()) net.send({ t: "rooms" });
  online.wait = null;
  online.chat = null;
  show({ root, back: () => homeScreen(), destroy: () => { online.lobby = null; } });
}

function chooseModeOnline(game) {
  const saved = store.get(`opts.${game}`, {});
  store.set(`opts.${game}`, { ...saved, mode: "online" });
  chooseMode(game);
}

// ---------------------------------------------------------------- 대기실
function waitingScreen() {
  const room = online.room;
  if (!room) return lobbyScreen();
  const root = el(`<section class="screen">
    <div class="topbar"><button class="icon-btn" aria-label="방 나가기">←</button><h1></h1><span class="net-dot ${online.status}"></span><button class="icon-btn" data-k="rules" aria-label="규칙 보기">?</button></div>
    <div class="wait-grid"><div class="wait-main main"></div><div class="side-col"></div></div></section>`);
  const main = root.querySelector(".main");
  const chat = new ChatPanel((m) => net.send({ t: "chat", ...m }));
  root.querySelector(".side-col").appendChild(chat.root);
  online.chat = chat;
  root.querySelector(".icon-btn").onclick = async () => {
    if (await confirmBox("방 나가기", "이 방에서 나갈까요?", "나가기", "남기")) leaveRoom();
  };
  root.querySelector('[data-k="rules"]').onclick = () => showRules(online.room.game);

  function update() {
    const r = online.room;
    if (!r) return;
    const me = net.myId();
    const isHost = r.host === me;
    const mine = r.members.find((x) => x.cid === me);
    const players = r.members.filter((x) => x.role === "player");
    const queue = (r.queue || []).map((cid) => r.members.find((x) => x.cid === cid)).filter(Boolean);
    const specs = r.members.filter((x) => x.role === "spectator" && !(r.queue || []).includes(x.cid));
    root.querySelector("h1").textContent = `${GAME_NAMES[r.game]} · ${r.name}`;
    const link = `${location.origin}/?room=${r.id}`;
    const tag = (x) => `${x.streak >= 2 ? `<span class="streak">${x.streak}연승</span>` : ""}${x.cid === r.host ? "<span class=\"pill\">방장</span>" : ""}${x.online ? "" : "<span class=\"pill\">연결 끊김</span>"}${isHost && x.cid !== me ? `<button class="btn ghost small kick" data-kick="${esc(x.cid)}" data-name="${esc(x.name)}">내보내기</button>` : ""}`;
    const playerPanel = r.game === "yut" ? "" : `<div class="card">
        <div class="sec-title">플레이어 <span class="muted">${players.length} / ${r.max}명</span></div><div class="people pl"></div>
      </div>`;
    const queuePanel = queue.length || specs.length ? `<div class="card">
        ${queue.length ? `<div class="sec-title">대기 줄 <span class="muted">진 사람은 줄 맨 뒤로, 이긴 사람은 계속!</span></div><div class="people qu"></div>` : ""}
        ${specs.length ? `<div class="sec-title">관전 <span class="muted">${specs.length}명</span></div><div class="people sp"></div>` : ""}
      </div>` : "";
    main.innerHTML = `<div class="card ticket">
        <div class="code-wrap"><div class="muted" style="font-size:13px">방 코드</div><div class="code-big">${esc(r.id)}</div>
          <div class="link">${esc(link)}${r.settings.private === "1" ? ` <span class="pill">비공개 · 코드로만 들어와요</span>` : ""}</div></div>
        <div class="actions"><button class="btn small" data-k="qr">QR 크게 보기</button><button class="btn small" data-k="share">링크 보내기</button></div></div>
      ${playerPanel}${queuePanel}
      <div class="card ${r.game === "yut" ? "yut-wait-card" : ""}"><div class="sec-title">${r.game === "yut" ? "윷놀이 대기실" : `게임 설정${isHost ? "" : ` <span class="muted">방장이 정해요</span>`}`}</div><div class="settings"></div>
        <div class="row start-row" style="justify-content:flex-end;margin-top:6px"></div></div>`;
    if (r.game !== "yut") main.querySelector(".pl").innerHTML = players.map((x) => personHtml(x, { extra: tag(x), cls: x.online ? "" : "off" })).join("") || `<div class="empty">아직 아무도 없어요</div>`;
    if (queue.length) main.querySelector(".qu").innerHTML = queue.map((x, k) => personHtml(x, { extra: tag(x), cls: x.online ? "" : "off", sub: `${k + 1}번째 대기${x.intro ? " · " + x.intro : ""}` })).join("");
    if (specs.length) main.querySelector(".sp").innerHTML = specs.map((x) => personHtml(x, { extra: tag(x), cls: x.online ? "" : "off" })).join("");
    main.querySelector('[data-k="qr"]').onclick = () => showQr(r, link);
    main.querySelector('[data-k="share"]').onclick = async () => {
      const text = `KI득KI득 ${GAME_NAMES[r.game]} 같이 해요! 방 코드 ${r.id}`;
      try {
        if (navigator.share) await navigator.share({ title: "KI득KI득", text, url: link });
        else { await navigator.clipboard.writeText(link); toast("링크를 복사했어요!"); }
      } catch { /* 공유 창을 닫음 */ }
    };

    const settings = main.querySelector(".settings");
    const s = { ...r.settings };
    const change = (k) => (v) => { s[k] = v; net.send({ t: "settings", settings: s }); };
    if (r.game === "chess") {
      settings.appendChild(option("시간", isHost ? segment(Object.entries(chess.TIME_MODES).map(([k, v]) => [k, v[0]]), s.time || "none", change("time")) : el(`<div>${esc(chess.TIME_MODES[s.time]?.[0] || "무제한")}</div>`)));
      settings.appendChild(option("방장의 색", isHost ? segment([["w", "백"], ["b", "흑"], ["random", "무작위"]], s.color || "w", change("color")) : el(`<div>${{ w: "백", b: "흑", random: "무작위" }[s.color] || "백"}</div>`)));
    } else if (r.game === "yut") {
      const teamMode = s.team === "1";
      const teamB = roomTeamB(r, players);
      const roster = el(`<section class="yut-room-setup" aria-label="윷놀이 준비">
        <div class="yut-setup-head"><div><strong>${teamMode ? "팀과 말 정하기" : "내 말 캐릭터 고르기"}</strong>
          <span>${teamMode ? "플레이어 카드를 끌어다 놓거나 팀 이동 버튼을 누르세요" : "각자 사용할 말을 대기실에서 미리 골라요"}</span></div>
          ${teamMode ? `<div class="team-totals"><span class="team-count team-a"><b data-team-count="A">0</b> / 2 A팀</span><span class="team-count team-b"><b data-team-count="B">0</b> / 2 B팀</span></div>` : `<span class="yut-skin-progress"></span>`}
        </div><div class="yut-roster-board ${teamMode ? "teams" : "solo"}"></div>
        ${teamMode ? `<p class="team-status" aria-live="polite"></p>` : ""}
        <p class="yut-skin-status" aria-live="polite"></p>
      </section>`);
      const board = roster.querySelector(".yut-roster-board");
      const lists = {};
      const columns = teamMode ? [["A", "A팀"], ["B", "B팀"]] : [["A", "참가 플레이어"]];
      for (const [team, label] of columns) {
        const col = el(`<section class="yut-team-column team-${team.toLowerCase()}" data-team-column="${team}">
          <div class="yut-team-column-head"><strong>${label}</strong>${teamMode ? `<span><b data-column-count="${team}">0</b>명</span>` : `<span>${players.length}명</span>`}</div>
          <div class="yut-team-members" data-team-list="${team}"></div>
        </section>`);
        lists[team] = col.querySelector(".yut-team-members");
        if (isHost && teamMode) {
          col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-over"); });
          col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop-over"); });
          col.addEventListener("drop", (e) => {
            e.preventDefault(); col.classList.remove("drop-over");
            const cid = e.dataTransfer?.getData("text/plain");
            if (cid) movePlayerToTeam(cid, team);
          });
        }
        board.appendChild(col);
      }
      const playerCards = new Map();
      const teamOfCid = (cid) => teamMode && teamB.has(cid) ? "B" : "A";
      const updateSetupStatus = () => {
        const skinIds = players.map((p) => p.avatar);
        const validSkins = skinIds.filter((id) => YUT_ROOM_SKINS.some((c) => c.id === id));
        const uniqueSkins = new Set(validSkins);
        const skinsReady = players.length >= 2 && validSkins.length === players.length && uniqueSkins.size === players.length;
        const selected = uniqueSkins.size;
        const skinStatus = roster.querySelector(".yut-skin-status");
        skinStatus.textContent = skinsReady ? "모두 다른 말 캐릭터를 골랐어요" : `말 캐릭터 ${selected}/${players.length}명 선택 · 서로 다른 말을 골라 주세요`;
        skinStatus.classList.toggle("ready", skinsReady);
        const progress = roster.querySelector(".yut-skin-progress");
        if (progress) progress.textContent = `${selected}/${players.length}명 말 선택`;
        if (teamMode) {
          const nB = players.filter((p) => teamB.has(p.cid)).length;
          const nA = players.length - nB;
          roster.querySelector('[data-team-count="A"]').textContent = nA;
          roster.querySelector('[data-team-count="B"]').textContent = nB;
          roster.querySelector('[data-column-count="A"]').textContent = nA;
          roster.querySelector('[data-column-count="B"]').textContent = nB;
          const ready = players.length === 4 && nA === 2 && nB === 2;
          const status = roster.querySelector(".team-status");
          status.textContent = ready ? "팀 배정 완료 · A팀과 B팀 2명씩" : `플레이어 ${players.length}/4명 · 양 팀을 2명씩 배정해 주세요`;
          status.classList.toggle("ready", ready);
        }
        return skinsReady;
      };
      const movePlayerToTeam = (cid, target) => {
        if (!isHost || !teamMode || !players.some((p) => p.cid === cid) || teamOfCid(cid) === target) return;
        if (target === "B") teamB.add(cid); else teamB.delete(cid);
        s.tb = [...teamB].filter((id) => players.some((p) => p.cid === id)).join(",");
        const card = playerCards.get(cid);
        if (card) {
          card.dataset.team = target;
          lists[target].appendChild(card);
          card.querySelector(".team-move-btn").textContent = target === "A" ? "B팀으로 →" : "← A팀으로";
        }
        net.send({ t: "settings", settings: s });
        updateSetupStatus();
      };
      for (const [i, p] of players.entries()) {
        const currentTeam = teamOfCid(p.cid);
        const pickedSkin = YUT_ROOM_SKINS.find((c) => c.id === p.avatar);
        const previewSkin = pickedSkin?.id || YUT_ROOM_SKINS[i % YUT_ROOM_SKINS.length].id;
        const card = el(`<article class="yut-room-player" data-player="${esc(p.cid)}" data-team="${currentTeam}">
          <div class="yut-player-top"><span class="yut-character-preview"><svg viewBox="-11 -27 22 29" aria-hidden="true">${yutCharSvg(previewSkin)}</svg></span>
            <div class="yut-player-label"><strong>${esc(p.name)}</strong><span class="yut-picked-name">${pickedSkin ? `${esc(pickedSkin.name)} 말` : "말을 골라 주세요"}</span>
              <div class="yut-player-tags">${tag(p)}</div></div>
          </div><div class="yut-character-picker" role="group" aria-label="${esc(p.name)} 말 캐릭터"></div>
          ${teamMode && isHost ? `<button type="button" class="team-move-btn">${currentTeam === "A" ? "B팀으로 →" : "← A팀으로"}</button>` : ""}
        </article>`);
        card.draggable = isHost && teamMode;
        if (card.draggable) {
          card.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", p.cid); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
          card.addEventListener("dragend", () => { card.classList.remove("dragging"); board.querySelectorAll(".drop-over").forEach((x) => x.classList.remove("drop-over")); });
          card.querySelector(".team-move-btn").onclick = () => movePlayerToTeam(p.cid, card.dataset.team === "A" ? "B" : "A");
        }
        if (p.cid === me) {
          const picker = card.querySelector(".yut-character-picker");
          for (const skin of YUT_ROOM_SKINS) {
            const owner = players.find((x) => x.cid !== p.cid && x.avatar === skin.id);
            const button = el(`<button type="button" class="yut-character-choice${pickedSkin?.id === skin.id ? " selected" : ""}" aria-pressed="${pickedSkin?.id === skin.id}" aria-label="${esc(skin.name)} 말" title="${owner ? `${esc(owner.name)} 님이 선택함` : `${esc(skin.name)} 말 선택`}" ${owner ? "disabled" : ""}>
              <svg viewBox="-11 -27 22 29" aria-hidden="true">${yutCharSvg(skin.id)}</svg><span>${esc(skin.name)}</span></button>`);
            button.onclick = () => {
              if (owner) return;
              profile.avatar = skin.id;
              p.avatar = skin.id;
              saveProfile();
              play("pop");
              update();
            };
            picker.appendChild(button);
          }
        } else {
          card.querySelector(".yut-character-picker").innerHTML = `<span class="yut-owner-note">${pickedSkin ? "선택 완료" : "아직 선택하지 않음"}</span>`;
        }
        playerCards.set(p.cid, card);
        lists[currentTeam].appendChild(card);
      }
      if (players.length === 0) board.querySelectorAll(".yut-team-members").forEach((list) => { list.innerHTML = `<p class="yut-drop-empty">플레이어가 들어오면 여기에 표시돼요</p>`; });
      updateSetupStatus();
      settings.appendChild(roster);
    } else if (r.game === "omok") {
      settings.appendChild(option("규칙", isHost ? segment([["33", "쌍삼 금지"], ["free", "자유룰"]], s.rule || "33", change("rule")) : el(`<div>${s.rule === "free" ? "자유룰" : "쌍삼 금지"}</div>`)));
      settings.appendChild(option("방장의 돌", isHost ? segment([["b", "흑"], ["w", "백"], ["random", "무작위"]], s.color || "b", change("color")) : el(`<div>${{ b: "흑", w: "백", random: "무작위" }[s.color] || "흑"}</div>`)));
    }
    if (isHost && r.game !== "yut") settings.appendChild(option("방 공개", segment([["", "열린 방 목록에 보이기"], ["1", "비공개 (코드로만)"]], s.private || "", change("private"))));

    main.querySelectorAll("[data-kick]").forEach((b) => {
      b.onclick = async () => {
        if (await confirmBox("내보내기", `${b.dataset.name} 님을 이 방에서 내보낼까요? 다시 들어올 수 없어요.`, "내보내기", "취소")) net.send({ t: "kick", pid: b.dataset.kick });
      };
    });

    const startRow = main.querySelector(".start-row");
    if (mine) {
      const inLine = (r.queue || []).includes(me);
      const label = mine.role === "player" ? "관전으로 바꾸기" : inLine ? "줄에서 빠지기" : players.length < r.max && !queue.length ? "플레이어로 참가" : "줄 서기";
      const swap = el(`<button class="btn ghost">${label}</button>`);
      swap.disabled = mine.role === "player" && r.status === "playing";
      swap.onclick = () => net.send({ t: "seat", role: mine.role === "player" || inLine ? "spectator" : "player" });
      startRow.appendChild(swap);
    }
    if (isHost) {
      const need = r.game === "yacht" ? 2 : 2;
      const go = el(`<button class="btn primary big">시작하기</button>`);
      const yutTeamReady = r.game !== "yut" || r.settings.team !== "1" ||
        (players.length === 4 && players.filter((p) => roomTeamB(r, players).has(p.cid)).length === 2);
      const pickedSkins = players.map((p) => p.avatar).filter((id) => YUT_ROOM_SKINS.some((c) => c.id === id));
      const yutSkinsReady = r.game !== "yut" || (players.length >= 2 && pickedSkins.length === players.length && new Set(pickedSkins).size === players.length);
      go.disabled = players.length < need || r.status === "playing" || !players.every((x) => x.online) || !yutTeamReady || !yutSkinsReady;
      go.onclick = () => startRoomGame(r);
      startRow.appendChild(go);
      if (players.length < need) startRow.appendChild(el(`<div class="muted" style="width:100%;text-align:right">친구가 ${need - players.length}명 더 들어오면 시작할 수 있어요</div>`));
      else if (r.game === "yut" && !yutSkinsReady) startRow.appendChild(el(`<div class="muted yut-start-note">모든 플레이어가 서로 다른 말 캐릭터를 골라야 시작할 수 있어요</div>`));
      else if (r.game === "yut" && !yutTeamReady) startRow.appendChild(el(`<div class="muted yut-start-note">A팀과 B팀을 2명씩 배정해 주세요</div>`));
    } else {
      startRow.appendChild(el(`<div class="muted">방장이 시작하기를 기다리는 중...</div>`));
    }
  }

  update();
  online.wait = { update };
  show({ root, back: () => root.querySelector(".icon-btn").click(), destroy: () => { online.wait = null; online.chat = null; } });
  chat.system(`방 코드 ${room.id} — 친구에게 링크를 보내 보세요!`);
}

/** 교실 화면(빔프로젝터)에 크게 띄워 폰으로 찍어 들어오게 하는 QR */
function showQr(r, link) {
  const body = el(`<div class="qr-box"><img class="qr" alt="방 링크 QR 코드" src="/qr/${encodeURIComponent(r.id)}.svg">
    <div class="code-big">${esc(r.id)}</div><div class="muted" style="word-break:break-all">${esc(link)}</div>
    <p class="muted" style="margin:6px 0 0">폰 카메라로 찍으면 바로 이 방으로 들어와요</p></div>`);
  modal(`${GAME_NAMES[r.game]} · ${r.name}`, body);
  body.closest(".modal").classList.add("modal-wide");
}

function startRoomGame(r) {
  // 자리에 앉는 사람과 이름 · 사진은 서버가 정함. 여기서는 체스 · 오목 색에 맞춘 자리 순서만 보냄
  let order = r.members.filter((x) => x.role === "player").map((x) => x.cid);
  if (r.game !== "yacht" && r.game !== "yut") {
    const firstColor = r.game === "chess" ? "w" : "b";
    const hostColor = resolveColor(r.game, r.settings.color || firstColor);
    if (order.includes(r.host)) {
      const rest = order.filter((p) => p !== r.host);
      order = hostColor === firstColor ? [r.host, ...rest] : [...rest, r.host];
    }
  }
  let team = "";
  if (r.game === "yut" && r.settings.team === "1" && order.length === 4) { // 팀전: 방장이 나눈 대로 A · B가 번갈아 앉게
    const players = r.members.filter((x) => x.role === "player");
    const tb = roomTeamB(r, players);
    if (order.filter((c) => tb.has(c)).length !== 2) { toast("대기실에서 팀을 2명씩 나눠 주세요"); return; }
    order = teamOrder(order, (c) => tb.has(c));
    team = "1";
  }
  const settings = r.game === "chess" ? { time: r.settings.time || "none" } : r.game === "omok" ? { rule: r.settings.rule || "33" }
    : r.game === "yut" ? { pieces: r.settings.pieces || "3", chaos: r.settings.chaos || "chaos", team } : {};
  net.send({ t: "act", a: { type: "start", game: r.game, settings, order } });
}

// ---------------------------------------------------------------- 랭킹
function rankingModal() {
  const body = el(`<div><div class="tabs" style="margin-bottom:10px"></div><div class="games-f" style="margin-bottom:12px"></div><div class="table"></div></div>`);
  let scope = "local", game = "all", classData = null, storeKind = null;
  const tableBox = body.querySelector(".table");
  const draw = () => {
    const data = scope === "local" ? store.get("ranking", {}) : classData;
    if (data === null) { tableBox.innerHTML = `<div class="empty">우리 반 기록을 불러오는 중...</div>`; return; }
    const rows = Object.entries(data).map(([name, recs]) => {
      let wins = 0, games = 0;
      for (const [g, r] of Object.entries(recs || {})) if (game === "all" || g === game) { wins += r.wins | 0; games += r.games | 0; }
      return { name, wins, games };
    }).filter((x) => x.games > 0).sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || a.games - b.games).slice(0, 50);
    tableBox.innerHTML = rows.length
      ? `<table class="rank"><thead><tr><th>순위</th><th>이름</th><th>승</th><th>판</th><th>승률</th></tr></thead><tbody>${rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${x.wins}</td><td>${x.games}</td><td>${Math.round((x.wins / x.games) * 100)}%</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">아직 기록이 없어요. 한 판 해 볼까요?</div>`;
    if (scope === "class" && storeKind === "file") tableBox.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:13px">이 서버는 기록을 임시 파일에 저장해서, 서버를 다시 켜면 초기화돼요.</p>`);
  };
  body.querySelector(".tabs").appendChild(segment([["local", "이 기기"], ["class", "우리 반 (온라인)"]], scope, (v) => {
    scope = v;
    if (v === "class") {
      connect();
      const ask = () => net.send({ t: "ranking" });
      if (net.isOpen()) ask(); else { const off = net.on("welcome", () => { off(); ask(); }); }
    }
    draw();
  }));
  body.querySelector(".games-f").appendChild(segment([["all", "전체"], ["chess", "체스"], ["omok", "오목"], ["yacht", "야추"], ["yut", "윷놀이"]], game, (v) => { game = v; draw(); }));
  const off = net.on("ranking", (msg) => {
    classData = msg.ranking || {};
    storeKind = msg.store;
    draw();
  });
  draw();
  const close = modal("랭킹", body);
  const obs = new MutationObserver(() => { if (!body.isConnected) { off(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  return close;
}

// ---------------------------------------------------------------- 시작
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
if (pendingCode) homeScreen(); // 초대 링크로 왔으면 바로 참가할 수 있는 화면으로
else titleScreen();
if (profile.name) connect(); // 새로고침해도 하던 방/판으로 돌아가도록
