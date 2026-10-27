"""Scoring: cross-check against libriichi arena logs + hand-made cases."""
from pathlib import Path

import pytest

from backend.engine.replay import check_log, read_log, replay
from backend.engine.scoring import HoraResult, evaluate_hora, exhaustive_draw_deltas
from backend.engine.state import Discard, KyokuState
from backend.engine.tiles import dora_kind, kind, to_136

ARENA_LOGS = sorted((Path(__file__).parent / "fixtures" / "arena").glob("*.json.gz"))


@pytest.mark.parametrize("path", ARENA_LOGS, ids=lambda p: p.name)
def test_matches_arena_deltas(path):
    assert check_log(read_log(path)) == []


def test_arena_fixtures_cover_double_ron():
    horas = 0
    for path in ARENA_LOGS:
        events = read_log(path)
        horas += sum(e["type"] == "hora" for e in events)
        if any(a["type"] == b["type"] == "hora" for a, b in zip(events, events[1:])):
            break
    else:
        pytest.fail("no double ron in fixtures")
    assert horas > 0


def test_tiles():
    assert kind("5mr") == kind("5m") == 4
    assert dora_kind("9m") == kind("1m")
    assert dora_kind("N") == kind("E")
    assert dora_kind("C") == kind("P")
    assert to_136(["5mr", "5m", "5m", "5m"]) == [16, 17, 18, 19]
    assert to_136(["1m", "1m"]) == [0, 1]


def _start(tehais, oya=0, dora="1s", honba=0, kyotaku=0):
    return {
        "type": "start_kyoku", "bakaze": "E", "dora_marker": dora, "kyoku": oya + 1,
        "honba": honba, "kyotaku": kyotaku, "oya": oya,
        "scores": [25000] * 4, "tehais": tehais,
    }


JUNK = ["1p", "2p", "3p", "4p", "6p", "7p", "8p", "4s", "6s", "7s", "8s", "9s", "N"]


def _discard(st, actor, pai):
    st.apply({"type": "tsumo", "actor": actor, "pai": pai})
    st.apply({"type": "dahai", "actor": actor, "pai": pai, "tsumogiri": True})


def test_pao_daisangen_tsumo_liable_pays_all():
    st = KyokuState(_start([JUNK, ["P", "P", "F", "F", "C", "C", "1m", "2m", "3m", "9p", "E", "S", "W"], JUNK, JUNK]))
    for target, dragon, junk in [(0, "P", "E"), (2, "F", "S"), (3, "C", "W")]:
        _discard(st, target, dragon)
        st.apply({"type": "pon", "actor": 1, "target": target, "pai": dragon, "consumed": [dragon, dragon]})
        st.apply({"type": "dahai", "actor": 1, "pai": junk, "tsumogiri": False})
    assert st.seats[1].pao == (3, "Daisangen")
    st.apply({"type": "tsumo", "actor": 1, "pai": "9p"})
    h = evaluate_hora(st, 1, 1, [])
    assert h.yakuman == 1
    assert h.deltas == [0, 32000, 0, -32000]


def test_double_riichi_ippatsu_tsumo_with_ura():
    hand = ["2m", "3m", "4m", "6m", "7m", "8m", "3p", "4p", "5p", "6s", "7s", "9s", "9s"]
    st = KyokuState(_start([hand, JUNK, JUNK, JUNK], oya=1, honba=1, kyotaku=1))
    st.apply({"type": "tsumo", "actor": 0, "pai": "1m"})
    st.apply({"type": "reach", "actor": 0})
    st.apply({"type": "dahai", "actor": 0, "pai": "1m", "tsumogiri": True})
    st.apply({"type": "reach_accepted", "actor": 0})
    for s in (1, 2, 3):
        _discard(st, s, "N" if s != 2 else "1p")
    st.apply({"type": "tsumo", "actor": 0, "pai": "8s"})
    h = evaluate_hora(st, 0, 0, ["8s"])  # ura indicator 8s -> 9s pair = 2 ura
    names = [y[0] for y in h.yaku]
    # riichi on the first discard is a double riichi
    assert {"Double Riichi", "Ippatsu", "Menzen Tsumo", "Pinfu", "Ura Dora"} <= set(names)
    # double riichi 2 + ippatsu + tsumo + pinfu + ura 2 = 7 han -> haneman, 3000/6000
    assert h.han == 7
    assert h.deltas == [12000 + 300 + 2000, -6000 - 100, -3000 - 100, -3000 - 100]


def test_tenpai_payments_and_nagashi():
    tenpai_hand = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "1p", "2p", "3p"]
    st = KyokuState(_start([tenpai_hand, JUNK, JUNK, JUNK]))
    deltas, tenpai, nagashi = exhaustive_draw_deltas(st)
    assert tenpai == [True, False, False, False] and not nagashi
    assert deltas == [3000, -1000, -1000, -1000]

    st.seats[2].river = [Discard("1m", False), Discard("N", False), Discard("9s", True)]
    st.seats[1].river = [Discard("1m", False), Discard("5p", False)]
    deltas, _, nagashi = exhaustive_draw_deltas(st)
    assert nagashi == [2]
    assert deltas == [-4000, -2000, 8000, -2000]
