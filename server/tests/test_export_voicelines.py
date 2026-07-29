# SPDX-License-Identifier: MIT
"""Voiceline zip export — layout, manifest, stable ids, unassigned guard."""

from __future__ import annotations

import io
import json
import struct
import zipfile

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


def _wav(seconds: float = 0.25, rate: int = 16000) -> bytes:
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 0) * int(rate * seconds))
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


CSV = """id,scene,character,text
Q01_HALE_001,Ashfall Village,Guard Hale,"Halt. State your business."
Q01_VYRA_001,Ashfall Village,Vyra,"I saw you in the smoke."
Q02_KEEPER_001,The Ember Gate,The Gatekeeper,"Three seals were placed."
"""


def _seed(client) -> str:
    r = client.post(
        "/v1/projects/import",
        data={"source": "csv_lines", "dry_run": "false"},
        files={"file": ("emberfall.csv", CSV.encode(), "text/csv")},
    )
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_zip_layout_and_manifest(client, monkeypatch):
    pid = _seed(client)
    monkeypatch.setattr(
        "justvoice.export_voicelines._render_block_production",
        lambda state, persona, block: _wav(),
    )
    r = client.post(f"/v1/projects/{pid}/export_voicelines")
    assert r.status_code == 200, r.text
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = sorted(zf.namelist())
    assert "ashfall-village/Q01_HALE_001.wav" in names
    assert "ashfall-village/Q01_VYRA_001.wav" in names
    assert "the-ember-gate/Q02_KEEPER_001.wav" in names
    manifest = json.loads(zf.read("manifest.json"))
    assert [m["line_id"] for m in manifest] == [
        "Q01_HALE_001", "Q01_VYRA_001", "Q02_KEEPER_001",
    ]
    entry = manifest[0]
    assert entry["character"] == "Guard Hale"
    assert entry["file"] == "ashfall-village/Q01_HALE_001.wav"
    assert entry["duration_s"] == 0.25
    assert len(entry["text_hash"]) == 16


def test_unassigned_voice_fails_with_actionable_error(client):
    pid = _seed(client)
    # No voices assigned to the imported personas → production renderer
    # must refuse with guidance rather than emit silent/garbage audio.
    r = client.post(f"/v1/projects/{pid}/export_voicelines")
    assert r.status_code == 400
    assert "no voice assigned" in r.text
