# SPDX-License-Identifier: MIT
"""Check that each of Chatterbox Turbo's inline tags does something, and is
never read out as a word (the persona redesign, plan call 8, 2026-10-03:
"render each one on Turbo and listen before the app lists it. A tag that
does nothing would be a broken promise in the list").

    npm run dev                                       # the app, our audio.cpp build
    python server/scripts/turbo_tag_check.py          # talks to 127.0.0.1:17494
    python server/scripts/turbo_tag_check.py --model chatterbox-nano --out <dir>

Nobody here can listen, so the check is mechanical. For every tag in the
model's capability row (`engines/capability_details.py`):

  1. the same line is rendered twice on one unsaved Turbo clone, with one seed —
     once plain, once with the tag (a state or register tag leads the line, a
     sound sits mid-line, as the persona page and Generate place them);
  2. speech recognition transcribes the tagged render;
  3. the tag PASSES when its word is not heard (a tag read aloud is the failure
     the 2026-09-29 rule exists for) and the audio differs from the plain render
     (a tag that changes nothing is a broken promise).

Writes nothing to the library: the reference clip is a Kokoro audition, the
clone is a `POST /v1/voices/preview` candidate (never saved), and transcribing
goes through the stateless `POST /v1/transcribe`. Each WAV and a JSON summary
land in --out (default: a temp folder); the record of a run is pasted into
docs/plans/ by hand.

Needs the app running with OUR audio.cpp build (`npm run dev`) — the pinned
release cannot clone on Turbo yet (docs/engines.md, Not available yet).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import re
import struct
import sys
import tempfile
import time
import uuid
import wave
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PLAIN = "I told you we would be late, and now look where we are."
# A state or a register is "the state the line is spoken in" — it leads the
# line. A sound is "made at a point in the text" — it goes mid-line.
LEADING = {"emotion", "register"}
REFERENCE_LINE = (
    "The fog came in over the pier before either of them said a word. "
    "By the time the lamps were lit, the harbour had gone quiet."
)
# What hearing a tag as a word looks like in a transcript: the tag's own word
# or its obvious forms. Never the SOUND the tag asks for — a performed [shush]
# transcribes as "Shh" and a [groan] as "Ugh!", which is the tag working (the
# first run, 2026-10-04, counted "shh" as the word and failed [shush] wrongly).
PROBES = {
    "whispering": ["whisper"], "crying": ["cry", "cries"], "surprised": ["surpris"],
    "sarcastic": ["sarcas"], "clear throat": ["throat", "clear"], "shush": ["shush"],
    "advertisement": ["advert"], "narration": ["narrat"], "dramatic": ["dramat"],
}


def http(base: str, method: str, path: str, body: dict | None = None, *, raw: bool = False,
         timeout: float = 900):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=timeout) as r:
            content = r.read()
    except HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code}: {e.read().decode(errors='replace')[:400]}") from e
    return content if raw else (json.loads(content) if content else {})


def transcribe(base: str, wav: bytes, language: str = "en") -> str:
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    for name, value in (("language", language),):
        body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.wav\"\r\n"
               "Content-Type: audio/wav\r\n\r\n".encode())
    body.write(wav)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    # The first transcribe after a render swaps the speech model out for the
    # recogniser, and the swap's memory check can run before the eviction has
    # freed anything ("not enough memory to load asr", seen 2026-10-04 — open in
    # TASKS). A short wait and a retry gets past it.
    for attempt in range(4):
        req = Request(base + "/v1/transcribe", data=body.getvalue(), method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            with urlopen(req, timeout=900) as r:
                return json.loads(r.read()).get("text", "")
        except HTTPError as e:
            if attempt == 3:
                raise
            print(f"  transcribe failed ({e.code}), retrying …", flush=True)
            time.sleep(8)
    return ""


def samples(wav: bytes) -> list[int]:
    with wave.open(io.BytesIO(wav)) as w:
        frames = w.readframes(w.getnframes())
        width = w.getsampwidth()
    if width != 2:
        return []
    return list(struct.unpack(f"<{len(frames) // 2}h", frames))


def seconds(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav)) as w:
        return w.getnframes() / float(w.getframerate() or 1)


def difference(a: bytes, b: bytes) -> float:
    """0 = the same audio; larger = more different. RMS of the sample-wise
    difference over the shorter render, relative to the plain render's RMS,
    plus the length change — a tag that adds a laugh mostly adds length."""
    sa, sb = samples(a), samples(b)
    n = min(len(sa), len(sb))
    if not n:
        return 0.0
    rms = math.sqrt(sum(x * x for x in sa[:n]) / n) or 1.0
    diff = math.sqrt(sum((x - y) ** 2 for x, y in zip(sa[:n], sb[:n])) / n)
    return round(diff / rms + abs(len(sa) - len(sb)) / max(len(sa), 1), 3)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z']+", text.lower())


def heard(tag: str, transcript: str) -> list[str]:
    probes = PROBES.get(tag, [tag[:4]])
    plain = set(words(PLAIN))
    return [w for w in words(transcript) if w not in plain and any(w.startswith(p) for p in probes)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", default="http://127.0.0.1:17494")
    ap.add_argument("--model", default="chatterbox-turbo")
    ap.add_argument("--engine", default="chatterbox")
    ap.add_argument("--reference-voice", default="af_heart", help="a Kokoro voice for the reference clip")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--out", default="")
    ap.add_argument("--from-renders", action="store_true",
                    help="skip rendering: transcribe and score the WAVs an earlier run left in --out")
    args = ap.parse_args()
    out = Path(args.out or tempfile.mkdtemp(prefix="turbo-tags-"))
    out.mkdir(parents=True, exist_ok=True)

    caps = http(args.base, "GET", "/v1/engines/capabilities")["engines"]
    row = caps.get(args.model)
    if not row:
        raise SystemExit(f"{args.model} has no capability row on this server")
    tags = [(s["category"], t) for s in row.get("inline_tags") or [] for t in s["tags"]]
    print(f"{row.get('display_name', args.model)}: {len(tags)} tags · out {out}")

    if args.from_renders:
        ref = (out / "reference.wav").read_bytes()
    else:
        print("reference clip …", flush=True)
        ref = http(args.base, "POST", f"/v1/voices/{args.reference_voice}/preview?auto_load=true",
                   {"text": REFERENCE_LINE}, raw=True)
        (out / "reference.wav").write_bytes(ref)
        print(f"  {seconds(ref):.1f} s", flush=True)
    ref_b64 = base64.b64encode(ref).decode()

    def render(text: str, file: str) -> bytes:
        if args.from_renders:
            return (out / file).read_bytes()
        r = http(args.base, "POST", "/v1/voices/preview", {
            "engine": args.engine, "model": args.model, "source": "cloned",
            "ref_wav_b64": ref_b64, "preview_text": text, "language": "en-US", "seed": args.seed,
        })
        return base64.b64decode(r["wav_b64"])

    t0 = time.time()
    plain = render(PLAIN, "plain.wav")
    (out / "plain.wav").write_bytes(plain)
    print(f"plain: {seconds(plain):.2f} s ({time.time() - t0:.0f} s to render)", flush=True)
    again = render(PLAIN, "plain_again.wav")
    (out / "plain_again.wav").write_bytes(again)
    same_seed_diff = difference(plain, again)
    print(f"plain again, same seed: difference {same_seed_diff}", flush=True)

    renders = []
    for kind, tag in tags:
        if kind in LEADING:
            text = f"[{tag}] {PLAIN}"
        else:
            text = PLAIN.replace(", and now", f", [{tag}] and now")
        name = re.sub(r"\W+", "_", tag)
        wav = render(text, f"{name}.wav")
        (out / f"{name}.wav").write_bytes(wav)
        renders.append({"kind": kind, "tag": tag, "text": text, "file": f"{name}.wav",
                        "seconds": round(seconds(wav), 2), "difference": difference(plain, wav)})
        print(f"  [{tag}] {renders[-1]['seconds']} s · difference {renders[-1]['difference']}", flush=True)

    print("transcribing …", flush=True)
    plain_text = transcribe(args.base, plain)
    for r in renders:
        r["transcript"] = transcribe(args.base, (out / r["file"]).read_bytes())
        r["heard"] = heard(r["tag"], r["transcript"])
        # The floor is the same-seed noise: a tag must move the audio more than
        # rendering the plain line twice does.
        r["changed"] = r["difference"] > max(0.05, same_seed_diff * 2)
        r["pass"] = not r["heard"] and r["changed"]
        print(f"  [{r['tag']}] {'PASS' if r['pass'] else 'FAIL'} · heard {r['heard'] or '-'} · "
              f"{r['transcript']!r}", flush=True)

    summary = {
        "model": args.model, "seed": args.seed, "plain_text": PLAIN,
        "plain_transcript": plain_text, "plain_seconds": round(seconds(plain), 2),
        "same_seed_difference": same_seed_diff, "renders": renders,
        "passing": [r["tag"] for r in renders if r["pass"]],
        "failing": [r["tag"] for r in renders if not r["pass"]],
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("passing", "failing")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
