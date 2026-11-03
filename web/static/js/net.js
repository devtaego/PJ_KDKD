// 서버와의 웹소켓 연결. 끊기면 자동으로 다시 붙고, 서버 시계와의 차이도 계산함
// cid: 이 브라우저만 아는 비밀 열쇠 (남에게 보여 주지 않음) / pid: 서버가 정해 준 공개 번호 (방에서 서로를 부르는 이름표)
const listeners = new Map();
let ws = null;
let cid = null;
let pid = null;
let profile = null;
let wantOpen = false;
let sleeping = false; // 오래 쉬어서 서버가 연결을 끊은 상태 (다시 손대면 붙음)
let retry = 0;
let offset = 0; // 서버 시각 - 내 시각 (ms)
let bestRtt = Infinity;
let pingTimer = null;

const newCid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
try {
  cid = localStorage.getItem("kidk.cid");
  if (!cid || cid.length < 16) {
    cid = newCid();
    localStorage.setItem("kidk.cid", cid);
  }
} catch {
  cid = newCid();
}

export const myId = () => pid;
export const serverNow = () => Date.now() + offset;
export const isOpen = () => ws !== null && ws.readyState === WebSocket.OPEN;

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
function emit(type, msg) {
  for (const fn of listeners.get(type) || []) {
    try { fn(msg); } catch (e) { console.error(e); }
  }
}

export function send(msg) {
  if (isOpen()) ws.send(JSON.stringify(msg));
}

export function connect(p) {
  profile = p;
  wantOpen = true;
  sleeping = false;
  if (ws && ws.readyState <= WebSocket.OPEN) {
    send({ t: "profile", profile });
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`); // 비밀 열쇠는 주소가 아니라 첫 메시지로 (접속 기록에 남지 않게)
  emit("status", "connecting");
  ws.onopen = () => {
    retry = 0;
    send({ t: "hello", cid });
    send({ t: "profile", profile });
    bestRtt = Infinity;
    sync();
    clearInterval(pingTimer);
    pingTimer = setInterval(sync, 15000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === "pong") {
      const now = Date.now();
      const rtt = now - msg.c;
      if (rtt <= bestRtt + 30) {
        bestRtt = Math.min(bestRtt, rtt);
        offset = msg.s - (msg.c + rtt / 2);
      }
      return;
    }
    if (msg.t === "welcome") {
      pid = msg.pid;
      if (msg.cid && msg.cid !== cid) { // 서버가 새 열쇠를 정해 준 경우 (예전 형식)
        cid = msg.cid;
        try { localStorage.setItem("kidk.cid", cid); } catch { /* 저장 불가 */ }
      }
      emit("status", "open");
    }
    emit(msg.t, msg);
  };
  ws.onclose = (ev) => {
    clearInterval(pingTimer);
    emit("status", "closed");
    if (ev.code === 4000) { // 오래 쉬어서 서버가 끊음 → 다시 손댈 때까지 기다림 (무료 서버가 잠들 수 있게)
      sleeping = true;
      emit("sleep", {});
      return;
    }
    if (ev.code === 4001) { // 같은 브라우저의 다른 탭이 연결을 가져감 → 바로 되찾으면 탭끼리 계속 밀어내므로, 이 탭을 다시 쓸 때까지 기다림
      sleeping = true;
      emit("replaced", {});
      return;
    }
    if (wantOpen) {
      retry++;
      setTimeout(() => wantOpen && !sleeping && connect(profile), Math.min(1000 * retry, 5000));
    }
  };
}

/** 연결이 살아 있는지 모를 때 새로 연결 (죽은 연결은 닫히기까지 오래 걸려서 기다리지 않음) */
export function reconnect() {
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
  clearInterval(pingTimer);
  emit("status", "closed");
  connect(profile);
}

function wake() {
  if (sleeping && wantOpen && document.visibilityState === "visible") connect(profile);
}
document.addEventListener("visibilitychange", wake);
window.addEventListener("pointerdown", wake);
window.addEventListener("keydown", wake);

function sync() {
  for (let i = 0; i < 3; i++) setTimeout(() => send({ t: "ping", c: Date.now() }), i * 300);
}

export function updateProfile(p) {
  profile = p;
  send({ t: "profile", profile });
}
