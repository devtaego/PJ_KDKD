// 한 판을 진행하는 틀: 컴퓨터 대전 · 한 기기 여럿 · 온라인을 같은 방식으로 다룸
// 모든 행동(수 두기, 주사위 굴리기, 항복...)은 submit -> apply 순서로 흘러감.
// 온라인에서는 서버가 순서와 시각을 붙여 모두에게 똑같이 돌려주므로, 모든 기기가 같은 판을 계산함.
import * as net from "./net.js";
import { el, ChatPanel, popAt, showResult, addLocalRecord, confirmBox, toast, modal, soundButton } from "./ui.js";
import { avatarHtml, esc } from "./art.js";
import { play } from "./sound.js";
import { questionFor, replyLine, CHAT_AI_TEXTS, randomOf } from "./party.js";
import { RULES_TEXT, GAME_NAMES } from "./rules.js";

export class Match {
  /**
   * game: chess / omok / yacht, mode: ai / local / online
   * seats: [{name, avatar, intro, ai, cid}], mySeats: 이 기기가 조작하는 자리 번호들
   * settings: 게임별 설정, level: 컴퓨터 난이도
   */
  constructor({ game, mode, seats, mySeats, settings, level, module, onExit, onAgain, isHost = true }) {
    Object.assign(this, { game, mode, seats, mySeats, settings, level, module, onExit, onAgain, isHost });
    this.online = mode === "online";
    this.replaying = false;
    this.lastSeq = 0;
    this.result = null;
    this.resultView = null;
    this.timers = new Set();
    this.offline = new Set(); // 연결이 끊긴 자리
    this.buildScreen();
    this.g = module.create(this);
    this.boardWrap.appendChild(this.g.el);
    if (this.g.sideEl) { // 게임이 채팅을 다른 곳으로 옮겼으면 그냥 뒤에 붙임
      if (this.chat.root.parentNode === this.side) this.side.insertBefore(this.g.sideEl, this.chat.root);
      else this.side.appendChild(this.g.sideEl);
    }
    this.g.render();
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
    this.chat = new ChatPanel((m) => this.sendChat(m));
    this.side.appendChild(this.chat.root);
    if (this.online) this.root.querySelector(".net-dot").hidden = false;
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
    this.showChat(me.name, m, this.mode === "local" ? null : seat);
    if (this.mode === "ai" && Math.random() < 0.7) {
      const bot = this.seats.findIndex((s) => s.ai);
      this.later(() => this.showChat(this.seats[bot].name, Math.random() < 0.4 ? { sticker: randomOf(["laugh", "cool", "wow", "fire"]) } : { text: randomOf(CHAT_AI_TEXTS) }, bot), 900 + Math.random() * 900);
    }
  }

  showChat(name, m, seat) {
    this.chat.add(name, m);
    if (seat !== null && seat >= 0) this.popSeat(seat, m.sticker ? { sticker: m.sticker } : { text: m.text });
    if (m.sticker) this.sfx("pop");
  }

  /** 온라인 채팅 메시지 */
  onChat(msg) {
    const seat = this.seats.findIndex((s) => s.cid === msg.from);
    this.showChat(msg.name, msg, seat);
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
    if (this.online && this.isHost && !this.replaying) {
      net.send({ t: "result", players: this.seats.map((s) => s.name), winners, losers: info.losers.map((i) => this.seats[i].name) });
    }
    const delay = this.replaying ? 0 : 900;
    this.later(() => this.showResultCard(), delay);
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
    const winner = info.winners.length === 1 ? info.winners[0] : null;
    const question = loser !== null && !this.seats[loser].ai
      ? questionFor(...this.seats.map((s) => s.name), info.moves ?? 0) : null;
    const canTeabag = winner !== null && loser !== null && (this.mode === "local" || this.controls(winner));
    const players = (info.order || this.seats.map((_, i) => i)).map((i) => ({
      key: String(i), name: this.seats[i].name, avatar: this.seats[i].avatar,
      winner: info.winners.includes(i), score: info.scores?.[i],
    }));
    this.resultView = showResult({
      title: info.title, sub: info.sub, players, myKind,
      question, questionFor: loser !== null ? this.seats[loser].name : "",
      onTaunt: (text) => this.taunt(mine[0], text, myKind),
      onTeabag: canTeabag ? () => this.fx({ kind: "teabag", from: winner, to: loser }) : null,
      onAgain: () => this.again(),
      againLabel: this.online && !this.isHost ? "방장이 다시 시작해요" : "한 판 더",
      canAgain: !this.online || this.isHost,
      onExit: () => this.exit(true),
    });
  }

  taunt(seat, text, kind) {
    if (this.online) {
      this.fx({ kind: "taunt", seat, text });
      return;
    }
    this.resultView?.bubble(String(seat), text);
    this.chat.add(this.seats[seat].name, { text });
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
      this.resultView?.teabag(String(f.from), String(f.to));
    } else if (f.kind === "taunt" && seatOk(f.seat) && typeof f.text === "string") {
      if (this.online && this.seats[f.seat].cid !== msg.from) return;
      const text = f.text.slice(0, 40);
      this.resultView?.bubble(String(f.seat), text);
      this.chat.add(this.seats[f.seat].name, { text });
    } else {
      this.g.onFx?.(msg); // 게임마다의 효과 (야추 컵 흔들기 등)
    }
  }

  again() {
    if (this.online && !this.isHost) return;
    this.onAgain?.();
  }

  async exit(force = false) {
    if (!force && !this.result && (this.online ? this.mySeats.length > 0 : true)) {
      const ok = await confirmBox("나가기", this.online ? "지금 나가면 이 판은 항복으로 처리돼요. 나갈까요?" : "진행 중인 판을 그만둘까요?", "나가기", "계속하기");
      if (!ok) return;
    }
    this.onExit?.();
  }

  destroy() {
    clearInterval(this.offlineTick);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.resultView?.close();
    this.g.destroy?.();
    this.root.remove();
  }
}

export function showRules(game) {
  const body = el(`<div class="rules">${RULES_TEXT[game].map((p) => `<p>• ${esc(p)}</p>`).join("")}</div>`);
  modal(`${GAME_NAMES[game]} 규칙`, body);
}

/** 자리 카드 HTML: 차례 표시 · 연결 끊김 표시 포함 */
export function seatCard(match, i, { extra = "", sub = null, turn = false } = {}) {
  const s = match.seats[i];
  const off = match.offline.has(i);
  const left = off ? match.secondsLeft(i) : null;
  const intro = off ? (left !== null ? `연결 끊김 · ${left}초 안에 안 오면 기권` : "연결이 끊겼어요...") : sub ?? s.intro ?? "";
  const tag = match.controls(i) && match.mode !== "local" ? " (나)" : "";
  const streak = match.streaks?.get(s.cid) || 0;
  const badge = streak >= 2 ? ` <span class="streak">${streak}연승</span>` : "";
  return `<div class="person ${turn ? "turn" : ""} ${off ? "off" : ""}" data-seat="${i}">${avatarHtml(s.avatar, 40)}<div class="who"><div class="nm">${esc(s.name + tag)}${badge}</div>${intro ? `<div class="intro">${esc(intro)}</div>` : ""}</div>${extra}</div>`;
}
