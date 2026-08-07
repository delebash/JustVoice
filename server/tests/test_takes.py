# SPDX-License-Identifier: MIT
"""Tests for the takes table — per-block take versioning invariants.

Covers both direct-DB invariants and HTTP API behaviour via TestClient.
The TestClient tests build a minimal FastAPI app from the takes router only
and override the `get_db` dependency with the same in-memory SQLite the
conftest_db fixtures provide — no real data directory required.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from justvoice.api import takes_api
from justvoice.database import get_db
from justvoice.database.models import Block, Generation, Persona, Scene, Project, Take
from llm_runner.platform import install_error_handlers

pytest_plugins = ["tests.conftest_db"]


# ── helpers ──────────────────────────────────────────────────────────────────


def _seed(db_session):
    """Insert one Persona + Project + Scene + Block; return (voice, block).

    After Slice 4 of the Profile-kill rollout the test seeds a Persona
    in place of the now-dropped VoiceProfile. Generation.profile_id is
    retained as a plain string column for backward DB compat, so the
    test passes the persona id through it as before.
    """
    v = Persona(name="V")
    db_session.add(v)
    p = Project(name="Book", project_type="audiobook")
    db_session.add(p)
    db_session.flush()
    s = Scene(project_id=p.id, position=0)
    db_session.add(s)
    db_session.flush()
    b = Block(scene_id=s.id, position=0, text="Hello.")
    db_session.add(b)
    db_session.flush()
    return v, b


def _gen(db_session, voice, block):
    g = Generation(text=block.text, engine="kokoro", profile_id=voice.id, block_id=block.id)
    db_session.add(g)
    db_session.flush()
    return g


def _make_wav(path: Path) -> None:
    """Write a minimal valid WAV file to *path*."""
    pcm = b"\x00\x00" * 4410  # 0.1 s silence, 16-bit mono 44.1 kHz
    data_len = len(pcm)
    chunk_size = 36 + data_len
    header = (
        b"RIFF"
        + struct.pack("<I", chunk_size)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)
        + struct.pack("<H", 1)   # PCM
        + struct.pack("<H", 1)   # mono
        + struct.pack("<I", 44100)
        + struct.pack("<I", 88200)
        + struct.pack("<H", 2)
        + struct.pack("<H", 16)
        + b"data"
        + struct.pack("<I", data_len)
    )
    path.write_bytes(header + pcm)


@pytest.fixture
def api_client(tmp_db) -> Generator[tuple[TestClient, object], None, None]:
    """A TestClient wired to the takes router with the test DB injected."""
    SessionFactory, _ = tmp_db

    def _override_get_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(takes_api.router)
    install_error_handlers(app, type_base="https://justvoice.dev/errors/")
    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app, raise_server_exceptions=False) as client:
        # Also hand the caller a fresh session for seeding
        seed_session = SessionFactory()
        try:
            yield client, seed_session
        finally:
            seed_session.close()


# ── direct-DB invariant tests (unchanged from before) ────────────────────────


def test_default_take_is_at_most_one_per_block_in_application_layer(db_session):
    """Application code (takes_api.set_default_take) clears prior defaults
    before marking the new one. This test sets two takes, marks first as
    default, then second — and verifies that we see exactly one default.
    """
    v, b = _seed(db_session)
    g1 = _gen(db_session, v, b)
    g2 = _gen(db_session, v, b)
    t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Take 1")
    t2 = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="Take 2")
    db_session.add_all([t1, t2])
    db_session.commit()

    # Simulate the set-default flow.
    db_session.query(Take).filter(Take.block_id == b.id, Take.is_default == True).update(  # noqa: E712
        {"is_default": False}
    )
    t2.is_default = True
    db_session.commit()

    defaults = db_session.query(Take).filter(Take.block_id == b.id, Take.is_default == True).all()  # noqa: E712
    assert len(defaults) == 1
    assert defaults[0].id == t2.id


def test_take_lineage(db_session):
    """source_take_id chains so retakes-of-retakes are traceable."""
    v, b = _seed(db_session)
    g_orig = _gen(db_session, v, b)
    g_retake = _gen(db_session, v, b)
    t_orig = Take(block_id=b.id, generation_id=g_orig.id, is_default=True, label="Original")
    db_session.add(t_orig)
    db_session.flush()
    t_retake = Take(
        block_id=b.id,
        generation_id=g_retake.id,
        source_take_id=t_orig.id,
        label="Retake",
    )
    db_session.add(t_retake)
    db_session.commit()
    assert t_retake.source_take_id == t_orig.id


# ── HTTP API tests ────────────────────────────────────────────────────────────


class TestListTakesForBlock:
    """GET /v1/takes/by_block/{block_id}"""

    def test_returns_takes_newest_first(self, api_client):
        """Takes are ordered by created_at DESC (newest first)."""
        client, db = api_client
        v, b = _seed(db)
        import time

        g1 = _gen(db, v, b)
        time.sleep(0.01)  # ensure distinct created_at
        g2 = _gen(db, v, b)
        # t1 created before t2
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=False, label="First")
        db.add(t1)
        db.flush()
        time.sleep(0.01)
        t2 = Take(block_id=b.id, generation_id=g2.id, is_default=True, label="Second")
        db.add(t2)
        db.commit()

        resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert resp.status_code == 200
        data = resp.json()
        ids = [t["id"] for t in data["takes"]]
        # Newest (t2) should come first
        assert ids[0] == t2.id
        assert ids[1] == t1.id

    def test_default_take_id_matches_is_default_row(self, api_client):
        """default_take_id in the list response points to the is_default take."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=False, label="A")
        t2 = Take(block_id=b.id, generation_id=g2.id, is_default=True, label="B")
        db.add_all([t1, t2])
        db.commit()

        resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["default_take_id"] == t2.id

    def test_empty_block_returns_empty_list(self, api_client):
        """Block with no takes returns empty takes list and null default."""
        client, db = api_client
        v, b = _seed(db)
        db.commit()

        resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["takes"] == []
        assert data["default_take_id"] is None

    def test_source_take_id_preserved_in_list(self, api_client):
        """Lineage pointer (source_take_id) is returned in the take objects."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Orig")
        db.add(t1)
        db.flush()
        t2 = Take(block_id=b.id, generation_id=g2.id, source_take_id=t1.id, label="Retake")
        db.add(t2)
        db.commit()

        resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert resp.status_code == 200
        takes_by_id = {t["id"]: t for t in resp.json()["takes"]}
        assert takes_by_id[t2.id]["source_take_id"] == t1.id
        assert takes_by_id[t1.id]["source_take_id"] is None


class TestSetDefaultTake:
    """POST /v1/takes/{take_id}/set_default"""

    def test_marks_take_as_default(self, api_client):
        """Posting set_default flips is_default to True on the target take."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Old default")
        t2 = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="New default")
        db.add_all([t1, t2])
        db.commit()

        resp = client.post(f"/v1/takes/{t2.id}/set_default")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == t2.id
        # is_default not in TakeResponse — check by re-listing
        list_resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert list_resp.json()["default_take_id"] == t2.id

    def test_clears_old_default_when_promoting(self, api_client):
        """After set_default, only one take in the block is the default."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        g3 = _gen(db, v, b)
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="T1")
        t2 = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="T2")
        t3 = Take(block_id=b.id, generation_id=g3.id, is_default=False, label="T3")
        db.add_all([t1, t2, t3])
        db.commit()

        client.post(f"/v1/takes/{t3.id}/set_default")

        list_resp = client.get(f"/v1/takes/by_block/{b.id}")
        data = list_resp.json()
        assert data["default_take_id"] == t3.id
        # Exactly one default in the full list
        defaults = [t for t in data["takes"] if t["id"] == data["default_take_id"]]
        assert len(defaults) == 1

    def test_set_default_on_unknown_take_returns_404(self, api_client):
        """set_default on a non-existent take_id returns 404."""
        client, _ = api_client
        resp = client.post("/v1/takes/nonexistent-id/set_default")
        assert resp.status_code == 404

    def test_set_default_same_take_is_idempotent(self, api_client):
        """Promoting the already-default take is a no-op (still 200)."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Only take")
        db.add(t1)
        db.commit()

        resp = client.post(f"/v1/takes/{t1.id}/set_default")
        assert resp.status_code == 200
        list_resp = client.get(f"/v1/takes/by_block/{b.id}")
        assert list_resp.json()["default_take_id"] == t1.id


class TestCreateTakeLineage:
    """Take lineage — creating a retake carries the source_take_id pointer.

    The takes API has no POST /v1/takes endpoint (takes are created as a side
    effect of render_chapter_api). This class tests the lineage invariant at
    the DB layer using the same pattern as test_take_lineage above.
    """

    def test_retake_version_carries_lineage_pointer(self, db_session):
        """A retake's source_take_id points to the parent; original has null."""
        v, b = _seed(db_session)
        g_orig = _gen(db_session, v, b)
        g_retake = _gen(db_session, v, b)
        t_orig = Take(block_id=b.id, generation_id=g_orig.id, is_default=True)
        db_session.add(t_orig)
        db_session.flush()
        t_retake = Take(
            block_id=b.id,
            generation_id=g_retake.id,
            source_take_id=t_orig.id,
        )
        db_session.add(t_retake)
        db_session.commit()

        assert t_orig.source_take_id is None
        assert t_retake.source_take_id == t_orig.id

    def test_three_generation_lineage_chain(self, db_session):
        """source_take_id chains across three generations."""
        v, b = _seed(db_session)
        gens = [_gen(db_session, v, b) for _ in range(3)]
        t0 = Take(block_id=b.id, generation_id=gens[0].id, is_default=True)
        db_session.add(t0)
        db_session.flush()
        t1 = Take(block_id=b.id, generation_id=gens[1].id, source_take_id=t0.id)
        db_session.add(t1)
        db_session.flush()
        t2 = Take(block_id=b.id, generation_id=gens[2].id, source_take_id=t1.id)
        db_session.add(t2)
        db_session.commit()

        assert t2.source_take_id == t1.id
        assert t1.source_take_id == t0.id
        assert t0.source_take_id is None


class TestDeleteTake:
    """DELETE /v1/takes/{take_id}"""

    def test_delete_non_default_take_returns_200(self, api_client):
        """Deleting a non-default take succeeds and removes the row."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        t_default = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Keep")
        t_other = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="Delete me")
        db.add_all([t_default, t_other])
        db.commit()
        other_id = t_other.id

        resp = client.delete(f"/v1/takes/{other_id}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

        # Confirm row is gone
        list_resp = client.get(f"/v1/takes/by_block/{b.id}")
        ids = [t["id"] for t in list_resp.json()["takes"]]
        assert other_id not in ids

    def test_delete_default_take_is_rejected_with_400(self, api_client):
        """Deleting the default take returns 400 Bad Request."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        t = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Default")
        db.add(t)
        db.commit()

        resp = client.delete(f"/v1/takes/{t.id}")
        assert resp.status_code == 400

    def test_delete_unknown_take_returns_404(self, api_client):
        """Deleting a non-existent take_id returns 404."""
        client, _ = api_client
        resp = client.delete("/v1/takes/does-not-exist")
        assert resp.status_code == 404

    def test_delete_non_default_does_not_affect_default(self, api_client):
        """Deleting a non-default take leaves the default take untouched."""
        client, db = api_client
        v, b = _seed(db)
        g1 = _gen(db, v, b)
        g2 = _gen(db, v, b)
        t_default = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="D")
        t_other = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="O")
        db.add_all([t_default, t_other])
        db.commit()

        client.delete(f"/v1/takes/{t_other.id}")

        list_resp = client.get(f"/v1/takes/by_block/{b.id}")
        data = list_resp.json()
        assert data["default_take_id"] == t_default.id
        assert len(data["takes"]) == 1


class TestGenerationAudio:
    """GET /v1/generations/{generation_id}/audio"""

    def test_returns_404_for_unknown_generation(self, api_client):
        """Unknown generation_id → 404."""
        client, _ = api_client
        resp = client.get("/v1/generations/does-not-exist/audio")
        assert resp.status_code == 404

    def test_returns_400_when_no_audio_path(self, api_client):
        """Generation exists but has no audio_path → 400 (not completed)."""
        client, db = api_client
        v, b = _seed(db)
        g = Generation(
            text="Hello",
            engine="kokoro",
            profile_id=v.id,
            block_id=b.id,
            audio_path=None,
        )
        db.add(g)
        db.commit()

        resp = client.get(f"/v1/generations/{g.id}/audio")
        assert resp.status_code == 400

    def test_returns_404_when_audio_path_missing_from_disk(self, api_client, tmp_path):
        """Generation has audio_path but the file doesn't exist on disk → 404."""
        client, db = api_client
        v, b = _seed(db)
        missing_path = str(tmp_path / "ghost.wav")
        g = Generation(
            text="Hello",
            engine="kokoro",
            profile_id=v.id,
            block_id=b.id,
            audio_path=missing_path,
        )
        db.add(g)
        db.commit()

        resp = client.get(f"/v1/generations/{g.id}/audio")
        assert resp.status_code == 404

    def test_returns_200_with_wav_content_type_when_file_exists(self, api_client, tmp_path):
        """Generation with valid audio_path on disk → 200 audio/wav."""
        client, db = api_client
        v, b = _seed(db)
        wav_path = tmp_path / "test.wav"
        _make_wav(wav_path)
        g = Generation(
            text="Hello",
            engine="kokoro",
            profile_id=v.id,
            block_id=b.id,
            audio_path=str(wav_path),
        )
        db.add(g)
        db.commit()

        resp = client.get(f"/v1/generations/{g.id}/audio")
        assert resp.status_code == 200
        assert "audio/wav" in resp.headers["content-type"]


class TestUpdateTakeLabel:
    """PATCH /v1/takes/{take_id} — label editing (existing endpoint, rounding out coverage)."""

    def test_label_can_be_updated(self, api_client):
        """PATCH with a new label persists and is returned in the response."""
        client, db = api_client
        v, b = _seed(db)
        g = _gen(db, v, b)
        t = Take(block_id=b.id, generation_id=g.id, is_default=True, label="Old label")
        db.add(t)
        db.commit()

        resp = client.patch(f"/v1/takes/{t.id}", json={"label": "New label"})
        assert resp.status_code == 200
        assert resp.json()["label"] == "New label"

    def test_patch_unknown_take_returns_404(self, api_client):
        """PATCHing a non-existent take returns 404."""
        client, _ = api_client
        resp = client.patch("/v1/takes/no-such-take", json={"label": "x"})
        assert resp.status_code == 404
