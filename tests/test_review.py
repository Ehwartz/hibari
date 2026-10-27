"""Mortal review of a saved game."""
from backend.agents.mortal_agent import MortalAgent
from backend.agents.simple_agent import SimpleAgent
from backend.analysis.review import action_label, actual_action, review_game
from backend.engine.driver import run_game
from backend.engine.game import Game
from backend.engine.rules import Rules


def test_action_labels():
    assert action_label({"type": "dahai", "pai": "5mr"}) == "5mr"
    assert action_label({"type": "chi", "pai": "3m", "consumed": ["4m", "5m"]}) == "chi_low"
    assert action_label({"type": "chi", "pai": "4m", "consumed": ["3m", "5m"]}) == "chi_mid"
    assert action_label({"type": "chi", "pai": "5m", "consumed": ["3m", "4m"]}) == "chi_high"
    assert action_label({"type": "kakan", "pai": "P", "consumed": ["P", "P", "P"]}) == "kan_select"


def test_actual_action_skips_dora_and_others_hora():
    evs = [
        {"type": "dahai", "actor": 1, "pai": "1m"},
        {"type": "hora", "actor": 0, "target": 1},
        {"type": "hora", "actor": 2, "target": 1},
    ]
    assert actual_action(evs, 0, 2)["type"] == "hora"
    assert actual_action(evs, 0, 3) == {"type": "none"}
    evs = [{"type": "tsumo", "actor": 2, "pai": "C"}, {"type": "dora", "dora_marker": "1s"}, {"type": "dahai", "actor": 2, "pai": "C"}]
    assert actual_action(evs, 0, 2)["pai"] == "C"


def test_review_of_a_mortal_seat_agrees_with_itself():
    """Seat 2 played by greedy Mortal: the review must agree 100% (same model, same state)."""
    agents = [SimpleAgent(0, seed=1), SimpleAgent(1, seed=2), MortalAgent(2), SimpleAgent(3, seed=3)]
    game = run_game(Game(Rules(length="tonpuu"), seed=5, meta={"human": 2}), agents)
    review = review_game(game.log)
    s = review["summary"]
    assert review["human"] == 2 and s["decisions"] > 30
    assert s["matches"] == s["decisions"] and s["bad"] == 0
    d = next(d for d in review["decisions"] if d["discard"])
    assert abs(sum(d["probs"].values()) - 1) < 1e-3 and d["actual"] in d["probs"]
