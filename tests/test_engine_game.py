"""Full games through the engine (libriichi PlayerState as referee)."""
import pytest

from backend.agents.mortal_agent import MortalAgent
from tests.weights import requires_weights
from backend.agents.simple_agent import SimpleAgent
from backend.engine.driver import run_game
from backend.engine.game import Game, IllegalAction, mask_event
from backend.engine.replay import check_log
from backend.engine.rules import Rules


def _simple_game(seed, rules=None):
    return run_game(Game(rules, seed=seed), [SimpleAgent(i, seed=seed * 4 + i) for i in range(4)])


def _assert_finished(game):
    rules = game.rules
    assert sum(game.scores) == 4 * rules.start_points
    assert sorted(game.ranks) == [1, 2, 3, 4]
    assert game.log[0]["type"] == "start_game" and game.log[-1]["type"] == "end_game"
    last = game.results[-1]
    round_idx = "ESW".index(last.bakaze) * 4 + last.kyoku - 1
    assert min(game.scores) < 0 or round_idx >= rules.last_round
    assert check_log(game.log) == []


@pytest.mark.parametrize("seed", range(20))
def test_simple_agents_hanchan(seed):
    _assert_finished(_simple_game(seed))


def _kyokus(log):
    cur = []
    for ev in log:
        if ev["type"] == "start_kyoku":
            cur = []
        cur.append(ev)
        if ev["type"] == "end_kyoku":
            yield cur


@pytest.mark.parametrize("seed", range(10))
def test_kan_dora_timing(seed):
    """Minkan dora flips right before the next discard / ankan, never before rinshan kaihou."""
    agents = [SimpleAgent(i, seed=seed * 4 + i, call_rate=0.8, kan_rate=1.0) for i in range(4)]
    game = run_game(Game(seed=seed), agents)
    _assert_finished(game)
    for evs in _kyokus(game.log):
        kans = doras = 0
        for i, ev in enumerate(evs):
            t = ev["type"]
            kans += t in ("ankan", "kakan", "daiminkan")
            doras += t == "dora"
            if t == "hora" and ev["actor"] == ev["target"]:
                assert evs[i - 1]["type"] == "tsumo"
            if t == "ankan":
                assert evs[i + 1]["type"] == "dora"
            if t == "tsumo" and evs[i - 1]["type"] in ("daiminkan", "kakan"):
                nxt = evs[i + 1]
                if nxt["type"] == "dahai" or nxt["type"] == "reach" and evs[i + 2]["type"] == "dahai":
                    pytest.fail(f"no dora before discard after minkan: {evs[i - 1:i + 3]}")
            if t == "dora" and evs[i + 1]["type"] in ("dahai", "ankan"):
                assert any(e["type"] in ("daiminkan", "kakan") for e in evs[:i])
        # every kan flips exactly one dora, except a minkan / kakan still pending at the end
        assert kans - 1 <= doras <= kans


def test_tonpuu():
    game = _simple_game(1, Rules(length="tonpuu"))
    _assert_finished(game)
    assert len(game.results) < len(_simple_game(1).results)


def test_deterministic_with_seed():
    assert _simple_game(5).log == _simple_game(5).log


def test_masking():
    ev = {"type": "tsumo", "actor": 1, "pai": "5mr"}
    assert mask_event(ev, 0)["pai"] == "?"
    assert mask_event(ev, 1)["pai"] == "5mr"
    start = {"type": "start_kyoku", "tehais": [["1m"] * 13, ["2m"] * 13, ["3m"] * 13, ["4m"] * 13]}
    assert mask_event(start, 2)["tehais"] == [["?"] * 13, ["?"] * 13, ["3m"] * 13, ["?"] * 13]


def test_illegal_action_rejected():
    game = Game(seed=3)
    gen = game.play()
    prompt = next(gen)
    while not prompt.need:
        prompt = gen.send({})
    seat = next(iter(prompt.need))
    hand = game.state.seats[seat].hand
    missing = next(t for t in ["1m", "9m", "1p", "9p", "E", "S", "C"] if t not in hand)
    with pytest.raises(IllegalAction):
        gen.send({seat: {"type": "dahai", "actor": seat, "pai": missing, "tsumogiri": False}})


@pytest.mark.parametrize(
    "scores, round_idx, renchan, expected",
    [
        ([40000, 30000, 20000, 10000], 6, False, False),  # not all-last yet
        ([40000, 30000, 20000, 10000], 7, False, True),  # all-last, someone >= 30000
        ([28000, 26000, 24000, 22000], 7, False, False),  # nobody >= 30000 -> West
        ([28000, 26000, 24000, 22000], 11, False, True),  # West 4 is the hard limit
        ([20000, 20000, 20000, 40000], 7, True, True),  # dealer (seat 3) top -> agari-yame
        ([40000, 20000, 20000, 20000], 7, True, False),  # dealer renchan but not top
        ([50000, 30000, 21000, -1000], 2, False, True),  # tobi
    ],
)
def test_game_end_conditions(scores, round_idx, renchan, expected):
    game = Game()
    game.scores = scores
    assert game._is_over(round_idx, renchan, "hora", round_idx % 4) is expected


@requires_weights
def test_mortal_tonpuu():
    game = run_game(Game(Rules(length="tonpuu"), seed=0), [MortalAgent(i) for i in range(4)])
    _assert_finished(game)


class _NoActorAgent(SimpleAgent):
    """Replies without the "actor" field (like Mortal's bare {"type": "ryukyoku"})."""

    def react(self, event):
        out = super().react(event)
        if out:
            out = {k: v for k, v in out.items() if k != "actor"}
        return out


def test_actions_without_actor_are_accepted():
    # seed 8: includes a kyuushu kyuuhai declared as a bare {"type": "ryukyoku"}
    game = run_game(Game(seed=8), [_NoActorAgent(i, seed=8 * 4 + i) for i in range(4)])
    _assert_finished(game)
    assert any(r.reason == "kyuushu_kyuuhai" for r in game.results)
    assert all("actor" in e for e in game.log if e["type"] in ("dahai", "pon", "chi", "reach", "hora"))
