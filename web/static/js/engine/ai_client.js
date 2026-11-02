// 워커에 컴퓨터 수를 물어봄. 워커를 못 쓰는 환경이면 fallback(짧게 생각하는 계산)으로 대신함
let worker = null;
let broken = false;
let nextId = 1;
const waiting = new Map();

function failAll() {
  broken = true;
  worker = null;
  for (const [, w] of waiting) w.fallback();
  waiting.clear();
}

function getWorker() {
  if (broken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./ai_worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      clearTimeout(w.timer);
      w.resolve(data.result);
    };
    worker.onerror = () => failAll();
    return worker;
  } catch {
    broken = true;
    return null;
  }
}

/** game: chess / omok, fallback: 워커 없이 바로 계산해서 돌려주는 함수 */
export function askAi(game, state, level, { timeMs, seen, fallback }) {
  return new Promise((resolve) => {
    const useFallback = () => setTimeout(() => resolve(fallback()), 0);
    const wk = getWorker();
    if (!wk) { useFallback(); return; }
    const id = nextId++;
    const timer = setTimeout(() => { // 응답이 너무 늦으면 기다리지 않음
      if (waiting.delete(id)) useFallback();
    }, timeMs + 6000);
    waiting.set(id, { resolve, timer, fallback: () => { clearTimeout(timer); useFallback(); } });
    wk.postMessage({ id, game, state, level, timeMs, seen });
  });
}
