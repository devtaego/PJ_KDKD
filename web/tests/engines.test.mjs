// 웹판 규칙 엔진 자동 테스트 (파이썬판 tests/test_core.py 와 같은 상황에서 같은 결과가 나오는지)
// 실행: node --test web/tests/engines.test.mjs   (Node 20 이상)
import test from "node:test";
import assert from "node:assert/strict";
import { Position, perft, bestMove, sameMove, gameOver, materialInfo } from "../static/js/engine/chess.js";
import { Board, BLACK, WHITE, aiMove } from "../static/js/engine/omok.js";
import { score, YachtGame, aiPickCategory, aiHolds, CATEGORIES, CAT_EXAMPLES } from "../static/js/engine/yacht.js";
import { questionFor, QUESTIONS } from "../static/js/party.js";
import { YutGame, pathFrom, remaining, mulberry, rollRaw, START, HOME, CENTER } from "../static/js/engine/yut.js";
import { cropRect, clampZoom, MAX_ZOOM } from "../static/js/engine/photo_crop.js";
import { TITLES, COUNTED_TITLES, KEEP_ON_RESET } from "../static/js/data/titles.js";
import { THROW_ODDS, ABILITIES, POWER_SUM, ABILITY_BY_ID, dealPowers } from "../static/js/data/yut_abilities.js";

test("체스: 시작 위치 수 생성 (perft 1~3)", () => {
  const pos = new Position();
  assert.deepEqual([1, 2, 3].map((d) => perft(pos, d)), [20, 400, 8902]);
});

test("체스: 잡은 기물과 점수 차이", () => {
  const board = new Position().board.map((row) => [...row]);
  assert.deepEqual(materialInfo(board), { taken: { w: [], b: [] }, diff: 0 });
  board[0][3] = null; // 흑 퀸이 잡힘
  assert.deepEqual(materialInfo(board), { taken: { w: ["Q"], b: [] }, diff: 9 });
  board[6][0] = null; // 백 폰이 승급: 폰이 잡힌 것으로 세지 않음
  board[1][0] = "wQ"; // 그 자리에 있던 흑 폰은 잡힘
  assert.deepEqual(materialInfo(board), { taken: { w: ["Q", "P"], b: [] }, diff: 18 });
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

test("체스: 어려움은 한 수 메이트 · 공짜 퀸을 놓치지 않고, 잡히는 자리에 퀸을 두지 않음", () => {
  const mate = new Position(true); // 백 Ra1, Kg6 / 흑 Kg8 → Ra8#
  mate.board[7][0] = "wR"; mate.board[2][6] = "wK"; mate.board[0][6] = "bK"; mate.castling = "";
  assert.ok(sameMove(bestMove(mate, "hard", { timeMs: 200 }), [7, 0, 0, 0, null]));
  const hang = new Position(true); // 흑 퀸이 d5에 공짜로 있음
  hang.board[7][4] = "wK"; hang.board[0][4] = "bK"; hang.board[7][3] = "wR"; hang.board[3][3] = "bQ"; hang.castling = "";
  assert.ok(sameMove(bestMove(hang, "hard", { timeMs: 200 }), [7, 3, 3, 3, null]));
  const poisoned = new Position(true); // Qxd5는 폰에게 잡힘 (d5 폰을 e6 폰이 지킴)
  poisoned.board[7][4] = "wK"; poisoned.board[0][4] = "bK"; poisoned.board[7][3] = "wQ"; poisoned.board[3][3] = "bP"; poisoned.board[2][4] = "bP"; poisoned.castling = "";
  assert.ok(!sameMove(bestMove(poisoned, "hard", { timeMs: 300 }), [7, 3, 3, 3, null]));
});

test("오목: 정확히 5목은 승리, 장목(6목)은 아님", () => {
  const b = new Board("renju");
  for (let c = 0; c < 4; c++) b.g[7][c] = BLACK;
  assert.ok(b.fiveAt(7, 4, BLACK));
  b.g[7][5] = BLACK;
  assert.ok(!b.fiveAt(7, 4, BLACK));
});

test("오목: 렌주룰 3-3 금지 / 자유룰", () => {
  const b = new Board("renju");
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

test("오목: 난이도마다 둘 수 있는 수를 고르고, 어려움은 열린 3을 그냥 두지 않음", () => {
  const b = new Board("free");
  for (const [r, c] of [[7, 5], [0, 0], [7, 6], [0, 14], [7, 7]]) b.place(r, c);
  for (const level of ["easy", "normal", "hard"]) {
    const [r, c] = aiMove(b, level, { timeMs: 100 });
    assert.ok(b.legal(r, c), level);
  }
  const [r, c] = aiMove(b, "hard", { timeMs: 200 });
  assert.ok(r === 7 && [3, 4, 8, 9].includes(c), `${r},${c}`);
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
  assert.equal(questionFor("태고", "민수", 12), "내가 좋아하는 대화 주제는 무엇인가요?"); // hub.party.question_for("태고", "민수", 12)
});

// ---------------------------------------------------------------- 윷놀이
const yutGame = (n = 2, opts = {}) => { // 카드는 테스트마다 직접 쥐여 줌
  const g = new YutGame(Array.from({ length: n }, (_, i) => `P${i}`), { pieces: 2, mode: "power", ...opts });
  for (const p of g.players) p.hand = [];
  return g;
};
// 원하는 결과가 나오는 seed 찾기 (윷 결과는 seed로만 정해짐)
const seedFor = (r) => { for (let s = 1; ; s++) if (rollRaw(mulberry(s)) === r) return s; };

test("윷: 지름길 · 남은 거리 · 결과 확률표 합 100%", () => {
  assert.deepEqual(pathFrom(5).slice(0, 6), [20, 21, 22, 23, 24, 15]);
  assert.deepEqual(pathFrom(10), [25, 26, 22, 27, 28, 0, HOME]);
  assert.deepEqual(pathFrom(CENTER), [27, 28, 0, HOME]);
  assert.deepEqual(pathFrom(5).slice(-3), [19, 0, HOME]);
  assert.deepEqual(pathFrom(19), [0, HOME]);
  assert.deepEqual(pathFrom(0), [HOME]);
  assert.equal(remaining(START), 21);
  assert.equal(remaining(HOME), 0);
  assert.ok(Math.abs(THROW_ODDS.reduce((s, o) => s + o.p, 0) - 1) < 1e-9);
});

test("윷: 모 뒤에 낙이 나와도 모는 남고, 더 못 던짐", () => {
  const g = yutGame(2, { mode: "basic" });
  g.throw(seedFor(5)); // 모 → 한 번 더
  assert.equal(g.phase, "throw");
  g.throw(seedFor(0)); // 낙
  assert.deepEqual(g.pending, [5]);
  assert.equal(g.current, 0);
  assert.equal(g.phase, "move");
  assert.equal(g.throws, 0);
  assert.ok(g.move(0, 0, 1));
  assert.equal(g.players[0].pieces[0].node, 5);
  assert.equal(g.current, 1);
  // 쌓인 결과가 없으면 낙은 차례를 넘김
  g.throw(seedFor(0));
  assert.equal(g.current, 0);
  assert.deepEqual(g.pending, []);
});

test("윷: 출발점에 딱 멈추면 골인이 아니고, 1칸 이상 넘어가야 골인", () => {
  for (const [from, exact] of [[19, 1], [18, 2], [28, 1], [27, 2], [CENTER, 3], [26, 4], [24, 6]]) {
    const g = yutGame(2, { mode: "basic" });
    g.players[0].pieces[0].node = from;
    assert.equal(g.destOf(g.players[0].pieces[0], exact), 0, `${from}에서 ${exact}칸`);
    assert.equal(g.destOf(g.players[0].pieces[0], exact + 1), HOME, `${from}에서 ${exact + 1}칸`);
  }
  const g = yutGame(2, { mode: "basic" });
  g.players[0].pieces[0].node = 28;
  g.throw(seedFor(1));
  g.move(0, 0, 1);
  assert.equal(g.players[0].pieces[0].node, 0); // 아직 판 위
  assert.equal(g.finished(0), 0);
  g.throw(seedFor(1)); g.move(0, 0, 1); // P1
  g.throw(seedFor(1));
  g.move(0, 0, 1);
  assert.equal(g.players[0].pieces[0].node, HOME);
  // 첫 칸에서 빽도: 출발점에 서고 바로 골인하지 않음
  const h = yutGame(2, { mode: "basic" });
  h.throw(seedFor(1)); h.move(0, 0, 1);
  h.throw(seedFor(2)); h.move(0, 0, 1);
  h.throw(seedFor(-1)); h.move(0, 0, 1);
  assert.equal(h.players[0].pieces[0].node, 0);
});

test("윷: 초능력 카드는 각자 윷의 힘 + 말의 힘 1장씩, 힘 합이 같고, 같은 seed면 같은 카드", () => {
  assert.ok(ABILITIES.every((a) => [1, 2, 3].includes(a.power) && ["yut", "piece"].includes(a.kind)));
  const names = ["A", "B", "C", "D"];
  for (let seed = 1; seed <= 200; seed++) {
    const g = new YutGame(names, { mode: "power", seed });
    for (const p of g.players) {
      const [y, q] = p.hand.map((id) => ABILITY_BY_ID[id]);
      assert.equal(p.hand.length, 2);
      assert.equal(y.kind, "yut");
      assert.equal(q.kind, "piece");
      assert.equal(y.power + q.power, POWER_SUM);
    }
    assert.equal(new Set(g.players.map((p) => p.hand[0])).size, 4); // 윷의 힘은 겹치지 않음
  }
  assert.deepEqual(new YutGame(names, { seed: 7 }).players.map((p) => p.hand), new YutGame(names, { seed: 7 }).players.map((p) => p.hand));
  assert.ok(new YutGame(names, { mode: "basic", seed: 7 }).players.every((p) => p.hand.length === 0));
  assert.equal(new YutGame(names, { mode: "chaos" }).mode, "power"); // 예전 설정은 초능력으로
  assert.equal(dealPowers(6, mulberry(1)).length, 6);
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

test("윷: 2:2 팀전 — 팀마다 말 4개 · 카드 한 벌을 같이 쓰고, 같은 팀은 안 잡음", () => {
  const g = new YutGame(["A1", "B1", "A2", "B2"], { pieces: 2, mode: "basic", teams: true });
  assert.ok(g.teams && g.ally(0, 2) && !g.ally(0, 1));
  assert.equal(g.pieceCount, 4); // pieces 설정과 상관없이 4개
  assert.equal(g.players[0].pieces, g.players[2].pieces);
  assert.equal(g.players[1].pieces, g.players[3].pieces);
  assert.notEqual(g.players[0].pieces, g.players[1].pieces);
  g.throw(seedFor(3));
  g.move(0, 0, 1); // A1: A팀 말 0 → 3
  assert.equal(g.current, 1);
  g.throw(seedFor(2)); g.move(0, 0, 1); // B1: B팀 말 0 → 2
  g.throw(seedFor(2));
  assert.ok(g.move(0, 0, 1)); // A2도 A팀 말 0을 옮김: 3 → 5
  assert.equal(g.players[0].pieces[0].node, 5);
  g.throw(seedFor(1)); g.move(0, 0, 1); // B2: B팀 말 0 → 3
  assert.equal(g.players[3].pieces[0].node, 3);
  g.throw(seedFor(3)); g.move(1, 0, 1); // A1: A팀 말 1 → 3: B팀 말을 잡음
  assert.equal(g.players[1].pieces[0].node, START);
  assert.equal(g.players[1].captured, 1);
  // 업기: 같은 팀 말끼리 함께 움직임
  const s = new YutGame(["A1", "B1", "A2", "B2"], { mode: "basic", teams: true });
  s.players[0].pieces[0].node = 3;
  s.players[0].pieces[1].node = 3;
  assert.equal(s.stackAt(2, 3).length, 2);
  s.current = 2;
  s.throw(seedFor(2));
  assert.ok(s.move(0, 0, 1));
  assert.deepEqual(s.players[0].pieces.slice(0, 2).map((q) => q.node), [5, 5]);
  // 상대 팀 말은 못 옮김
  s.throw(seedFor(1)); // B2 차례(자리 3)
  assert.equal(s.current, 3);
  assert.equal(s.move(0, 0, 1, 0), false);
  // 말 4개가 다 들어오면 그 팀 승리
  const k = new YutGame(["A1", "B1", "A2", "B2"], { mode: "basic", teams: true });
  k.players[0].pieces.forEach((q) => { q.node = HOME; });
  k.players[0].pieces[3].node = 19;
  k.throw(seedFor(2));
  assert.ok(k.move(3, 0, 1));
  assert.ok(k.over);
  assert.deepEqual([...k.winners].sort(), [0, 2]);
  // 한 명이 기권하면 그 팀이 짐
  const r = new YutGame(["A1", "B1", "A2", "B2"], { teams: true, mode: "basic" });
  r.resign(1);
  assert.ok(r.over);
  assert.deepEqual(r.winners, [0, 2]);
});

test("윷: 팀전도 카드는 사람마다 따로이고, 쓰면 그 사람 카드만 줄어듦", () => {
  const g = new YutGame(["A1", "B1", "A2", "B2"], { mode: "power", seed: 5, teams: true });
  assert.ok(g.players.every((p) => p.hand.length === 2));
  assert.notEqual(g.players[0].hand, g.players[2].hand);
  assert.equal(g.players[0].pieces, g.players[2].pieces); // 말은 같이 씀
  g.players[0].hand.splice(0, 2, "extra");
  assert.ok(g.use(0, {}, 1));
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.players[2].hand.length, 2);
});

test("윷: 윷 · 모가 나오면 더 던지기 전에 먼저 옮겨도 됨", () => {
  const g = yutGame(2, { mode: "basic" });
  g.throw(seedFor(4));
  assert.equal(g.phase, "throw");
  assert.ok(g.move(0, 0, 1)); // 더 던지기 전에 윷으로 먼저 이동
  assert.equal(g.players[0].pieces[0].node, 4);
  assert.deepEqual(g.pending, []);
  assert.equal(g.current, 0); // 던질 기회는 그대로 남아 차례가 안 넘어감
  assert.equal(g.phase, "throw");
  assert.equal(g.move(0, 0, 1), false); // 쓸 결과가 없으면 못 옮김
  g.throw(seedFor(2));
  g.move(0, 0, 1);
  assert.equal(g.players[0].pieces[0].node, 6);
  assert.equal(g.current, 1);
});

const give = (g, seat, ...ids) => { g.players[seat].hand = [...ids]; };

test("윷: 초능력은 던지기 전에만, 한 차례에 한 장만, 쓰면 사라짐", () => {
  const g = yutGame();
  give(g, 0, "golden", "extra");
  assert.ok(g.use(1, {}, 1));
  assert.equal(g.throws, 2); // 한 번만 더
  assert.equal(g.use(0, {}, 1), false); // 이번 차례는 이미 씀
  const m = yutGame();
  give(m, 0, "golden");
  m.throw(seedFor(2));
  assert.equal(m.phase, "move");
  assert.equal(m.use(0, {}, 1), false); // 던진 뒤에는 못 씀
  assert.equal(m.players[0].hand.length, 1);
});

test("윷: 윷의 힘 — 걸 · 빽도 · 반반 · 세트 · 곱빼기 · 미루기", () => {
  const thrown = (id, seed = 1, setup = () => {}) => {
    const g = yutGame();
    setup(g);
    give(g, 0, id);
    assert.ok(g.use(0, {}, 1), id);
    g.throw(seed);
    return g;
  };
  assert.deepEqual(thrown("gul3").pending, [3]);
  assert.deepEqual(thrown("reverse", 1, (g) => { g.players[0].pieces[0].node = 3; }).pending, [-1]);
  assert.deepEqual(thrown("combo").pending, [1, 2]);
  for (let s = 1; s < 40; s++) {
    assert.ok([1, 5].includes(thrown("allin", s).pending[0]));
    assert.ok([4, 5].includes(thrown("golden", s).pending[0]));
  }
  assert.deepEqual(thrown("double", seedFor(3)).pending, [3, 3]);
  const nak = thrown("double", seedFor(0));
  assert.equal(nak.current, 1); // 낙이면 사라지고 차례가 넘어감
  const later = thrown("later", seedFor(3));
  assert.equal(later.current, 1);
  assert.deepEqual(later.pending, []);
  later.throw(seedFor(1));
  later.move(0, 0, 1); // 상대 차례 끝
  assert.equal(later.current, 0);
  assert.deepEqual(later.pending, [3]); // 다음 내 차례에 받음
  assert.equal(later.phase, "throw");
});

test("윷: 말의 힘 — 불러오기 · 얹혀가기 · 방어 · 뒤에 붙기 · 지뢰 · 택시 · 귀가 · 자리 바꾸기", () => {
  const setup = (...ids) => {
    const g = yutGame(2, { pieces: 3 });
    give(g, 0, ...ids);
    g.players[0].pieces[0].node = 3;
    g.players[1].pieces[0].node = 8;
    return g;
  };
  const opp = { seat: 1, idx: 0 };
  const c = setup("callme");
  assert.ok(c.use(0, { own: 0, opp }, 1));
  assert.ok([4, 5, 6].includes(c.players[1].pieces[0].node));

  const h = setup("hitch");
  assert.ok(h.use(0, { own: 0 }, 1));
  assert.equal(h.players[0].pieces[1].node, 3);
  const noRider = setup("hitch");
  noRider.players[0].pieces.forEach((pc) => { pc.node = 3; });
  assert.equal(noRider.abilityReady("hitch"), false);
  assert.equal(noRider.use(0, { own: 0 }, 1), false);

  const b = setup("guard");
  assert.ok(b.use(0, { own: 0 }, 1));
  assert.ok(b.shielded(b.players[0].pieces[0]));

  const t = setup("tail");
  assert.ok(t.use(0, { own: 1, opp }, 1)); // 안 나간 말도 고를 수 있음
  assert.equal(t.players[0].pieces[1].node, 7);

  const m = setup("mine");
  assert.equal(m.use(0, { node: 8 }, 1), false); // 말이 있는 칸은 안 됨
  assert.ok(m.use(0, { node: 12 }, 1));
  assert.equal(m.bombs[12], 0);

  const x = setup("taxi");
  assert.ok(x.use(0, { own: 0 }, 1));
  assert.equal(x.players[0].pieces[0].node, 0);
  assert.equal(x.finished(0), 0); // 골인은 아님

  const go = setup("gohome");
  assert.ok(go.use(0, { opp }, 1));
  assert.equal(go.players[1].pieces[0].node, START);

  const sw = setup("swapme");
  assert.ok(sw.use(0, { own: 0, opp }, 1));
  assert.equal(sw.players[0].pieces[0].node, 8);
  assert.equal(sw.players[1].pieces[0].node, 3);

  const fl = setup("flip");
  assert.ok(fl.use(0, {}, 1));
  assert.deepEqual([fl.players[0].pieces[0].node, fl.players[1].pieces[0].node].sort((p, q) => p - q), [3, 8]);
});

test("윷: 같은 seed면 같은 판 (아무렇게나 끝까지 둬도 규칙이 깨지지 않음)", () => {
  const play = (seed) => {
    const rng = mulberry(seed);
    const g = new YutGame(["A", "B", "C", "D"], { pieces: 3, mode: "power", seed });
    for (let step = 0; step < 4000 && !g.over; step++) {
      const s = Math.floor(rng() * 2 ** 31);
      const p = g.players[g.current];
      if (p.hand.length && !g.usedAbility && rng() < 0.3) {
        const opp = (g.current + 1) % 4;
        g.use(0, { own: Math.floor(rng() * 3), opp: { seat: opp, idx: Math.floor(rng() * 3) }, node: 1 + Math.floor(rng() * 28) }, s);
      } else if (g.phase === "throw") g.throw(s);
      else {
        // 빽도는 말을 먼저 올린 뒤 쓸 수 있으니, 지금 옮길 수 있는 결과를 고름
        const res = g.pending.findIndex((r) => p.pieces.some((q) => g.destOf(q, r) !== null));
        assert.ok(res >= 0, "옮길 수 있는 결과가 있어야 함");
        const ok = p.pieces.map((_, i) => i).filter((i) => g.destOf(p.pieces[i], g.pending[res]) !== null);
        g.move(ok[Math.floor(rng() * ok.length)], res, s);
      }
      for (const pl of g.players) {
        assert.ok(pl.hand.length <= 2);
        for (const pc of pl.pieces) assert.ok(pc.node === START || pc.node === HOME || (pc.node >= 0 && pc.node <= 28));
      }
    }
    assert.ok(g.over, "끝까지 가야 함");
    return JSON.stringify([g.winner, g.ranking(), g.log]);
  };
  for (const seed of [1, 2, 3, 42, 777]) assert.equal(play(seed), play(seed));
});

test("프로필 사진: 자르는 칸은 항상 사진 안쪽, 확대하면 작아짐", () => {
  assert.deepEqual(cropRect(400, 200, 1, 200, 100), { x: 100, y: 0, size: 200 }); // 처음에는 가운데
  assert.deepEqual(cropRect(400, 200, 2, 200, 100), { x: 150, y: 50, size: 100 });
  assert.deepEqual(cropRect(400, 200, 1, -999, 100), { x: 0, y: 0, size: 200 }); // 왼쪽 끝을 넘지 않음
  assert.deepEqual(cropRect(400, 200, 1, 9999, 100), { x: 200, y: 0, size: 200 }); // 오른쪽 끝을 넘지 않음
  assert.deepEqual(cropRect(200, 400, 2, 100, 9999), { x: 50, y: 300, size: 100 }); // 아래쪽 끝을 넘지 않음
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(99), MAX_ZOOM);
});

test("칭호: 전체 개수에서 DEV · 히든 칭호는 빠지고, 초기화해도 남는 칭호는 목록에 있음", () => {
  assert.equal(COUNTED_TITLES.length, 37); // 서버의 COLLECT_TITLES와 같은 수
  assert.ok(!COUNTED_TITLES.includes("dev"));
  assert.ok(COUNTED_TITLES.every((id) => !TITLES[id].secret && !id.startsWith("q_") && !id.startsWith("col_") && !id.startsWith("reset_")));
  assert.ok(COUNTED_TITLES.includes("kda"));
  for (const id of KEEP_ON_RESET) assert.ok(TITLES[id], id);
  assert.ok(!KEEP_ON_RESET.has("col_all"));
});

// 렌주룰 시험용 판: 칸 목록에 돌을 놓음
const renju = (black, white = []) => {
  const b = new Board("renju");
  for (const [r, c] of black) b.g[r][c] = BLACK;
  for (const [r, c] of white) b.g[r][c] = WHITE;
  return b;
};

test("렌주룰: 예전 설정 33은 렌주룰로 읽음", () => {
  assert.equal(new Board("33").rule, "renju");
  assert.equal(new Board().rule, "renju");
  assert.equal(new Board("free").rule, "free");
});

test("렌주룰: 흑 장목은 금수이고 승리가 아님, 백은 장목도 승리", () => {
  const b = renju([[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]]);
  assert.equal(b.forbidReason(7, 5, BLACK), "overline");
  assert.ok(!b.fiveAt(7, 5, BLACK));
  const w = renju([], [[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]]);
  assert.equal(w.forbidReason(7, 5, WHITE), null);
  assert.ok(w.fiveAt(7, 5, WHITE));
  w.g[7][5] = WHITE;
  assert.equal(w.winLine(7, 5, WHITE).length, 6);
});

test("렌주룰: 4-4는 금수, 한 줄에 생기는 4-4도 금수, 열린 4 하나는 괜찮음", () => {
  const cross = renju([[7, 4], [7, 5], [7, 6], [4, 7], [5, 7], [6, 7]]);
  assert.equal(cross.fourCount(7, 7, BLACK), 2);
  assert.equal(cross.forbidReason(7, 7, BLACK), "four");
  const line = renju([[7, 2], [7, 4], [7, 5], [7, 8]]); // ● · ● ● ★ · ●  (6에 두면 4가 둘)
  assert.equal(line.fourCount(7, 6, BLACK), 2);
  assert.equal(line.forbidReason(7, 6, BLACK), "four");
  const straight = renju([[7, 4], [7, 5], [7, 6]]);
  assert.equal(straight.fourCount(7, 7, BLACK), 1);
  assert.equal(straight.forbidReason(7, 7, BLACK), null);
});

test("렌주룰: 4-3은 둘 수 있음", () => {
  const b = renju([[7, 4], [7, 5], [7, 6], [5, 7], [6, 7]]);
  assert.equal(b.fourCount(7, 7, BLACK), 1);
  assert.equal(b.threeCount(7, 7, BLACK, 2), 1);
  assert.equal(b.forbidReason(7, 7, BLACK), null);
});

test("렌주룰: 5목이 되는 수는 금수와 겹쳐도 둘 수 있음", () => {
  // 가로로 정확히 5목 + 세로 · 대각선으로 3-3도 생기는 자리
  const b = renju([[7, 3], [7, 4], [7, 5], [7, 6], [5, 7], [6, 7], [5, 5], [6, 6]]);
  assert.ok(b.fiveAt(7, 7, BLACK));
  assert.equal(b.forbidReason(7, 7, BLACK), null);
  // 5목과 장목이 함께 생겨도 5목이 우선
  const both = renju([[7, 3], [7, 4], [7, 5], [7, 6], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]]);
  assert.equal(both.forbidReason(7, 7, BLACK), null);
});

test("렌주룰: 막힌 3 · 열린 4가 못 되는 3은 3으로 세지 않음", () => {
  const blocked = renju([[7, 5], [7, 6], [5, 7], [6, 7]], [[7, 4]]); // 가로 3이 백에 막힘
  assert.equal(blocked.threeCount(7, 7, BLACK, 2), 1);
  assert.equal(blocked.forbidReason(7, 7, BLACK), null);
  // 가로: 어느 쪽으로 넓혀도 양 끝 너머에 흑이 있어 열린 4가 못 됨
  const noRoom = renju([[7, 2], [7, 5], [7, 6], [7, 10], [5, 7], [6, 7]]);
  assert.equal(noRoom.threeCount(7, 7, BLACK, 2), 1);
  assert.equal(noRoom.forbidReason(7, 7, BLACK), null);
  // 판 가장자리에 붙은 3
  const edge = renju([[0, 1], [0, 2], [1, 3], [2, 3]]);
  assert.equal(edge.threeCount(0, 3, BLACK, 2), 1);
  assert.equal(edge.forbidReason(0, 3, BLACK), null);
});

test("렌주룰: 다음 수가 금수뿐인 3은 진짜 3이 아님", () => {
  // (7,7)의 가로 3: 왼쪽은 백에 막혀 (7,8)로만 열린 4가 되는데, (7,8)은 세로 · 대각선 3-3 금수라 3으로 세지 않음
  const b = renju([[7, 5], [7, 6], [5, 7], [6, 7], [5, 8], [6, 8], [6, 9], [5, 10]], [[7, 3]]);
  assert.equal(b.threeCount(7, 7, BLACK, 0), 2); // 다음 수의 금수를 따지지 않으면 3-3처럼 보임
  assert.equal(b.threeCount(7, 7, BLACK, 2), 1);
  assert.equal(b.forbidReason(7, 7, BLACK), null);
});

test("렌주룰: 백은 3-3 · 4-4도 둘 수 있고, 자유룰은 흑도 제한 없음", () => {
  const w = renju([], [[7, 5], [7, 6], [5, 7], [6, 7]]);
  w.moves = [[0, 0]]; // 백 차례
  assert.equal(w.turn, WHITE);
  assert.ok(w.legal(7, 7));
  const free = new Board("free");
  for (const [r, c] of [[7, 5], [7, 6], [5, 7], [6, 7]]) free.g[r][c] = BLACK;
  assert.ok(!free.forbidden(7, 7, BLACK));
});

test("렌주룰: 판 전체 금수 계산이 충분히 빠름", () => {
  const b = renju([[7, 5], [7, 6], [5, 7], [6, 7], [3, 3], [4, 4], [9, 9], [10, 10], [11, 4], [11, 5]], [[8, 8], [2, 2], [6, 6], [12, 12]]);
  const t0 = Date.now();
  for (let k = 0; k < 20; k++) for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) b.forbidden(r, c, BLACK);
  assert.ok((Date.now() - t0) / 20 < 30, `${(Date.now() - t0) / 20}ms`);
});

test("렌주룰: 컴퓨터(흑)는 금수에 두지 않음", () => {
  const b = renju([[7, 5], [7, 6], [5, 7], [6, 7]]);
  b.moves = [[0, 0], [0, 1]];
  for (const level of ["easy", "normal", "hard"]) for (let k = 0; k < 8; k++) {
    const [r, c] = aiMove(b, level, { timeMs: 30 });
    assert.ok(!b.forbidden(r, c, BLACK), `${level} ${r},${c}`);
  }
});
