# SPDX-License-Identifier: MIT
"""/v1/prefs — renderer UI preferences (real rows, not the renderer's localStorage).

A small key/value JSON store for the Vue app's content prefs — appearance,
hidden-voice lists, per-voice gender overrides, speaker-lab presets, autoload.
The renderer GETs the whole document on boot and PATCHes a section on change.

Deliberately separate from `/v1/settings` (typed operator/server config): PATCH
here is a **wholesale per-key** upsert, NOT a deep merge, so a map/list entry can
be removed by sending the smaller value (the settings deep-merge can't express a
deletion). Moving these off `localStorage` lets a thin client read them too.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Pref

router = APIRouter(tags=["prefs"])


def _read_all(db: Session) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in db.query(Pref).all():
        try:
            out[row.key] = json.loads(row.value)
        except (ValueError, TypeError):
            out[row.key] = None
    return out


@router.get("/v1/prefs", summary="The full renderer-prefs document")
async def get_prefs(db: Session = Depends(get_db)) -> dict:
    return _read_all(db)


@router.patch("/v1/prefs", summary="Upsert the given prefs (wholesale per key); returns the merged document")
async def patch_prefs(patch: dict[str, Any], db: Session = Depends(get_db)) -> dict:
    for key, value in patch.items():
        encoded = json.dumps(value)
        row = db.get(Pref, key)
        if row is None:
            db.add(Pref(key=key, value=encoded))
        else:
            row.value = encoded
    db.commit()
    return _read_all(db)


@router.delete("/v1/prefs", status_code=204, summary="Clear all renderer prefs (factory reset)")
async def clear_prefs(db: Session = Depends(get_db)) -> Response:
    db.query(Pref).delete(synchronize_session=False)
    db.commit()
    return Response(status_code=204)
