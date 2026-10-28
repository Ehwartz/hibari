"""Build the portable release for the current OS.

    uv run python -m scripts.build_release [--no-archive] [--no-avatars] [--allow-no-weights]

Output in release/ (the interpreter and packages are copied from .venv; nothing is downloaded):

    Windows  Hibari-<v>-win64.zip            Hibari/Hibari.exe (scripts/release/Hibari.cs, compiled with csc)
    Linux    Hibari-<v>-linux-x86_64.tar.gz  Hibari/start.sh
    macOS    Hibari-<v>-macos-arm64.zip      Hibari/Hibari.app (the app folder is Contents/Resources/app;
                                             user data goes to ~/Library/Application Support/Hibari)

The app folder keeps the repo layout, so paths in the code stay valid:

    runtime/python/   standalone CPython 3.12 (the one .venv is based on) + .venv's site-packages
    backend/ scripts/ frontend/dist/  mjbot_mortal/ (libriichi for this OS, mortal.pth if present)
    LICENSE  使用说明.txt
    data/             only the AI avatars from this machine's data/ (seed for the first run)

Without mortal.pth (CI) pass --allow-no-weights; scripts/add_weights.py adds the weights (and the AI
avatars) to a downloaded package later.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "release"
NODE_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs"  # Windows: portable Node
CSC = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
PY = f"python{sys.version_info.major}.{sys.version_info.minor}"
# per OS: package suffix, libriichi target triple + extension
TARGETS = {
    "win32": ("win64", "x86_64-pc-windows-msvc", ".pyd"),
    "linux": ("linux-x86_64", "x86_64-unknown-linux-gnu", ".so"),
    "darwin": ("macos-arm64", "aarch64-apple-darwin", ".so"),
}
IS_WIN = sys.platform == "win32"
# venv-only files that must not land in the standalone interpreter
SKIP_SITE = {"_virtualenv.py", "_virtualenv.pth", "__pycache__"}
MAC_DATA = "$HOME/Library/Application Support/Hibari/data"
ICONS = ROOT / "scripts" / "release" / "icons"  # made by scripts/make_icons.py from frontend/public/logo


def step(msg: str) -> None:
    print(f"==> {msg}", flush=True)


def base_python() -> Path:
    """Install folder of the interpreter .venv was created from (uv-managed standalone CPython)."""
    cfg = (ROOT / ".venv" / "pyvenv.cfg").read_text(encoding="utf-8")
    home = Path(next(line.split("=", 1)[1].strip() for line in cfg.splitlines() if line.startswith("home"))).resolve()
    base = home if IS_WIN else home.parent  # posix: home is .../bin
    if not (base / ("python.exe" if IS_WIN else "bin/python3")).exists():
        raise SystemExit(f"base interpreter not found: {base}")
    if not IS_WIN and str(base).startswith("/usr"):
        raise SystemExit(f".venv uses the system Python ({base}); recreate it with UV_PYTHON_PREFERENCE=only-managed")
    return base


def site_packages(py_root: Path) -> Path:
    return py_root / "Lib" / "site-packages" if IS_WIN else py_root / "lib" / PY / "site-packages"


def build_frontend() -> None:
    env = {**os.environ, "PATH": f"{NODE_DIR}{os.pathsep}{os.environ.get('PATH', '')}"}
    npm = shutil.which("npm", path=env["PATH"])
    if not npm:
        raise SystemExit("npm not found (Node.js is needed to build the UI)")
    subprocess.run([npm, "run", "build"], cwd=ROOT / "frontend", env=env, check=True)


def copy_tree(src: Path, dst: Path, skip: set[str] = frozenset()) -> None:
    shutil.copytree(src, dst, symlinks=True, ignore=lambda d, names: [n for n in names if n in skip or n == "__pycache__"])


def _site_ignore(d: str, names: list[str]) -> list[str]:
    """Build-time-only files: C/C++ libraries for linking (torch alone has ~2.6 GB of .lib on Windows) and headers."""
    parent = Path(d).name
    return [
        n
        for n in names
        if n == "__pycache__" or n.lower().endswith((".lib", ".a")) or (parent == "torch" and n in ("include", "share"))
    ]


def write_text(path: Path, text: str) -> None:
    """Readme text: UTF-8 with BOM and CRLF on Windows (Notepad), plain UTF-8 elsewhere."""
    if IS_WIN:
        path.write_bytes(b"\xef\xbb\xbf" + text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
    else:
        path.write_text(text, encoding="utf-8")


def write_script(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")
    path.chmod(0o755)


AI_AVATARS = ("avatar_ai1", "avatar_ai2", "avatar_ai3")


def ai_avatar_files() -> tuple[dict[str, Path], dict[str, int]]:
    """This machine's AI-A/B/C avatars: {path in data/: file}, {asset name: version}."""
    sys.path.insert(0, str(ROOT))
    from backend import storage

    files, versions = {}, {}
    for name in AI_AVATARS:
        src = storage.asset_path(name)
        if src is not None:
            files[(Path("assets") / src.relative_to(storage.ASSET_DIR)).as_posix()] = src
            versions[name] = int(src.stat().st_mtime * 1000)
    return files, versions


def seed_ai_avatars(app: Path) -> None:
    """Ship the AI avatars set on this machine as the release's starting avatars.

    Only the images and their ``assets`` entries (data/settings.json) go in; every other setting
    (names, your avatar, folders …) stays at its default.
    """
    files, versions = ai_avatar_files()
    if not files:
        step("no AI avatars in data/assets — skipped")
        return
    for rel, src in files.items():
        dst = app / "data" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    (app / "data" / "settings.json").write_text(json.dumps({"assets": versions}, indent=2), encoding="utf-8")
    step(f"AI avatars: {', '.join(versions)}")


def mac_bundle(bundle: Path, version: str) -> Path:
    """Hibari.app skeleton; returns the app folder (Contents/Resources/app)."""
    contents = bundle / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    (contents / "Resources").mkdir()
    plist = {
        "CFBundleName": "Hibari",
        "CFBundleDisplayName": "雲雀 Hibari",
        "CFBundleIdentifier": "io.github.ehwartz.hibari",
        "CFBundleExecutable": "Hibari",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "LSMinimumSystemVersion": "11.0",
        "NSHighResolutionCapable": True,
        "CFBundleIconFile": "hibari",
    }
    import plistlib

    (contents / "Info.plist").write_bytes(plistlib.dumps(plist))
    shutil.copy2(ICONS / "hibari.icns", contents / "Resources" / "hibari.icns")
    write_script(
        contents / "MacOS" / "Hibari",
        f'''#!/bin/sh
# Hibari.app entry point: the app folder is read-only, user data lives in Application Support.
APP="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export HIBARI_DATA="{MAC_DATA}"
export PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
unset PYTHONPATH PYTHONHOME VIRTUAL_ENV
cd "$APP" && exec ./runtime/python/bin/python3 -m scripts.launch
''',
    )
    return contents / "Resources" / "app"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-archive", action="store_true", help="only build the folder in release/")
    ap.add_argument("--no-avatars", action="store_true", help="don't ship the AI avatars from data/assets")
    ap.add_argument("--allow-no-weights", action="store_true", help="build even if mjbot_mortal/mortal.pth is missing (CI)")
    ap.add_argument("--no-weights", action="store_true", help="leave the weights out even if present")
    args = ap.parse_args()

    if sys.platform not in TARGETS or (sys.platform == "darwin" and platform.machine() != "arm64"):
        raise SystemExit(f"unsupported build platform: {sys.platform} {platform.machine()}")
    suffix, triple, ext = TARGETS[sys.platform]
    version = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    weights = ROOT / "mjbot_mortal" / "mortal.pth"
    if not weights.exists() and not (args.allow_no_weights or args.no_weights):
        raise SystemExit(f"model weights missing: {weights} (use --allow-no-weights to build without them)")
    if IS_WIN and not CSC.exists():
        raise SystemExit(f"csc.exe not found: {CSC}")

    RELEASE.mkdir(exist_ok=True)
    top = RELEASE / "Hibari"  # the folder inside the archive
    if top.exists():
        step(f"removing old {top}")
        shutil.rmtree(top)
    app = mac_bundle(top / "Hibari.app", version) if sys.platform == "darwin" else top
    app.mkdir(parents=True, exist_ok=True)

    step("building the UI")
    build_frontend()

    step("copying the Python runtime")
    py = app / "runtime" / "python"
    copy_tree(base_python(), py)
    for marker in py.rglob("EXTERNALLY-MANAGED"):
        marker.unlink()
    step("copying packages (.venv site-packages)")
    site_src = site_packages(ROOT / ".venv")
    site_dst = site_packages(py)
    site_dst.mkdir(parents=True, exist_ok=True)
    for item in site_src.iterdir():
        if item.name in SKIP_SITE:
            continue
        if item.is_dir() and not item.is_symlink():
            shutil.copytree(item, site_dst / item.name, symlinks=True, ignore=_site_ignore)
        else:
            shutil.copy2(item, site_dst / item.name, follow_symlinks=False)

    step("copying the app")
    copy_tree(ROOT / "backend", app / "backend")
    (app / "scripts").mkdir()
    for name in ("__init__.py", "launch.py"):
        shutil.copy2(ROOT / "scripts" / name, app / "scripts" / name)
    copy_tree(ROOT / "frontend" / "dist", app / "frontend" / "dist")
    bot = app / "mjbot_mortal"
    (bot / "libriichi").mkdir(parents=True)
    for name in ("_libriichi_loader.py", "bot.py", "model.py", "meta_show.py", "ot_settings.json", "LICENSE", "README.md"):
        shutil.copy2(ROOT / "mjbot_mortal" / name, bot / name)
    lib = f"libriichi-{sys.version_info.major}.{sys.version_info.minor}-{triple}{ext}"
    shutil.copy2(ROOT / "mjbot_mortal" / "libriichi" / lib, bot / "libriichi" / lib)
    if weights.exists() and not args.no_weights:
        shutil.copy2(weights, bot / "mortal.pth")
    else:
        step("no mortal.pth — package built without weights (add them with scripts/add_weights.py)")
    shutil.copy2(ROOT / "LICENSE", app / "LICENSE")
    readme = (ROOT / "scripts" / "release" / "使用说明.txt").read_text(encoding="utf-8").replace("{version}", version)
    write_text(top / "使用说明.txt", readme)

    if not args.no_avatars:
        seed_ai_avatars(app)

    if IS_WIN:
        step("compiling Hibari.exe")
        subprocess.run(
            [str(CSC), "/nologo", "/target:winexe", "/optimize+", f"/out:{app / 'Hibari.exe'}",
             f"/win32icon:{ICONS / 'hibari.ico'}", "/r:System.Windows.Forms.dll", str(ROOT / "scripts" / "release" / "Hibari.cs")],
            check=True,
        )
    elif sys.platform == "linux":
        shutil.copy2(ICONS / "hibari-256.png", app / "hibari.png")  # for a desktop shortcut
        write_script(
            app / "start.sh",
            '''#!/bin/sh
# Hibari: starts the backend and opens the app window. Logs: data/launcher.log, data/server.log
cd "$(dirname "$0")" || exit 1
export PYTHONNOUSERSITE=1
unset PYTHONPATH PYTHONHOME VIRTUAL_ENV
exec ./runtime/python/bin/python3 -m scripts.launch
''',
        )

    step("checking the bundled interpreter")
    python = py / ("python.exe" if IS_WIN else "bin/python3")
    subprocess.run(
        [str(python), "-I", "-c",
         "import sys, torch, fastapi, uvicorn, mahjong, numpy; assert sys.prefix.startswith(sys.argv[1]); "
         "print('ok', sys.version.split()[0], torch.__version__)",
         str(py)],
        check=True, cwd=app,
    )

    if args.no_archive:
        return
    if sys.platform == "linux":
        archive = RELEASE / f"Hibari-{version}-{suffix}.tar.gz"
        step(f"packing {archive.name}")
        with tarfile.open(archive, "w:gz", compresslevel=6) as tar:
            tar.add(top, arcname=top.name)
    elif sys.platform == "darwin":
        archive = RELEASE / f"Hibari-{version}-{suffix}.zip"
        step(f"packing {archive.name}")
        archive.unlink(missing_ok=True)
        # ditto keeps permissions, symlinks and the bundle structure (Finder's own zip format)
        subprocess.run(["ditto", "-c", "-k", "--norsrc", "--noextattr", "--keepParent", str(top), str(archive)], check=True)
    else:
        archive = RELEASE / f"Hibari-{version}-{suffix}.zip"
        step(f"packing {archive.name}")
        archive.unlink(missing_ok=True)
        files = sorted(p for p in top.rglob("*") if p.is_file())
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for i, f in enumerate(files):
                z.write(f, Path(top.name) / f.relative_to(top))
                if i % 2000 == 0:
                    print(f"   {i}/{len(files)}", flush=True)
    size = sum(f.stat().st_size for f in top.rglob("*") if f.is_file() and not f.is_symlink())
    print(f"done: {archive} ({archive.stat().st_size / 2**20:.0f} MB packed, {size / 2**20:.0f} MB unpacked)")


if __name__ == "__main__":
    sys.exit(main())
