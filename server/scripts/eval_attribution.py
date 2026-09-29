# SPDX-License-Identifier: MIT
"""Score speaker attribution (Studio · Script · Analyze) against an answer key.

    npm run eval:attribution                         # server on 127.0.0.1:8741
    npm run eval:attribution -- --runs 2 --route direct
    npm run eval:attribution -- --system draft.txt   # try a prompt, save nothing
    npm run eval:attribution -- --fixes-from "Bigger Inside"   # with the user's fixes in the prompt
    npm run eval:attribution -- --sample the-speckled-band     # published prose, a plain-text import

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

Every run also reports Script's flags (`justvoice/extraction/flags.py`, the
function the app ships): how many WRONG lines sit inside a flag group
(caught), how many don't (missed), and how many groups hold no wrong line at
all (false alarms).

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

from justvoice.extraction.flags import flag_groups, lines_from_rows, quote_left_open  # noqa: E402
from justvoice.extraction.segmentation import split_into_paragraphs  # noqa: E402
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


def build_fixes(book, key: dict, args, chars: list[dict]) -> list[dict]:
    """The user's fixes as Analyze sends them (`_resolve_corrections`): a line's
    text and the persona it belongs to. Built from the answer key of ONE chapter,
    which the caller then leaves out of the score, so a fix never hands over an
    answer being tested. Each snippet is the line exactly as a block stores it —
    the segmenter's dialogue text — because that is what a fix records."""
    from justvoice.extraction.segmentation import segment_paragraphs, split_into_paragraphs

    scene = next((s for s in book.scenes if s.title == args.fixes_from), None)
    if scene is None or args.fixes_from not in key["chapters"]:
        raise SystemExit(f"--fixes-from: no keyed chapter called {args.fixes_from!r}")
    text = "\n\n".join(line.text for line in scene.lines if line.text)
    spoken = [s["text"] for s in segment_paragraphs(split_into_paragraphs(text)) if s["kind"] == "dialogue"]
    name_to_id = {c["name"]: c["id"] for c in chars}
    pool = [(spoken[int(d)], name_to_id[who]) for d, who in key["chapters"][args.fixes_from].items()
            if who in name_to_id and who != "Narrator" and int(d) < len(spoken)]
    if args.fixes_pick == "shortest":
        pool.sort(key=lambda p: len(p[0]))
        picked = pool[: args.fixes]
    else:
        step = max(len(pool) / max(args.fixes, 1), 1)
        picked = [pool[int(i * step)] for i in range(min(args.fixes, len(pool)))]
    return [{"text_snippet": t, "persona_id": pid} for t, pid in picked]


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
    ap.add_argument("--fixes-from", metavar="CHAPTER",
                    help="send fixes (the user's past corrections) built from this keyed chapter's "
                         "answers, and leave that chapter out of the score so no answer leaks")
    ap.add_argument("--fixes", type=int, default=12,
                    help="how many fixes to send (Analyze sends the 12 most recent)")
    ap.add_argument("--fixes-pick", choices=["shortest", "spread"], default="shortest",
                    help="shortest lines (least context, the risky kind) or evenly spread")
    args = ap.parse_args()

    root = HERE.parents[2] / "samples" / args.sample
    key = json.loads((root / "attribution-truth.json").read_text(encoding="utf-8"))
    # A key may name its book file and the adapter that reads it — a plain-text
    # book goes through book_prose, the path a non-JustWrite import takes.
    book_file = key.get("book", "book.json")
    book = run_adapter(key.get("adapter", "justwrite"), (root / book_file).read_bytes(), filename=book_file)

    # The cast exactly as _resolve_cast shapes it for Analyze. A cast entry is a
    # name, or {"name", "aliases", "notes"} for a book that ships no characters
    # (the key then stands in for what Discover would have added).
    cast = [c if isinstance(c, dict) else {"name": c} for c in key["cast"]]
    cast_names = [c["name"] for c in cast]

    def char(name: str, aliases, notes) -> dict:
        return {"id": ("p_" + name.lower().replace(" ", "_")) if args.readable_ids else slug(name),
                "name": name, "role": None, "gender": None, "pronouns": None,
                "aliases": list(aliases or []), "description": notes}

    chars = [{"id": "p_narrator", "name": "Narrator", "role": None, "gender": None,
              "pronouns": None, "aliases": [], "description": None}]
    if book.characters:
        chars += [char(c.name, c.aliases, c.notes) for c in book.characters if c.name in cast_names]
    else:
        chars += [char(c["name"], c.get("aliases"), c.get("notes")) for c in cast]
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

    if args.fixes_from:
        body_extra["corrections"] = build_fixes(book, key, args, chars)

    print(f"Attribution test · {key.get('title') or book.project.name} · {args.server} · {args.runs} run(s)"
          f" · {', '.join(f'{k}={v!r:.40}' for k, v in body_extra.items()) or 'live settings'}\n")
    for fix in body_extra.get("corrections", []):
        print(f"   fix: “{fix['text_snippet'][:60]}” -> {id_to_name.get(fix['persona_id'])}")

    tests = []   # (title, text, truth, also_ok)
    for scene in book.scenes:
        if args.chapter and scene.title not in args.chapter:
            continue
        if scene.title not in key["chapters"] or scene.title == args.fixes_from:
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
    flag_total = Counter()
    dump = []
    cast_ids = {c["id"] for c in chars}
    for title, text, truth, also_ok in tests:
        scene = SimpleNamespace(title=title)
        for run in range(args.runs):
            t0 = time.time()
            r = post(args.server, "/v1/extraction/analyze-text",
                     {"text": text, "characters": chars, **body_extra})
            dialogue = [row for row in r["rows"] if row["kind"] == "dialogue"]
            open_paras = {i for i, p in enumerate(split_into_paragraphs(text)) if quote_left_open(p)}
            groups = flag_groups(lines_from_rows(r["rows"], narrator_ids=("narrator", "p_narrator")),
                                 cast_ids, open_paragraphs=open_paras)
            flags_on = {}
            for g in groups:
                for lid in g.lines:
                    flags_on.setdefault(lid, []).append(g.check)
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
                             "source": src, "confidence": row.get("confidence"), "verdict": verdict,
                             "flags": flags_on.get(f"D{i}", [])})
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
            wrong = {f"D{d['d']}" for d in dump
                     if d["chapter"] == scene.title and d["run"] == run and d["verdict"] == "WRONG"}
            caught = {lid for lid in wrong if lid in flags_on}
            idle = [g for g in groups if not wrong & set(g.lines)]
            kinds = Counter(g.check for g in groups)
            flag_total.update(groups=len(groups), wrong=len(wrong), caught=len(caught),
                              idle=len(idle))
            print(f"   flags: {len(groups)} group(s)"
                  f"{' (' + ' · '.join(f'{k} {n}' for k, n in kinds.items()) + ')' if kinds else ''}"
                  f" · caught {len(caught)} of {len(wrong)} wrong line(s)"
                  f"{' ' + ', '.join(sorted(wrong - caught)) + ' missed' if wrong - caught else ''}"
                  f" · {len(idle)} group(s) hold no wrong line")

    n = sum(grand.values())
    print(f"\nTOTAL right {grand['right']}/{n} ({100 * grand['right'] / max(n, 1):.0f}%) · "
          f"WRONG {grand['WRONG']} ({100 * grand['WRONG'] / max(n, 1):.0f}%) · "
          f"blank {grand['blank']} ({100 * grand['blank'] / max(n, 1):.0f}%)")
    print("by source: " + " · ".join(
        f"{s}: {by_source[(s, 'right')]}/{sum(v for (ss, _), v in by_source.items() if ss == s)} right"
        f"{', ' + str(by_source[(s, 'WRONG')]) + ' wrong' if by_source[(s, 'WRONG')] else ''}"
        for s in ("tag", "propagated", "llm", "floored") if any(ss == s for ss, _ in by_source)))
    print(f"flags: {flag_total['groups']} group(s) · caught {flag_total['caught']} of "
          f"{flag_total['wrong']} wrong line(s) · {flag_total['idle']} group(s) hold no wrong line")
    if args.out:
        Path(args.out).write_text(json.dumps(dump, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
