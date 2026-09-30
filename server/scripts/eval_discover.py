# SPDX-License-Identifier: MIT
"""Score the Discover prompt against a sample book — on demand, real model.

    npm run eval:discover                      # server on 127.0.0.1:8741
    npm run eval:discover -- --server http://127.0.0.1:17494 --runs 3
    npm run eval:discover -- --system candidate.txt   # try a prompt, save nothing
    npm run eval:discover -- --system s.txt --user u.txt   # a candidate user template too

Needs a running JustVoice server (it owns the model and the LIVE prompt row —
AI Settings → Features → Find new speakers). Writes nothing: each chapter goes
through POST /v1/ai/run, the same action Discover runs, then through the same
known-list formatting, parser, cast filter and quote check the endpoint uses.

The scenario comes from `samples/<sample>/discover-eval.json`: which
characters are taken out of the cast, which named things are objects, which
minor people are real. Scores per chapter:

  found      removed characters proposed, of those the chapter names
  wrong      proposals that are a cast member, a listed object, or an
             invented quote
  extra      anyone else — real minor people, or a miss worth reading

Built 2026-09-27 (Discover fix 5) so a prompt edit is measured, not eyeballed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))

from justvoice.extraction.identify import format_known, known_labels, parse_candidates  # noqa: E402
from justvoice.extraction.names import match, norm, quote_in_text, refers_to  # noqa: E402
from justvoice.imports import run_adapter  # noqa: E402

ACTION = "speaker_attribution.identify"


def post(server: str, path: str, body: dict, timeout: int = 900) -> dict:
    req = urllib.request.Request(
        server + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def named_in(person: dict, text: str) -> bool:
    """Does the chapter name them — full name, first name, surname, or alias?"""
    words = [person["name"], *person.get("aliases", [])]
    words += [w for w in person["name"].split() if len(w) >= 3]
    return any(re.search(rf"\b{re.escape(w)}\b", text, re.IGNORECASE) for w in words)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--server", default="http://127.0.0.1:8741")
    ap.add_argument("--sample", default="the-ninth-facet")
    ap.add_argument("--runs", type=int, default=1, help="repeat each chapter to see how stable it is")
    ap.add_argument("--system", help="a file holding a CANDIDATE system prompt to test instead of the "
                                     "live one — the Lab's unsaved-draft door; nothing is saved")
    ap.add_argument("--user", help="a file holding a CANDIDATE user template (the {{…}} variables "
                    "are filled as usual) to test instead of the live row's")
    args = ap.parse_args()

    root = HERE.parents[2] / "samples" / args.sample
    spec = json.loads((root / "discover-eval.json").read_text(encoding="utf-8"))
    book = run_adapter("justwrite", (root / "book.json").read_bytes(), filename="book.json")

    people = [{"name": c.name, "aliases": c.aliases, "description": c.notes} for c in book.characters]
    removed = [p for p in people if p["name"] in spec["remove_from_cast"]]
    cast = [{"name": "Narrator", "aliases": [], "description": None}] + [
        p for p in people if p["name"] not in spec["remove_from_cast"]]
    objects = spec.get("not_characters", [])
    extras_ok = {norm(n) for n in spec.get("real_extras", [])}

    candidate = Path(args.system).read_text(encoding="utf-8") if args.system else None
    candidate_user = Path(args.user).read_text(encoding="utf-8") if args.user else None
    print(f"Discover prompt test · {book.project.name} · {args.server} · {args.runs} run(s) per chapter"
          f" · prompt: {'CANDIDATE ' + args.system if candidate else 'live row'}"
          f"{' + CANDIDATE user template ' + args.user if candidate_user else ''}")
    print(f"cast: {', '.join(p['name'] for p in cast)}")
    print(f"taken out of the cast: {', '.join(p['name'] for p in removed)}\n")

    totals = {"expected": 0, "found": 0, "wrong": 0, "quotes": 0, "quotes_ok": 0}
    for scene in book.scenes:
        text = "\n\n".join(line.text for line in scene.lines if line.text)
        expected = [p for p in removed if named_in(p, text)]
        for run in range(args.runs):
            t0 = time.time()
            body = {"action": ACTION,
                    "variables": {"known_speakers": format_known(cast), "manuscript": text}}
            if candidate:
                body["system"] = candidate
            if candidate_user:
                body["userTemplate"] = candidate_user
            resp = post(args.server, "/v1/ai/run", body)
            cands = parse_candidates(resp.get("content", ""), known_labels(cast))
            found, wrong, extra = [], [], []
            for c in cands:
                if match(c.name, cast) is not None:
                    continue   # the endpoint drops these too — not shown to anyone
                ok_quote = quote_in_text(c.evidence, text) if c.evidence else None
                if c.evidence:
                    totals["quotes"] += 1
                    totals["quotes_ok"] += bool(ok_quote)
                label = f"{c.name}" + ("" if ok_quote is not False else " [invented quote]")
                if any(refers_to(c.name, p) for p in removed):
                    found.append(c.name)
                elif any(norm(c.name) == norm(o) or refers_to(c.name, {"name": o}) for o in objects):
                    wrong.append(label + " [object]")
                elif any(refers_to(c.name, p) for p in cast) or ok_quote is False:
                    wrong.append(label + (" [cast]" if ok_quote is not False else ""))
                elif norm(c.name) in extras_ok:
                    extra.append(label + " (real)")
                else:
                    extra.append(label)
            hit = [p["name"] for p in expected if any(refers_to(n, p) for n in found)]
            missed = [p["name"] for p in expected if p["name"] not in hit]
            totals["expected"] += len(expected)
            totals["found"] += len(hit)
            totals["wrong"] += len(wrong)
            tag = f" run {run + 1}" if args.runs > 1 else ""
            print(f"## {scene.title}{tag}  ({len(text):,} chars, {time.time() - t0:.1f}s)")
            print(f"   found {len(hit)}/{len(expected)}" + (f"   MISSED {', '.join(missed)}" if missed else ""))
            if wrong:
                print(f"   WRONG  {', '.join(wrong)}")
            if extra:
                print(f"   extra  {', '.join(extra)}")

    print(f"\nrecall {totals['found']}/{totals['expected']} · wrong {totals['wrong']} · "
          f"quotes found in the text {totals['quotes_ok']}/{totals['quotes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
