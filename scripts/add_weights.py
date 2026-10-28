"""Add the private files to a release package built without them: the Mortal weights, the preset
avatars next to them (mjbot_mortal/*avatars) and this machine's AI avatars (data/assets).

    uv run python -m scripts.add_weights release/Hibari-0.1.0-macos-arm64.zip [--weights PATH] [--no-avatars]

Works on any OS for all three package kinds (CI artifacts are built without weights, since the
weights are not in the repository). Writes release/full/<same name>; the input is left untouched.
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_release import ai_avatar_files, preset_dirs  # noqa: E402


def app_prefix(names: list[str]) -> str:
    """Path of the app folder inside the archive ("Hibari/" or "Hibari/Hibari.app/Contents/Resources/app/")."""
    marker = "mjbot_mortal/model.py"
    hits = [n[: -len(marker)] for n in names if n.endswith(marker)]
    if len(hits) != 1:
        raise SystemExit("not a Hibari package (mjbot_mortal/model.py not found exactly once)")
    return hits[0]


def extra_files(prefix: str, weights: Path, avatars: bool) -> dict[str, bytes]:
    out = {f"{prefix}mjbot_mortal/mortal.pth": weights.read_bytes()}
    for d in preset_dirs():
        for f in sorted(d.iterdir()):
            if f.is_file():
                out[f"{prefix}mjbot_mortal/{d.name}/{f.name}"] = f.read_bytes()
    if avatars:
        files, versions = ai_avatar_files()
        for rel, src in files.items():
            out[f"{prefix}data/{rel}"] = src.read_bytes()
        if versions:
            out[f"{prefix}data/settings.json"] = json.dumps({"assets": versions}, indent=2).encode()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("package", type=Path)
    ap.add_argument("--weights", type=Path, default=ROOT / "mjbot_mortal" / "mortal.pth")
    ap.add_argument("--no-avatars", action="store_true")
    args = ap.parse_args()
    if not args.weights.exists():
        raise SystemExit(f"weights not found: {args.weights}")
    out = args.package.parent / "full" / args.package.name
    out.parent.mkdir(exist_ok=True)

    if args.package.name.endswith(".tar.gz"):
        with tarfile.open(args.package, "r:gz") as src:
            members = src.getmembers()
            prefix = app_prefix([m.name for m in members])
            extra = extra_files(prefix, args.weights, not args.no_avatars)
            with tarfile.open(out, "w:gz", compresslevel=6) as dst:
                for m in members:
                    if m.name not in extra:
                        dst.addfile(m, src.extractfile(m) if m.isfile() else None)
                for name, data in extra.items():
                    info = tarfile.TarInfo(name)
                    info.size, info.mode = len(data), 0o644
                    dst.addfile(info, io.BytesIO(data))
    else:
        with zipfile.ZipFile(args.package) as z:
            names = z.namelist()
        prefix = app_prefix(names)
        extra = extra_files(prefix, args.weights, not args.no_avatars)
        clash = set(extra) & set(names)
        if clash:
            raise SystemExit(f"already in the package: {', '.join(sorted(clash))}")
        shutil.copyfile(args.package, out)
        with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name, data in extra.items():
                info = zipfile.ZipInfo(name)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3  # unix: keep a sane file mode for macOS / Linux unzip
                info.external_attr = 0o100644 << 16
                z.writestr(info, data)
    print(f"done: {out} (+ {', '.join(n[len(prefix):] for n in extra)})")


if __name__ == "__main__":
    main()
