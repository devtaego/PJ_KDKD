// 웹판 규칙 엔진 자동 테스트 (파이썬판 tests/test_core.py 와 같은 상황에서 같은 결과가 나오는지)
// 실행: node --test web/tests/engines.test.mjs   (Node 20 이상)
import test from "node:test";
import assert from "node:assert/strict";
import { Position, perft, bestMove, sameMove, gameOver } from "../static/js/engine/chess.js";
import { Board, BLACK, aiMove } from "../static/js/engine/omok.js";
import { score, YachtGame, aiPickCategory, aiHolds, CATEGORIES, CAT_EXAMPLES } from "../static/js/engine/yacht.js";
import { questionFor, QUESTIONS } from "../static/js/party.js";

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
  assert.equal(questionFor("a", "b", 1), "MBTI가 뭐예요?"); // party.question_for("a", "b", 1)
  assert.equal(questionFor("태고", "민수", 12), "요즘 제일 빠져 있는 것은?");
});
