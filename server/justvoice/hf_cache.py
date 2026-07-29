# SPDX-License-Identifier: MIT
"""HuggingFace cache probes — torch-free, safe in the API import graph.

Used by the Engines UI's per-model `on_disk` flags and the capture
readiness probe. A repo counts as cached when its snapshots dir holds at
least one real weight file (HF creates the directory skeleton on failed
downloads, so existence alone lies).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_WEIGHT_EXTS = (".safetensors", ".bin", ".onnx", ".gguf", ".npz", ".pt")

_HF_URL = re.compile(r"huggingface\.co/([^/]+/[^/]+)/")


def repo_from_url(url: str) -> str | None:
    """Extract "org/name" from a huggingface.co resolve URL; None for
    non-HF urls (e.g. Kokoro's GitHub tarballs)."""
    m = _HF_URL.search(url or "")
    return m.group(1) if m else None


def hf_cache_dir() -> Path:
    """The HF hub cache root, computed WITHOUT importing huggingface_hub
    (user directive 2026-06-15: rip the dep — server-side HF fetch is
    plain HTTPS, see installer._hf_snapshot_to). Resolution order matches
    the documented huggingface_hub behavior:
        HF_HUB_CACHE → $HF_HOME/hub → ~/.cache/huggingface/hub
    """
    env = os.environ.get("HF_HUB_CACHE")
    if env:
        return Path(env)
    home = os.environ.get("HF_HOME")
    if home:
        return Path(home) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def is_hf_repo_cached(hf_repo: str) -> bool:
    try:
        repo_cache = hf_cache_dir() / ("models--" + hf_repo.replace("/", "--"))
        snaps = repo_cache / "snapshots"
        if not snaps.is_dir():
            return False
        for snap in snaps.iterdir():
            for f in snap.rglob("*"):
                if f.is_file() and f.suffix in _WEIGHT_EXTS:
                    return True
        return False
    except Exception:
        return False
