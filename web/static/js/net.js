// 서버와의 웹소켓 연결. 끊기면 자동으로 다시 붙고, 서버 시계와의 차이도 계산함
const listeners = new Map();
let ws = null;
let cid = null;
let profile = null;
let wantOpen = false;
let retry = 0;
let offset = 0; // 서버 시각 - 내 시각 (ms)
let bestRtt = Infinity;
let pingTimer = null;

try {
  cid = localStorage.getItem("kidk.cid");
  if (!cid) {
    cid = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("kidk.cid", cid);
  }
} catch {
  cid = Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export const myCid = () => cid;
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
  if (ws && ws.readyState <= WebSocket.OPEN) {
    send({ t: "profile", profile });
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?cid=${encodeURIComponent(cid)}`);
  emit("status", "connecting");
  ws.onopen = () => {
    retry = 0;
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
    if (msg.t === "welcome") emit("status", "open");
    emit(msg.t, msg);
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    emit("status", "closed");
    if (wantOpen) {
      retry++;
      setTimeout(() => wantOpen && connect(profile), Math.min(1000 * retry, 5000));
    }
  };
}

function sync() {
  for (let i = 0; i < 3; i++) setTimeout(() => send({ t: "ping", c: Date.now() }), i * 300);
}

export function updateProfile(p) {
  profile = p;
  send({ t: "profile", profile });
}
