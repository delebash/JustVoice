# SPDX-License-Identifier: GPL-3.0-or-later
"""JustVoice ↔ shared llm-runner integration.

The LLM-runner core lives in its OWN package (`llm_runner`, repo
`just-llm-runner`) and is consumed as a git dependency. JustVoice's only
concern is that the package's router is MOUNTED on the app and serves the
shared camelCase contract. The package's own unit tests (manifest schema,
binary selection, hardware detection) live in the just-llm-runner repo —
they are NOT duplicated here.

See docs/plans/2026-06-16-builtin-llm-runner.md.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    from justvoice.app import create_app

    return TestClient(create_app(data_dir=tmp_path))


def test_manifest_endpoint_mounted_and_camelcase(client):
    r = client.get("/v1/llm-runner/manifest")
    assert r.status_code == 200
    body = r.json()
    # Shared contract is camelCase (the Vue llm-ui reads the same shape).
    assert body["schemaVersion"] == 1
    assert body["llamacpp"]["pinnedBuild"]
    assert "flagPresets" in body and "vramFit" in body
    assert "schema_version" not in body
    # Spawner-relevant flags survive the round-trip.
    assert "-ngl" in body["flagPresets"]["base"]
    assert "--spec-type" in body["flagPresets"]["mtp"]


def test_hardware_endpoint_mounted_and_camelcase(client):
    # The standalone package adds /hardware (the in-tree shim never had it).
    r = client.get("/v1/llm-runner/hardware")
    assert r.status_code == 200
    body = r.json()
    assert body["platform"] in {"windows", "macos", "linux"}
    # camelCase aliases on the wire, not snake_case attribute names.
    assert "cpuCores" in body and "ramMb" in body
    assert "cpu_cores" not in body
