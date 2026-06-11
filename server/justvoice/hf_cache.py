# SPDX-License-Identifier: GPL-3.0-or-later
"""HuggingFace cache probes — torch-free, safe in the API import graph.

Used by the Engines UI's per-model `on_disk` flags and the capture
readiness probe. A repo counts as cached when its snapshots dir holds at
least one real weight file (HF creates the directory skeleton on failed
downloads, so existence alone lies).
"""

from __future__ import annotations

import re
from pathlib import Path

_WEIGHT_EXTS = (".safetensors", ".bin", ".onnx", ".gguf", ".npz", ".pt")

_HF_URL = re.compile(r"huggingface\.co/([^/]+/[^/]+)/")


def repo_from_url(url: str) -> str | None:
    """Extract "org/name" from a huggingface.co resolve URL; None for
    non-HF urls (e.g. Kokoro's GitHub tarballs)."""
    m = _HF_URL.search(url or "")
    return m.group(1) if m else None


def is_hf_repo_cached(hf_repo: str) -> bool:
    try:
        from huggingface_hub import constants as hf_constants

        repo_cache = Path(hf_constants.HF_HUB_CACHE) / ("models--" + hf_repo.replace("/", "--"))
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
