// 화면 공통 부품: 요소 만들기, 알림, 창, 선택 버튼, 저장, 채팅, 결과 화면과 티배깅
import { avatarHtml, stickerSvg, STICKERS, CROWN_SVG, esc } from "./art.js";
import { play } from "./sound.js";
import { pickLines, TAUNTS, randomOf } from "./party.js";

/** html 문자열로 요소 하나 만들기 */
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer = null;
export function toast(text, ms = 2200) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/** 가운데 창. body는 요소. 닫는 함수를 돌려줌 */
export function modal(title, body, { closable = true } = {}) {
  const back = el(`<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2></div></div>`);
  back.firstElementChild.appendChild(body);
  const close = () => back.remove();
  if (closable) {
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    const x = el(`<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn">닫기</button></div>`);
    x.querySelector("button").onclick = close;
    back.firstElementChild.appendChild(x);
  }
  document.body.appendChild(back);
  return close;
}

export function confirmBox(title, text, yes = "좋아요", no = "아니요") {
  return new Promise((resolve) => {
    const body = el(`<div><p>${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn ghost">${esc(no)}</button><button class="btn primary">${esc(yes)}</button></div></div>`);
    const close = modal(title, body, { closable: false });
    const [n, y] = body.querySelectorAll("button");
    n.onclick = () => { close(); resolve(false); };
    y.onclick = () => { close(); resolve(true); };
  });
}

/** 알약 모양 선택 버튼 묶음. options = [[값, 이름]] */
export function segment(options, value, onChange) {
  const wrap = el(`<div class="segment" role="group"></div>`);
  for (const [v, label] of options) {
    const b = el(`<button type="button" aria-pressed="${v === value}">${esc(label)}</button>`);
    b.onclick = () => {
      wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      play("click");
      onChange(v);
    };
    wrap.appendChild(b);
  }
  return wrap;
}

export function option(label, control) {
  const o = el(`<div class="opt"><div class="label">${esc(label)}</div></div>`);
  o.appendChild(control);
  return o;
}

// ---------------------------------------------------------------- 저장 (이 기기)
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("kidk." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("kidk." + key, JSON.stringify(value)); } catch { /* 사진이 너무 크거나 저장 불가 */ }
  },
};

/** 이 기기 누적 기록 (데스크톱판의 '이 PC 랭킹') */
export function addLocalRecord(game, names, winners) {
  const rank = store.get("ranking", {});
  for (const n of names) {
    const rec = ((rank[n] ||= {})[game] ||= { wins: 0, games: 0 });
    rec.games++;
    if (winners.includes(n)) rec.wins++;
  }
  store.set("ranking", rank);
}

// ---------------------------------------------------------------- 사람 카드
export function personHtml(p, { extra = "", sub = null, cls = "" } = {}) {
  const intro = sub ?? p.intro ?? "";
  return `<div class="person ${cls}" data-key="${esc(p.key ?? "")}">${avatarHtml(p.avatar, 40)}<div class="who"><div class="nm">${esc(p.name)}</div>${intro ? `<div class="intro">${esc(intro)}</div>` : ""}</div>${extra}</div>`;
}

/** 사람 카드 위에 스티커/말풍선을 잠깐 띄움 */
export function popAt(target, { sticker = null, text = null } = {}) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  const pop = el(`<div class="pop">${sticker ? stickerSvg(sticker, 54) : ""}${text ? `<div class="txt">${esc(text)}</div>` : ""}</div>`);
  pop.style.left = `${r.left + r.width / 2 + window.scrollX}px`;
  pop.style.top = `${r.top + window.scrollY - (sticker ? 56 : 30)}px`;
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 1850);
}

// ---------------------------------------------------------------- 채팅
export class ChatPanel {
  /** onSend({text}|{sticker}) */
  constructor(onSend) {
    this.onSend = onSend;
    this.root = el(`<div class="card chat"><h3>채팅</h3><div class="chat-log" aria-live="polite"></div>
      <div class="sticker-bar"></div>
      <form class="chat-form"><input type="text" maxlength="100" placeholder="말 걸어 보기..." enterkeyhint="send" aria-label="채팅 입력"><button class="btn primary small">보내기</button></form></div>`);
    this.log = this.root.querySelector(".chat-log");
    const bar = this.root.querySelector(".sticker-bar");
    for (const [sid, name] of STICKERS) {
      const b = el(`<button type="button" title="${esc(name)}" aria-label="${esc(name)} 스티커">${stickerSvg(sid, 30)}</button>`);
      b.onclick = () => this.onSend({ sticker: sid });
      bar.appendChild(b);
    }
    const form = this.root.querySelector("form");
    const input = form.querySelector("input");
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.onSend({ text });
    };
  }

  add(name, { text = "", sticker = "" }) {
    const line = el(`<div class="msg"><b>${esc(name)}</b></div>`);
    if (sticker) line.insertAdjacentHTML("beforeend", stickerSvg(sticker, 28));
    if (text) line.append(text);
    this.push(line);
  }

  system(text) { this.push(el(`<div class="msg sys">${esc(text)}</div>`)); }

  push(line) {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 30;
    this.log.appendChild(line);
    while (this.log.children.length > 120) this.log.firstElementChild.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}

// ---------------------------------------------------------------- 결과 화면
const CONFETTI = ["#FFC94D", "#FF5C8A", "#3DDC97", "#7C5CFF", "#4DABF7", "#FF8A4C"];
const VEIN_SVG = `<svg class="vein" viewBox="-10 -10 20 20"><g stroke="#FF2E2E" stroke-width="3" stroke-linecap="round" fill="none"><path d="M-7 -2 Q-2 -2 -2 -7"/><path d="M7 -2 Q2 -2 2 -7"/><path d="M-7 2 Q-2 2 -2 7"/><path d="M7 2 Q2 2 2 7"/></g></svg>`;

/**
 * 게임 결과 카드.
 * opts: { title, sub, players: [{name, avatar, score?, winner, key}], me: 내 key 또는 null(관전),
 *         myKind: win/lose/draw/null, question: 질문 문자열 또는 null, questionFor: 이름,
 *         onTaunt(text), onTeabag(), onAgain, againLabel, onExit, canAgain }
 * 돌려주는 객체: { close(), teabag(fromKey, toKey), bubble(key, text) }
 */
export function showResult(opts) {
  const root = el(`<div class="result"><div class="result-card"><h2>${esc(opts.title)}</h2><div class="sub">${esc(opts.sub || "")}</div><div class="podium"></div></div></div>`);
  const card = root.firstElementChild;
  const podium = card.querySelector(".podium");
  for (const p of opts.players) {
    const pl = el(`<div class="pl ${p.winner ? "won" : "lost"}" data-key="${esc(p.key)}">${p.winner ? CROWN_SVG : ""}${avatarHtml(p.avatar, 64, p.winner ? "ring" : "")}<div class="nm">${esc(p.name)}</div>${p.score !== undefined ? `<div class="sc">${esc(p.score)}</div>` : ""}</div>`);
    podium.appendChild(pl);
  }
  if (opts.question) {
    card.appendChild(el(`<div class="question"><span class="muted">${esc(opts.questionFor || "진 사람")}에게 질문!</span><b>${esc(opts.question)}</b></div>`));
  }
  if (opts.myKind) {
    const taunts = el(`<div class="taunts"></div>`);
    for (const line of pickLines(opts.myKind, 4)) {
      const b = el(`<button class="btn small">${esc(line)}</button>`);
      b.onclick = () => opts.onTaunt?.(line);
      taunts.appendChild(b);
    }
    card.appendChild(taunts);
  }
  const actions = el(`<div class="row" style="justify-content:center;margin-top:12px"></div>`);
  if (opts.onTeabag) {
    const tb = el(`<button class="btn pink">티배깅 하기</button>`);
    tb.onclick = () => opts.onTeabag();
    actions.appendChild(tb);
  }
  if (opts.onAgain) {
    const again = el(`<button class="btn primary">${esc(opts.againLabel || "한 판 더")}</button>`);
    again.disabled = opts.canAgain === false;
    again.onclick = () => opts.onAgain();
    actions.appendChild(again);
  }
  const look = el(`<button class="btn ghost">판 보기</button>`);
  look.onclick = () => {
    root.style.display = "none";
    const back = el(`<button class="btn primary" style="position:fixed;right:16px;bottom:calc(16px + var(--safe-b));z-index:41">결과 다시 보기</button>`);
    back.onclick = () => { root.style.display = ""; back.remove(); };
    document.body.appendChild(back);
    api.cleanup.push(() => back.remove());
  };
  actions.appendChild(look);
  if (opts.onExit) {
    const exit = el(`<button class="btn ghost">나가기</button>`);
    exit.onclick = () => opts.onExit();
    actions.appendChild(exit);
  }
  card.appendChild(actions);
  document.body.appendChild(root);

  if (opts.myKind === "win") {
    play("win");
    for (let i = 0; i < 40; i++) {
      const c = el(`<i class="confetti"></i>`);
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = CONFETTI[i % CONFETTI.length];
      c.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      root.appendChild(c);
    }
  } else if (opts.myKind === "lose") play("lose");

  const api = {
    root,
    cleanup: [],
    close() { root.remove(); api.cleanup.forEach((f) => f()); },
    bubble(key, text) { popAt(podium.querySelector(`[data-key="${CSS.escape(key)}"] .avatar`), { text }); },
    teabag(fromKey, toKey) {
      const stop = teabag(podium, fromKey, toKey);
      if (stop) api.cleanup.push(stop);
    },
  };
  return api;
}

const TEABAG_TIME = 3.4, TB_GO = 0.35, TB_BOUNCE = 9;

/** 이긴 사람 프로필이 진 사람 머리 위로 날아가 앉았다 일어났다 (party.teabag_pos 와 같은 움직임) */
function teabag(podium, fromKey, toKey) {
  const from = podium.querySelector(`[data-key="${CSS.escape(fromKey)}"] .avatar`);
  const toPl = podium.querySelector(`[data-key="${CSS.escape(toKey)}"]`);
  if (!from || !toPl || podium.dataset.tb) return;
  podium.dataset.tb = "1";
  const to = toPl.querySelector(".avatar");
  const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
  const size = fr.width;
  const fly = from.cloneNode(true);
  fly.classList.add("tb-fly");
  fly.style.left = `${fr.left}px`;
  fly.style.top = `${fr.top}px`;
  document.body.appendChild(fly);
  from.style.visibility = "hidden";
  toPl.classList.add("angry");
  toPl.insertAdjacentHTML("beforeend", VEIN_SVG);
  const hx = fr.left, hy = fr.top, tx = tr.left + (tr.width - size) / 2, ty = tr.top - size * 0.62;
  const start = performance.now();
  let lastLow = false;
  let done = false;
  const finish = () => { // 탭이 뒤에 있어 그림이 멈춰도 시간이 되면 반드시 정리
    if (done) return;
    done = true;
    fly.remove();
    from.style.visibility = "";
    toPl.classList.remove("angry");
    toPl.querySelector(".vein")?.remove();
    delete podium.dataset.tb;
  };
  setTimeout(finish, TEABAG_TIME * 1000 + 100);
  play("pop");
  const frame = (now) => {
    const t = (now - start) / 1000;
    if (done) return;
    if (t >= TEABAG_TIME) return finish();
    let x, y;
    const back = TEABAG_TIME - TB_GO;
    if (t < TB_GO) {
      const e = 1 - (1 - t / TB_GO) ** 3;
      x = hx + (tx - hx) * e; y = hy + (ty - hy) * e - Math.sin(e * Math.PI) * size * 0.8;
    } else if (t > back) {
      const e = 1 - (1 - (t - back) / TB_GO) ** 3;
      x = tx + (hx - tx) * e; y = ty + (hy - ty) * e - Math.sin(e * Math.PI) * size * 0.8;
    } else {
      const bounce = Math.abs(Math.sin((t - TB_GO) * TB_BOUNCE));
      x = tx; y = ty - bounce * size * 0.4;
      const low = bounce < 0.12;
      if (low && !lastLow) {
        play("thud");
        const boom = el(`<div class="boom">${esc(randomOf(["쿵!", "퍽!", ...TAUNTS]))}</div>`);
        boom.style.left = `${tr.left + tr.width / 2 + (Math.random() - 0.5) * 60}px`;
        boom.style.top = `${tr.top - 10}px`;
        document.body.appendChild(boom);
        setTimeout(() => boom.remove(), 720);
      }
      lastLow = low;
    }
    fly.style.transform = `translate(${x - hx}px, ${y - hy}px)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return finish;
}
