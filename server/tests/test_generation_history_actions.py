# SPDX-License-Identifier: GPL-3.0-or-later
"""History-row actions wired by the parity audit: favorite toggle +
single-generation delete (the History table's ★ / ✕ buttons were
decorative — no endpoints, no handlers)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _make_generation(tmp_path) -> str:
    from justvoice.database import get_db
    from justvoice.database.models import Generation

    wav = tmp_path / "g.wav"
    wav.write_bytes(b"RIFF0000WAVE")
    db = next(get_db())
    try:
        gen = Generation(text="hello", engine="test", status="completed", audio_path=str(wav))
        db.add(gen)
        db.commit()
        return gen.id
    finally:
        db.close()


def test_favorite_toggle_roundtrip(client, tmp_path) -> None:
    gen_id = _make_generation(tmp_path)

    r = client.patch(f"/v1/generations/{gen_id}/favorite")
    assert r.status_code == 200 and r.json()["is_favorited"] is True

    rows = client.get("/v1/takes/recent").json()["takes"]
    assert any(t["id"] == gen_id and t["is_favorited"] for t in rows)

    r = client.patch(f"/v1/generations/{gen_id}/favorite")
    assert r.json()["is_favorited"] is False


def test_delete_generation_removes_row_and_audio(client, tmp_path) -> None:
    gen_id = _make_generation(tmp_path)
    audio = tmp_path / "g.wav"
    assert audio.exists()

    r = client.delete(f"/v1/generations/{gen_id}")
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert not audio.exists()

    rows = client.get("/v1/takes/recent").json()["takes"]
    assert all(t["id"] != gen_id for t in rows)

    assert client.delete(f"/v1/generations/{gen_id}").status_code == 404
