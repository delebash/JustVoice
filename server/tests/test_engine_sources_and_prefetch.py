# SPDX-License-Identifier: MIT
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
import requests
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


def test_prefetch_hf_path_uses_plain_https_no_hub_dep(client, app, monkeypatch, tmp_path):
    """User directive 2026-06-15 ("rip hugging face dep"): the prefetch
    worker for HF sources MUST NOT import huggingface_hub. It talks to
    HF Hub's public HTTP API directly and writes the canonical cache
    layout (refs/<rev>, blobs/<oid>, snapshots/<sha>/<path>) so engine
    subprocesses' from_pretrained() finds the weights.

    We mock the three HTTP endpoints (revision, tree, resolve) plus
    _stream_download, then assert the layout the worker produced on
    disk matches the HF cache shape.
    """
    import sys

    from justvoice.app_state import get_state
    from justvoice import installer

    # Make sure huggingface_hub isn't accidentally importable in the
    # test process — the worker must not need it.
    monkeypatch.setitem(sys.modules, "huggingface_hub", None)

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][1]["variant_id"]
    # Pin the cache root to tmp_path so the test doesn't write to ~/.cache
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "hf"))

    # Mock the three HF Hub HTTP endpoints.
    class _FakeResp:
        def __init__(self, json_data):
            self._json = json_data
        def raise_for_status(self): pass
        def json(self): return self._json

    fake_tree = [
        {"type": "file", "path": "config.json", "oid": "git0000config", "size": 42},
        {"type": "file", "path": "model.safetensors",
         "oid": "git00000model", "size": 1024,
         "lfs": {"oid": "lfssha256weights", "size": 1024}},
        {"type": "file", "path": "tokenizer/vocab.json", "oid": "git0000vocab", "size": 17},
        {"type": "directory", "path": "tokenizer"},  # filtered out
    ]
    real_get = requests.get
    def fake_get(url, **kw):
        if "/revision/" in url:
            return _FakeResp({"sha": "commit0000sha"})
        if "/tree/" in url:
            return _FakeResp(fake_tree)
        return real_get(url, **kw)
    import requests as _requests
    monkeypatch.setattr(_requests, "get", fake_get)
    monkeypatch.setattr(installer, "requests", _requests)

    # Stub _stream_download to write the file size in dummy bytes.
    def fake_stream(url, dest, on_progress, cancel_check=None):
        # Echo size from the URL's filename (we control the fake tree).
        name = url.rsplit("/", 1)[-1]
        size = next((e.get("size", 0) for e in fake_tree if e.get("path", "").endswith(name)), 0)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x" * int(size))
        on_progress(int(size))
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", fake_stream)

    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)
    row = _wait_for_job(state, job_id, phase="completed")
    assert row["error"] in (None, "")

    # Verify the cache layout the worker produced.
    repo_dir = tmp_path / "hf" / "models--ResembleAI--chatterbox-turbo"
    # Chatterbox-turbo is variant 1's hf_repo — confirm from the source.
    if not repo_dir.exists():
        # Other repo name. Find what was written.
        cands = list((tmp_path / "hf").glob("models--*"))
        assert cands, "no HF cache dir written"
        repo_dir = cands[0]

    assert (repo_dir / "refs" / "main").read_text() == "commit0000sha"
    # blobs/ should have one entry per file, named by lfs.oid OR git oid
    blobs = list((repo_dir / "blobs").iterdir())
    assert {b.name for b in blobs} == {"git0000config", "lfssha256weights", "git0000vocab"}
    # snapshots/<sha>/<path> should resolve (via symlink or copy) to a
    # file of the right size — that's what from_pretrained() will read.
    snap = repo_dir / "snapshots" / "commit0000sha"
    assert (snap / "config.json").stat().st_size == 42
    assert (snap / "model.safetensors").stat().st_size == 1024
    assert (snap / "tokenizer" / "vocab.json").stat().st_size == 17


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


# ── A1+A2 from docs/plans/2026-06-14-engines-progress-accuracy.md ───
# One smooth bar through download AND extract: bytes_total covers
# downloaded + unpacked archive bytes; per-member extract advances
# bytes_downloaded so the bar never freezes during extract.


def _make_tarball(dir: Path, *, payload_files: list[tuple[str, int]]) -> Path:
    """Create a small .tar.bz2 with the requested (name, byte_size) members."""
    import io
    import tarfile

    archive = dir / "fake-archive.tar.bz2"
    with tarfile.open(archive, "w:bz2") as tar:
        for name, size in payload_files:
            data = b"x" * size
            info = tarfile.TarInfo(name=name)
            info.size = size
            tar.addfile(info, io.BytesIO(data))
    return archive


def test_estimate_archive_unpacked_sums_member_sizes(tmp_path):
    from justvoice.installer import _estimate_archive_unpacked

    archive = _make_tarball(tmp_path, payload_files=[
        ("model.onnx", 4096),
        ("tokens.txt", 256),
        ("voices/spk_001.bin", 2048),
    ])
    assert _estimate_archive_unpacked(archive, "fake-archive.tar.bz2") == 4096 + 256 + 2048


def test_extract_tar_bz2_fires_on_member_with_size_and_supports_cancel(tmp_path):
    from justvoice.installer import _extract_tar_bz2, _Cancelled

    archive = _make_tarball(tmp_path, payload_files=[
        ("a.bin", 100),
        ("b.bin", 200),
        ("c.bin", 50),
    ])
    out = tmp_path / "out"
    out.mkdir()
    seen: list[int] = []
    _extract_tar_bz2(archive, out, "fake-archive.tar.bz2", on_member=lambda n: seen.append(n))
    assert seen == [100, 200, 50]
    assert (out / "a.bin").read_bytes() == b"x" * 100

    # Cancel mid-extract.
    out2 = tmp_path / "out2"
    out2.mkdir()
    cancel_after = {"hits": 0}
    def _cancel() -> bool:
        cancel_after["hits"] += 1
        return cancel_after["hits"] > 1
    seen2: list[int] = []
    with pytest.raises(_Cancelled):
        _extract_tar_bz2(archive, out2, "fake-archive.tar.bz2",
                         on_member=lambda n: seen2.append(n),
                         cancel_check=_cancel)
    # One member extracted before cancel kicked in.
    assert seen2 == [100]


def test_url_path_progress_advances_through_extract(client, app, monkeypatch, tmp_path):
    """End-to-end: _url_stream_to should report monotonic bytes_downloaded
    that ticks through BOTH download and extract phases against a unified
    bytes_total = download + unpacked. Bar must not freeze when phase
    flips to 'extracting'.
    """
    from justvoice.app_state import get_state
    from justvoice import installer
    from justvoice.engines.manager import get_manager

    r0 = client.get("/v1/engines/chatterbox/sources").json()
    variant_id = r0["variants"][0]["variant_id"]

    # Real tarball — so unpacked = real sum of member sizes.
    members = [("model.onnx", 4096), ("voices/v1.bin", 8192), ("tokens.txt", 256)]
    fake_tar = _make_tarball(tmp_path, payload_files=members)
    download_bytes = fake_tar.stat().st_size

    # Override to a .tar.bz2 URL so _url_stream_to takes the archive path.
    client.put(
        f"/v1/engines/chatterbox/sources/{variant_id}",
        json={"url": "http://example.test/fake.tar.bz2"},
    )

    # Stub _stream_download to copy the real tarball + report bytes.
    def fake_stream(url, dest, on_progress, cancel_check=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(fake_tar.read_bytes())
        on_progress(download_bytes)
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", fake_stream)

    # Capture every job_update so we can assert monotonic progress.
    state = get_state()
    history: list[dict] = []
    real_update = state.job_update
    def _capture(*args, **kw):
        real_update(*args, **kw)
        snap = state.job_get(args[0])
        if snap:
            history.append({k: snap.get(k) for k in ("phase", "bytes_downloaded", "bytes_total")})
    monkeypatch.setattr(state, "job_update", _capture)

    job_id = installer.spawn_prefetch(state, "chatterbox", variant_id)
    row = _wait_for_job(state, job_id, phase="completed")
    assert row["error"] in (None, "")

    # Final bytes_total should equal download + sum(member sizes).
    expected_unpacked = sum(s for _, s in members)
    assert row["bytes_total"] == download_bytes + expected_unpacked
    assert row["bytes_downloaded"] == row["bytes_total"], (
        f"final progress must hit 100% — got {row['bytes_downloaded']}/{row['bytes_total']}"
    )

    # Monotonic — no backwards step.
    seen = [h["bytes_downloaded"] or 0 for h in history if h.get("bytes_downloaded") is not None]
    for i in range(1, len(seen)):
        assert seen[i] >= seen[i - 1], f"bar moved backwards: {seen}"

    # Extract phase MUST have at least one update where bytes_downloaded
    # advances PAST the download point (the freeze the user reported).
    extract_advances = [
        h["bytes_downloaded"]
        for h in history
        if h.get("phase") == "extracting" and (h.get("bytes_downloaded") or 0) > download_bytes
    ]
    assert extract_advances, (
        "bar did not advance during extract — bytes_downloaded stayed "
        f"<= download size ({download_bytes}); history={history[-10:]}"
    )

    # And the file landed where the prefetch worker put it.
    models_dir = get_manager().get_manifest("chatterbox").models_dir / variant_id
    assert (models_dir / "model.onnx").exists()
