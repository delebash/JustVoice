# SPDX-License-Identifier: MIT
"""Tests for /v1/personas/{id}/rewrite — the LLM-rewrite endpoint.

Covers the contract the StudioView per-block right-click flow depends
on. Mocks the LLM dispatch so the tests run without a real provider
configured.

Affordance Table (what the endpoint must guarantee):
  ✅ 400 when text is empty
  ✅ 404 when persona doesn't exist
  ✅ 400 when persona has no personality
  ✅ 501 when no LLM provider is configured
  ✅ 502 when the LLM call raises
  ✅ 200 with {original, rewritten, persona_id} on success
  ✅ Response shape includes `rewritten` field (StudioView reads `r.text || r.rewritten`)
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from llm_runner.llm import LLMNotConfiguredError, LLMResponse

from justvoice.api import personas_api
from justvoice.models import Persona


def _make_persona(personality: str | None = "Test personality") -> Persona:
    """Build a Persona with all required fields."""
    now = datetime.now(timezone.utc)
    return Persona(
        id="persona-mara",
        name="Mara",
        voice_id="voice-mara",
        personality=personality,
        default_delivery={},
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def rewrite_client(monkeypatch):
    """Build a FastAPI app with the personas router + a mockable state."""
    # The personas + state stack: persona lookup + settings get.
    state = SimpleNamespace(
        personas=SimpleNamespace(get=lambda pid: None),
        settings=SimpleNamespace(
            get=lambda: SimpleNamespace(
                engines=SimpleNamespace(
                    llm=[], feature_pins=[], production_configs=[]
                )
            )
        ),
    )

    def _set_persona(persona: Persona | None):
        state.personas.get = lambda pid: persona if persona and pid == persona.id else None

    # Patch get_state in BOTH the api module + the helper module.
    monkeypatch.setattr(personas_api, "get_state", lambda: state)

    app = FastAPI()
    app.include_router(personas_api.router)

    client = TestClient(app, raise_server_exceptions=False)
    # Yield (client, helper to swap persona, helper to mock chat)
    yield SimpleNamespace(client=client, set_persona=_set_persona, monkeypatch=monkeypatch)


# ─── 1. 404 when persona doesn't exist ──────────────────────────────────


def test_rewrite_unknown_persona_404(rewrite_client):
    r = rewrite_client.client.post(
        "/v1/personas/nope/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 404


# ─── 2. 400 when text is empty ──────────────────────────────────────────


def test_rewrite_empty_text_400(rewrite_client):
    rewrite_client.set_persona(_make_persona())
    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "   "},  # whitespace only
    )
    assert r.status_code == 400


# ─── 3. 400 when persona has no personality ─────────────────────────────


def test_rewrite_persona_without_personality_400(rewrite_client):
    rewrite_client.set_persona(_make_persona(personality=None))
    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 400
    assert "personality" in r.json()["detail"].lower()


# ─── 4. 501 when no LLM provider configured ─────────────────────────────


def test_rewrite_no_llm_returns_501(rewrite_client):
    rewrite_client.set_persona(_make_persona())

    def _raise_not_configured(*args, **kwargs):
        raise LLMNotConfiguredError(
            "No LLM provider registered. Add one in Engines → LLM."
        )

    # The api module imports dispatch inside the function body, so we
    # patch it in the module where it lives.
    from llm_runner.llm import dispatch
    rewrite_client.monkeypatch.setattr(dispatch, "chat", _raise_not_configured)

    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 501


# ─── 5. 502 when LLM call raises ────────────────────────────────────────


def test_rewrite_llm_failure_returns_502(rewrite_client):
    rewrite_client.set_persona(_make_persona())

    def _raise_runtime(*args, **kwargs):
        raise RuntimeError("LLM provider returned malformed response")

    from llm_runner.llm import dispatch
    rewrite_client.monkeypatch.setattr(dispatch, "chat", _raise_runtime)

    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 502


# ─── 6. 200 success with full response shape ────────────────────────────


def test_rewrite_success_returns_original_and_rewritten(rewrite_client):
    rewrite_client.set_persona(_make_persona())

    def _mock_chat(*args, **kwargs):
        return LLMResponse(
            text="Hey there, friend — fancy seein' you again.",
            model="test-model",
        )

    from llm_runner.llm import dispatch
    rewrite_client.monkeypatch.setattr(dispatch, "chat", _mock_chat)

    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello again, my friend."},
    )
    assert r.status_code == 200
    body = r.json()
    # The StudioView per-block right-click code reads either `text` or
    # `rewritten`. Verify both shapes:
    assert "rewritten" in body
    assert body["original"] == "Hello again, my friend."
    assert body["rewritten"] == "Hey there, friend — fancy seein' you again."
    assert body["persona_id"] == "persona-mara"


# ─── 7. System prompt contains the persona's personality ────────────────


def test_rewrite_passes_personality_into_system_prompt(rewrite_client):
    rewrite_client.set_persona(_make_persona(personality="Boston dialect, dry sarcasm."))

    captured = {}
    def _capture_chat(**kwargs):
        captured.update(kwargs)
        return LLMResponse(text="Rewritten!", model="test", usage_in=0, usage_out=0)

    from llm_runner.llm import dispatch
    rewrite_client.monkeypatch.setattr(dispatch, "chat", _capture_chat)

    rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert "Boston dialect" in captured.get("system", "")
    assert captured.get("feature") == "persona_rewrite"
