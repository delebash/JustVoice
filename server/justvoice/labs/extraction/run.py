# SPDX-License-Identifier: MIT
"""Extraction lab CLI.

Usage:
  python -m justvoice.labs.extraction.run                 # run every passage at auto tier
  python -m justvoice.labs.extraction.run --tier guided   # force a tier
  python -m justvoice.labs.extraction.run --corpus austen_persuasion

Writes a markdown report to labs/extraction/reports/<timestamp>.md with
per-passage block-accuracy, per-character F1, and a source breakdown
(anchor / propagated / llm / floored). Requires a registered LLM provider
in settings — without one the pipeline runs anchors-only and the report
notes the LLM-call skip.

The corpus lives next to this module as JSON files under corpus/.
"""

from __future__ import annotations

import argparse
import json
import logging
import pathlib
import sys
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)


HERE = pathlib.Path(__file__).resolve().parent
CORPUS_DIR = HERE / "corpus"
REPORTS_DIR = HERE / "reports"


def load_corpus(slug: str | None = None) -> list[dict]:
    files = sorted(CORPUS_DIR.glob("*.json"))
    cases: list[dict] = []
    for f in files:
        case = json.loads(f.read_text(encoding="utf-8"))
        if slug is None or case.get("slug") == slug:
            cases.append(case)
    return cases


def score_case(rows: list, ground_truth: list[dict]) -> dict[str, Any]:
    """Compare AttributionRow output to ground truth.

    Walks rows in order, indexing only the dialogue rows (narration is
    automatic). Compares row.speaker to ground_truth[i].speaker.
    """
    dialogue_rows = [r for r in rows if r.kind == "dialogue"]
    gt = sorted(ground_truth, key=lambda g: g["dialogue_id"])
    n = min(len(dialogue_rows), len(gt))
    correct = 0
    by_source: dict[str, int] = defaultdict(int)
    per_char_tp: dict[str, int] = defaultdict(int)  # tp = true positive per character
    per_char_fp: dict[str, int] = defaultdict(int)
    per_char_fn: dict[str, int] = defaultdict(int)
    for i in range(n):
        row = dialogue_rows[i]
        expected = gt[i]["speaker"]
        got = row.speaker
        by_source[row.source] += 1
        if got == expected:
            correct += 1
            per_char_tp[expected] += 1
        else:
            per_char_fp[got] += 1
            per_char_fn[expected] += 1
    accuracy = correct / n if n else 0.0

    f1_per_char = {}
    for char_id in set(list(per_char_tp.keys()) + list(per_char_fn.keys())):
        tp = per_char_tp.get(char_id, 0)
        fp = per_char_fp.get(char_id, 0)
        fn = per_char_fn.get(char_id, 0)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        f1_per_char[char_id] = {
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
        }

    return {
        "dialogue_count": n,
        "correct": correct,
        "accuracy": round(accuracy, 3),
        "by_source": dict(by_source),
        "per_character_f1": f1_per_char,
    }


def run_passage(case: dict, tier_override: str | None) -> dict[str, Any]:
    # Lazy import so a missing optional dependency doesn't kill the CLI.
    from ...app_state import get_state, set_state, AppState
    from ...extraction import AnalyzeRequest, analyze_scene
    from ...paths import default_data_dir

    try:
        get_state()
    except RuntimeError:
        set_state(AppState(default_data_dir()))
    settings = get_state().settings.get()

    try:
        rows = analyze_scene(
            settings=settings,
            request=AnalyzeRequest(
                text=case["text"],
                characters=case["characters"],
                corrections=[],
                tier=tier_override,
                propagate=True,
                use_floor=True,
            ),
        )
        llm_ok = True
    except Exception as e:
        rows = []
        llm_ok = False
        logger.warning("passage %s: LLM call failed: %s", case["slug"], e)

    scored = score_case(rows, case["ground_truth"])
    scored["llm_ok"] = llm_ok
    scored["title"] = case["title"]
    scored["slug"] = case["slug"]
    scored["genre"] = case["genre"]
    return scored


def format_report(results: list[dict], tier_label: str) -> str:
    lines = [
        "# Extraction lab report",
        "",
        f"- Tier: `{tier_label}`",
        f"- Passages: {len(results)}",
        "",
        "## Per-passage accuracy",
        "",
        "| Passage | Genre | Dialogue | Correct | Accuracy | tag | propagated | llm | floored | LLM OK |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        s = r["by_source"]
        lines.append(
            f"| {r['title']} | {r['genre']} | {r['dialogue_count']} | {r['correct']} | "
            f"{r['accuracy'] * 100:.1f}% | {s.get('tag', 0)} | {s.get('propagated', 0)} | "
            f"{s.get('llm', 0)} | {s.get('floored', 0)} | {'✓' if r['llm_ok'] else '✗'} |"
        )

    avg = sum(r["accuracy"] for r in results) / max(1, len(results))
    lines.extend([
        "",
        f"## Aggregate accuracy: {avg * 100:.1f}%",
        "",
        "## Per-character F1",
        "",
    ])
    for r in results:
        if not r["per_character_f1"]:
            continue
        lines.append(f"### {r['title']}")
        lines.append("")
        lines.append("| Character | Precision | Recall | F1 |")
        lines.append("|---|---|---|---|")
        for char_id, scores in r["per_character_f1"].items():
            lines.append(
                f"| `{char_id}` | {scores['precision']} | {scores['recall']} | {scores['f1']} |"
            )
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="JustVoice extraction lab")
    parser.add_argument("--tier", choices=["guided", "direct", "reasoned"], help="force a tier")
    parser.add_argument("--corpus", help="run a single passage by slug; default = all")
    args = parser.parse_args(argv)

    cases = load_corpus(args.corpus)
    if not cases:
        print(f"No corpus matches {args.corpus!r}", file=sys.stderr)
        return 1

    print(f"Running {len(cases)} passage(s)…", file=sys.stderr)
    results = [run_passage(c, args.tier) for c in cases]

    report = format_report(results, args.tier or "auto")
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    # Use a deterministic name so output stays predictable (the user can
    # diff successive runs by overwriting the same file).
    out_path = REPORTS_DIR / f"latest-{args.tier or 'auto'}.md"
    out_path.write_text(report, encoding="utf-8")
    print(f"Report -> {out_path}", file=sys.stderr)
    # Guard against non-UTF-8 stdout encodings (Windows cp1252 trips on
    # emoji + en-dash). Fall back to ASCII when the host encoding can't
    # round-trip; the file always carries the full Unicode report.
    try:
        sys.stdout.write(report)
    except UnicodeEncodeError:
        sys.stdout.write(report.encode("ascii", "replace").decode("ascii"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
