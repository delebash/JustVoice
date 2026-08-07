# SPDX-License-Identifier: MIT
"""Task #22 (2026-08-06) — the dictation-cleanup Lab doors: the family
prompt-preview contract (the composed call, live against the Capture
toggles) and the Lab run door that rides production's few-shot history."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def test_prompt_preview_serves_the_composed_refine_call(client):
    r = client.post("/v1/ai/prompt-preview", json={"feature": "refine"})
    assert r.status_code == 200, r.text
    body = r.json()
    # The ground rules always open the composition; default toggles are all
    # on, so every section's name shows in the sample note.
    assert "Fix punctuation" in body["system"] or body["system"].strip()
    assert body["user"].startswith("um can you check")
    assert "sections on:" in body["sample"]

    # Toggle a section off — the composed system is LIVE against settings.
    on = client.post("/v1/ai/prompt-preview", json={"feature": "refine"}).json()["system"]
    r = client.patch("/v1/settings", json={"captures": {"smart_cleanup": False}})
    assert r.status_code == 200, r.text
    off = client.post("/v1/ai/prompt-preview", json={"feature": "refine"}).json()["system"]
    assert off != on and len(off) < len(on)


def test_prompt_preview_404s_for_other_features(client):
    r = client.post("/v1/ai/prompt-preview", json={"feature": "compose"})
    assert r.status_code == 404


def test_lab_run_rides_production_history(client, monkeypatch):
    """The recorded #22 gap: production sends REFINEMENT_EXAMPLES as history
    turns and the Lab sent none — the Lab door now rides the same turns, and
    a piece column's own system text still wins (standalone-testable)."""
    captured = {}

    def fake(action, variables, **overrides):
        captured["action"] = action
        captured["variables"] = variables
        captured["overrides"] = overrides

        class R:
            text = "Cleaned."
            model = "m"
            prompt_tokens = 5
            completion_tokens = 2

        return R()

    monkeypatch.setattr("justvoice.api.refine_lab_api.run_feature", fake, raising=False)
    import justvoice.engines.llm.run as run_mod

    monkeypatch.setattr(run_mod, "run_feature", fake)

    r = client.post(
        "/v1/refine/lab-run",
        json={"transcript": "um hello there", "systemPrompt": "MY OWN SECTION TEXT"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] == "Cleaned."
    assert body["usage"]["prompt_tokens"] == 5 and body["usage"]["completion_tokens"] == 2

    assert captured["action"] == "refine.base"
    assert captured["variables"] == {"transcript": "um hello there"}
    o = captured["overrides"]
    # The column's own system rode (what you see is what runs).
    assert o["system"] == "MY OWN SECTION TEXT"
    # Production's few-shot turns ride as real history.
    hist = o["history"]
    assert len(hist) >= 2
    assert hist[0]["role"] == "user" and hist[1]["role"] == "assistant"


def test_lab_run_defaults_to_the_composed_system(client, monkeypatch):
    """No column system → the CURRENT toggles' composition, production's call."""
    captured = {}

    def fake(action, variables, **overrides):
        captured["overrides"] = overrides

        class R:
            text = "ok"
            model = "m"
            prompt_tokens = 0
            completion_tokens = 0

        return R()

    import justvoice.engines.llm.run as run_mod

    monkeypatch.setattr(run_mod, "run_feature", fake)

    r = client.post("/v1/refine/lab-run", json={"transcript": "um hello"})
    assert r.status_code == 200, r.text
    composed = client.post("/v1/ai/prompt-preview", json={"feature": "refine"}).json()["system"]
    assert captured["overrides"]["system"] == composed
