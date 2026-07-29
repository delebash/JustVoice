# SPDX-License-Identifier: MIT
"""DELETE /v1/generations — engine / favorited / persona-aware voice
filters (wiring-audit W1). The voice filter previously matched only the
legacy profile_id column, silently missing every persona-era row.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _seed(tmp_path):
    """Three generations: legacy voice row, persona-bound row, other-engine
    favorited row. Returns their ids in that order."""
    from justvoice.database import get_db
    from justvoice.database.models import Generation, Persona

    db = next(get_db())
    try:
        db.add(Persona(id="per-1", name="Narrator", voice_id="voice-1"))
        db.flush()
        legacy = Generation(
            text="legacy", engine="kokoro", status="completed",
            profile_id="voice-1",
        )
        persona_era = Generation(
            text="persona-era", engine="kokoro", status="completed",
            persona_id="per-1",
        )
        other = Generation(
            text="other", engine="dia", status="completed",
            is_favorited=True,
        )
        db.add_all([legacy, persona_era, other])
        db.commit()
        return legacy.id, persona_era.id, other.id
    finally:
        db.close()


def _remaining_ids(client):
    rows = client.get("/v1/takes/recent").json()["takes"]
    return {t["id"] for t in rows}


def test_voice_filter_matches_legacy_and_persona_rows(client, tmp_path):
    legacy_id, persona_id, other_id = _seed(tmp_path)

    dry = client.delete("/v1/generations?voice_id=voice-1").json()
    assert dry["dry_run"] is True and dry["deleted_count"] == 2

    r = client.delete("/v1/generations?voice_id=voice-1&confirm=true").json()
    assert r["deleted_count"] == 2

    assert _remaining_ids(client) == {other_id}


def test_engine_filter(client, tmp_path):
    legacy_id, persona_id, other_id = _seed(tmp_path)

    r = client.delete("/v1/generations?engine=dia&confirm=true").json()
    assert r["deleted_count"] == 1

    assert _remaining_ids(client) == {legacy_id, persona_id}


def test_favorited_false_preserves_favorites(client, tmp_path):
    legacy_id, persona_id, other_id = _seed(tmp_path)

    r = client.delete("/v1/generations?favorited=false&confirm=true").json()
    assert r["deleted_count"] == 2

    assert _remaining_ids(client) == {other_id}


def test_no_filters_still_400s(client, tmp_path):
    _seed(tmp_path)
    r = client.delete("/v1/generations")
    assert r.status_code == 400
