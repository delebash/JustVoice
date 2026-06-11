# SPDX-License-Identifier: GPL-3.0-or-later
"""AI usage ledger — tokens + duration per feature (CONCEPTS §13.1).

Every dispatch.chat() call records one entry: feature, model, prompt /
completion tokens, wall time, ok/error. In-memory ring (capped) +
totals-by-feature; powers Settings → AI usage. Persisting the ledger to
SQLite is Phase-1.5 follow-on — totals survive a session, which is the
JustWrite-parity behavior this ports.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field

_LOG_CAP = 200


@dataclass
class UsageEntry:
    feature: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    duration_ms: int
    ok: bool
    error: str | None = None
    at: float = field(default_factory=time.time)


class UsageLedger:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._log: deque[UsageEntry] = deque(maxlen=_LOG_CAP)

    def record(self, entry: UsageEntry) -> None:
        with self._lock:
            self._log.append(entry)

    def snapshot(self) -> dict:
        with self._lock:
            entries = list(self._log)
        by_feature: dict[str, dict] = {}
        for e in entries:
            agg = by_feature.setdefault(
                e.feature,
                {"calls": 0, "errors": 0, "prompt_tokens": 0, "completion_tokens": 0, "duration_ms": 0},
            )
            agg["calls"] += 1
            agg["errors"] += 0 if e.ok else 1
            agg["prompt_tokens"] += e.prompt_tokens
            agg["completion_tokens"] += e.completion_tokens
            agg["duration_ms"] += e.duration_ms
        return {
            "by_feature": by_feature,
            "recent": [asdict(e) for e in reversed(entries[-30:])],
            "total_calls": len(entries),
        }

    def clear(self) -> None:
        with self._lock:
            self._log.clear()


_ledger = UsageLedger()


def get_ledger() -> UsageLedger:
    return _ledger
