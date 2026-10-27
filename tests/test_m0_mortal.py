"""M0: Mortal loads in-process and answers mjai events."""
from backend import mortal
from backend.agents.mortal_agent import MortalAgent

START_KYOKU = {
    "type": "start_kyoku", "bakaze": "E", "dora_marker": "1p",
    "kyoku": 1, "honba": 0, "kyotaku": 0, "oya": 0,
    "scores": [25000, 25000, 25000, 25000],
    "tehais": [
        ["4p", "4s", "P", "3p", "1p", "5s", "2m", "F", "1m", "7s", "9m", "6m", "9s"],
        ["?"] * 13, ["?"] * 13, ["?"] * 13,
    ],
}


def test_online_disabled():
    mortal.load_bot(0)
    assert mortal._model_module().ot_settings["online"] is False


def test_bot_discards_after_tsumo():
    agent = MortalAgent(0)
    assert agent.react({"type": "start_game", "names": ["me", "a", "b", "c"], "id": 0}) is None
    assert agent.react(START_KYOKU) is None
    action = agent.react({"type": "tsumo", "actor": 0, "pai": "3s"})
    assert action["type"] == "dahai"
    assert action["actor"] == 0
    assert "q_values" in action["meta"] and "mask_bits" in action["meta"]


def test_player_state_tracks_hand():
    ps = mortal.new_player_state(0)
    ps.update('{"type":"start_game","names":["me","a","b","c"],"id":0}')
    ps.update(__import__("json").dumps(START_KYOKU))
    cans = ps.update('{"type":"tsumo","actor":0,"pai":"3s"}')
    assert cans.can_discard and not cans.can_pon
    assert sum(ps.tehai) == 14
    assert ps.shanten >= 0
