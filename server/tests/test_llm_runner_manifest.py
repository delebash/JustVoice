# SPDX-License-Identifier: GPL-3.0-or-later
"""P1.1 — built-in LLM runner manifest: schema + loader + endpoint.

docs/plans/2026-06-16-builtin-llm-runner.md. Verifies the manifest loads
and validates, that its JSON keys are camelCase (the shared-contract
decision), and that GET /v1/llm-runner/manifest serves it camelCased.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    from justvoice.app import create_app

    return TestClient(create_app(data_dir=tmp_path))


def test_manifest_loads_and_validates():
    from justvoice.llm_runner import load_manifest

    m = load_manifest(refresh=True)
    assert m.schema_version == 1
    assert m.llamacpp.pinned_build, "must pin an exact build tag"
    assert m.llamacpp.binaries, "must declare at least one binary asset"
    # Every binary resolves either a github asset URL or a docker image.
    for b in m.llamacpp.binaries:
        assert b.asset_url or b.image, f"binary {b.platform}/{b.gpu} has no source"
    # Pin is an exact tag, never 'latest' (which breaks on API changes).
    assert m.llamacpp.pinned_build != "latest"


def test_manifest_models_are_hf_repos_with_quant():
    from justvoice.llm_runner import load_manifest

    m = load_manifest(refresh=True)
    assert m.models, "catalog should have at least one model"
    for entry in m.models:
        # hf_repo is an org/repo on HuggingFace; quant drives file resolution
        # at download time (no hardcoded filenames in the manifest).
        assert "/" in entry.hf_repo, f"{entry.id}: hf_repo must be org/repo"
        assert entry.quant, f"{entry.id}: must declare a quant"
        assert entry.tier in {"cpu", "low-vram-moe", "mid", "high"}


def test_manifest_json_keys_are_camelcase():
    """The on-disk JSON is the shared contract — keys must be camelCase."""
    from justvoice.llm_runner.manifest import manifest_path

    raw = json.loads(manifest_path().read_text(encoding="utf-8"))
    assert "schemaVersion" in raw
    assert "flagPresets" in raw
    assert "vramFit" in raw
    assert "pinnedBuild" in raw["llamacpp"]
    # snake_case leakage would mean the alias generator wasn't applied.
    assert "schema_version" not in raw
    assert "pinned_build" not in raw["llamacpp"]


def test_endpoint_serves_camelcase(client):
    r = client.get("/v1/llm-runner/manifest")
    assert r.status_code == 200
    body = r.json()
    # Response must be camelCase for the shared Vue llm-ui.
    assert body["schemaVersion"] == 1
    assert "flagPresets" in body and "vramFit" in body
    assert body["llamacpp"]["pinnedBuild"]
    assert "schema_version" not in body
    # MTP preset + base flags present (composed by the spawner later).
    assert "--spec-type" in body["flagPresets"]["mtp"]
    assert "-ngl" in body["flagPresets"]["base"]


def test_camel_roundtrip_parses_both_forms():
    """populate_by_name=True: the model parses camelCase (wire) AND
    snake_case (Python) input, so internal construction stays idiomatic."""
    from justvoice.llm_runner.schema import BinaryAsset

    by_alias = BinaryAsset.model_validate({"platform": "windows", "gpu": "cpu", "serverExe": "x.exe"})
    by_name = BinaryAsset(platform="windows", gpu="cpu", server_exe="x.exe")
    assert by_alias.server_exe == "x.exe"
    assert by_name.model_dump(by_alias=True)["serverExe"] == "x.exe"
