# SPDX-License-Identifier: MIT
"""Tests for PATCH /v1/voices/{id} — stored-voice metadata updates.

Covers the VoiceStore.update() partial-update semantics and the HTTP
endpoint behaviour (200 stored, 404 missing, PATCH-skips-None).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from justvoice.models import VoiceRecord
from justvoice.storage.voices import VoiceStore


def _record(id: str = "voice_test1") -> VoiceRecord:
    now = datetime.now(timezone.utc)
    return VoiceRecord(
        id=id,
        engine="kokoro",
        source="cloned",
        name="Sarah",
        language="en-US",
        gender=None,
        created_at=now,
        updated_at=now,
    )


# ── VoiceStore.update() ──────────────────────────────────────────────────────


def test_store_update_sets_fields(tmp_path):
    store = VoiceStore(tmp_path)
    store.create(_record())
    rec = store.update("voice_test1", gender="F", name="Sarah 2")
    assert rec is not None
    assert rec.gender == "F"
    assert rec.name == "Sarah 2"
    # Persisted — fresh store re-reads from disk.
    fresh = VoiceStore(tmp_path)
    assert fresh.get("voice_test1").gender == "F"


def test_store_update_skips_none(tmp_path):
    store = VoiceStore(tmp_path)
    store.create(_record())
    store.update("voice_test1", gender="M")
    rec = store.update("voice_test1", gender=None, name="Renamed")
    assert rec.gender == "M"  # untouched by the None
    assert rec.name == "Renamed"


def test_store_update_missing_returns_none(tmp_path):
    store = VoiceStore(tmp_path)
    assert store.update("nope", gender="F") is None


def test_store_update_bumps_updated_at(tmp_path):
    store = VoiceStore(tmp_path)
    created = store.create(_record())
    rec = store.update("voice_test1", gender="N")
    assert rec.updated_at >= created.updated_at


# ── HTTP endpoint ────────────────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path):
    from justvoice.app import create_app

    app = create_app(data_dir=tmp_path)
    with TestClient(app) as c:
        yield c


def test_patch_voice_updates_gender(client):
    from justvoice.app_state import get_state

    get_state().voices.create(_record())
    r = client.patch("/v1/voices/voice_test1", json={"gender": "F"})
    assert r.status_code == 200
    assert r.json()["gender"] == "F"
    # Round-trips through GET.
    g = client.get("/v1/voices/voice_test1")
    assert g.json()["gender"] == "F"


def test_patch_voice_partial_leaves_other_fields(client):
    from justvoice.app_state import get_state

    get_state().voices.create(_record())
    r = client.patch("/v1/voices/voice_test1", json={"gender": "M"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Sarah"
    assert body["language"] == "en-US"


def test_patch_voice_404_when_missing(client):
    r = client.patch("/v1/voices/voice_missing", json={"gender": "F"})
    assert r.status_code == 404
