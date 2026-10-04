# SPDX-License-Identifier: MIT
"""The speech-model cache — plain files plus a written manifest.

Phase ② of the 2026-08-13 speech redesign (plan doc §12): speech engines'
model files live at ``<data_dir>/speech-cache/<engine>/<variant>/`` as PLAIN
files at their repo-relative paths, with one ``files.json`` per variant as
the on-disk truth:

    {"sources": [{"hf_repo": "...", "revision": "...", "commit_sha": "..."}],
     "fetched_at": 1755150000000,
     "files": [{"path": "...", "size": 123, "oid": "..."}, ...]}

Design points, each deliberate:
- NO HF hub-cache layout — no blobs, no snapshots, no symlink-or-copy
  machinery. The WinError-1314 class (hub's Windows symlink fallback hole)
  has no code path left because nothing here ever links.
- Downloads ride the KIT's chunked downloader (`stream_download`: resumable
  parts, per-chunk retry, the shared 429 rate gate) resolved by the kit's
  `select_repo_files` (explicit pinned file lists; a missing name fails
  loud). File URLs pin the RESOLVED commit sha, so a moving branch can't
  tear a download.
- `variant_on_disk` verifies every manifest file exists at its recorded
  size (stat, no hashing) — this replaces folder-non-empty heuristics and
  HF-cache probing for speech engines.
- Multi-repo variants nest one subdir per repo under the variant dir
  (``<owner>--<name>/``); single-repo variants keep their files at the variant
  root — the folder the speech runtime's config points into.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .storage.atomic import atomic_write_json

log = logging.getLogger(__name__)

MANIFEST_NAME = "files.json"
_HF_BASE = "https://huggingface.co"


def variant_dir(data_dir: Path, engine_id: str, variant_id: str) -> Path:
    from .paths import speech_cache_root

    return speech_cache_root(data_dir) / engine_id / variant_id


def read_manifest(vdir: Path) -> dict[str, Any] | None:
    """The variant's files.json, or None (absent/unreadable — not truth)."""
    import json

    try:
        return json.loads((vdir / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def variant_on_disk(data_dir: Path, engine_id: str, variant_id: str) -> bool:
    """The on-disk truth: a manifest exists and EVERY file it names exists
    at its recorded size. Anything less is False — a half-fetched variant
    never reads as installed (the old folder-non-empty heuristic did)."""
    vdir = variant_dir(data_dir, engine_id, variant_id)
    man = read_manifest(vdir)
    if not man:
        return False
    for f in man.get("files") or []:
        p = vdir / f["path"]
        try:
            if not p.is_file() or p.stat().st_size != int(f["size"]):
                return False
        except OSError:
            return False
    return bool(man.get("files"))


def any_variant_on_disk(data_dir: Path, engine_id: str) -> bool:
    """True when at least one of this engine's variants is COMPLETE in the
    cache (phase ④): the manager's `is_installed` consults this, so a
    prefetched shared engine reads as installed and the load door never
    re-downloads through the legacy engine-dir install steps."""
    from .paths import speech_cache_root

    root = speech_cache_root(data_dir) / engine_id
    try:
        children = [c.name for c in root.iterdir() if c.is_dir()]
    except OSError:
        return False
    return any(variant_on_disk(data_dir, engine_id, name) for name in children)


def variant_disk_bytes(data_dir: Path, engine_id: str, variant_id: str) -> int:
    """Recorded total bytes of the variant (manifest sum; 0 when absent)."""
    man = read_manifest(variant_dir(data_dir, engine_id, variant_id))
    if not man:
        return 0
    return sum(int(f.get("size") or 0) for f in man.get("files") or [])


def _download_kwargs() -> dict:
    """The kit's per-download settings from the runner config when the
    shared service is wired; plain defaults otherwise."""
    try:
        from llm_runner.runner.download import download_kwargs
        from llm_runner.runner.lifecycle import get_service

        return download_kwargs(get_service().config())
    except Exception:  # noqa: BLE001 — bare tests / standalone
        return {"segments": 8, "retries": 3}


def fetch_hf_variant(
    data_dir: Path,
    engine_id: str,
    variant_id: str,
    sources: list[dict[str, Any]],
    *,
    on_progress: Callable[[int, int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Fetch a variant's pinned files into the speech cache and write its
    manifest. `sources` rows: {"hf_repo": str, "revision": str|None,
    "files": [paths]|None} — None files = the whole repo tree. Multi-source
    variants nest per-repo subdirs. Progress is cumulative bytes across
    every file of every source, against the RESOLVED real total. Raises the
    kit's DownloadCancelled on cancel; already-present files at the right
    size are skipped (resume/idempotent). Returns the written manifest."""
    # One fetch per variant at a time: a Download and a Load of the same model (or two loads)
    # used to download the same file at once, the second deleting what the first had just
    # finished (audit 2026-10-04 §5 E6).
    with _fetch_lock(engine_id, variant_id):
        return _fetch_hf_variant(data_dir, engine_id, variant_id, sources,
                                 on_progress=on_progress, cancel_check=cancel_check)


_FETCH_LOCKS: dict[str, Any] = {}
_FETCH_LOCKS_GUARD = threading.Lock()


def _fetch_lock(engine_id: str, variant_id: str):
    with _FETCH_LOCKS_GUARD:
        return _FETCH_LOCKS.setdefault(f"{engine_id}/{variant_id}", threading.Lock())


def _verify_lfs_sha256(path: Path, oid: str | None) -> None:
    """A large file's oid on Hugging Face is the sha256 of its content: check it, and refuse
    (and delete) a file that doesn't match. A git blob's oid (40 hex) is not a content hash
    of the file, so it is not checked. Files were checked by size only until 2026-10-04."""
    if not oid or len(oid) != 64:
        return
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest().lower() != oid.lower():
        path.unlink(missing_ok=True)
        raise RuntimeError(f"{path.name} does not match its published checksum — it was deleted; "
                           "download it again")


def _fetch_hf_variant(
    data_dir: Path,
    engine_id: str,
    variant_id: str,
    sources: list[dict[str, Any]],
    *,
    on_progress: Callable[[int, int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    from llm_runner.runner.download import stream_download
    from llm_runner.runner.models import (
        _entry_oid,
        _entry_size,
        hf_download_headers,
        select_repo_files,
    )

    vdir = variant_dir(data_dir, engine_id, variant_id)
    vdir.mkdir(parents=True, exist_ok=True)
    nest = len(sources) > 1
    headers = hf_download_headers()
    kwargs = _download_kwargs()

    # Resolve every source first: real sizes give the bar its denominator,
    # and a bad repo/file list fails before any byte moves.
    resolved: list[tuple[dict, str, list[dict], Path]] = []
    total = 0
    for src in sources:
        repo = src["hf_repo"]
        revision = src.get("revision") or "main"
        sha, entries = select_repo_files(repo, revision=revision,
                                         files=src.get("files"))
        root = vdir / repo.replace("/", "--") if nest else vdir
        resolved.append((src, sha, entries, root))
        total += sum(_entry_size(e) for e in entries)
    if on_progress:
        on_progress(0, total)

    done = 0
    recorded: list[dict[str, Any]] = []
    for src, sha, entries, root in resolved:
        repo = src["hf_repo"]
        for e in entries:
            path, size = e["path"], _entry_size(e)
            rel = (Path(repo.replace("/", "--")) / path) if nest else Path(path)
            dest = vdir / rel
            recorded.append({"path": rel.as_posix(), "size": size,
                             "oid": _entry_oid(e)})
            if dest.is_file() and dest.stat().st_size == size:
                done += size
                if on_progress:
                    on_progress(done, total)
                continue
            # Pin the resolved sha, not the symbolic revision — a branch
            # moving mid-fetch cannot tear the variant.
            url = f"{_HF_BASE}/{repo}/resolve/{sha}/{path}"
            base = done
            stream_download(
                url, dest,
                on_progress=(lambda n, _t, _b=base: on_progress(_b + n, total))
                if on_progress else None,
                cancel_check=cancel_check,
                headers=headers,
                **kwargs,
            )
            _verify_lfs_sha256(dest, _entry_oid(e))
            done += size
            if on_progress:
                on_progress(done, total)

    manifest = {
        "sources": [
            {"hf_repo": s["hf_repo"], "revision": s.get("revision") or "main",
             "commit_sha": sha}
            for (s, sha, _e, _r) in resolved
        ],
        "fetched_at": int(time.time() * 1000),
        "files": recorded,
    }
    atomic_write_json(vdir / MANIFEST_NAME, manifest)
    return manifest
