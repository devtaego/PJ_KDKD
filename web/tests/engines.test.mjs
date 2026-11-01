// 웹판 규칙 엔진 자동 테스트 (파이썬판 tests/test_core.py 와 같은 상황에서 같은 결과가 나오는지)
// 실행: node --test web/tests/engines.test.mjs   (Node 20 이상)
import test from "node:test";
import assert from "node:assert/strict";
import { Position, perft, bestMove, sameMove, gameOver } from "../static/js/engine/chess.js";
import { Board, BLACK, aiMove } from "../static/js/engine/omok.js";
import { score, YachtGame, aiPickCategory, aiHolds, CATEGORIES, CAT_EXAMPLES } from "../static/js/engine/yacht.js";
import { questionFor, QUESTIONS } from "../static/js/party.js";
import { YutGame, pathFrom, remaining, mulberry, rollRaw, START, HOME, CENTER } from "../static/js/engine/yut.js";
import { THROW_ODDS, abilityOdds, START_HAND } from "../static/js/data/yut_abilities.js";

test("체스: 시작 위치 수 생성 (perft 1~3)", () => {
  const pos = new Position();
  assert.deepEqual([1, 2, 3].map((d) => perft(pos, d)), [20, 400, 8902]);
});

test("체스: 바보의 체크메이트", () => {
  let pos = new Position();
  for (const m of [[6, 5, 5, 5, null], [1, 4, 3, 4, null], [6, 6, 4, 6, null], [0, 3, 4, 7, null]]) {
    assert.ok(pos.legalMoves().some((x) => sameMove(x, m)));
    pos = pos.make(m);
  }
  assert.ok(pos.inCheck(pos.turn));
  assert.equal(pos.legalMoves().length, 0);
  assert.deepEqual(gameOver([pos]), { winner: "b", text: "체크메이트!" });
});

test("체스: 컴퓨터는 난이도마다 둘 수 있는 수를 고름", () => {
  const pos = new Position();
  for (const level of ["easy", "normal", "hard"]) {
    const m = bestMove(pos, level);
    assert.ok(pos.legalMoves().some((x) => sameMove(x, m)), level);
  }
});

test("오목: 정확히 5목은 승리, 장목(6목)은 아님", () => {
  const b = new Board("33");
  for (let c = 0; c < 4; c++) b.g[7][c] = BLACK;
  assert.ok(b.fiveAt(7, 4, BLACK));
  b.g[7][5] = BLACK;
  assert.ok(!b.fiveAt(7, 4, BLACK));
});

test("오목: 쌍삼 금지 / 자유룰", () => {
  const b = new Board("33");
  for (const [r, c] of [[7, 5], [7, 6], [5, 7], [6, 7]]) b.g[r][c] = BLACK;
  assert.ok(b.forbidden(7, 7, BLACK));
  const free = new Board("free");
  free.g = b.g.map((row) => row.slice());
  assert.ok(!free.forbidden(7, 7, BLACK));
});

test("오목: 컴퓨터(어려움)는 열린 4를 막음", () => {
  const b = new Board("free");
  for (const [r, c] of [[7, 3], [0, 0], [7, 4], [0, 2], [7, 5], [0, 4], [7, 6]]) b.place(r, c);
  const [r, c] = aiMove(b, "hard");
  assert.ok((r === 7 && c === 2) || (r === 7 && c === 7), `${r},${c}`);
});

test("야추: 족보 점수", () => {
  assert.equal(score("yacht", [6, 6, 6, 6, 6]), 50);
  assert.equal(score("full", [2, 2, 3, 3, 3]), 13);
  assert.equal(score("full", [2, 2, 2, 2, 2]), 0);
  assert.equal(score("lstraight", [2, 3, 4, 5, 6]), 30);
  assert.equal(score("lstraight", [1, 2, 3, 5, 6]), 0);
  assert.equal(score("sstraight", [1, 2, 3, 4, 6]), 15);
  assert.equal(score("four", [5, 5, 5, 5, 1]), 20);
  assert.equal(score("fives", [5, 5, 1, 2, 5]), 15);
});

test("야추: 도움말 예시 주사위는 모든 칸에 있고 그 칸 점수가 남", () => {
  for (const c of CATEGORIES) {
    assert.equal(CAT_EXAMPLES[c].length, 5, c);
    assert.ok(score(c, CAT_EXAMPLES[c]) > 0, c);
  }
});

test("야추: 정해진 주사위 눈으로 굴리기 · 고정 · 기록 · 보너스", () => {
  const g = new YachtGame(["a", "b"]);
  g.roll([6, 6, 6, 1, 2]);
  g.toggle(0); g.toggle(1); g.toggle(2);
  g.roll([5, 5, 5, 6, 6]); // 고정한 자리(0~2)는 그대로
  assert.deepEqual(g.dice, [6, 6, 6, 6, 6]);
  assert.ok(g.record("yacht"));
  assert.equal(g.current, 1);
  assert.equal(g.total(g.players[0]), 50);
  g.players[0].scores = { sixes: 30, fives: 25, fours: 8 };
  assert.equal(g.bonus(g.players[0]), 35);
});

test("야추: 컴퓨터는 빈 칸을 고르고 고정은 5개짜리 목록", () => {
  const g = new YachtGame(["a", "b"]);
  g.roll([2, 3, 4, 5, 1]);
  for (const level of ["easy", "normal", "hard"]) assert.ok(CATEGORIES.includes(aiPickCategory(g, level)));
  assert.equal(aiHolds(g).length, 5);
});

test("질문 카드: 이름 순서와 상관없이 같고, 파이썬판과 같은 질문", () => {
  assert.equal(questionFor("태고", "민수", 12), questionFor("민수", "태고", 12));
  assert.ok(QUESTIONS.includes(questionFor("a", "b", 1)));
  assert.equal(questionFor("a", "b", 1), "내가 은근히 자신 있는 사소한 능력은?"); // hub.party.question_for("a", "b", 1)
  assert.equal(questionFor("태고", "민수", 12), "MBTI가 뭐예요?");
});

// ---------------------------------------------------------------- 특수능력 윷놀이
const yutGame = (n = 2, opts = {}) => { // 카드는 테스트마다 직접 쥐여 줌
  const g = new YutGame(Array.from({ length: n }, (_, i) => `P${i}`), { pieces: 2, mode: "chaos", ...opts });
  for (const p of g.players) p.hand = [];
  return g;
};
// 원하는 결과가 나오는 seed 찾기 (윷 결과는 seed로만 정해짐)
const seedFor = (r) => { for (let s = 1; ; s++) if (rollRaw(mulberry(s)) === r) return s; };

test("윷: 지름길 · 남은 거리 · 결과 확률표 합 100%", () => {
  assert.deepEqual(pathFrom(5).slice(0, 6), [20, 21, 22, 23, 24, 15]);
  assert.deepEqual(pathFrom(10), [25, 26, 22, 27, 28, HOME]);
  assert.deepEqual(pathFrom(CENTER), [27, 28, HOME]);
  assert.deepEqual(pathFrom(19), [0, HOME]);
  assert.deepEqual(pathFrom(0), [HOME]);
  assert.equal(remaining(START), 21);
  assert.equal(remaining(HOME), 0);
  assert.ok(Math.abs(THROW_ODDS.reduce((s, o) => s + o.p, 0) - 1) < 1e-9);
  for (const mode of ["special", "chaos"]) assert.ok(Math.abs(abilityOdds(mode).reduce((s, a) => s + a.pct, 0) - 100) < 1e-9);
  assert.ok(abilityOdds("special").every((a) => a.tier !== "legend"));
});

test("윷: 능력 카드는 시작할 때만 모두 같은 장수, 같은 seed면 같은 카드", () => {
  const names = ["A", "B", "C"];
  const a = new YutGame(names, { mode: "chaos", seed: 7 }), b = new YutGame(names, { mode: "chaos", seed: 7 });
  assert.ok(a.players.every((p) => p.hand.length === START_HAND.chaos));
  assert.deepEqual(a.players.map((p) => p.hand), b.players.map((p) => p.hand));
  assert.ok(new YutGame(names, { mode: "special", seed: 7 }).players.every((p) => p.hand.length === START_HAND.special && p.hand.every((id) => !["party", "quake", "assemble", "roulette", "dopamine"].includes(id))));
  assert.ok(new YutGame(names, { mode: "basic", seed: 7 }).players.every((p) => p.hand.length === 0));
  // 판 위를 돌아다녀도 카드가 늘지 않음
  const g = new YutGame(["A", "B"], { mode: "chaos", seed: 3, pieces: 2 });
  g.players[0].hand = [];
  g.players[0].pieces[0].node = 3;
  g.throw(seedFor(2));
  g.move(0, 0, 1); // 예전 카드 칸(5)에 멈춤
  assert.equal(g.players[0].hand.length, 0);
});

test("윷: 던지기 · 옮기기 · 잡으면 한 번 더 · 업기", () => {
  const g = yutGame(2, { mode: "basic" });
  assert.ok(g.throw(seedFor(3)));
  assert.equal(g.phase, "move");
  assert.ok(g.move(0, 0, 1));
  assert.equal(g.players[0].pieces[0].node, 3);
  assert.equal(g.current, 1);
  g.throw(seedFor(3));
  g.move(0, 0, 1); // P1이 3에 있는 P0 말을 잡음
  assert.equal(g.players[0].pieces[0].node, START);
  assert.equal(g.players[0].captured, 1);
  assert.equal(g.current, 1);
  assert.equal(g.phase, "throw"); // 한 번 더
  g.throw(seedFor(2));
  g.move(1, 0, 1); // 새 말 → 2
  g.throw(seedFor(1));
  g.move(0, 0, 1); // P0 말 → 1
  g.throw(seedFor(1));
  g.move(1, 0, 1); // P1 말 2 → 3 : 3에 있는 내 말과 업힘
  assert.deepEqual(g.players[1].pieces.map((p) => p.node), [3, 3]);
  g.throw(seedFor(4)); g.throw(seedFor(1)); // 윷(한 번 더) + 도
  g.move(0, 0, 1); // P0 말 1 → 5
  assert.equal(g.players[0].pieces[0].node, 5);
});

test("윷: 빽도는 판 위 말이 없으면 버려지고, 있으면 한 칸 뒤로", () => {
  const g = yutGame(2, { mode: "basic" });
  g.throw(seedFor(-1));
  assert.equal(g.current, 1); // 버려지고 차례 넘어감
  const h = yutGame(2, { mode: "basic" });
  h.players[0].pieces[0].node = 7;
  h.throw(seedFor(-1));
  h.move(0, 0, 1);
  assert.equal(h.players[0].pieces[0].node, 6);
});

test("윷: 윷 + 빽도는 윷으로 말을 올린 뒤 빽도로 한 칸 뒤로 (빽도를 버리지 않음)", () => {
  const g = yutGame(2, { mode: "basic" });
  g.throw(seedFor(4)); // 윷 → 한 번 더
  g.throw(seedFor(-1)); // 빽도: 아직 판 위에 말은 없음
  assert.deepEqual(g.pending, [4, -1]);
  assert.equal(g.phase, "move");
  g.move(0, 0, 1); // 윷으로 새 말 → 4
  assert.equal(g.players[0].pieces[0].node, 4);
  assert.deepEqual(g.pending, [-1]);
  g.move(0, 0, 1); // 빽도 → 3
  assert.equal(g.players[0].pieces[0].node, 3);
  assert.equal(g.current, 1);
});

test("윷: 2:2 팀전 — 같은 팀은 업혀 함께 가고 안 잡으며, 둘 다 들어와야 승리", () => {
  const g = new YutGame(["A1", "B1", "A2", "B2"], { pieces: 2, mode: "basic", teams: true });
  assert.ok(g.teams && g.ally(0, 2) && !g.ally(0, 1));
  g.players[2].pieces[0].node = 3; // A2 말이 3에
  g.throw(seedFor(3));
  g.move(0, 0, 1); // A1 새 말 → 3: 같은 팀이라 잡지 않고 업힘
  assert.equal(g.players[2].pieces[0].node, 3);
  assert.equal(g.current, 1);
  g.throw(seedFor(2)); g.move(0, 0, 1); // B1 새 말 → 2
  g.throw(seedFor(2)); g.move(0, 0, 1); // A2: 3에 있는 묶음(A1 말 + A2 말)을 옮김 → 5
  assert.deepEqual([g.players[0].pieces[0].node, g.players[2].pieces[0].node], [5, 5]);
  g.throw(seedFor(2)); g.move(0, 0, 1); // B2 새 말 → 2: 같은 팀 B1과 업힘
  assert.equal(g.players[1].pieces[0].node, 2);
  g.throw(seedFor(3)); g.move(1, 0, 1); // A1 새 말 → 3 (상대 없음)
  g.throw(seedFor(1)); g.move(0, 0, 1); // B1: 2의 묶음 → 3: A1 말을 잡음
  assert.equal(g.players[0].pieces[1].node, START);
  // 내 말이 다 들어오면 같은 팀 말을 대신 옮김
  const k = new YutGame(["A1", "B1", "A2", "B2"], { pieces: 2, mode: "basic", teams: true });
  k.players[0].pieces.forEach((q) => { q.node = HOME; });
  k.players[2].pieces[0].node = HOME; k.players[2].pieces[1].node = 19;
  k.throw(seedFor(2));
  assert.equal(k.phase, "move"); // 버려지지 않음
  assert.ok(k.move(1, 0, 1, 2)); // A1이 A2의 말을 옮겨 골인
  assert.ok(k.over);
  assert.deepEqual([...k.winners].sort(), [0, 2]);
  // 한 명이 기권하면 그 팀이 짐
  const r = new YutGame(["A1", "B1", "A2", "B2"], { teams: true, mode: "basic" });
  r.resign(1);
  assert.ok(r.over);
  assert.deepEqual(r.winners, [0, 2]);
});

test("윷: 능력 — 폭탄 · 어쩔티비 · 갓생 · 미사일", () => {
  const g = yutGame(2);
  g.players[0].hand = ["bomb", "missile"];
  assert.equal(g.use(0, { node: 3 }, 1), true);
  assert.equal(g.bombs[3], 0);
  g.throw(seedFor(3));
  g.move(0, 0, 1); // 내 말도 폭탄에 당함
  assert.equal(g.players[0].pieces[0].node, START);
  assert.equal(g.bombs[3], undefined);

  const h = yutGame(2);
  h.players[1].pieces[0].node = 12;
  h.players[1].ward = true;
  h.players[0].hand = ["kingbat"];
  h.use(0, { opp: { seat: 1, idx: 0 } }, 1);
  assert.equal(h.players[1].pieces[0].node, 12); // 막힘
  assert.deepEqual(h.players[1].hand, ["kingbat"]); // 빼앗음
  assert.equal(h.players[1].ward, false);

  const k = yutGame(3);
  k.players[1].pieces[0].node = 12;
  k.players[2].pieces[0].node = 17;
  k.players[2].pieces[0].shield = 99; // 갓생: 미사일 대상에서 빠짐
  k.players[0].hand = ["missile"];
  k.use(0, {}, 1);
  assert.equal(k.players[1].pieces[0].node, 9);
  assert.equal(k.players[2].pieces[0].node, 17);
});

test("윷: 능력 — 이게 맞아? · 존버 · 손가락 꼬임 · 전원 집합", () => {
  const g = yutGame(2);
  g.players[0].pieces[0].node = 2;
  g.players[1].pieces[0].node = 15;
  g.players[0].hand = ["isthisright"];
  g.use(0, { own: 0, opp: { seat: 1, idx: 0 } }, 1);
  assert.equal(g.players[0].pieces[0].node, 15);
  assert.equal(g.players[1].pieces[0].node, 2);

  const h = yutGame(2);
  h.players[0].hand = ["hodl"];
  h.use(0, {}, 1);
  assert.equal(h.current, 1);
  assert.equal(h.players[0].shift, 2);
  h.players[1].hand = ["twist"];
  h.use(0, {}, 1); // 다음 사람(P0)에게 -1 → 합쳐서 +1
  assert.equal(h.players[0].shift, 1);
  const c = yutGame(3);
  c.players[0].pieces[0].node = 4;
  c.players[1].pieces[0].node = 9;
  c.players[2].pieces[1].node = 27;
  c.players[0].hand = ["assemble"];
  c.use(0, {}, 1);
  assert.deepEqual([c.players[0].pieces[0].node, c.players[1].pieces[0].node, c.players[2].pieces[1].node], [CENTER, CENTER, CENTER]);
});

test("윷: 같은 seed면 같은 판 (아무렇게나 끝까지 둬도 규칙이 깨지지 않음)", () => {
  const play = (seed) => {
    const rng = mulberry(seed);
    const g = new YutGame(["A", "B", "C", "D"], { pieces: 3, mode: "chaos" });
    for (let step = 0; step < 4000 && !g.over; step++) {
      const s = Math.floor(rng() * 2 ** 31);
      const p = g.players[g.current];
      if (p.hand.length && !g.usedAbility && rng() < 0.3) {
        const opp = (g.current + 1) % 4;
        g.use(0, { own: Math.floor(rng() * 3), opp: { seat: opp, idx: Math.floor(rng() * 3) }, node: 1 + Math.floor(rng() * 28) }, s);
      } else if (g.phase === "throw") g.throw(s);
      else {
        const ok = p.pieces.map((_, i) => i).filter((i) => g.destOf(p.pieces[i], g.pending[0]) !== null);
        assert.ok(ok.length > 0, "옮길 수 있는 말이 있어야 함");
        g.move(ok[Math.floor(rng() * ok.length)], 0, s);
      }
      for (const pl of g.players) {
        assert.ok(pl.hand.length <= START_HAND.chaos + 4); // 처음 받은 카드 + 어쩔티비로 빼앗은 카드
        for (const pc of pl.pieces) assert.ok(pc.node === START || pc.node === HOME || (pc.node >= 0 && pc.node <= 28));
      }
    }
    assert.ok(g.over, "끝까지 가야 함");
    return JSON.stringify([g.winner, g.ranking(), g.log]);
  };
  for (const seed of [1, 2, 3, 42, 777]) assert.equal(play(seed), play(seed));
});
