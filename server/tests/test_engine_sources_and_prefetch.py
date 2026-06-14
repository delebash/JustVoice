# SPDX-License-Identifier: GPL-3.0-or-later
"""S0 + S1 from docs/plans/2026-06-14-engines-download-contract.md:

- S0: GET/PUT/DELETE /v1/engines/{engine}/sources[/{variant}] + the
  resolve_source helper the worker reads.
- S1: spawn_prefetch unified worker — both the URL-stream path (kokoro
  shape) and the HF-snapshot path (chatterbox shape), with progress +
  cancel + partial cleanup.

All network is mocked. The tests run against the real plugin manager so
the variant lookup uses the same code path the server does.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


@pytest.fixture
def client(app):
    return TestClient(app)


# ── S0 — sources endpoint ────────────────────────────────────────────


def test_sources_list_uses_catalog_variant_ids_and_manifest_provenance(client):
    r = client.get("/v1/engines/chatterbox/sources")
    assert r.status_code == 200
    body = r.json()
    assert body["engine_id"] == "chatterbox"
    # Catalog (not raw manifest.MODELS) is the source of truth, so
    # variant ids are slug-shaped — no '/'.
    assert body["variants"], "chatterbox should expose variants"
    for v in body["variants"]:
        assert "/" not in v["variant_id"]
        assert v["provenance"] == "manifest"
        # Either url or hf_repo is filled in from the catalog.
        assert v["url"] or v["hf_repo"]


def test_sources_put_persists_and_flips_provenance(client):
    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]

    r = client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"hf_repo": "my-fork/chatterbox", "hf_revision": "v1.2"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provenance"] == "override"
    assert body["hf_repo"] == "my-fork/chatterbox"

    # GET reflects the override.
    after = client.get("/v1/engines/chatterbox/sources").json()
    row = next(v for v in after["variants"] if v["variant_id"] == variant_id)
    assert row["provenance"] == "override"
    assert row["hf_repo"] == "my-fork/chatterbox"

    # And the settings store now holds the override.
    settings = client.get("/v1/settings").json()
    assert settings["engines"]["engine_overrides"]["chatterbox"]["sources"][variant_id][
        "hf_repo"
    ] == "my-fork/chatterbox"


def test_sources_delete_reverts_and_gcs_empty_engine(client):
    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"hf_repo": "x/y"},
    )
    r = client.delete(f"/v1/engines/chatterbox/sources/{variant_id}")
    assert r.status_code == 200
    assert r.json()["provenance"] == "manifest"

    # Empty engine entry should be GC'd from settings so the tree
    # doesn't accumulate dead keys.
    settings = client.get("/v1/settings").json()
    assert "chatterbox" not in settings["engines"]["engine_overrides"]


def test_sources_negatives(client):
    # Unknown engine.
    assert client.get("/v1/engines/nope/sources").status_code == 404
    # Unknown variant.
    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    assert (
        client.put(
            "/v1/engines/chatterbox/sources/not-a-real-variant",
            json={"url": "http://x"},
        ).status_code
        == 404
    )
    # Empty body.
    assert (
        client.put(
            f"/v1/engines/chatterbox/sources/{variant_id}",
            json={},
        ).status_code
        == 400
    )


def test_resolve_source_honors_operator_override(client, app):
    """The resolver the prefetch worker reads is the same one GET uses."""
    from justvoice.api.engine_sources_api import resolve_source

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    eff_before, prov_before = resolve_source("chatterbox", variant_id)
    assert prov_before == "manifest"
    assert eff_before["url"]

    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"hf_repo": "operator/fork"},
    )
    eff_after, prov_after = resolve_source("chatterbox", variant_id)
    assert prov_after == "override"
    assert eff_after["hf_repo"] == "operator/fork"


# ── S1 — spawn_prefetch worker ──────────────────────────────────────


def _wait_for_job(state, job_id: str, *, phase: str, timeout: float = 5.0) -> dict[str, Any]:
    """Spin until the worker thread reaches the target phase."""
    end = time.time() + timeout
    while time.time() < end:
        row = state.job_get(job_id)
        if row and row.get("phase") == phase:
            return row
        time.sleep(0.02)
    raise AssertionError(f"job {job_id!r} never reached phase {phase!r}: last={row}")


def test_prefetch_unknown_engine_raises(app):
    from justvoice.app_state import get_state
    from justvoice.installer import spawn_prefetch

    with pytest.raises(ValueError):
        spawn_prefetch(get_state(), "no-such-engine", "vX")


def test_prefetch_url_path_streams_and_completes(client, app, monkeypatch, tmp_path):
    """URL-source variant: spawn_prefetch should stream the file via the
    same _stream_download primitive the legacy installer used. We mock the
    stream so the test stays offline; success means the worker reaches
    'completed' and the target dir contains a fetched file.
    """
    from justvoice.app_state import get_state
    from justvoice import installer

    # Find an engine + variant that resolves to a URL source. Chatterbox
    # is HF-by-catalog, so we override it to a URL for this test —
    # exercising both S0 (override) AND S1 (URL path) at once.
    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"url": "http://example.test/fake-model.bin"},
    )

    # Stub _stream_download: write a small payload, report progress, succeed.
    def fake_stream(url, dest, on_progress, cancel_check=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x" * 4096)
        on_progress(4096)
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", fake_stream)

    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)

    row = _wait_for_job(state, job_id, phase="completed")
    assert row["error"] in (None, "")
    # And the file landed in the engine's models_dir/<variant_id>/
    from justvoice.engines.manager import get_manager

    models_dir = get_manager().get_manifest("chatterbox").models_dir / variant_id
    assert (models_dir / "fake-model.bin").exists()


def test_prefetch_hf_path_completes_via_mocked_snapshot(client, app, monkeypatch):
    """HF-source variant: snapshot_download is mocked to a no-op (the real
    one is a multi-MB network round-trip). Worker should reach 'completed'.

    `huggingface_hub` may not be installed in this test environment (it's a
    runtime dep for HF-distributed engines, not a test dep). We inject a
    stub module into sys.modules so the inner `from huggingface_hub import
    snapshot_download` resolves to our fake without needing the real wheel.
    """
    import sys
    import types

    from justvoice.app_state import get_state
    from justvoice import installer

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][1]["variant_id"]  # second variant, untouched

    def fake_snapshot(*, repo_id, revision, local_dir, local_dir_use_symlinks, tqdm_class):  # noqa: ARG001
        Path(local_dir).mkdir(parents=True, exist_ok=True)
        (Path(local_dir) / "config.json").write_text("{}")
        # Touch the reporter so its update path is exercised at least once.
        rep = tqdm_class(total=1024, desc=repo_id)
        rep.update(1024)
        rep.close()

    stub = types.ModuleType("huggingface_hub")
    stub.snapshot_download = fake_snapshot  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "huggingface_hub", stub)

    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)
    row = _wait_for_job(state, job_id, phase="completed")
    assert row["error"] in (None, "")


def test_prefetch_cancel_cleans_partials(client, app, monkeypatch):
    """A mid-stream cancel should mark the job failed=cancelled and remove
    the partial dir so the on-disk check doesn't lie about completeness.
    """
    from justvoice.app_state import get_state
    from justvoice import installer

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"url": "http://example.test/fake-model.bin"},
    )

    state = get_state()
    job_id_holder: dict[str, str] = {}

    def slow_stream(url, dest, on_progress, cancel_check=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"y" * 1024)
        on_progress(1024)
        # Wait for the cancel signal; mimic a real download checking
        # cancel between chunks.
        for _ in range(50):
            if cancel_check and cancel_check():
                raise installer._Cancelled()
            time.sleep(0.02)
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", slow_stream)

    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)
    job_id_holder["id"] = job_id

    # Let the worker start, then cancel.
    time.sleep(0.1)
    installer.cancel(job_id)

    row = _wait_for_job(state, job_id, phase="failed")
    assert "cancel" in (row.get("error") or "").lower()

    # Partials gone.
    from justvoice.engines.manager import get_manager

    target = get_manager().get_manifest("chatterbox").models_dir / variant_id
    assert not target.exists() or not any(target.iterdir())


def test_prefetch_cancel_via_http_endpoint(client, app, monkeypatch):
    """End-to-end: DELETE /v1/jobs/{id} signals the cancel cooperatively,
    the worker raises _Cancelled, and the partial dir is cleaned. This is
    the wire path the renderer Cancel button will hit.
    """
    from justvoice.app_state import get_state
    from justvoice import installer
    from justvoice.engines.manager import get_manager

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]
    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"url": "http://example.test/fake.bin"},
    )

    state = get_state()

    def slow_stream(url, dest, on_progress, cancel_check=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"z" * 1024)
        on_progress(1024)
        for _ in range(100):
            if cancel_check and cancel_check():
                raise installer._Cancelled()
            time.sleep(0.02)
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", slow_stream)

    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)
    # Let the worker enter the slow-stream loop.
    time.sleep(0.1)

    # Hit the REST cancel endpoint the renderer will call.
    resp = client.delete(f"/v1/jobs/{job_id}")
    assert resp.status_code == 202
    assert resp.json() == {"cancelled": job_id}

    row = _wait_for_job(state, job_id, phase="failed", timeout=3.0)
    assert "cancel" in (row.get("error") or "").lower()

    target = get_manager().get_manifest("chatterbox").models_dir / variant_id
    assert not target.exists() or not any(target.iterdir()), (
        "partial dir should be removed after cancel"
    )
