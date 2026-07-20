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

    Durability: the tmp file is flushed + fsync'd before the rename, so a
    power loss between the write and the kernel flushing file *data* to disk
    can't expose a zero-length settings/personas/lexicons file — the exact
    corruption this module exists to prevent. `write_text` + `os.replace`
    alone gave no such guarantee. On ANY failure (serialization or IO) the
    tmp file is unlinked instead of being left as a stray `.tmp` sibling.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, default=_default_serializer)
            f.flush()
            os.fsync(f.fileno())  # force file *data* to disk before the rename
        # `os.replace` is atomic on POSIX + Windows; `Path.replace` calls it.
        os.replace(tmp, path)
    except BaseException:
        # Serialization or IO failed (or was interrupted mid-write) — don't
        # leave a partial `.tmp` behind for the next reader to trip on.
        tmp.unlink(missing_ok=True)
        raise
    # Best-effort: fsync the parent directory so the rename itself is durable
    # on POSIX. Can't fsync a directory handle on Windows (os.open raises), so
    # skip cleanly there — the data fsync above already covers the file bytes.
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass


def _default_serializer(o: Any) -> Any:
    """JSON fallback for non-builtin types used in our models."""
    from datetime import datetime, date

    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if hasattr(o, "model_dump"):
        return o.model_dump()
    raise TypeError(f"Cannot serialize {type(o).__name__}")
