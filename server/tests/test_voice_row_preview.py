# SPDX-License-Identifier: MIT
"""POST /v1/voices/{id}/preview — row audition w/ ask-before-load.

Exercises the real app factory against a temp data dir: the managed
kokoro manifest is present (static voices resolve) but never loaded, so
the endpoint must 409 with the engine id instead of 404/405 — the bug
this endpoint replaced. The auto_load happy path is covered by
monkeypatching the manager + synth seam.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture(autouse=True)
def _kokoro_installed(monkeypatch):
    """Kokoro moved to per-engine venv isolation (2026-08-19, the kokoro-onnx
    swap: its numpy>=2 clashes with the shared venv's torch pins), so
    `is_installed` now probes engines/kokoro/.venv — absent on a test
    machine. These tests are about the LOADED gate that sits behind the
    install gate; before the move they only passed by riding the dev
    machine's shared venv."""
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(
        mgr_mod.EngineManifest, "is_installed", property(lambda self: True)
    )


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def test_preset_of_unloaded_engine_409s_with_engine_id(client):
    r = client.post("/v1/voices/af_heart/preview")
    assert r.status_code == 409
    assert "engine_not_loaded:kokoro" in r.text


def test_unknown_voice_404(client):
    r = client.post("/v1/voices/definitely_not_a_voice/preview")
    assert r.status_code == 404


def test_auto_load_loads_then_synthesizes(client, monkeypatch):
    from fastapi import Response

    import justvoice.api.generate_api as gen
    from justvoice.engines import manager as mgr_mod

    loads: list[str] = []
    mgr = mgr_mod.get_manager()
    monkeypatch.setattr(mgr, "load", lambda eid, device=None, variant=None: loads.append(eid))

    async def fake_via_manager(engine_id, req, voice_fields=None):
        return Response(content=b"RIFFfake", media_type="audio/wav")

    monkeypatch.setattr(gen, "_generate_via_manager", fake_via_manager)
    r = client.post("/v1/voices/af_heart/preview?auto_load=true")
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"RIFF")
    assert loads == ["kokoro"]


def test_loaded_engine_skips_the_gate(client, monkeypatch):
    from fastapi import Response

    import justvoice.api.generate_api as gen
    from justvoice.engines import manager as mgr_mod

    mgr = mgr_mod.get_manager()
    monkeypatch.setattr(mgr, "current_id", lambda: "kokoro")

    async def fake_via_manager(engine_id, req, voice_fields=None):
        return Response(content=b"RIFFfake", media_type="audio/wav")

    monkeypatch.setattr(gen, "_generate_via_manager", fake_via_manager)
    r = client.post("/v1/voices/af_heart/preview")
    assert r.status_code == 200, r.text
