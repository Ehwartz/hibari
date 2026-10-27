"""Discard rules libriichi doesn't enforce: riichi tsumogiri, tenpai riichi discard, kuikae."""
from backend.engine.legality import discard_error, kuikae_kinds
from backend.engine.state import KyokuState

TENPAI = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "1p", "2p", "3p"]  # waits 1p/4p
JUNK = ["1s", "2s", "3s", "4s", "6s", "7s", "8s", "9s", "N", "N", "W", "W", "E"]


def _state(hand):
    return KyokuState({
        "type": "start_kyoku", "bakaze": "E", "dora_marker": "1s", "kyoku": 1, "honba": 0, "kyotaku": 0,
        "oya": 0, "scores": [25000] * 4, "tehais": [hand, JUNK, JUNK, JUNK],
    })


def _dahai(pai, tsumogiri=False):
    return {"type": "dahai", "actor": 0, "pai": pai, "tsumogiri": tsumogiri}


def test_after_riichi_only_tsumogiri():
    st = _state(TENPAI)
    for ev in ({"type": "tsumo", "actor": 0, "pai": "S"}, {"type": "reach", "actor": 0}):
        st.apply(ev)
    st.apply(_dahai("S"))
    st.apply({"type": "reach_accepted", "actor": 0})
    draw = {"type": "tsumo", "actor": 0, "pai": "C"}
    st.apply(draw)
    assert discard_error(st, 0, _dahai("C", True), draw) is None
    assert discard_error(st, 0, _dahai("C", False), draw)
    assert discard_error(st, 0, _dahai("1m"), draw)


def test_riichi_discard_must_keep_tenpai():
    st = _state(TENPAI)
    st.apply({"type": "tsumo", "actor": 0, "pai": "S"})
    reach = {"type": "reach", "actor": 0}
    st.apply(reach)
    assert discard_error(st, 0, _dahai("S"), reach) is None
    assert discard_error(st, 0, _dahai("5m"), reach)


def test_tsumogiri_flag_must_match_drawn_tile():
    st = _state(TENPAI)
    draw = {"type": "tsumo", "actor": 0, "pai": "S"}
    st.apply(draw)
    assert discard_error(st, 0, _dahai("1m", True), draw)


def test_kuikae():
    assert kuikae_kinds({"type": "pon", "pai": "5p", "consumed": ["5p", "5p"]}) == {13}
    # chi 3m with 4m5m: no 3m, no 6m
    assert kuikae_kinds({"type": "chi", "pai": "3m", "consumed": ["4m", "5m"]}) == {2, 5}
    # chi 6m with 4m5m: no 6m, no 3m
    assert kuikae_kinds({"type": "chi", "pai": "6m", "consumed": ["4m", "5m"]}) == {5, 2}
    # kanchan chi: only the called tile
    assert kuikae_kinds({"type": "chi", "pai": "5m", "consumed": ["4m", "6m"]}) == {4}
    # 7m with 8m9m: 10m doesn't exist
    assert kuikae_kinds({"type": "chi", "pai": "7m", "consumed": ["8m", "9m"]}) == {6}

    st = _state(["4m", "5m", "6m", "6m", *TENPAI[8:]])
    st.apply({"type": "tsumo", "actor": 1, "pai": "3m"})
    st.apply({"type": "dahai", "actor": 1, "pai": "3m", "tsumogiri": True})
    chi = {"type": "chi", "actor": 0, "target": 1, "pai": "3m", "consumed": ["4m", "5m"]}
    st.apply(chi)
    assert discard_error(st, 0, _dahai("6m"), chi)
    assert discard_error(st, 0, _dahai("9m"), chi) is None
