"""End-to-end smoke test for voice cloning through the new plugin pipeline.

Uses Kokoro to generate a reference WAV, clones it as a Chatterbox voice,
synthesizes a line with that voice. Saves output for ear-check.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

BASE = "http://localhost:17494"
HERE = Path(__file__).resolve().parent


def http(method: str, path: str, body: dict | None = None, raw: bool = False):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urlopen(req) as r:
        content = r.read()
    if raw:
        return content
    return json.loads(content) if content else {}


def main() -> int:
    ref_path = HERE / "_chatterbox_ref_sarah.wav"
    out_path = HERE / "_chatterbox_clone_test.wav"

    print("=== Read reference WAV (already generated via Kokoro at /tmp/ref_sarah.wav) ===")
    src = Path("/tmp/ref_sarah.wav")
    if not src.is_file():
        # Cygwin /tmp on Windows — translate.
        src = Path("C:/Users/danel/AppData/Local/Temp/ref_sarah.wav")
    if not src.is_file():
        # Generate it fresh.
        print("ref WAV missing — generating via Kokoro...")
        http("POST", "/v1/engines/kokoro/load", {"device": "auto"})
        wav_bytes = http(
            "POST",
            "/v1/generate",
            {
                "voice": "af_sarah",
                "text": "Hello, my name is Sarah, and this is a reference clip for voice cloning. The quick brown fox jumps over the lazy dog.",
            },
            raw=True,
        )
        ref_path.write_bytes(wav_bytes)
    else:
        ref_path.write_bytes(src.read_bytes())
    print(f"  reference WAV: {ref_path.stat().st_size} bytes")

    print("=== Clone as a Chatterbox voice ===")
    b64 = base64.b64encode(ref_path.read_bytes()).decode()
    print(f"  encoded length: {len(b64):,} chars")
    clone_resp = http(
        "POST",
        "/v1/voices/clone",
        {
            "engine": "chatterbox",
            "name": "Sarah clone (from Kokoro ref)",
            "language": "en",
            "ref_wav_b64": b64,
        },
    )
    print(f"  clone response: {clone_resp}")
    voice_id = clone_resp["id"]
    print(f"  voice id: {voice_id}")

    print("=== Switch to Chatterbox if needed ===")
    cur = http("GET", "/v1/engines/current")
    cur_id = (cur.get("engine") or {}).get("id")
    if cur_id != "chatterbox":
        print("  loading Chatterbox...")
        http("POST", "/v1/engines/chatterbox/load", {"device": "auto"})

    print("=== Synthesize with the cloned voice ===")
    out_bytes = http(
        "POST",
        "/v1/generate",
        {
            "voice": voice_id,
            "text": "This is the cloned voice speaking. Hello from Chatterbox via the JustVoice plugin pipeline.",
        },
        raw=True,
    )
    out_path.write_bytes(out_bytes)
    print(f"  output: {out_path} ({out_path.stat().st_size:,} bytes)")
    head = out_path.read_bytes()[:4]
    assert head == b"RIFF", f"expected RIFF, got {head!r}"
    print("  RIFF header OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
