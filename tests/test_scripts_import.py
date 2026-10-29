"""The launcher and release scripts must at least import (a syntax error there only shows in a package)."""
import importlib

import pytest


@pytest.mark.parametrize("name", ["scripts.launch", "scripts.build_release", "scripts.add_weights", "scripts.smoke_release", "scripts.updater"])
def test_script_imports(name):
    importlib.import_module(name)
