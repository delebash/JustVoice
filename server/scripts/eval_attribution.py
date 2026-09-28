# SPDX-License-Identifier: MIT
"""Score speaker attribution (Studio · Script · Analyze) against an answer key.

    npm run eval:attribution                         # server on 127.0.0.1:8741
    npm run eval:attribution -- --runs 2 --route direct
    npm run eval:attribution -- --system draft.txt   # try a prompt, save nothing

Needs a running JustVoice server (it owns the model and the LIVE prompt rows —
AI Settings → Features → the speaker_attribution routes). Each chapter goes
through POST /v1/extraction/analyze-text: the whole production pipeline —
segmentation, tag anchors, the model call, the confidence floor — writing
nothing. The cast is built the way `_resolve_cast` builds it for Analyze.

The answer key is `samples/<sample>/attribution-truth.json`: the speaker of
every [D#] dialogue segment, labelled by hand. Per segment the result is
  right      the right cast member (or "unknown" where the speaker is not cast)
  WRONG      a different cast member — the dangerous one: it looks finished
  blank      "unknown" / no speaker where the key names someone — visible,
             and blocks the render until fixed
and every result is also broken down by the source that decided it (tag,
propagated, llm, floored), so a change can be traced to the stage it moved.

Built 2026-09-28 so attribution changes are measured, not eyeballed.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

from justvoice.imports import run_adapter  # noqa: E402


def slug(name: str) -> str:
    """A persona id shaped like the app's (a UUID), stable per name — a readable
    id would hand the model the name and hide id-copying mistakes."""
    import hashlib
    h = hashlib.sha1(name.encode("utf-8")).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def post(server: str, path: str, body: dict, timeout: int = 1800) -> dict:
    req = urllib.request.Request(
        server + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{path} -> {e.code}: {e.read().decode()[:400]}") from e


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--server", default="http://127.0.0.1:8741")
    ap.add_argument("--sample", default="the-ninth-facet")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--route", choices=["guided", "direct"], help="force a route (default: Auto)")
    ap.add_argument("--system", help="file with a CANDIDATE system prompt (not saved)")
    ap.add_argument("--user", help="file with a CANDIDATE user template (not saved)")
    ap.add_argument("--floor", type=float, help="confidence floor for this run")
    ap.add_argument("--temperature", type=float)
    ap.add_argument("--think", action="store_true", help="let the model reason before answering")
    ap.add_argument("--model", help="run on this catalog model instead of the preset's (local runner)")
    ap.add_argument("--readable-ids", action="store_true", help="p_name ids instead of UUID-shaped (diagnostic)")
    ap.add_argument("--no-propagate", action="store_true", help="skip the tag-anchor pass")
    ap.add_argument("--chapter", action="append", help="only these chapter titles")
    ap.add_argument("--whole", action="store_true", help="join the keyed chapters into ONE long chapter")
    ap.add_argument("--max-context", type=int,
                    help="treat the model's context as this many tokens - forces chapter splitting")
    ap.add_argument("--show", type=int, default=12, help="errors to print per chapter")
    ap.add_argument("--out", help="write every row as JSON, for comparing runs")
    args = ap.parse_args()

    root = HERE.parents[2] / "samples" / args.sample
    key = json.loads((root / "attribution-truth.json").read_text(encoding="utf-8"))
    book = run_adapter("justwrite", (root / "book.json").read_bytes(), filename="book.json")

    # The cast exactly as _resolve_cast shapes it for Analyze.
    chars = [{"id": "p_narrator", "name": "Narrator", "role": None, "gender": None,
              "pronouns": None, "aliases": [], "description": None}]
    for c in book.characters:
        if c.name in key["cast"]:
            chars.append({"id": ("p_" + c.name.lower().replace(" ", "_")) if args.readable_ids else slug(c.name), "name": c.name, "role": None, "gender": None,
                          "pronouns": None, "aliases": list(c.aliases), "description": c.notes})
    id_to_name = {c["id"]: c["name"] for c in chars}
    id_to_name.update({"narrator": "Narrator", "unknown": "unknown"})

    body_extra = {}
    if args.system:
        body_extra["systemPrompt"] = Path(args.system).read_text(encoding="utf-8")
    if args.user:
        body_extra["userPrompt"] = Path(args.user).read_text(encoding="utf-8")
    if args.think:
        body_extra["think"] = True
    if args.model:
        body_extra["model"] = args.model
        body_extra["providerId"] = "local-llamacpp"
    for k, v in (("route", args.route), ("confidence_floor", args.floor), ("temperature", args.temperature)):
        if v is not None:
            body_extra[k] = v
    if args.no_propagate:
        body_extra["propagate"] = False
    if args.max_context:
        body_extra["max_context"] = args.max_context

    print(f"Attribution test · {book.project.name} · {args.server} · {args.runs} run(s)"
          f" · {', '.join(f'{k}={v!r:.40}' for k, v in body_extra.items()) or 'live settings'}\n")

    tests = []   # (title, text, truth, also_ok)
    for scene in book.scenes:
        if args.chapter and scene.title not in args.chapter:
            continue
        if scene.title not in key["chapters"]:
            continue   # a key may cover only some chapters of a long book
        tests.append((scene.title, "\n\n".join(line.text for line in scene.lines if line.text),
                      key["chapters"][scene.title], set(key.get("also_ok", {}).get(scene.title, []))))
    if args.whole:
        # One long chapter: the keyed chapters joined, their [D#] keys shifted by the
        # dialogue count before them (a key numbers every dialogue segment from 0).
        text, truth, also_ok, off = [], {}, set(), 0
        for _title, t, tr, ok in tests:
            text.append(t)
            truth.update({str(int(d) + off): v for d, v in tr.items()})
            also_ok.update(str(int(d) + off) for d in ok)
            off += len(tr)
        tests = [(f"whole book ({len(tests)} chapters)", "\n\n".join(text), truth, also_ok)]

    grand = Counter()
    by_source = Counter()
    dump = []
    for title, text, truth, also_ok in tests:
        scene = SimpleNamespace(title=title)
        for run in range(args.runs):
            t0 = time.time()
            r = post(args.server, "/v1/extraction/analyze-text",
                     {"text": text, "characters": chars, **body_extra})
            dialogue = [row for row in r["rows"] if row["kind"] == "dialogue"]
            if len(dialogue) != len(truth):
                print(f"   {len(dialogue)} dialogue segments, key has {len(truth)} — the numbering is off")
            c = Counter()
            errors = []
            for i, row in enumerate(dialogue):
                want = truth.get(str(i))
                got = id_to_name.get(row["speaker"], row["speaker"])
                src = row["source"]
                if want is None:
                    continue
                if got == want or (got == "unknown" and str(i) in also_ok):
                    verdict = "right"
                elif got in ("unknown", "Narrator") and want != "unknown":
                    verdict = "blank" if got == "unknown" else "WRONG"
                else:
                    verdict = "WRONG"
                c[verdict] += 1
                by_source[(src, verdict)] += 1
                if verdict != "right":
                    errors.append(f"D{i} {verdict:5} want {want:15} got {got:15} [{src}"
                                  f"{' ' + format(row.get('confidence') or 0, '.2f') if src in ('llm', 'floored') else ''}]"
                                  f"  “{row['text'][:60]}”")
                dump.append({"chapter": scene.title, "run": run, "d": i, "want": want, "got": got,
                             "source": src, "confidence": row.get("confidence"), "verdict": verdict})
            n = sum(c.values())
            grand.update(c)
            if c["blank"] > n / 2 and r.get("raw_llm") is not None:
                raw_path = Path(tempfile.gettempdir()) / f"attr_raw_{re.sub(r'[^A-Za-z0-9]+', '_', scene.title)}_{run}.txt"
                raw_path.write_text(r["raw_llm"] or "", encoding="utf-8")
                print(f"   (mostly blank — raw reply saved to {raw_path})")
            usage = r.get("usage") or {}
            print(f"## {scene.title}{f' run {run + 1}' if args.runs > 1 else ''}  "
                  f"right {c['right']}/{n}  WRONG {c['WRONG']}  blank {c['blank']}   "
                  f"({time.time() - t0:.0f}s, route {r.get('route_used')}, floor {r.get('confidence_floor')},"
                  f" model {usage.get('model', '?')}, {usage.get('pieces', 1)} piece(s))")
            for e in errors[: args.show]:
                print("   " + e)
            if len(errors) > args.show:
                print(f"   … {len(errors) - args.show} more")

    n = sum(grand.values())
    print(f"\nTOTAL right {grand['right']}/{n} ({100 * grand['right'] / max(n, 1):.0f}%) · "
          f"WRONG {grand['WRONG']} ({100 * grand['WRONG'] / max(n, 1):.0f}%) · "
          f"blank {grand['blank']} ({100 * grand['blank'] / max(n, 1):.0f}%)")
    print("by source: " + " · ".join(
        f"{s}: {by_source[(s, 'right')]}/{sum(v for (ss, _), v in by_source.items() if ss == s)} right"
        f"{', ' + str(by_source[(s, 'WRONG')]) + ' wrong' if by_source[(s, 'WRONG')] else ''}"
        for s in ("tag", "propagated", "llm", "floored") if any(ss == s for ss, _ in by_source)))
    if args.out:
        Path(args.out).write_text(json.dumps(dump, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
