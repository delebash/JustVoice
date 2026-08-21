# SPDX-License-Identifier: MIT
"""Print the current commit SHA of every HuggingFace repo the manifests pin.

A dev tool, not part of the server. Run it when you are about to pin — or
re-pin — model revisions:

    python server/scripts/harvest_revisions.py

Why pinning matters: a `sources` row that says `"revision": "main"` does not
name a version, it names a moving target. Upstream can re-upload weights under
the same filenames, and the next machine to install gets different bytes with
no signal anywhere that they differ. Our own byte-count and file-list facts —
the ones the catalog shows and the tests assert — are true of one commit, not
of a branch.

The script reads, in order:
  1. the local speech cache, whose `files.json` records the `commit_sha` the
     bytes on disk actually came from (the strongest evidence: it is what this
     machine downloaded and rendered with);
  2. failing that, the HF API's current `sha` for the repo.

Then it prints a table. It does NOT edit manifests — pinning is a deliberate
edit, with a dated comment, made by a person who has decided that this commit
is the one to ship.

Stdlib only, and network failures degrade to a printed reason. Kokoro is
absent by design: its sources are GitHub release URLs, which are already
version-pinned by the URL itself.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from justvoice.engines.manager import discover_engines  # noqa: E402
from justvoice.paths import default_data_dir  # noqa: E402

HF_API = "https://huggingface.co/api/models/"
UA = {"User-Agent": "justvoice-harvest-revisions/1.0"}


def cached_sha(data_dir: Path, engine_id: str, variant_id: str) -> str | None:
    """The commit this machine's downloaded bytes came from, if it has them."""
    files_json = data_dir / "speech-cache" / engine_id / variant_id / "files.json"
    try:
        data = json.loads(files_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    sha = data.get("commit_sha")
    return sha if isinstance(sha, str) and sha else None


def upstream_sha(repo: str) -> tuple[str | None, str]:
    """(sha, note) for a repo's current default-branch commit."""
    req = urllib.request.Request(HF_API + repo, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, f"unreachable ({type(e).__name__})"
    sha = body.get("sha")
    return (sha, "hf-api") if isinstance(sha, str) else (None, "no sha in response")


def main() -> int:
    data_dir = default_data_dir()
    print(f"speech cache: {data_dir / 'speech-cache'}\n")
    rows: list[tuple[str, str, str, str, str]] = []

    for engine_id, m in sorted(discover_engines().items()):
        for variant in getattr(m.module, "VARIANTS", []) or []:
            vid = variant.get("id", "?")
            for src in variant.get("sources") or []:
                repo = src.get("hf_repo")
                if not repo:
                    continue  # URL-pinned source (kokoro) — nothing to harvest
                pinned = str(src.get("revision") or "(none)")
                sha = cached_sha(data_dir, engine_id, vid)
                where = "speech-cache"
                if not sha:
                    sha, where = upstream_sha(repo)
                rows.append((engine_id, vid, repo, pinned, f"{sha or '—'}  [{where}]"))

    width = [max(len(r[i]) for r in rows) if rows else 0 for i in range(4)]
    for engine_id, vid, repo, pinned, current in rows:
        moved = "" if pinned == current.split(" ")[0] else "   <- PIN ME"
        print(f"{engine_id:<{width[0]}}  {vid:<{width[1]}}  {repo:<{width[2]}}  "
              f"{pinned:<{width[3]}}  {current}{moved}")

    print(
        "\nTo pin: set each row's \"revision\" to the full sha above, with a "
        "dated comment (# <what> @ <date>; bump = deliberate PR)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
