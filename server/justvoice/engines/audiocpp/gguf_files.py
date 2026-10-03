# SPDX-License-Identifier: MIT
"""The files an audio.cpp GGUF carries inside it — read without audio.cpp.

audio.cpp's standalone GGUFs embed their non-weight files (configs, vocabularies, Kokoro's
voices) in three metadata arrays: `audiocpp.embedded_files.names`, `.offsets` (one more than
the names) and `.data` (the bytes). Kokoro's voices are `voices.json` plus `voices/<id>.bin`,
raw float32 of 510 × 256 — what a blend is made from (gap 2,
docs/plans/2026-10-03-gap-2-kokoro-blends.md). Only the metadata section is read; the tensor
data after it never is.
"""

from __future__ import annotations

import struct
from pathlib import Path

_SCALAR = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
_STRING, _ARRAY = 8, 9


def _read(f, fmt: str):
    size = struct.calcsize("<" + fmt)
    return struct.unpack("<" + fmt, f.read(size))[0]


def _skip_or_read(f, kind: int, keep: bool):
    if kind in _SCALAR:
        value = f.read(struct.calcsize("<" + _SCALAR[kind]))
        return struct.unpack("<" + _SCALAR[kind], value)[0] if keep else None
    if kind == _STRING:
        n = _read(f, "Q")
        raw = f.read(n)
        return raw.decode("utf-8") if keep else None
    if kind == _ARRAY:
        item, n = _read(f, "I"), _read(f, "Q")
        if item == 0:                      # uint8 — the embedded bytes
            raw = f.read(n)
            return raw if keep else None
        if item in _SCALAR:
            width = struct.calcsize("<" + _SCALAR[item])
            raw = f.read(width * n)
            return list(struct.unpack("<" + _SCALAR[item] * n, raw)) if keep else None
        values = [_skip_or_read(f, item, keep) for _ in range(n)]
        return values if keep else None
    raise ValueError(f"unknown GGUF metadata type {kind}")


_KEYS = ("audiocpp.embedded_files.names", "audiocpp.embedded_files.offsets",
         "audiocpp.embedded_files.data")


def embedded_files(path: Path) -> dict[str, bytes]:
    """Every embedded file of an audio.cpp GGUF, by its name (e.g. "voices/af_heart.bin").
    An empty dict when the file embeds none."""
    found: dict[str, object] = {}
    with open(path, "rb") as f:
        if f.read(4) != b"GGUF":
            raise ValueError(f"{path} is not a GGUF file")
        _read(f, "I")                      # version
        _read(f, "Q")                      # tensor count
        for _ in range(_read(f, "Q")):     # metadata entries
            key = f.read(_read(f, "Q")).decode("utf-8")
            kind = _read(f, "I")
            value = _skip_or_read(f, kind, key in _KEYS)
            if key in _KEYS:
                found[key] = value
                if len(found) == len(_KEYS):
                    break
    if len(found) < len(_KEYS):
        return {}
    names, offsets, data = (found[k] for k in _KEYS)
    if len(offsets) != len(names) + 1:
        raise ValueError(f"{path}: {len(names)} embedded names but {len(offsets)} offsets")
    return {name: data[offsets[i]:offsets[i + 1]] for i, name in enumerate(names)}
