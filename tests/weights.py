"""Marker for tests that run the Mortal network (CI has no weights; they are not in the repo)."""
import os

import pytest

from backend import mortal

HAS_WEIGHTS = (mortal.MORTAL_DIR / "mortal.pth").exists() and not os.environ.get("HIBARI_NO_WEIGHTS")
requires_weights = pytest.mark.skipif(not HAS_WEIGHTS, reason="Mortal weights (mjbot_mortal/mortal.pth) not present")
