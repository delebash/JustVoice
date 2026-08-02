# SPDX-License-Identifier: MIT
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


def test_runner_router_mounted_and_camelcase(client):
    # /v1/llm-runner/manifest is GONE — runner-manifest.json was deleted with A7
    # ("config is data, it belongs in the DB"); this test asserted the dead route
    # and passed only while JV's environment froze a pre-A7 llm-runner. The
    # CURRENT mounted contract: /config serves the engine defaults (camelCase)
    # and /models serves the catalog view.
    r = client.get("/v1/llm-runner/config")
    assert r.status_code == 200
    body = r.json()
    assert body["llamacpp"]["pinnedBuild"]  # camelCase — the Vue llm-ui reads this shape
    assert "pinned_build" not in body.get("llamacpp", {})

    r = client.get("/v1/llm-runner/models")
    assert r.status_code == 200
    body = r.json()
    # HONEST STATE (2026-08-01): JV mounts the router but has NOT wired a catalog
    # source (no configure_service/install_llm yet) — so the endpoint must SAY so
    # rather than serve an indistinguishable empty list. Full convergence
    # (install_llm adoption) flips this to True; when it does, THIS assert flips
    # with it, deliberately.
    assert body["catalogWired"] is False
    assert body["models"] == []


def test_hardware_endpoint_mounted_and_camelcase(client):
    # The standalone package adds /hardware (the in-tree shim never had it).
    r = client.get("/v1/llm-runner/hardware")
    assert r.status_code == 200
    body = r.json()
    assert body["platform"] in {"windows", "macos", "linux"}
    # camelCase aliases on the wire, not snake_case attribute names.
    assert "cpuCores" in body and "ramMb" in body
    assert "cpu_cores" not in body
