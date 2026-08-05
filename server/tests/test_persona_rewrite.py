# SPDX-License-Identifier: MIT
"""Tests for /v1/personas/{id}/rewrite — the LLM-rewrite endpoint.

Covers the contract the StudioView per-block right-click flow depends on.
Rewritten for F1 Phase 2 (2026-08-05): the endpoint runs through the SHARED
run path (`run_feature` → template row + engine preset + dispatch), so the
fixture stands up real shared storage (in-memory, the runner-suite pattern) +
JV's seeds, and success/failure cases register a fake adapter under the preset's
`local-llamacpp` id instead of monkeypatching the dead per-endpoint prompt code.

Affordance Table (what the endpoint must guarantee):
  ✅ 400 when text is empty
  ✅ 404 when persona doesn't exist
  ✅ 400 when persona has no personality
  ✅ 501 when no LLM provider is registered
  ✅ 502 when the LLM call raises
  ✅ 200 with {original, rewritten, persona_id} on success
  ✅ The persona's personality reaches the system prompt via the template row
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from llm_runner.llm import LLMResponse, get_llm_registry
from llm_runner.llm import db as llm_db
from llm_runner.llm.dispatch import set_ensure_local_model
from llm_runner.llm.seed import configure_app_seed, seed_llm
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from justvoice.api import personas_api
from justvoice.feature_catalog import FEATURE_CATALOG
from justvoice.models import Persona
from justvoice.seed_feature_prompts import DEFAULT_FEATURE_PROMPTS
from justvoice.seed_presets import (
    DEFAULT_ENGINE_PRESETS,
    DEFAULT_FEATURE_PRESETS,
    DEFAULT_PRESET_ID,
)


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


class _FakeLocalAdapter:
    """Registered under the preset's provider id so the run path resolves to
    it; records the system + user content the rendered row produced."""

    def __init__(self, respond):
        self.provider_id = "local-llamacpp"
        self.provider_type = "openai-compat"
        self.default_model = "test-model"
        self.respond = respond
        self.last: dict = {}

    def chat(self, messages, *, model=None, temperature=0.7, max_tokens=None,
             system=None, think=False, extra=None):
        self.last = {"system": system, "user": messages[-1].content,
                     "temperature": temperature, "max_tokens": max_tokens}
        return self.respond(model or self.default_model)

    def models(self):
        return [self.default_model]

    def ping(self):
        return True


@pytest.fixture
def rewrite_client(monkeypatch):
    """The personas router over REAL shared-stack storage (in-memory) + JV's
    seeds; the adapter registry starts empty (the 501 state)."""
    engine = sa.create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    llm_db.LlmBase.metadata.create_all(engine)
    llm_db.configure_storage(sessionmaker(bind=engine))
    configure_app_seed(
        feature_catalog=FEATURE_CATALOG,
        feature_prompts=DEFAULT_FEATURE_PROMPTS,
        engine_presets=DEFAULT_ENGINE_PRESETS,
        feature_presets=DEFAULT_FEATURE_PRESETS,
        default_preset_id=DEFAULT_PRESET_ID,
    )
    seed_llm()
    get_llm_registry()._adapters = {}
    set_ensure_local_model(None)  # no bundled-runner load in unit tests

    state = SimpleNamespace(personas=SimpleNamespace(get=lambda pid: None))

    def _set_persona(persona: Persona | None):
        state.personas.get = (
            lambda pid: persona if persona and pid == persona.id else None
        )

    def _register(respond) -> _FakeLocalAdapter:
        adapter = _FakeLocalAdapter(respond)
        get_llm_registry().register(adapter)
        return adapter

    monkeypatch.setattr(personas_api, "get_state", lambda: state)

    app = FastAPI()
    app.include_router(personas_api.router)
    client = TestClient(app, raise_server_exceptions=False)
    yield SimpleNamespace(client=client, set_persona=_set_persona, register=_register)


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


# ─── 4. 501 when no LLM provider registered ─────────────────────────────


def test_rewrite_no_llm_returns_501(rewrite_client):
    # Registry is empty by fixture — the run path's own resolution raises
    # LLMNotConfiguredError; no monkeypatching required.
    rewrite_client.set_persona(_make_persona())
    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 501


# ─── 5. 502 when LLM call raises ────────────────────────────────────────


def test_rewrite_llm_failure_returns_502(rewrite_client):
    rewrite_client.set_persona(_make_persona())

    def _raise(_model):
        raise RuntimeError("LLM provider returned malformed response")

    rewrite_client.register(_raise)
    r = rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    assert r.status_code == 502


# ─── 6. 200 success with full response shape ────────────────────────────


def test_rewrite_success_returns_original_and_rewritten(rewrite_client):
    rewrite_client.set_persona(_make_persona())
    rewrite_client.register(
        lambda model: LLMResponse(
            text="Hey there, friend — fancy seein' you again.", model=model
        )
    )
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


# ─── 7. The template row renders the personality into the system ────────


def test_rewrite_passes_personality_into_system_prompt(rewrite_client):
    rewrite_client.set_persona(_make_persona(personality="Boston dialect, dry sarcasm."))
    adapter = rewrite_client.register(
        lambda model: LLMResponse(text="Rewritten!", model=model)
    )
    rewrite_client.client.post(
        "/v1/personas/persona-mara/rewrite",
        json={"text": "Hello."},
    )
    # The row's system template carried the personality…
    assert "Boston dialect" in adapter.last["system"]
    assert "Rewrite the user's line" in adapter.last["system"]
    # …and its {{text}} user half rendered the request text.
    assert adapter.last["user"] == "Hello."
    # The tunables came from the assigned preset (p_voiced_edit), not code.
    assert adapter.last["temperature"] == 0.6
