# SPDX-License-Identifier: MIT
"""S0 + S1 from docs/plans/2026-06-14-engines-download-contract.md:

- S0: GET/PUT/DELETE /v1/engines/{engine}/sources[/{variant}] + the
  resolve_source helper the worker reads.
- S1: spawn_prefetch — a variant's pinned file(s) into the speech cache, with
  progress + cancel.

All network is mocked. The tests run against the real plugin manager so the
variant lookup uses the same code path the server does. (The URL/tarball path
these tests also covered went with kokoro-onnx in the 2026-10-01 switch.)
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from justvoice.engines.audiocpp import release

VARIANT = "chatterbox-multilingual-v2-q8"
PINNED = "Chatterbox-GGUF/chatterbox-q8_0.gguf"


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


@pytest.fixture
def client(app):
    return TestClient(app)


def _put_on_disk(vdir: Path, name: str, size: int) -> None:
    """Files + the speech cache's files.json record, as a finished fetch leaves them."""
    from justvoice import speech_cache

    (vdir / name).parent.mkdir(parents=True, exist_ok=True)
    (vdir / name).write_bytes(b"\0" * size)
    (vdir / speech_cache.MANIFEST_NAME).write_text(json.dumps(
        {"sources": [], "files": [{"path": name, "size": size, "oid": ""}]}), encoding="utf-8")


# ── S0 — sources endpoint ────────────────────────────────────────────


def test_sources_list_uses_catalog_variant_ids_and_manifest_provenance(client):
    r = client.get("/v1/engines/chatterbox/sources")
    assert r.status_code == 200
    body = r.json()
    assert body["engine_id"] == "chatterbox"
    assert body["variants"], "chatterbox should expose variants"
    for v in body["variants"]:
        assert "/" not in v["variant_id"]
        assert v["provenance"] == "manifest"
        assert v["hf_repo"] == release.MODEL_REPO
        assert v["hf_revision"] == release.MODEL_REVISION


def test_sources_put_persists_and_flips_provenance(client):
    r = client.put(
        f"/v1/engines/chatterbox/sources/{VARIANT}",
        json={"hf_repo": "my-fork/audio-gguf", "hf_revision": "v1.2"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["provenance"] == "override"
    assert body["hf_repo"] == "my-fork/audio-gguf"

    after = client.get("/v1/engines/chatterbox/sources").json()
    row = next(v for v in after["variants"] if v["variant_id"] == VARIANT)
    assert row["provenance"] == "override"
    assert row["hf_repo"] == "my-fork/audio-gguf"

    settings = client.get("/v1/settings").json()
    assert settings["engines"]["engine_overrides"]["chatterbox"]["sources"][VARIANT][
        "hf_repo"
    ] == "my-fork/audio-gguf"


def test_sources_delete_reverts_and_gcs_empty_engine(client):
    client.put(f"/v1/engines/chatterbox/sources/{VARIANT}", json={"hf_repo": "x/y"})
    r = client.delete(f"/v1/engines/chatterbox/sources/{VARIANT}")
    assert r.status_code == 200
    assert r.json()["provenance"] == "manifest"
    # Empty engine entry should be GC'd from settings so the tree
    # doesn't accumulate dead keys.
    settings = client.get("/v1/settings").json()
    assert "chatterbox" not in settings["engines"]["engine_overrides"]


def test_sources_negatives(client):
    assert client.get("/v1/engines/nope/sources").status_code == 404
    assert client.put("/v1/engines/chatterbox/sources/not-a-real-variant",
                      json={"hf_repo": "x/y"}).status_code == 404
    assert client.put(f"/v1/engines/chatterbox/sources/{VARIANT}", json={}).status_code == 400
    # A URL override went with the tarball engines; hf_repo is required.
    assert client.put(f"/v1/engines/chatterbox/sources/{VARIANT}",
                      json={"url": "http://x"}).status_code == 400


def test_an_override_swaps_the_repo_and_keeps_the_pinned_files(client, app):
    """The resolver the prefetch worker reads is the same one GET uses. An
    override points at a mirror holding the SAME files: the runtime's config
    names them, and a whole-tree fetch of a GGUF repo runs to many gigabytes."""
    from justvoice.api.engine_sources_api import resolve_source

    before, prov = resolve_source("chatterbox", VARIANT)
    assert prov == "manifest"
    assert before["hf_repo"] == release.MODEL_REPO
    assert before["files"] == [PINNED]

    client.put(f"/v1/engines/chatterbox/sources/{VARIANT}",
               json={"hf_repo": "operator/mirror", "hf_revision": "abc"})
    after, prov = resolve_source("chatterbox", VARIANT)
    assert prov == "override"
    assert after["hf_repo"] == "operator/mirror"
    assert after["files"] == [PINNED]
    assert [(s["hf_repo"], s["revision"], s["files"]) for s in after["sources"]] == [
        ("operator/mirror", "abc", [PINNED])]


# ── S1 — spawn_prefetch worker ──────────────────────────────────────


def _wait_for_job(state, job_id: str, *, phase: str, timeout: float = 5.0) -> dict[str, Any]:
    """Spin until the worker thread reaches the target phase."""
    end = time.time() + timeout
    row = None
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


def _fake_hub(monkeypatch, *, size: int, stream=None):
    """The KIT resolver + downloader are the fetch path — fake both."""
    import llm_runner.runner.download as kit_dl
    import llm_runner.runner.models as kit_models

    def select(repo, *, revision="main", files=None):
        assert files == [PINNED], "the pinned file list must reach the resolver"
        return "commit0000sha", [{"type": "file", "path": PINNED, "oid": "gitoid",
                                  "size": size, "lfs": {"oid": "lfssha256", "size": size}}]

    def write(url, dest, on_progress=None, cancel_check=None, headers=None, **_kw):
        assert "/resolve/commit0000sha/" in url   # sha-pinned, never symbolic
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x" * size)
        if on_progress:
            on_progress(size, size)

    monkeypatch.setattr(kit_models, "select_repo_files", select)
    monkeypatch.setattr(kit_dl, "stream_download", stream or write)


def test_prefetch_lands_plain_files_no_hub_dep_no_hub_layout(client, app, monkeypatch, tmp_path):
    """Two standing directives in one pin. 2026-06-15 ("rip hugging face dep"):
    the worker must not need huggingface_hub. Phase ② (plan doc §12): fetches
    land as PLAIN files + files.json in the speech cache — the hub-cache layout
    (refs/blobs/snapshots + symlink-or-copy, the WinError-1314 class) must NOT
    be written at all."""
    import sys

    from justvoice import installer, speech_cache
    from justvoice.app_state import get_state

    monkeypatch.setitem(sys.modules, "huggingface_hub", None)
    _fake_hub(monkeypatch, size=1024)

    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", VARIANT)
    row = _wait_for_job(state, job_id, phase="completed")
    assert row["error"] in (None, "")
    assert row["bytes_total"] == 1024   # the resolved real size

    vdir = speech_cache.variant_dir(state.data_dir, "chatterbox", VARIANT)
    assert (vdir / PINNED).stat().st_size == 1024
    man = speech_cache.read_manifest(vdir)
    assert man["sources"][0]["commit_sha"] == "commit0000sha"
    assert {f["oid"] for f in man["files"]} == {"lfssha256"}
    assert speech_cache.variant_on_disk(state.data_dir, "chatterbox", VARIANT)
    assert not list(tmp_path.rglob("blobs"))
    assert not list(tmp_path.rglob("snapshots"))


def _slow_stream(started: list):
    from llm_runner.runner.download import DownloadCancelled

    def stream(url, dest, on_progress=None, cancel_check=None, headers=None, **_kw):
        dest.parent.mkdir(parents=True, exist_ok=True)
        (dest.parent / (dest.name + ".part")).write_bytes(b"y" * 512)
        started.append(True)
        for _ in range(200):
            if cancel_check and cancel_check():
                raise DownloadCancelled()
            time.sleep(0.02)
    return stream


def test_prefetch_cancel_fails_the_job_and_keeps_partials_for_resume(client, app, monkeypatch):
    """A mid-stream cancel marks the job failed=cancelled. The kit downloader's
    chunked partials are KEPT — the next fetch resumes past them — and the
    variant does not count as on disk."""
    from justvoice import installer, speech_cache
    from justvoice.app_state import get_state

    started: list = []
    _fake_hub(monkeypatch, size=4096, stream=_slow_stream(started))
    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", VARIANT)
    for _ in range(100):
        if started:
            break
        time.sleep(0.02)
    installer.cancel(job_id)

    row = _wait_for_job(state, job_id, phase="failed")
    assert "cancel" in (row.get("error") or "").lower()
    assert not speech_cache.variant_on_disk(state.data_dir, "chatterbox", VARIANT)
    vdir = speech_cache.variant_dir(state.data_dir, "chatterbox", VARIANT)
    assert list(vdir.rglob("*.part")), "partials are kept for the resume"


def test_prefetch_cancel_via_http_endpoint(client, app, monkeypatch):
    """End-to-end: DELETE /v1/jobs/{id} signals the cancel cooperatively — the
    wire path the renderer's Cancel button hits."""
    from justvoice import installer
    from justvoice.app_state import get_state

    started: list = []
    _fake_hub(monkeypatch, size=4096, stream=_slow_stream(started))
    state = get_state()
    job_id = installer.spawn_prefetch(state, "chatterbox", VARIANT)
    for _ in range(100):
        if started:
            break
        time.sleep(0.02)

    resp = client.delete(f"/v1/jobs/{job_id}")
    assert resp.status_code == 202
    assert resp.json() == {"cancelled": job_id}
    row = _wait_for_job(state, job_id, phase="failed", timeout=5.0)
    assert "cancel" in (row.get("error") or "").lower()


# ── The models list serves local_dir for "Open folder" ───────────────


def test_models_list_serves_speech_cache_local_dir(client, app):
    """The desktop "Open folder" verb needs the resolved on-disk folder. The
    SERVER resolves it so the cache-layout knowledge stays in one place — the
    client never composes paths."""
    from justvoice import speech_cache
    from justvoice.app_state import get_state

    vdir = speech_cache.variant_dir(get_state().data_dir, "chatterbox", VARIANT)
    _put_on_disk(vdir, PINNED, 16)
    row = next(v for v in client.get("/v1/engines/chatterbox/models").json()["variants"]
               if v["id"] == VARIANT)
    assert row["on_disk"] is True
    assert row["local_dir"] == str(vdir)


def test_a_model_not_in_the_speech_cache_is_not_on_disk(client, app):
    """Only the speech cache counts — never a Hugging Face cache: every variant
    comes from the one audio.cpp-gguf repo, so a cached copy of any of its files
    would otherwise mark them all downloaded."""
    rows = client.get("/v1/engines/chatterbox/models").json()["variants"]
    assert all(v["on_disk"] is False and v["local_dir"] is None for v in rows)


# ── The whole-store speech-cache clear verb ──────────────────────────


def test_speech_cache_clear_deletes_all_and_flips_on_disk(client, app):
    from justvoice import speech_cache
    from justvoice.app_state import get_state
    from justvoice.paths import speech_cache_root

    st = get_state()
    vdir = speech_cache.variant_dir(st.data_dir, "chatterbox", VARIANT)
    _put_on_disk(vdir, PINNED, 64)

    r = client.post("/v1/engines/speech-cache/clear").json()
    assert r["ok"] is True
    assert r["bytes"] > 0
    assert not speech_cache_root(st.data_dir).exists()
    row = next(v for v in client.get("/v1/engines/chatterbox/models").json()["variants"]
               if v["id"] == VARIANT)
    assert row["on_disk"] is False and row["local_dir"] is None


def test_speech_cache_clear_refuses_while_an_engine_is_loaded(client, app, monkeypatch):
    """One grammar with the kit's models-cache/clear: a resident model's file is
    open in the runtime — refuse honestly, never half-delete."""
    from justvoice.engines.manager import get_manager

    monkeypatch.setattr(get_manager(), "status", lambda eid: "loaded")
    r = client.post("/v1/engines/speech-cache/clear").json()
    assert r == {"ok": False, "detail": "unload engines first"}
