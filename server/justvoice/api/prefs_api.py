# SPDX-License-Identifier: MIT
"""/v1/prefs — renderer UI preferences (real rows, not the renderer's localStorage).

A small key/value JSON store for the Vue app's content prefs — appearance,
hidden-voice lists, per-voice gender overrides, speaker-lab presets, autoload.
The renderer GETs the whole document on boot and PATCHes a section on change.

Deliberately separate from `/v1/settings` (typed operator/server config): PATCH
here is a **wholesale per-key** upsert, NOT a deep merge, so a map/list entry can
be removed by sending the smaller value (the settings deep-merge can't express a
deletion). Moving these off `localStorage` lets a thin client read them too.

The router itself is the kit's (this contract was the family donor —
target-tree P9); what lives here is JustVoice's storage: the `prefs` table,
one JSON-encoded value per row. Module-attr session access, not a from-import:
`SessionLocal` is REBOUND by init_db (and again on a test's re-init), so a
from-import would freeze the pre-boot None — the P5 server_auth lesson.
"""

from __future__ import annotations

import json
from typing import Any

from llm_runner.platform import make_prefs_router

from ..database import session as _db
from ..database.models import Pref


def _read_all() -> dict[str, Any]:
    with _db.SessionLocal() as db:
        out: dict[str, Any] = {}
        for row in db.query(Pref).all():
            try:
                out[row.key] = json.loads(row.value)
            except (ValueError, TypeError):
                out[row.key] = None
        return out


def _write_many(patch: dict[str, Any]) -> None:
    with _db.SessionLocal() as db:
        for key, value in patch.items():
            encoded = json.dumps(value)
            row = db.get(Pref, key)
            if row is None:
                db.add(Pref(key=key, value=encoded))
            else:
                row.value = encoded
        db.commit()


def _clear() -> None:
    with _db.SessionLocal() as db:
        db.query(Pref).delete(synchronize_session=False)
        db.commit()


router = make_prefs_router(read_all=_read_all, write_many=_write_many, clear=_clear)
