"""Atomic JSON write helper.

Writes go through ``<path>.tmp`` + os.replace() so a partial write
never leaves a corrupt JSON file. Mirrors the pattern the Rust core
used with ``tempfile + rename``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def atomic_write_json(path: Path, data: Any, indent: int = 2) -> None:
    """Write `data` to `path` atomically.

    Creates parent dirs if needed. Renders with `indent` spaces of
    indentation (default 2) for human-readability when operators edit
    the file directly.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(data, indent=indent, default=_default_serializer)
    # `os.replace` is atomic on POSIX + Windows; `Path.replace` calls it.
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _default_serializer(o: Any) -> Any:
    """JSON fallback for non-builtin types used in our models."""
    from datetime import datetime, date

    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if hasattr(o, "model_dump"):
        return o.model_dump()
    raise TypeError(f"Cannot serialize {type(o).__name__}")
