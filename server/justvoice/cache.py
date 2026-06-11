"""Per-line render cache — disk-backed LRU with in-memory hot tier.

Each scope is a subdirectory; each entry is one PCM-with-format-header
file keyed by `sha256(engine || voice || engine_version || text || delivery || lexicons)`.
"""

from __future__ import annotations

import hashlib
import logging
import struct
import threading
from collections import OrderedDict
from pathlib import Path

from .models import CacheStats, ScopeStats

log = logging.getLogger(__name__)


class CacheKeyBuilder:
    """Composable cache-key hasher. Order matters for stable keys."""

    def __init__(self):
        self._h = hashlib.sha256()

    def with_engine(self, engine_id: str, version: str) -> "CacheKeyBuilder":
        self._h.update(b"engine:")
        self._h.update(engine_id.encode("utf-8"))
        self._h.update(b":")
        self._h.update(version.encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_voice(self, voice_id: str) -> "CacheKeyBuilder":
        self._h.update(b"voice:")
        self._h.update(voice_id.encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_text(self, text: str) -> "CacheKeyBuilder":
        self._h.update(b"text:")
        self._h.update(text.encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_language(self, lang: str | None) -> "CacheKeyBuilder":
        self._h.update(b"lang:")
        self._h.update((lang or "").encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_seed(self, seed: int | None) -> "CacheKeyBuilder":
        self._h.update(b"seed:")
        self._h.update(str(seed or 0).encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_delivery_json(self, canonical: str) -> "CacheKeyBuilder":
        self._h.update(b"delivery:")
        self._h.update(canonical.encode("utf-8"))
        self._h.update(b"\n")
        return self

    def with_lexicons(self, lexicon_ids: list[str]) -> "CacheKeyBuilder":
        for lid in sorted(lexicon_ids):
            self._h.update(b"lex:")
            self._h.update(lid.encode("utf-8"))
            self._h.update(b"\n")
        return self

    def with_effects_chain(self, chain_hash: str) -> "CacheKeyBuilder":
        """Include the resolved effects-chain hash (Slice 6 of the
        Profile-kill plan / Effects v1 wiring). When the chain changes
        the cache busts. Empty chains hash to a constant so "no effects"
        cache hits propagate across requests.
        """
        self._h.update(b"fx:")
        self._h.update((chain_hash or "noeffects").encode("utf-8"))
        self._h.update(b"\n")
        return self

    def finish(self) -> str:
        return self._h.hexdigest()


class RenderCache:
    """Disk-backed LRU. Each scope is a subdirectory of `root`."""

    def __init__(self, root: Path, max_memory_entries: int = 64):
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        # In-memory LRU
        self._memory: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._max_memory_entries = max_memory_entries

    def get(self, scope: str, key: str) -> bytes | None:
        with self._lock:
            mkey = (scope, key)
            if mkey in self._memory:
                self._memory.move_to_end(mkey)
                return self._memory[mkey]
            path = self._path(scope, key)
            if not path.exists():
                return None
            data = path.read_bytes()
            self._memory[mkey] = data
            self._memory.move_to_end(mkey)
            if len(self._memory) > self._max_memory_entries:
                self._memory.popitem(last=False)
            return data

    def has(self, scope: str, key: str) -> bool:
        """Existence probe — no disk read, no LRU promotion. Drives the
        Studio Render cache banner ("N of M lines unchanged")."""
        with self._lock:
            if (scope, key) in self._memory:
                return True
            return self._path(scope, key).exists()

    def put(self, scope: str, key: str, data: bytes) -> None:
        with self._lock:
            path = self._path(scope, key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            mkey = (scope, key)
            self._memory[mkey] = data
            self._memory.move_to_end(mkey)
            if len(self._memory) > self._max_memory_entries:
                self._memory.popitem(last=False)

    def clear(self, scope: str | None = None) -> None:
        with self._lock:
            if scope is None:
                for child in self._root.iterdir():
                    if child.is_dir():
                        for f in child.glob("*.bin"):
                            f.unlink(missing_ok=True)
                        try:
                            child.rmdir()
                        except OSError:
                            pass
                self._memory.clear()
            else:
                d = self._root / scope
                if d.exists():
                    for f in d.glob("*.bin"):
                        f.unlink(missing_ok=True)
                    try:
                        d.rmdir()
                    except OSError:
                        pass
                self._memory = OrderedDict(
                    (k, v) for k, v in self._memory.items() if k[0] != scope
                )

    def stats(self) -> CacheStats:
        scopes: dict[str, ScopeStats] = {}
        total_entries = 0
        total_bytes = 0
        for scope_dir in self._root.iterdir():
            if not scope_dir.is_dir():
                continue
            entries = list(scope_dir.glob("*.bin"))
            bytes_on_disk = sum(f.stat().st_size for f in entries)
            scopes[scope_dir.name] = ScopeStats(
                entries_on_disk=len(entries), bytes_on_disk=bytes_on_disk
            )
            total_entries += len(entries)
            total_bytes += bytes_on_disk
        memory_bytes = sum(len(v) for v in self._memory.values())
        return CacheStats(
            total_entries_on_disk=total_entries,
            total_bytes_on_disk=total_bytes,
            memory_entries=len(self._memory),
            memory_bytes=memory_bytes,
            scopes=scopes,
        )

    def _path(self, scope: str, key: str) -> Path:
        # Sanitize scope name (no slashes / special chars on disk)
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in scope)[:80]
        return self._root / safe / f"{key}.bin"


def pack_pcm_with_format(pcm: bytes, sample_rate: int, channels: int) -> bytes:
    """Prepend a tiny header so the cache file carries format info."""
    return struct.pack("<IH", sample_rate, channels) + pcm


def unpack_pcm_with_format(buf: bytes) -> tuple[int, int, bytes]:
    if len(buf) < 6:
        raise ValueError("buffer too small for PCM-with-format header")
    sr, ch = struct.unpack_from("<IH", buf, 0)
    return sr, ch, buf[6:]
