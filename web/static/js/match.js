// 한 판을 진행하는 틀: 컴퓨터 대전 · 한 기기 여럿 · 온라인을 같은 방식으로 다룸
// 모든 행동(수 두기, 주사위 굴리기, 항복...)은 submit -> apply 순서로 흘러감.
// 온라인에서는 서버가 순서와 시각을 붙여 모두에게 똑같이 돌려주므로, 모든 기기가 같은 판을 계산함.
import * as net from "./net.js";
import { titleBadge, titleFx } from "./data/titles.js";
import { countQuirk, streakHtml, streakText, el, ChatPanel, popAt, showResult, addLocalRecord, toast, modal, soundButton } from "./ui.js";
import { avatarHtml, esc } from "./art.js";
import { play } from "./sound.js";
import { questionFor, replyLine, CHAT_AI_TEXTS, randomOf } from "./party.js";
import { RULES_TEXT, GAME_NAMES } from "./rules.js";

const INTRO_MS = 2000; // 시작 연출 길이
// 연출 재료: 모션(style.css 의 vs- / gather- 클래스) · 배경 · 터질 때 흩어지는 게임별 조각
const VS_MOTIONS = ["clash", "drop", "spin", "charge", "slash", "zoom", "flip", "rocket", "whip", "swap"];
const GATHER_MOTIONS = ["implode", "spiral", "rain", "march", "pop"];
const VS_BACKS = ["bg-slash", "bg-split", "bg-rays", "bg-spot"];
const GATHER_BACKS = ["bg-glow", "bg-rays", "bg-spot"];
const INTRO_BITS = { chess: ["♟", "♞", "♝", "♜", "♛", "♚"], omok: ["⚫", "⚪"], yacht: ["🎲", "🎯", "🍀"], yut: ["🐷", "🐶", "🐑", "🐮", "🐴"] };
const lastPick = new Map();
/** 바로 전과 다른 것을 무작위로 고름 (같은 연출이 연달아 나오지 않게) */
function freshPick(list) {
  const pick = randomOf(list.filter((x) => x !== lastPick.get(list)));
  lastPick.set(list, pick);
  return pick;
}

export class Match {
  /**
   * game: chess / omok / yacht, mode: ai / local / online
   * seats: [{name, avatar, intro, ai, cid}], mySeats: 이 기기가 조작하는 자리 번호들
   * settings: 게임별 설정, level: 컴퓨터 난이도
   */
  constructor({ game, mode, seats, mySeats, settings, level, module, onExit, onAgain, onWaitingRoom, onManage, onBracket, isHost = true, replaying = false }) {
    Object.assign(this, { game, mode, seats, mySeats, settings, level, module, onExit, onAgain, onWaitingRoom, onManage, onBracket, isHost, replaying });
    this.online = mode === "online";
    this.lastSeq = 0;
    this.result = null;
    this.resultView = null;
    this.timers = new Set();
    this.offline = new Set(); // 연결이 끊긴 자리
    this.introKind = replaying || matchMedia("(prefers-reduced-motion: reduce)").matches ? null
      : seats.length === 2 || (seats.length === 4 && settings?.team === "1") ? "vs" : seats.length > 2 ? "gather" : null;
    this.introUntil = this.introKind ? Date.now() + INTRO_MS : 0;
    this.buildScreen();
    this.g = module.create(this);
    this.boardWrap.appendChild(this.g.el);
    if (this.g.sideEl) { // 게임이 채팅을 다른 곳으로 옮겼으면 그냥 뒤에 붙임
      if (this.chat.root.parentNode === this.side) this.side.insertBefore(this.g.sideEl, this.chat.root);
      else this.side.appendChild(this.g.sideEl);
    }
    this.g.render();
    if (this.introKind) this.playIntro();
  }

  /** 시작 연출이 끝나기까지 남은 시간 (게임이 카드 뽑기 같은 시작 과정을 그 뒤로 미룰 때 씀) */
  introLeft() { return Math.max(0, this.introUntil - Date.now()); }

  /** 시작 연출: 1:1 · 2:2는 양쪽이 격돌, 그 밖에는 모두 모였다가 펑. 보기만 하는 화면이라 누르면 아래 판으로 그대로 전달됨 */
  playIntro() {
    const member = (i, style = "") => {
      const s = this.seats[i];
      const pic = this.g.vsPortrait?.(i) ?? avatarHtml(s.avatar, 92);
      return `<div class="vs-member" style="${style}"><span class="vs-pic">${pic}</span><div class="vs-name"><span class="${titleFx(s.title)}">${esc(s.name)}</span></div>${titleBadge(s.title)}</div>`;
    };
    const pieces = INTRO_BITS[this.game] || [];
    const bits = `<span class="intro-bits">${Array.from({ length: 16 }, (_, k) => `<i style="--a:${k * 22.5 + Math.random() * 14}deg;--d:${30 + Math.random() * 28}vmin">${pieces[k % pieces.length] || ""}</i>`).join("")}</span>`;
    let html, impact;
    if (this.introKind === "vs") {
      const team = this.seats.length === 4; // 자리 순서가 A, B, A, B
      const side = (cls, list) => `<div class="vs-side ${cls}">${list.map((i) => member(i)).join("")}</div>`;
      html = `<div class="vs-intro vs-${freshPick(VS_MOTIONS)} ${freshPick(VS_BACKS)}${team ? " vs-team" : ""}" aria-hidden="true"><div class="vs-stage">${side("a", team ? [0, 2] : [0])}<div class="vs-big">VS</div>${side("b", team ? [1, 3] : [1])}</div>${bits}<span class="vs-burst"></span></div>`;
      impact = 420;
    } else {
      const ring = this.seats.map((_, i) => {
        const angle = (i / this.seats.length) * 2 * Math.PI - Math.PI / 2;
        return member(i, `--cx:${Math.cos(angle).toFixed(3)};--cy:${Math.sin(angle).toFixed(3)};--ang:${(angle * 180 / Math.PI).toFixed(1)}deg;--i:${i}`);
      }).join("");
      html = `<div class="vs-intro gather-intro gather-${freshPick(GATHER_MOTIONS)} ${freshPick(GATHER_BACKS)}" aria-hidden="true"><div class="gather-ring">${ring}</div><div class="gather-go">시작!</div>${bits}<span class="vs-burst"></span></div>`;
      impact = 1250;
    }
    const intro = el(html);
    this.root.appendChild(intro);
    this.later(() => this.sfx("clash"), impact);
    this.later(() => { intro.remove(); this.g.render(); }, INTRO_MS);
  }

  // ------------------------------------------------------------ 화면 틀
  buildScreen() {
    this.root = el(`<section class="screen game-screen">
      <div class="topbar"><button class="icon-btn" aria-label="나가기">←</button><h1>${esc(GAME_NAMES[this.game])}<span class="muted" style="font-size:16px"> · ${esc(this.modeLabel())}</span></h1>
      <span class="net-dot" hidden></span><span class="top-actions"></span><button class="icon-btn" data-k="rules" aria-label="규칙 보기">?</button></div>
      <div class="game-layout"><div class="board-wrap"></div><div class="side"></div></div></section>`);
    this.boardWrap = this.root.querySelector(".board-wrap");
    this.side = this.root.querySelector(".side");
    this.root.querySelector(".topbar .icon-btn").onclick = () => this.exit();
    this.root.querySelector(".topbar").appendChild(soundButton());
    this.root.querySelector('[data-k="rules"]').onclick = () => showRules(this.game);
    this.onEscape = (e) => {
      if (e.key !== "Escape" || e.repeat || e.isComposing || this.result || !this.root.isConnected || document.querySelector(".modal-back")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.exit();
    };
    document.addEventListener("keydown", this.onEscape);
    this.chat = new ChatPanel((m) => this.sendChat(m));
    this.side.appendChild(this.chat.root);
    if (this.online) {
      this.root.querySelector(".net-dot").hidden = false;
      const manage = el(`<button class="icon-btn manage-btn" aria-label="방 관리" title="방 관리">👑</button>`);
      manage.hidden = !this.isHost;
      manage.onclick = () => this.onManage?.();
      this.root.querySelector('[data-k="rules"]').before(manage);
      if (this.onBracket) {
        const bracket = el(`<button class="icon-btn" aria-label="대진표" title="대진표">🏆</button>`);
        bracket.onclick = () => this.onBracket();
        manage.before(bracket);
      }
    }
  }

  /** 방장이 바뀌면 방 관리 버튼도 함께 (게임 중에도 방장을 넘길 수 있음) */
  setHost(isHost) {
    this.isHost = isHost;
    const manage = this.root.querySelector(".manage-btn");
    if (manage) manage.hidden = !isHost;
  }

  /** 오른쪽 위 상단바 버튼들 (무르기 · 항복 · 판 돌리기). list = [{label, short?, onClick, disabled, title}] (short: 폰에서 쓰는 짧은 글자) */
  setTopActions(list) {
    const box = this.root.querySelector(".top-actions");
    box.replaceChildren(...list.map((a) => {
      const b = el(`<button class="btn ghost small"></button>`);
      b.append(el(`<span class="long${a.short ? " has-short" : ""}"></span>`));
      b.firstChild.textContent = a.label;
      if (a.short) {
        b.append(el(`<span class="short"></span>`));
        b.lastChild.textContent = a.short;
      }
      if (a.title) b.title = a.title;
      b.disabled = !!a.disabled;
      b.onclick = a.onClick;
      return b;
    }));
  }

  /** 연결이 끊긴 자리 표시 + "N초 뒤 기권" 카운트다운 (서버가 GRACE초 뒤 나간 것으로 처리) */
  setOffline(offline, goneAt, grace) {
    this.offline = offline;
    this.goneAt = goneAt;
    this.grace = grace;
    clearInterval(this.offlineTick);
    if (offline.size && !this.result) this.offlineTick = setInterval(() => this.g.render(), 1000);
    this.g.render();
  }

  /** 끊긴 자리가 기권 처리되기까지 남은 초 (모르면 null) */
  secondsLeft(seat) {
    const at = this.goneAt?.get(seat);
    if (!at) return null;
    return Math.max(0, Math.ceil(this.grace - (net.serverNow() - at) / 1000));
  }

  modeLabel() {
    if (this.online) return this.mySeats.length ? "온라인" : "관전 중";
    if (this.mode === "ai") return `컴퓨터 대전 (${{ easy: "쉬움", normal: "보통", hard: "어려움" }[this.level] || "보통"})`;
    return "한 기기에서 같이";
  }

  setNet(status) {
    const dot = this.root.querySelector(".net-dot");
    dot.className = `net-dot ${status}`;
    dot.title = status === "open" ? "연결됨" : "다시 연결하는 중...";
  }

  // ------------------------------------------------------------ 행동 흐름
  now() { return this.online ? net.serverNow() : Date.now(); }

  /** 이 기기가 seat 자리를 조작할 수 있는지 */
  controls(seat) { return this.mySeats.includes(seat) && !this.seats[seat]?.ai; }

  /** 행동 보내기. 온라인이면 서버를 거쳐 돌아온 뒤에 적용됨 */
  submit(a, seat) {
    if (this.result && !["fx"].includes(a.type)) return;
    if (this.online) net.send({ t: "act", a });
    else this.later(() => this.apply({ a, at: Date.now(), seat }), 0);
  }

  /** 연결이 끊긴 자리를 방장 기기가 대신 둠 (온라인 전용, 서버가 방장인지 · 끊겼는지 확인함) */
  submitAs(a, seat) {
    if (this.online && !this.result) net.send({ t: "act", a, as: this.seats[seat].cid });
  }

  /** 서버에서 온 기록 하나 (온라인) */
  receive(entry) {
    if (entry.seq <= this.lastSeq) return;
    this.lastSeq = entry.seq;
    if (entry.a.type === "start") return;
    const seat = this.seats.findIndex((s) => s.cid === entry.from);
    if (seat < 0) return;
    this.apply({ a: entry.a, at: entry.at, seat });
  }

  apply({ a, at, seat }) {
    if (this.result) return;
    if (a.type === "resign" || a.type === "leave") {
      if (!this.replaying) toast(`${this.seats[seat].name} 님이 ${a.type === "leave" ? "나갔어요" : "항복했어요"}`);
      this.g.resign(seat, a.type);
    } else {
      this.g.apply(a, at, seat);
    }
    this.g.render();
  }

  later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  sfx(name) { if (!this.replaying) play(name); }

  /** 자리 카드 위에 스티커/말풍선 */
  popSeat(seat, what) {
    if (this.replaying) return;
    popAt(this.root.querySelector(`[data-seat="${seat}"] .avatar`), what);
  }

  // ------------------------------------------------------------ 채팅
  sendChat(m) {
    if (this.online) {
      net.send({ t: "chat", ...m });
      return;
    }
    const seat = this.mySeats.find((i) => !this.seats[i].ai) ?? 0;
    const me = this.mode === "local" ? { name: "우리" } : this.seats[seat];
    this.showChat(me.name, { ...m, title: me.title }, this.mode === "local" ? null : seat);
    if (this.mode === "ai" && Math.random() < 0.7) {
      const bot = this.seats.findIndex((s) => s.ai);
      this.later(() => this.showChat(this.seats[bot].name, Math.random() < 0.4 ? { sticker: randomOf(["laugh", "cool", "wow", "fire"]) } : { text: randomOf(CHAT_AI_TEXTS) }, bot), 900 + Math.random() * 900);
    }
  }

  showChat(name, m, seat) {
    this.chat.add(name, m);
    if (seat !== null && seat >= 0) this.popSeat(seat, m.sticker ? { sticker: m.sticker, long: true } : { text: m.text, long: true });
    if (m.sticker) this.sfx("pop");
  }

  /** 온라인 채팅 메시지 */
  onChat(msg) {
    const seat = this.seats.findIndex((s) => s.cid === msg.from);
    this.showChat(seat < 0 ? `${msg.name} (관전)` : msg.name, msg, seat); // 자리에 없는 사람은 관전자
  }

  // ------------------------------------------------------------ 끝
  /**
   * 모듈이 판이 끝났을 때 부름.
   * info: { title, sub, winners: [seat], losers: [seat], scores?: {seat: 점수} }
   */
  finish(info) {
    if (this.result) return;
    this.result = info;
    this.g.render();
    const names = this.seats.filter((s) => !s.ai).map((s) => s.name);
    const winners = info.winners.map((i) => this.seats[i].name);
    if (!this.replaying) addLocalRecord(this.game, names, winners);
    if (this.online && this.mySeats.length) { // 앉은 사람마다 각자 계산한 결과를 보냄 (서버가 서로 맞춰 보고 기록)
      net.send({ t: "result", players: this.seats.map((s) => s.name), winners, losers: info.losers.map((i) => this.seats[i].name) });
    }
    const delay = this.replaying ? 0 : 900;
    this.later(() => this.showResultCard(), delay);
  }

  /** 방 정보(자리 · 연승 등)가 바뀔 때마다 앱이 불러 줌 */
  setRoomInfo(room) {
    this.roomInfo = room;
    this.updateSpecBar();
    this.resultView?.setFlow?.(this.flowInfo());
    this.updateResultStreaks();
  }

  /** 결과 화면 이름 옆 연승 (서버가 판을 집계한 뒤에 바뀜) */
  updateResultStreaks() {
    this.resultView?.setStreaks?.((key) => this.streaks?.get(this.seats[+key]?.cid) || 0);
  }

  /** 관전하는 사람에게 게임 화면 위에 보여 주는 줄 */
  updateSpecBar() {
    if (!this.online || this.mySeats.length || !this.root) { this.specBar?.remove(); this.specBar = null; return; }
    if (!this.specBar) {
      this.specBar = el(`<div class="spec-bar"><span>관전 중이에요</span></div>`);
      this.root.querySelector(".topbar").after(this.specBar);
    }
  }

  /** 끝난 뒤 내 역할과 대기실에서 할 일 (온라인만). 진 사람은 판이 끝날 때 이미 관전으로 가 있을 수 있음 */
  flowInfo() {
    if (!this.online || !this.result) return null;
    const info = this.result, room = this.roomInfo || {}, me = net.myId();
    const meNow = (room.members || []).find((x) => x.cid === me);
    const seated = meNow?.role === "player";
    const flow = (kind, tag, note) => ({ kind, tag, note });
    const tour = room.tournament;
    if (tour) { // 토너먼트: 다음 라운드 진출 · 탈락 · 우승
      const seatNow = this.mySeats.filter((i) => !this.seats[i].ai)[0];
      if (seatNow === undefined) return flow("spectator", "관전자", "대기실에서 대진표를 보고 다른 경기도 구경할 수 있어요");
      if (tour.champion === me) return flow("win", "🏆 우승", "토너먼트에서 우승했어요!");
      if (info.winners.includes(seatNow)) return flow("win", "진출", "다음 라운드로 올라가요. 대기실에서 다음 경기를 준비해요");
      if (info.winners.length) return flow("lose", "탈락", "이번 대회는 여기까지예요. 대기실에서 진행 중인 다른 경기를 구경해요");
      return flow("draw", "무승부", "같은 상대와 다시 겨뤄요. 선공은 바꿔요");
    }
    const next = seated ? "대기실에서 다음 판을 기다려요" : "관전으로 옮겼어요. 대기실에서 빈자리 참가하기를 누르면 다시 들어와요";
    const mine = this.mySeats.filter((i) => !this.seats[i].ai);
    if (mine.length) {
      const seat = mine[0];
      if (info.winners.includes(seat)) {
        const streak = meNow?.streak || 0;
        return flow("win", streak >= 1 ? `승자 · ${streakText(streak)}` : "승자", next);
      }
      return flow(info.winners.length ? "lose" : "draw", info.winners.length ? "패자" : "무승부", next);
    }
    if (seated) return flow("queue", "다음 판 출전", next);
    return flow("spectator", "관전자", "대기실에서 빈자리 참가하기를 누르면 들어갈 수 있어요");
  }

  showResultCard() {
    const info = this.result;
    const mine = this.mySeats.filter((i) => !this.seats[i].ai);
    let myKind = null;
    if (this.mode !== "local" && mine.length) {
      const me = mine[0];
      myKind = info.winners.includes(me) ? "win" : info.winners.length ? "lose" : "draw";
    }
    const loser = info.losers.length ? info.losers[info.losers.length - 1] : null;
    // 공격하는 사람: 이긴 사람. 팀전은 이 기기의 이긴 사람 (한 기기에서는 첫 번째)
    const winner = (info.winners.length === 1 || this.mode === "local" ? info.winners[0] : info.winners.find((i) => this.controls(i))) ?? null;
    const question = loser !== null && !this.seats[loser].ai
      ? questionFor(...this.seats.map((s) => s.name), info.moves ?? 0) : null;
    const canTeabag = winner !== null && loser !== null && (this.mode === "local" || this.controls(winner));
    const players = (info.order || this.seats.map((_, i) => i)).map((i) => ({
      key: String(i), name: this.seats[i].name, avatar: this.seats[i].avatar, title: this.seats[i].title,
      winner: info.winners.includes(i), score: info.scores?.[i],
    }));
    this.resultView = showResult({
      title: info.title, sub: info.sub, players, myKind,
      question, questionFor: loser !== null ? this.seats[loser].name : "",
      onTaunt: (text) => this.taunt(mine[0], text, myKind),
      onTeabag: canTeabag ? (style) => this.fx({ kind: "teabag", from: winner, to: loser, style }) : null,
      onAgain: this.online ? null : () => this.again(),
      onWaitingRoom: this.onWaitingRoom ? () => this.onWaitingRoom() : null,
      againLabel: "한 판 더",
      noRematch: !!this.onBracket, // 토너먼트 방
      onExit: () => this.exit(true),
    });
    this.resultView.setFlow(this.flowInfo());
    this.updateResultStreaks();
  }

  taunt(seat, text, kind) {
    if (this.online) {
      this.fx({ kind: "taunt", seat, text });
      return;
    }
    this.resultView?.bubble(String(seat), text);
    this.chat.add(this.seats[seat].name, { text, title: this.seats[seat].title });
    if (this.mode === "ai") {
      const bot = this.seats.findIndex((s) => s.ai);
      const back = replyLine(kind === "win" ? "lose" : kind === "lose" ? "win" : "draw");
      this.later(() => { this.resultView?.bubble(String(bot), back); this.chat.add(this.seats[bot].name, { text: back }); }, 1100);
    }
  }

  /** 기록하지 않는 효과 (도발 멘트, 티배깅) */
  fx(f) {
    if (this.online) net.send({ t: "fx", fx: f });
    else this.onFx({ fx: f });
  }

  onFx(msg) {
    const f = msg.fx;
    const seatOk = (i) => Number.isInteger(i) && i >= 0 && i < this.seats.length;
    if (f.kind === "teabag" && seatOk(f.from) && seatOk(f.to)) {
      if (this.online && this.seats[f.from].cid !== msg.from) return; // 이긴 사람 본인만
      const losers = this.seats.map((_, i) => i).filter((i) => i !== f.from && !this.result?.winners.includes(i)); // 다인전은 이긴 사람을 뺀 모두
      this.resultView?.teabag(String(f.from), (losers.length ? losers : [f.to]).map(String), f.style);
    } else if (f.kind === "taunt" && seatOk(f.seat) && typeof f.text === "string") {
      if (this.online && this.seats[f.seat].cid !== msg.from) return;
      const text = f.text.slice(0, 40);
      this.resultView?.bubble(String(f.seat), text);
      this.chat.add(this.seats[f.seat].name, { text, title: this.seats[f.seat].title });
    } else {
      this.g.onFx?.(msg); // 게임마다의 효과 (야추 컵 흔들기 등)
    }
  }

  again() {
    this.onAgain?.();
  }

  async exit(force = false) {
    if (!force && this.g.cancelInput?.()) return;
    if (!force && !this.result && (this.online ? this.mySeats.length > 0 : true)) {
      const choice = await this.askSurrender();
      if (choice === "stay") return;
      if (choice === "resign") {
        this.submit({ type: "resign" }, this.g.surrenderSeat());
        return;
      }
    }
    this.onExit?.();
  }

  /** Esc · 뒤로 가기: 계속하기(stay) / 항복하고 결과 보기(resign) 중에 고르는 창. 이미 항복한 자리면 나가기(leave) */
  askSurrender() {
    return new Promise((resolve) => {
      const word = this.game === "yut" ? "기권" : "항복";
      const seat = this.g.surrenderSeat?.();
      const who = seat === undefined ? "" : `${this.seats[seat].name} 님, `;
      const body = el(`<div><p>${seat === undefined ? "이 판에서 나갈까요?" : `${esc(who)}${word}할까요?`}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-v="stay">계속하기</button>${seat === undefined ? `<button class="btn primary" data-v="leave">나가기</button>` : `<button class="btn primary" data-v="resign">${word}</button>`}</div></div>`);
      const pick = (value) => { close(); resolve(value); };
      const close = modal(word, body, { closable: false, onEscape: () => pick("stay") }); // Esc = 계속하기, Enter = 항복
      body.querySelectorAll("button").forEach((b) => { b.onclick = () => pick(b.dataset.v); });
    });
  }

  destroy() {
    document.removeEventListener("keydown", this.onEscape);
    clearInterval(this.offlineTick);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.resultView?.close();
    this.g.destroy?.();
    this.root.remove();
  }
}

export function showRules(game) {
  countQuirk("rules", game);
  const body = el(`<div class="rules">${RULES_TEXT[game].map((p) => `<p>• ${esc(p)}</p>`).join("")}</div>`);
  modal(`${GAME_NAMES[game]} 규칙`, body);
}

/** 자리 카드 HTML: 차례 표시 · 연결 끊김 표시 포함 */
export function seatCard(match, i, { extra = "", sub = null, turn = false, below = "" } = {}) {
  const s = match.seats[i];
  const off = match.offline.has(i);
  const left = off ? match.secondsLeft(i) : null;
  const intro = off ? (left !== null ? `연결 끊김 · ${left}초 안에 안 오면 기권` : "연결이 끊겼어요...") : sub ?? s.intro ?? "";
  const tag = match.controls(i) && match.mode !== "local" ? " (나)" : "";
  const streak = match.streaks?.get(s.cid) || 0;
  const champion = match.roomInfo?.members?.find((x) => x.cid === s.cid)?.champion ? ` <span class="champion-mark">👑 챔피언</span>` : "";
  const badge = `${champion}${streak >= 1 ? ` ${streakHtml(streak)}` : ""}`;
  return `<div class="person ${turn ? "turn" : ""} ${off ? "off" : ""}" data-seat="${i}">${avatarHtml(s.avatar, 40)}<div class="who"><div class="nm"><span class="${titleFx(s.title)}">${esc(s.name + tag)}</span>${titleBadge(s.title)}${badge}</div>${intro ? `<div class="intro">${esc(intro)}</div>` : ""}${below}</div>${extra}</div>`;
}
