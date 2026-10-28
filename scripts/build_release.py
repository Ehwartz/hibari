"""Build the portable Windows release: release/Hibari-<version>-win64.zip.

    python -m uv run python -m scripts.build_release [--no-zip]

Layout (the app keeps the repo layout, so paths in the code stay valid):

    Hibari/
      Hibari.exe            launcher (scripts/release/Hibari.cs, compiled with Windows' csc.exe)
      runtime/python/       standalone CPython 3.12 (the one .venv is based on) + .venv's site-packages
      backend/  scripts/    app sources
      frontend/dist/        prebuilt UI (no Node needed)
      mjbot_mortal/         model.py & co, libriichi for py3.12 win64, mortal.pth
      LICENSE  使用说明.txt
      data/                 created on first run (logs, settings); the release only seeds the
                            AI avatars from your local data/ (skip with --no-avatars)

Nothing is downloaded: the interpreter and packages are the ones the tests ran with.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "release"
NODE_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs"
CSC = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
LIBRIICHI = "libriichi-3.12-x86_64-pc-windows-msvc.pyd"
# venv-only files that must not land in the standalone interpreter
SKIP_SITE = {"_virtualenv.py", "_virtualenv.pth", "__pycache__"}


def step(msg: str) -> None:
    print(f"==> {msg}", flush=True)


def base_python() -> Path:
    """Home of the interpreter .venv was created from (uv-managed standalone CPython)."""
    cfg = (ROOT / ".venv" / "pyvenv.cfg").read_text(encoding="utf-8")
    home = next(line.split("=", 1)[1].strip() for line in cfg.splitlines() if line.startswith("home"))
    home_path = Path(home).resolve()
    if not (home_path / "python.exe").exists():
        raise SystemExit(f"base interpreter not found: {home_path}")
    return home_path


def build_frontend() -> None:
    env = {**os.environ, "PATH": f"{NODE_DIR}{os.pathsep}{os.environ.get('PATH', '')}"}
    npm = shutil.which("npm", path=env["PATH"])
    if not npm:
        raise SystemExit("npm not found (Node.js is needed to build the UI)")
    subprocess.run([npm, "run", "build"], cwd=ROOT / "frontend", env=env, check=True)


def copy_tree(src: Path, dst: Path, skip: set[str] = frozenset()) -> None:
    shutil.copytree(src, dst, ignore=lambda d, names: [n for n in names if n in skip or n == "__pycache__"])


def _site_ignore(d: str, names: list[str]) -> list[str]:
    """Build-time-only files: C/C++ import & static libraries (torch alone has ~2.6 GB of .lib) and headers."""
    parent = Path(d).name
    return [
        n
        for n in names
        if n == "__pycache__" or n.lower().endswith(".lib") or (parent == "torch" and n in ("include", "share"))
    ]


def write_text(path: Path, text: str) -> None:
    """Text for Notepad: UTF-8 with BOM, CRLF."""
    path.write_bytes(b"\xef\xbb\xbf" + text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))


AI_AVATARS = ("avatar_ai1", "avatar_ai2", "avatar_ai3")


def seed_ai_avatars(out: Path) -> None:
    """Ship the AI-A/B/C avatars set in this machine's data/ as the release's starting avatars.

    Only the images and their ``assets`` entries go into data/settings.json; every other setting
    (names, your avatar, folders …) stays at its default.
    """
    sys.path.insert(0, str(ROOT))
    from backend import storage

    assets = {}
    for name in AI_AVATARS:
        src = storage.asset_path(name)
        if src is None:
            continue
        dst = out / "data" / "assets" / src.relative_to(storage.ASSET_DIR)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        assets[name] = int(src.stat().st_mtime * 1000)
    if not assets:
        step("no AI avatars in data/assets — skipped")
        return
    (out / "data" / "settings.json").write_text(json.dumps({"assets": assets}, indent=2), encoding="utf-8")
    step(f"AI avatars: {', '.join(assets)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-zip", action="store_true", help="only build release/Hibari/")
    ap.add_argument("--no-avatars", action="store_true", help="don't ship the AI avatars from data/assets")
    args = ap.parse_args()
    if sys.platform != "win32":
        raise SystemExit("build_release builds the Windows package and must run on Windows. "
                         "On macOS / Linux, run from source with ./start.sh (see README).")

    version = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    weights = ROOT / "mjbot_mortal" / "mortal.pth"
    if not weights.exists():
        raise SystemExit(f"model weights missing: {weights}")
    if not CSC.exists():
        raise SystemExit(f"csc.exe not found: {CSC}")

    out = RELEASE / "Hibari"
    if out.exists():
        step(f"removing old {out}")
        shutil.rmtree(out)
    out.mkdir(parents=True)

    step("building the UI")
    build_frontend()

    step("copying the Python runtime")
    py = out / "runtime" / "python"
    copy_tree(base_python(), py)
    (py / "EXTERNALLY-MANAGED").unlink(missing_ok=True)
    (py / "Lib" / "EXTERNALLY-MANAGED").unlink(missing_ok=True)
    step("copying packages (.venv site-packages)")
    site_src = ROOT / ".venv" / "Lib" / "site-packages"
    site_dst = py / "Lib" / "site-packages"
    site_dst.mkdir(parents=True, exist_ok=True)
    for item in site_src.iterdir():
        if item.name in SKIP_SITE:
            continue
        if item.is_dir():
            shutil.copytree(item, site_dst / item.name, ignore=_site_ignore)
        else:
            shutil.copy2(item, site_dst / item.name)

    step("copying the app")
    copy_tree(ROOT / "backend", out / "backend")
    (out / "scripts").mkdir()
    for name in ("__init__.py", "launch.py"):
        shutil.copy2(ROOT / "scripts" / name, out / "scripts" / name)
    copy_tree(ROOT / "frontend" / "dist", out / "frontend" / "dist")
    bot = out / "mjbot_mortal"
    (bot / "libriichi").mkdir(parents=True)
    for name in ("_libriichi_loader.py", "bot.py", "model.py", "meta_show.py", "ot_settings.json", "LICENSE", "README.md"):
        shutil.copy2(ROOT / "mjbot_mortal" / name, bot / name)
    shutil.copy2(ROOT / "mjbot_mortal" / "libriichi" / LIBRIICHI, bot / "libriichi" / LIBRIICHI)
    shutil.copy2(weights, bot / "mortal.pth")
    shutil.copy2(ROOT / "mjbot_mortal" / "LICENSE", out / "LICENSE")  # AGPL-3.0 (see 使用说明)
    write_text(out / "使用说明.txt", (ROOT / "scripts" / "release" / "使用说明.txt").read_text(encoding="utf-8").replace("{version}", version))

    if not args.no_avatars:
        seed_ai_avatars(out)

    step("compiling Hibari.exe")
    subprocess.run(
        [str(CSC), "/nologo", "/target:winexe", "/optimize+", f"/out:{out / 'Hibari.exe'}",
         "/r:System.Windows.Forms.dll", str(ROOT / "scripts" / "release" / "Hibari.cs")],
        check=True,
    )

    step("checking the bundled interpreter")
    subprocess.run(
        [str(py / "python.exe"), "-I", "-c",
         "import sys, torch, fastapi, uvicorn, mahjong, numpy; assert sys.prefix.startswith(sys.argv[1]); print('ok', sys.version.split()[0], torch.__version__)",
         str(py)],
        check=True, cwd=out,
    )

    if args.no_zip:
        return
    zip_path = RELEASE / f"Hibari-{version}-win64.zip"
    step(f"zipping {zip_path.name}")
    zip_path.unlink(missing_ok=True)
    files = sorted(p for p in out.rglob("*") if p.is_file())
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for i, f in enumerate(files):
            z.write(f, Path("Hibari") / f.relative_to(out))
            if i % 2000 == 0:
                print(f"   {i}/{len(files)}", flush=True)
    size = sum(f.stat().st_size for f in files)
    print(f"done: {zip_path} ({zip_path.stat().st_size / 2**20:.0f} MB zipped, {size / 2**20:.0f} MB unpacked)")


if __name__ == "__main__":
    sys.exit(main())
