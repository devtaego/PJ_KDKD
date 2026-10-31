// KI득KI득 웹판: 첫 화면 · 프로필 · 게임 고르기 · 온라인 방 목록 · 대기실 · 랭킹
import * as net from "./net.js";
import { ANIMALS, avatarHtml, photoToSpec, GAME_ICONS, esc } from "./art.js";
import { el, toast, modal, confirmBox, segment, option, store, ChatPanel, personHtml } from "./ui.js";
import { play, soundOn, setSound } from "./sound.js";
import { Match, showRules } from "./match.js";
import { GAME_NAMES, GAME_DESC } from "./rules.js";
import * as chess from "./games/chess.js";
import * as omok from "./games/omok.js";
import * as yacht from "./games/yacht.js";

const APP_VERSION = "2.0.0-web";
const APP_SUB = "같은 기수, 키득키득";
const DEVELOPER = "KDA 5기 송재혁";
const REPO_URL = "https://github.com/devtaego/PJ_KDKD";
const MODULES = { chess, omok, yacht };
const MAX_PLAYERS = { chess: 2, omok: 2, yacht: 6 };
const LEVELS = [["easy", "쉬움"], ["normal", "보통"], ["hard", "어려움"]];
const ROBOT_NAMES = ["컴퓨터", "로봇 철수", "로봇 영희", "로봇 민수", "로봇 지수", "로봇 하나"];

const app = document.getElementById("app");
let profile = { name: "", avatar: "cat", intro: "", ...store.get("profile", {}) };
let current = null; // 지금 화면 { root, back?, destroy? }
let match = null;
const online = { room: null, status: "closed", chat: null, lobby: null, wait: null };
let pendingCode = new URLSearchParams(location.search).get("room");

// ---------------------------------------------------------------- 화면 바꾸기
function show(screen, { push = true } = {}) {
  if (current && current !== screen) current.destroy?.();
  if (match && screen.root !== match.root) { match.destroy(); match = null; }
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

// ---------------------------------------------------------------- 첫 화면
function homeScreen() {
  const root = el(`<section class="screen">
    <header class="home-head"><h1 class="logo">KI<b>득</b>KI<em>득</em></h1><div class="muted">${esc(APP_SUB)} · 아이스브레이킹 미니게임룸</div></header>
    <div class="home-grid">
      <div class="card profile">
        <h2>내 프로필</h2>
        <label class="field"><span>닉네임</span><input id="nick" type="text" maxlength="12" placeholder="예: 태고" autocomplete="nickname"></label>
        <div class="muted" style="font-size:14px">캐릭터 또는 내 사진</div>
        <div class="avatar-pick"></div>
        <label class="field"><span>한 줄 소개 (MBTI, 관심사...)</span><input id="intro" type="text" maxlength="30" placeholder="예: ENFP · 떡볶이 좋아해요"></label>
        <div class="row"><button class="btn small ghost" data-k="sound"></button><span class="grow"></span><button class="btn small ghost" data-k="about">정보</button></div>
      </div>
      <div>
        <div class="games"></div>
        <div class="card" style="margin-top:var(--gap)">
          <h3>친구들과 온라인으로</h3>
          <div class="muted" style="font-size:15px">와이파이가 달라도, 폰이어도 괜찮아요. 방 코드나 링크만 나누면 같이 할 수 있어요.</div>
          <div class="join-code"><input id="code" type="text" maxlength="4" placeholder="방 코드" aria-label="방 코드" autocomplete="off"><button class="btn primary" data-k="join">참가</button></div>
          <div class="home-tools"><button class="btn" data-k="lobby">열린 방 보기</button><button class="btn" data-k="rank">랭킹</button><button class="btn ghost" data-k="rules">규칙 보기</button></div>
        </div>
      </div>
    </div></section>`);
  const nick = root.querySelector("#nick");
  const intro = root.querySelector("#intro");
  nick.value = profile.name;
  intro.value = profile.intro;
  nick.oninput = () => { profile.name = nick.value.trim(); saveProfile(); };
  intro.oninput = () => { profile.intro = intro.value.trim(); saveProfile(); };

  const pick = root.querySelector(".avatar-pick");
  const drawPick = () => {
    pick.innerHTML = "";
    for (const [id, label] of ANIMALS) {
      const b = el(`<button type="button" aria-label="${label}" aria-pressed="${profile.avatar === id}">${avatarHtml(id, 52)}</button>`);
      b.onclick = () => { profile.avatar = id; saveProfile(); play("pop"); drawPick(); };
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
      } catch { toast("사진을 열 수 없어요"); }
    };
    pick.append(ph, file);
  };
  drawPick();

  const games = root.querySelector(".games");
  for (const g of ["chess", "yacht", "omok"]) {
    const card = el(`<button class="game-card"><div class="gicon">${GAME_ICONS[g]}</div><div><div class="gname">${GAME_NAMES[g]}</div><div class="gdesc">${GAME_DESC[g]}</div></div></button>`);
    card.onclick = () => { if (!needName()) { play("click"); chooseMode(g); } };
    games.appendChild(card);
  }

  const soundBtn = root.querySelector('[data-k="sound"]');
  const paint = () => { soundBtn.textContent = soundOn() ? "효과음 켜짐" : "효과음 꺼짐"; };
  paint();
  soundBtn.onclick = () => { setSound(!soundOn()); paint(); play("click"); };
  root.querySelector('[data-k="about"]').onclick = about;
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
  show({ root }, { push: false });
  if (pendingCode && !profile.name) toast("닉네임을 정하고 '참가'를 누르면 친구 방에 들어가요", 3500);
}

function rulesPicker() {
  const body = el(`<div class="row"></div>`);
  let close;
  for (const g of ["chess", "yacht", "omok"]) {
    const b = el(`<button class="btn">${GAME_NAMES[g]}</button>`);
    b.onclick = () => { close(); showRules(g); };
    body.appendChild(b);
  }
  close = modal("어떤 게임 규칙을 볼까요?", body);
}

function about() {
  const body = el(`<div class="rules">
    <p><b>KI득KI득</b> v${APP_VERSION} — ${esc(APP_SUB)}</p>
    <p>새 기수가 처음 만났을 때 어색함 없이 친해질 수 있도록 만든 미니게임 모음이에요. 체스 · 야추 다이스 · 오목을 컴퓨터와, 한 기기에서, 또는 온라인으로 함께 해요.</p>
    <p>만든 사람: ${esc(DEVELOPER)}</p>
    <p class="muted">글꼴: 주아체 (SIL Open Font License 1.1) · 기물 · 주사위 · 캐릭터 · 스티커는 모두 코드로 직접 그렸어요. 채팅은 서버를 거쳐 전달되고 따로 저장하지 않아요.</p>
    <p><a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--gold)">GitHub 저장소</a> · 데스크톱(exe)판도 있어요</p></div>`);
  modal("정보", body);
}

// ---------------------------------------------------------------- 게임 · 모드 고르기
function chooseMode(game) {
  const saved = store.get(`opts.${game}`, {});
  const o = { mode: "ai", level: "normal", time: "none", color: game === "omok" ? "b" : "w", rule: "33", bots: 1, people: 2, friend: "친구", ...saved };
  const body = el(`<div></div>`);
  let close;
  const draw = () => {
    body.innerHTML = "";
    const modes = [["ai", "컴퓨터 대전"], ["local", game === "yacht" ? "한 기기 여럿" : "한 기기 2인"], ["online", "온라인"]];
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
    if (game !== "yacht" && o.mode === "local") {
      const f = el(`<label class="field"><span>같이 하는 친구 이름</span><input type="text" maxlength="12"></label>`);
      const input = f.querySelector("input");
      input.value = o.friend;
      input.oninput = () => { o.friend = input.value.trim() || "친구"; };
      body.appendChild(f);
    }
    if (o.mode === "online") body.appendChild(el(`<p class="muted" style="margin-top:0">방을 만들면 4자리 코드와 링크가 생겨요. 친구에게 보내면 폰에서도 바로 들어와요.</p>`));
    const row = el(`<div class="row" style="justify-content:flex-end"></div>`);
    if (o.mode === "online") {
      const find = el(`<button class="btn ghost">열린 방 찾기</button>`);
      find.onclick = () => { close(); lobbyScreen(game); };
      row.appendChild(find);
    }
    const go = el(`<button class="btn primary big">${o.mode === "online" ? "방 만들기" : "시작!"}</button>`);
    go.onclick = () => {
      store.set(`opts.${game}`, o);
      close();
      if (o.mode === "online") createRoom(game, game === "chess" ? { time: o.time, color: o.color } : game === "omok" ? { rule: o.rule, color: o.color } : {});
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

function startLocal(game, o) {
  const me = { name: profile.name, avatar: profile.avatar, intro: profile.intro, ai: false };
  const botAvatar = { name: ROBOT_NAMES[0], avatar: "robot", intro: "", ai: true };
  let seats, mySeats;
  if (game === "yacht") {
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
  const settings = game === "chess" ? { time: o.time } : game === "omok" ? { rule: o.rule } : {};
  const begin = () => {
    if (match) { match.destroy(); match = null; }
    match = new Match({
      game, mode: o.mode, seats, mySeats, settings, level: o.level, module: MODULES[game],
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

net.on("room", (msg) => {
  const prev = online.room;
  online.room = msg.room;
  if (match?.online) {
    match.isHost = msg.room.host === net.myCid();
    const on = new Map(msg.room.members.map((x) => [x.cid, x.online]));
    match.offline = new Set(match.seats.map((s, i) => (on.get(s.cid) === false ? i : -1)).filter((i) => i >= 0));
    match.g.render();
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
  const text = msg.kind === "join" ? `${msg.name} 님이 들어왔어요${msg.role === "spectator" ? " (관전)" : ""}` : `${msg.name} 님이 나갔어요`;
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
  const me = seats.findIndex((s) => s.cid === net.myCid());
  match = new Match({
    game: a.game, mode: "online", seats, mySeats: me >= 0 ? [me] : [], settings: a.settings || {}, level: "normal",
    module: MODULES[a.game], isHost: online.room?.host === net.myCid(),
    onExit: () => leaveRoom(), onAgain: () => net.send({ t: "reset" }),
  });
  match.lastSeq = entry.seq;
  match.setNet(online.status);
  show({ root: match.root, back: () => match?.exit() });
}

// ---------------------------------------------------------------- 방 목록
function lobbyScreen(filter = "all") {
  connect();
  let rooms = [];
  const root = el(`<section class="screen">
    <div class="topbar"><button class="icon-btn" aria-label="뒤로">←</button><h1>온라인 방</h1><span class="net-dot ${online.status}"></span><button class="icon-btn" data-k="refresh" aria-label="새로고침">↻</button></div>
    <div class="lobby-grid"><div class="card"><div class="filter" style="margin-bottom:12px"></div><div class="room-list"></div></div>
    <div class="card"><h3>방 만들기</h3><div class="row"></div>
      <h3 style="margin-top:16px">코드로 들어가기</h3><div class="join-code" style="margin-top:0"><input type="text" maxlength="4" placeholder="ABCD" aria-label="방 코드" autocomplete="off"><button class="btn primary">참가</button></div>
      <p class="muted" style="font-size:14px">진행 중인 방에 들어가면 관전자로 같이 구경하고 채팅할 수 있어요.</p></div></div></section>`);
  const list = root.querySelector(".room-list");
  root.querySelector(".filter").appendChild(segment([["all", "전체"], ["chess", "체스"], ["yacht", "야추"], ["omok", "오목"]], filter, (v) => { filter = v; draw(); }));
  const make = root.querySelector(".lobby-grid .card:last-child .row");
  for (const g of ["chess", "yacht", "omok"]) {
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
      const full = r.players >= r.max;
      const item = el(`<button class="room-item"><span class="gicon">${GAME_ICONS[r.game]}</span><span class="grow"><div>${esc(r.name)} <span class="muted" style="font-size:14px">${esc(r.id)}</span></div><div class="muted" style="font-size:14px">${GAME_NAMES[r.game]} · 방장 ${esc(r.host)} · ${r.players}/${r.max}명${r.spectators ? ` · 관전 ${r.spectators}` : ""}</div></span><span class="pill ${playing ? "live" : "wait"}">${playing ? "대전 중 · 관전" : full ? "꽉 참 · 관전" : "참가 가능"}</span></button>`);
      item.onclick = () => net.send({ t: "join", room: r.id, as: playing || full ? "spectator" : "player" });
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
    <div class="wait-grid"><div class="card main"></div><div class="side-col"></div></div></section>`);
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
    const me = net.myCid();
    const isHost = r.host === me;
    const mine = r.members.find((x) => x.cid === me);
    const players = r.members.filter((x) => x.role === "player");
    const specs = r.members.filter((x) => x.role === "spectator");
    root.querySelector("h1").textContent = `${GAME_NAMES[r.game]} · ${r.name}`;
    const link = `${location.origin}/?room=${r.id}`;
    main.innerHTML = `<div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="muted" style="font-size:14px">방 코드</div><div class="code-big">${esc(r.id)}</div></div>
      <div class="row"><button class="btn small" data-k="share">링크 보내기</button></div></div>
      <div class="muted" style="font-size:14px;margin:4px 0 14px;word-break:break-all">${esc(link)}</div>
      <h3>플레이어 ${players.length}/${r.max}</h3><div class="people pl"></div>
      ${specs.length ? `<h3 style="margin-top:14px">관전 ${specs.length}</h3><div class="people sp"></div>` : ""}
      <div class="settings" style="margin-top:16px"></div><div class="row start-row" style="justify-content:flex-end;margin-top:12px"></div>`;
    const tag = (x) => `${x.cid === r.host ? "<span class=\"pill\">방장</span>" : ""}${x.online ? "" : "<span class=\"pill\">연결 끊김</span>"}`;
    main.querySelector(".pl").innerHTML = players.map((x) => personHtml(x, { extra: tag(x), cls: x.online ? "" : "off" })).join("") || `<div class="empty">아직 아무도 없어요</div>`;
    if (specs.length) main.querySelector(".sp").innerHTML = specs.map((x) => personHtml(x, { extra: tag(x), cls: x.online ? "" : "off" })).join("");
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
    } else if (r.game === "omok") {
      settings.appendChild(option("규칙", isHost ? segment([["33", "쌍삼 금지"], ["free", "자유룰"]], s.rule || "33", change("rule")) : el(`<div>${s.rule === "free" ? "자유룰" : "쌍삼 금지"}</div>`)));
      settings.appendChild(option("방장의 돌", isHost ? segment([["b", "흑"], ["w", "백"], ["random", "무작위"]], s.color || "b", change("color")) : el(`<div>${{ b: "흑", w: "백", random: "무작위" }[s.color] || "흑"}</div>`)));
    }

    const startRow = main.querySelector(".start-row");
    if (mine) {
      const swap = el(`<button class="btn ghost">${mine.role === "player" ? "관전으로 바꾸기" : "플레이어로 참가"}</button>`);
      swap.disabled = r.status === "playing" || (mine.role === "spectator" && players.length >= r.max);
      swap.onclick = () => net.send({ t: "seat", role: mine.role === "player" ? "spectator" : "player" });
      startRow.appendChild(swap);
    }
    if (isHost) {
      const need = r.game === "yacht" ? 2 : 2;
      const go = el(`<button class="btn primary big">시작하기</button>`);
      go.disabled = players.length < need || r.status === "playing" || !players.every((x) => x.online);
      go.onclick = () => startRoomGame(r);
      startRow.appendChild(go);
      if (players.length < need) startRow.appendChild(el(`<div class="muted" style="width:100%;text-align:right">친구가 ${need - players.length}명 더 들어오면 시작할 수 있어요</div>`));
    } else {
      startRow.appendChild(el(`<div class="muted">방장이 시작하기를 기다리는 중...</div>`));
    }
  }

  update();
  online.wait = { update };
  show({ root, back: () => root.querySelector(".icon-btn").click(), destroy: () => { online.wait = null; online.chat = null; } });
  chat.system(`방 코드 ${room.id} — 친구에게 링크를 보내 보세요!`);
}

function startRoomGame(r) {
  const players = r.members.filter((x) => x.role === "player");
  let seats = players.map((x) => ({ cid: x.cid, name: x.name, avatar: x.avatar, intro: x.intro }));
  if (r.game !== "yacht") {
    const hostIdx = seats.findIndex((x) => x.cid === r.host);
    const firstColor = r.game === "chess" ? "w" : "b";
    const hostColor = resolveColor(r.game, r.settings.color || firstColor);
    const host = seats.splice(hostIdx, 1)[0];
    seats = hostColor === firstColor ? [host, ...seats] : [...seats, host];
  }
  const settings = r.game === "chess" ? { time: r.settings.time || "none" } : r.game === "omok" ? { rule: r.settings.rule || "33" } : {};
  net.send({ t: "act", a: { type: "start", game: r.game, settings, seats } });
}

// ---------------------------------------------------------------- 랭킹
function rankingModal() {
  const body = el(`<div><div class="tabs" style="margin-bottom:10px"></div><div class="games-f" style="margin-bottom:12px"></div><div class="table"></div></div>`);
  let scope = "local", game = "all", classData = null;
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
  body.querySelector(".games-f").appendChild(segment([["all", "전체"], ["chess", "체스"], ["yacht", "야추"], ["omok", "오목"]], game, (v) => { game = v; draw(); }));
  const off = net.on("ranking", (msg) => { classData = msg.ranking || {}; draw(); });
  draw();
  const close = modal("랭킹", body);
  const obs = new MutationObserver(() => { if (!body.isConnected) { off(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  return close;
}

// ---------------------------------------------------------------- 시작
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
homeScreen();
if (profile.name) connect(); // 새로고침해도 하던 방/판으로 돌아가도록
