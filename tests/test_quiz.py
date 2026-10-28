import random

from backend.analysis.quiz import hand_waits, score_question, wait_question
from backend.engine.tiles import to_34


def test_hand_waits_known_shapes():
    nine_gates = [f"{n}m" for n in (1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9)]
    assert hand_waits(nine_gates) == [f"{n}m" for n in range(1, 10)]
    assert hand_waits(["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "E", "E", "C"]) == ["C"]
    # all four 4p held: 4p is not a wait (no karaten)
    assert "4p" not in hand_waits(["4p", "4p", "4p", "4p", "5p", "6p", "7p", "8p", "9p", "1s", "1s", "2s", "3s"])


def test_wait_questions_are_tenpai():
    rng = random.Random(3)
    for mode in ("mixed", "chinitsu"):
        for _ in range(100):
            q = wait_question(rng, mode)
            assert len(q["hand"]) == 13 and q["waits"]
            assert max(to_34(q["hand"])) <= 4
            if mode == "chinitsu":
                assert len({t[1] for t in q["hand"]}) == 1


def test_score_questions_are_consistent():
    rng = random.Random(5)
    for _ in range(500):
        q = score_question(rng)
        a = q["answer"]
        tiles = q["hand"] + [q["win"]] + [t for m in q["melds"] for t in m["tiles"]]
        assert len(q["hand"]) + 1 + 3 * len(q["melds"]) == 14
        assert max(to_34(tiles)) <= 4
        assert 1 <= a["han"] < 13 and sum(h for _, h in a["yaku"]) == a["han"]
        if q["riichi"]:
            assert not q["melds"] and ("Riichi", 1) in [tuple(y) for y in a["yaku"]]
        pay = a["pay"]
        if not q["tsumo"]:
            assert a["total"] == pay["ron"]
        elif q["oya"]:
            assert a["total"] == pay["all"] * 3
        else:
            assert a["total"] == pay["ko"] * 2 + pay["oya"]
