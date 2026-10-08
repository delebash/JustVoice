# SPDX-License-Identifier: MIT
"""The Python half of the py_compat parity check (wave D of step 5).

    python compare-pycompat.py <cases.json> <out.json>

Answers each generated case the way CPython does: json.loads (the value, with floats marked,
or the JSONDecodeError text), bytes.decode("utf-8" / "utf-8-sig", strict and "replace"),
csv.reader over io.StringIO(newline=""), str.splitlines / title / isupper / capitalize, float(),
format(x, "g") and format(x, ".1f"), html.unescape, re.escape lengths.
"""

from __future__ import annotations

import csv
import html
import io
import json
import re
import sys
from pathlib import Path


def mark(v):
    """A parsed JSON value with its floats marked (JSON can't tell 1.0 from 1)."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return {"$float": repr(v)}
    if isinstance(v, list):
        return [mark(x) for x in v]
    return {"$dict": [[k, mark(x)] for k, x in v.items()]}


def attempt(fn):
    try:
        return {"ok": fn()}
    except Exception as e:  # noqa: BLE001
        return {"err": f"{type(e).__name__}: {e}"}


def main(cases_path: str, out_path: str) -> None:
    c = json.loads(Path(cases_path).read_text(encoding="utf-8"))
    out = {
        "json": [attempt(lambda s=s: mark(json.loads(s))) for s in c["json"]],
        "utf8": [
            {
                "strict": attempt(lambda b=b: bytes.fromhex(b).decode("utf-8")),
                "sig": attempt(lambda b=b: bytes.fromhex(b).decode("utf-8-sig")),
                "replace": bytes.fromhex(b).decode("utf-8", errors="replace"),
            }
            for b in c["utf8"]
        ],
        "csv": [attempt(lambda t=t: list(csv.reader(io.StringIO(t, newline="")))) for t in c["csv"]],
        "str": [
            {"splitlines": s.splitlines(), "title": s.title(), "isupper": s.isupper(), "capitalize": s.capitalize()}
            for s in c["str"]
        ],
        "float": [attempt(lambda s=s: repr(float(s))) for s in c["float"]],
        "fmt": [{"g": format(float(x), "g"), "f1": format(float(x), ".1f")} for x in c["num"]],
        "unescape": [html.unescape(s) for s in c["unescape"]],
        "escape": [len(re.escape(s)) for s in c["escape"]],
    }
    # ASCII escapes: a lone surrogate (a JSON "\ud83d" cut in half) can't be written as UTF-8.
    Path(out_path).write_text(json.dumps(out), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2])
