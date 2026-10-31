// 효과음: 소리 파일 없이 Web Audio로 직접 만듦 (hub/sound.py 와 같은 생각)
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem("kidk.sound") !== "off"; } catch { /* 저장소를 못 쓰면 켜 둔 채로 */ }

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem("kidk.sound", on ? "on" : "off"); } catch { /* 무시 */ }
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
// 폰은 첫 터치 뒤에만 소리를 낼 수 있어서, 처음 누를 때 미리 깨워 둠
window.addEventListener("pointerdown", () => { if (enabled) ac(); }, { once: true });

function tone(freq, dur, { type = "sine", gain = 0.18, at = 0, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(freq + slide, 30), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.2, at = 0, freq = 1800, q = 0.8 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS = {
  click: () => tone(900, 0.05, { type: "triangle", gain: 0.12 }),
  pop: () => tone(520, 0.12, { type: "sine", gain: 0.2, slide: 500 }),
  place: () => { noise(0.06, { gain: 0.5, freq: 2400, q: 1.4 }); tone(180, 0.08, { gain: 0.2 }); },
  move: () => { noise(0.05, { gain: 0.35, freq: 1500, q: 1.2 }); tone(240, 0.06, { gain: 0.12 }); },
  shake: () => { for (let i = 0; i < 5; i++) noise(0.04, { gain: 0.3, at: i * 0.06, freq: 3000, q: 2 }); },
  roll: () => { for (let i = 0; i < 7; i++) noise(0.05, { gain: 0.4 - i * 0.04, at: i * 0.07 + Math.random() * 0.03, freq: 2200, q: 1.6 }); },
  thud: () => { tone(120, 0.18, { gain: 0.4, slide: -70 }); noise(0.08, { gain: 0.3, freq: 400 }); },
  win: () => [523, 659, 784, 1047].forEach((fq, i) => tone(fq, 0.22, { type: "triangle", gain: 0.16, at: i * 0.11 })),
  lose: () => [392, 330, 262].forEach((fq, i) => tone(fq, 0.3, { type: "sine", gain: 0.16, at: i * 0.16 })),
  join: () => { tone(660, 0.1, { gain: 0.12 }); tone(880, 0.14, { gain: 0.12, at: 0.08 }); },
};

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch { /* 소리가 안 나도 게임은 계속 */ }
}
