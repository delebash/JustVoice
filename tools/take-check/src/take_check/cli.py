# SPDX-License-Identifier: MIT
"""take-check score --manifest <manifest.json> --out <dir> [--device cpu|cuda]"""

import argparse
import csv
import json
import math
import os
import sys
from pathlib import Path

from take_check.manifest import line_emotions, load_manifest
from take_check.utmosv2_weights import ensure_weights
from take_check.versa_scores import base_env, run_versa

# uv installs this project editable, so the kit's folder is three levels up from here.
DEFAULT_CACHE = Path(__file__).resolve().parents[2] / ".cache"

# An asked emotion with no emotion2vec+ class of its own, read as its nearest.
EMOTION_CLASS = {"contemptuous": "disgusted"}


def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def score(args: argparse.Namespace) -> int:
    manifest = Path(args.manifest).resolve()
    out = Path(args.out).resolve()
    cache = Path(args.cache_dir).resolve()
    try:
        takes = load_manifest(manifest)
    except (OSError, ValueError) as error:
        print(f"take-check: {error}", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    line_emotion = line_emotions(takes)

    # Set before torch is imported in this process (FunASR) and passed to VERSA.
    env = base_env(cache, args.device)
    os.environ.update(env)

    ensure_weights(cache / "utmosv2")

    print(f"take-check: {len(takes)} takes; VERSA (read-back, speaker, UTMOSv2, emo_vad) ...", flush=True)
    quality_seeds = {s.strip() for s in args.quality_seeds.split(",") if s.strip()} if args.quality_seeds else None
    versa, problems = run_versa(takes, out / "versa", cache, args.device == "cuda", env, quality_seeds)

    print("take-check: emotion2vec+ large ...", flush=True)
    from take_check.emotion import score_emotion
    from take_check.loudness import measure

    emotions = score_emotion(takes, args.device, out / "emotion2vec")
    labels = next(iter(emotions.values()))["labels"]

    print("take-check: loudness ...", flush=True)
    rows = []
    for take in takes:
        emotion = emotions[take.id]
        probs = dict(zip(emotion["labels"], emotion["scores"]))
        top = max(probs, key=probs.get)
        asked = line_emotion[take.line]
        signal = measure(take.wav)
        row = {
            "id": take.id,
            "model": take.model,
            "line": take.line,
            "seed": take.seed,
            "told": take.told,
            "emotion_asked": take.emotion_asked,
            **{k: versa[take.id].get(k) for k in ("wer", "cer", "spk_similarity", "utmosv2")},
            "emotion_top": top,
            # The probability of the emotion the line asks for, when it is one of the nine
            # classes (contemptuous read as disgusted, the nearest, as IndexTTS's authors map it);
            # read on told and untold takes of the line alike.
            "emotion_asked_prob": probs.get(EMOTION_CLASS.get(asked.lower(), asked.lower())) if asked else None,
            **{f"emo_{label}": probs[label] for label in labels},
            **{k: versa[take.id].get(k) for k in ("arousal", "valence", "dominance")},
            "loudness_lufs": signal["loudness_lufs"],
            "duration_s": signal["duration_s"],
            "chars_per_s": len(take.text) / signal["duration_s"] if signal["duration_s"] else None,
            "whisper_hyp_text": versa[take.id].get("whisper_hyp_text"),
        }
        rows.append(row)

    columns = list(rows[0].keys())
    with (out / "scores.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    from take_check.summary import summarise

    score_columns = [
        "wer", "cer", "spk_similarity", "utmosv2", "emotion_asked_prob",
        *[f"emo_{label}" for label in labels],
        "arousal", "valence", "dominance", "loudness_lufs", "duration_s", "chars_per_s",
    ]
    summary = summarise(rows, score_columns, line_emotion)
    (out / "summary.json").write_text(
        json.dumps(_json_safe(summary), indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"take-check: wrote {out / 'scores.csv'} and {out / 'summary.json'}", flush=True)
    if problems:
        print("take-check: some scores are missing:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="take-check", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    score_parser = commands.add_parser("score", help="score every take in a manifest")
    score_parser.add_argument("--manifest", required=True, help="path to manifest.json")
    score_parser.add_argument("--out", required=True, help="folder for scores.csv and summary.json")
    score_parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    score_parser.add_argument(
        "--quality-seeds",
        default="",
        help="UTMOSv2 (the slowest score) only on takes with these seeds, e.g. 7 — a model's average "
        "quality, not each take's (default: every take)",
    )
    score_parser.add_argument(
        "--cache-dir", default=str(DEFAULT_CACHE), help="where models are downloaded (default: %(default)s)"
    )
    args = parser.parse_args()
    if args.command == "score":
        sys.exit(score(args))
