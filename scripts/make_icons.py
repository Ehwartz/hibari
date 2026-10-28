"""Render the app icons from the logo SVGs (frontend/public/logo/).

    uv run python -m scripts.make_icons

Writes scripts/release/icons/: hibari.ico (Windows exe), hibari.icns (macOS app), hibari-256.png
(Linux). Sizes up to 32 px use the simplified logo (no cloud / eye / wing line), larger ones the
full logo, both on a square canvas. PNGs are rendered by headless Chrome from the vector source
(each size drawn natively, not downscaled); ICO and ICNS hold PNG entries, assembled here.
"""
from __future__ import annotations

import base64
import json
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.launch import find_browser  # noqa: E402

LOGO = ROOT / "frontend" / "public" / "logo"
OUT = ROOT / "scripts" / "release" / "icons"
SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
SMALL_MAX = 32


def render(sizes: list[int]) -> dict[int, bytes]:
    """PNG bytes per size, drawn by Chrome into a canvas from the SVG."""
    found = find_browser()
    if not found:
        raise SystemExit("Chrome / Edge / Chromium is needed to render the icons")
    port = 9350
    proc = subprocess.Popen([str(found[1]), "--headless=new", f"--remote-debugging-port={port}",
                             f"--user-data-dir={tempfile.mkdtemp()}", "about:blank"])
    try:
        for _ in range(100):
            try:
                page = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json")) if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.1)
        with connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
            svgs = {n: (LOGO / f"{n}.svg").read_text(encoding="utf-8") for n in ("hibari-square", "hibari-small-square")}
            script = """(async (svgs, sizes, smallMax) => {
              const out = {};
              for (const n of sizes) {
                const svg = svgs[n <= smallMax ? 'hibari-small-square' : 'hibari-square']
                  .replace('<svg ', `<svg width="${n}" height="${n}" `);
                const img = new Image();
                img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
                await img.decode();
                const c = document.createElement('canvas');
                c.width = c.height = n;
                c.getContext('2d').drawImage(img, 0, 0, n, n);
                out[n] = c.toDataURL('image/png').split(',')[1];
              }
              return out;
            })(%s, %s, %d)""" % (json.dumps(svgs), json.dumps(sizes), SMALL_MAX)
            ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                "params": {"expression": script, "awaitPromise": True, "returnByValue": True}}))
            while (msg := json.loads(ws.recv())).get("id") != 1:
                pass
        value = msg["result"]["result"]["value"]
        return {int(k): base64.b64decode(v) for k, v in value.items()}
    finally:
        proc.terminate()


def ico(pngs: dict[int, bytes]) -> bytes:
    """Windows icon with PNG entries (supported since Vista); 256 px is stored as size 0."""
    sizes = [s for s in (16, 24, 32, 48, 64, 128, 256) if s in pngs]
    head = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries, data = b"", b""
    for s in sizes:
        png = pngs[s]
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(png), offset + len(data))
        data += png
    return head + entries + data


def icns(pngs: dict[int, bytes]) -> bytes:
    """macOS icon with PNG entries."""
    types = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512),
             ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    body = b"".join(t.encode() + struct.pack(">I", 8 + len(pngs[s])) + pngs[s] for t, s in types)
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main() -> None:
    pngs = render(SIZES)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hibari.ico").write_bytes(ico(pngs))
    (OUT / "hibari.icns").write_bytes(icns(pngs))
    (OUT / "hibari-256.png").write_bytes(pngs[256])
    for f in sorted(OUT.iterdir()):
        print(f"{f.name}: {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
