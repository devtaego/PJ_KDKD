// 컴퓨터 수 계산 전용 워커: 어려운 난이도가 오래 생각해도 화면이 멈추지 않게 함
import { Position, bestMove } from "./chess.js";
import { Board, aiMove } from "./omok.js";

self.onmessage = ({ data: d }) => {
  let result = null;
  if (d.game === "chess") {
    const pos = new Position(true);
    Object.assign(pos, d.state);
    result = bestMove(pos, d.level, { timeMs: d.timeMs, seen: d.seen });
  } else if (d.game === "omok") {
    const board = new Board(d.state.rule);
    board.g = d.state.g;
    board.moves = d.state.moves;
    result = aiMove(board, d.level, { timeMs: d.timeMs });
  }
  self.postMessage({ id: d.id, result });
};
