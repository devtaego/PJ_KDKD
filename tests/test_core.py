"""KI득KI득 핵심 규칙/도우미 자동 테스트

실행: python -m unittest discover -s tests -v
(화면을 띄우지 않고 규칙 엔진, 질문 카드, 같은 와이파이 메시지, 효과음 생성만 확인)
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for sub in ("hub", "chess", "omok", "yacht"):
    sys.path.insert(0, os.path.join(ROOT, sub))

import chess_game  # noqa: E402
import lan  # noqa: E402
import omok_game  # noqa: E402
import party  # noqa: E402
import sound  # noqa: E402
import yacht_game  # noqa: E402


def perft(pos, depth):
    if depth == 0:
        return 1
    return sum(perft(pos.make(m), depth - 1) for m in pos.legal_moves())


class ChessTest(unittest.TestCase):
    def test_perft_start(self):
        """시작 위치에서 가능한 수의 개수 (체스 엔진 검증의 표준 방법)."""
        pos = chess_game.Position()
        self.assertEqual(perft(pos, 1), 20)
        self.assertEqual(perft(pos, 2), 400)
        self.assertEqual(perft(pos, 3), 8902)

    def test_fools_mate(self):
        pos = chess_game.Position()
        for m in [(6, 5, 5, 5, None), (1, 4, 3, 4, None), (6, 6, 4, 6, None), (0, 3, 4, 7, None)]:
            self.assertIn(m, pos.legal_moves())
            pos = pos.make(m)
        self.assertTrue(pos.in_check(pos.turn))
        self.assertEqual(pos.legal_moves(), [])  # 체크메이트

    def test_ai_levels_return_legal_moves(self):
        pos = chess_game.Position()
        for level in ("easy", "normal", "hard"):
            self.assertIn(chess_game.best_move(pos, level=level), pos.legal_moves())


class OmokTest(unittest.TestCase):
    def test_five_wins_six_does_not(self):
        b = omok_game.Board("33")
        for c in range(4):
            b.g[7][c] = omok_game.BLACK
        self.assertTrue(b.five_at(7, 4, omok_game.BLACK))
        b.g[7][5] = omok_game.BLACK
        self.assertFalse(b.five_at(7, 4, omok_game.BLACK))  # 장목은 승리 아님

    def test_double_three_forbidden(self):
        b = omok_game.Board("33")
        for r, c in [(7, 5), (7, 6), (5, 7), (6, 7)]:
            b.g[r][c] = omok_game.BLACK
        self.assertTrue(b.forbidden(7, 7, omok_game.BLACK))
        free = omok_game.Board("free")
        free.g = [row[:] for row in b.g]
        self.assertFalse(free.forbidden(7, 7, omok_game.BLACK))

    def test_ai_blocks_four(self):
        b = omok_game.Board("free")
        for k, (r, c) in enumerate([(7, 3), (0, 0), (7, 4), (0, 2), (7, 5), (0, 4), (7, 6)]):
            b.place(r, c)
        move = omok_game.ai_move(b, "hard")
        self.assertIn(move, [(7, 2), (7, 7)])


class YachtTest(unittest.TestCase):
    def test_scores(self):
        s = yacht_game.score
        self.assertEqual(s("yacht", [6, 6, 6, 6, 6]), 50)
        self.assertEqual(s("full", [2, 2, 3, 3, 3]), 13)
        self.assertEqual(s("full", [2, 2, 2, 2, 2]), 0)
        self.assertEqual(s("lstraight", [2, 3, 4, 5, 6]), 30)
        self.assertEqual(s("sstraight", [1, 2, 3, 4, 6]), 15)
        self.assertEqual(s("four", [5, 5, 5, 5, 1]), 20)
        self.assertEqual(s("fives", [5, 5, 1, 2, 5]), 15)

    def test_ai_picks_open_category(self):
        g = yacht_game.YachtGame(["a", "b"])
        g.roll()
        for level in ("easy", "normal", "hard"):
            self.assertIn(yacht_game.ai_pick_category(g, level), yacht_game.CATEGORIES)


class PartyTest(unittest.TestCase):
    def test_question_is_same_on_both_pcs(self):
        """두 PC가 이름 순서를 다르게 넣어도 같은 질문이 나와야 함."""
        self.assertEqual(party.question_for("태고", "민수", 12), party.question_for("민수", "태고", 12))
        self.assertIn(party.question_for("a", "b", 1), party.QUESTIONS)


class LanTest(unittest.TestCase):
    def test_parse_room(self):
        msg = lan.parse(b'{"app": "kidk1", "kind": "room", "game": "chess", "host": "taego", "players": 1, '
                        b'"max": 2, "playing": false}', "192.168.0.5")
        self.assertEqual((msg["game"], msg["ip"], msg["players"]), ("chess", "192.168.0.5", 1))

    def test_parse_rejects_garbage(self):
        self.assertIsNone(lan.parse(b"not json", "1.2.3.4"))
        self.assertIsNone(lan.parse(b'{"app": "other", "kind": "room"}', "1.2.3.4"))
        self.assertIsNone(lan.parse(b'{"app": "kidk1", "kind": "who", "name": ""}', "1.2.3.4"))

    def test_parse_who_records(self):
        msg = lan.parse('{"app": "kidk1", "kind": "who", "name": "지수", "intro": "ENFP", '
                        '"records": {"chess": {"wins": 2, "games": 3}, "bad": "x"}}'.encode("utf-8"), "1.2.3.4")
        self.assertEqual(msg["records"], {"chess": {"wins": 2, "games": 3}})


class SoundTest(unittest.TestCase):
    def test_sounds_are_generated(self):
        for name in ("click", "pop", "place", "move", "shake", "roll", "thud", "win", "lose", "join"):
            path = sound._path(name)
            self.assertTrue(path and os.path.getsize(path) > 1000, name)


if __name__ == "__main__":
    unittest.main()
