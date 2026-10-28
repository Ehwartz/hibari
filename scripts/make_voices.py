"""Generate the call / riichi / win voices with a local VOICEVOX engine.

    # start the engine first (e.g. D:/VOICEVOX/engine/run.exe), then:
    uv run python -m scripts.make_voices [--engine http://127.0.0.1:50021] [--policies DIR]

Writes frontend/src/assets/voice/<player>/<name>.wav for the four players and credits.json there
({player: "VOICEVOX:<character>"}; the characters' terms require the credit). The UI imports the
clips at build time (inlined into small JS chunks), so the browser never requests a .wav file:
download managers such as IDM intercept those. With --policies, each character's terms of use (from
the engine) are saved there for review.
"""
from __future__ import annotations

import argparse
import array
import io
import json
import wave
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "src" / "assets" / "voice"

# player -> VOICEVOX character (style ノーマル); four distinct voices, all from the 東北ずん子
# project, so one set of terms applies (https://zunko.jp/con_ongen_kiyaku.html: credit required)
VOICES = {
    "human": "四国めたん",
    "ai1": "ずんだもん",
    "ai2": "九州そら",
    "ai3": "東北きりたん",
}
LINES = {"chi": "チー！", "pon": "ポン！", "kan": "カン！", "riichi": "リーチ！", "ron": "ロン！", "tsumo": "ツモ！"}


def call(engine: str, path: str, params: dict | None = None, body: bytes | None = None) -> bytes:
    url = f"{engine}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, data=body, method="POST" if body is not None or path in ("/audio_query", "/synthesis") else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def normalize(wav: bytes, peak: float = 0.85) -> bytes:
    """Scale a 16-bit mono WAV so its peak is ``peak`` of full scale (the voices differ a lot)."""
    with wave.open(io.BytesIO(wav)) as w:
        params, frames = w.getparams(), w.readframes(w.getnframes())
    samples = array.array("h", frames)
    gain = peak * 32767 / max(1, max(abs(x) for x in samples))
    samples = array.array("h", (max(-32768, min(32767, round(x * gain))) for x in samples))
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setparams(params)
        w.writeframes(samples.tobytes())
    return out.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="http://127.0.0.1:50021")
    ap.add_argument("--policies", type=Path, help="save each character's terms of use here")
    args = ap.parse_args()

    speakers = json.loads(call(args.engine, "/speakers"))
    by_name = {s["name"]: s for s in speakers}
    credits: dict[str, str] = {}
    for player, name in VOICES.items():
        sp = by_name.get(name)
        if sp is None:
            raise SystemExit(f"{name} not in this engine; available: {', '.join(by_name)}")
        style = next((st for st in sp["styles"] if st["name"] == "ノーマル"), sp["styles"][0])
        if args.policies:
            info = json.loads(call(args.engine, "/speaker_info", {"speaker_uuid": sp["speaker_uuid"]}))
            args.policies.mkdir(parents=True, exist_ok=True)
            (args.policies / f"{name}.md").write_text(info["policy"], encoding="utf-8")
        out = OUT / player
        out.mkdir(parents=True, exist_ok=True)
        for key, text in LINES.items():
            query = json.loads(call(args.engine, "/audio_query", {"text": text, "speaker": style["id"]}))
            # short, punchy calls: a bit faster, more intonation, little silence around them
            query.update(speedScale=1.12, intonationScale=1.35, volumeScale=1.25,
                         prePhonemeLength=0.03, postPhonemeLength=0.06)
            wav = call(args.engine, "/synthesis", {"speaker": style["id"]}, json.dumps(query).encode())
            (out / f"{key}.wav").write_bytes(normalize(wav))
        credits[player] = f"VOICEVOX:{name}"
        print(f"{player}: {name} ({style['name']}, id {style['id']}) — {len(LINES)} clips")
    (OUT / "credits.json").write_text(json.dumps(credits, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done: {OUT}")


if __name__ == "__main__":
    main()
