from backend.analysis.ukeire import analyze

NONE = [0] * 34


def test_tenpai_waits_and_remaining_counts():
    # 123m 456m 789m 11p 23p: waits 1p / 4p
    hand = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "1p", "2p", "3p"]
    out = analyze(hand, NONE)
    (opt,) = out["options"]
    assert not out["discard"] and opt["shanten"] == 0
    assert {t["tile"]: t["left"] for t in opt["tiles"]} == {"1p": 2, "4p": 4}
    seen = NONE.copy()
    seen[12] = 3  # three 4p visible (rivers / melds / dora indicators)
    (opt,) = analyze(hand, seen)["options"]
    assert {t["tile"]: t["left"] for t in opt["tiles"]} == {"1p": 2, "4p": 1} and opt["total"] == 3


def test_discard_options_sorted_best_first():
    # 14 tiles: discarding the lone north keeps tenpai on 1p/4p
    hand = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "1p", "2p", "3p", "N"]
    out = analyze(hand, NONE)
    assert out["discard"]
    best = out["options"][0]
    assert best["discard"] == "N" and best["shanten"] == 0 and best["total"] == 6
    assert len(out["options"]) == len(set(hand))  # one option per kind
    assert all(a["shanten"] <= b["shanten"] for a, b in zip(out["options"], out["options"][1:]))


def test_red_five_counts_as_its_kind():
    hand = ["5m", "5mr", "1p", "2p", "3p", "4s", "5s", "6s", "7s", "8s", "9s", "E", "E", "S"]
    out = analyze(hand, NONE)
    fives = [o for o in out["options"] if o["discard"] in ("5m", "5mr")]
    assert [o["discard"] for o in fives] == ["5m"]  # one row, the plain five shown


def test_open_hand():
    # 7 tiles left after two calls: 11p 234s 56m -> tenpai on 4m/7m
    (opt,) = analyze(["1p", "1p", "2s", "3s", "4s", "5m", "6m"], NONE)["options"]
    assert opt["shanten"] == 0 and {t["tile"] for t in opt["tiles"]} == {"4m", "7m"}
