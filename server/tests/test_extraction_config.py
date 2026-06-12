# SPDX-License-Identifier: GPL-3.0-or-later
"""Speaker Lab truth surface — GET /v1/extraction/config + the per-call
user_prompt / confidence_floor overrides (Lab parity redesign)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


class FakeAdapter:
    def __init__(self, provider_id, default_model):
        self.provider_id = provider_id
        self.provider_type = "ollama"
        self.default_model = default_model

    def chat(self, *a, **k):  # pragma: no cover - not exercised
        raise NotImplementedError

    def stream_chat(self, *a, **k):  # pragma: no cover
        raise NotImplementedError


@pytest.fixture()
def app(tmp_path):
    app = create_app(data_dir=tmp_path)
    from justvoice.engines.llm.registry import get_llm_registry

    reg = get_llm_registry()
    saved = list(reg.all())
    reg._adapters = {}
    reg.register(FakeAdapter("prov-local", "qwen3:8b"))
    yield app
    reg._adapters = {a.provider_id: a for a in saved}


def test_extraction_config_shape(app) -> None:
    client = TestClient(app)
    r = client.get("/v1/extraction/config")
    assert r.status_code == 200
    body = r.json()

    names = {t["name"] for t in body["tiers"]}
    assert names == {"guided", "direct", "reasoned"}
    floors = {t["name"]: t["confidence_floor"] for t in body["tiers"]}
    assert floors["guided"] == 0.7 and floors["direct"] == 0.5

    # Real prompt bodies, not placeholders — guided extends direct with
    # the worked examples.
    assert "RULES:" in body["system_prompts"]["direct"]
    assert "WORKED EXAMPLES:" in body["system_prompts"]["guided"]
    assert body["system_prompts"]["guided"].startswith(
        body["system_prompts"]["direct"].rstrip()[:40]
    )
    for token in ("{characters}", "{corrections}", "{paragraphs}"):
        assert token in body["user_template"]

    # Route resolved against the registered fake adapter.
    assert body["resolved_provider_id"] == "prov-local"
    assert body["resolved_model"] == "qwen3:8b"
    assert body["resolved_tier"] == "guided"  # qwen3:8b sub-12B → guided


def test_extraction_config_no_provider(tmp_path) -> None:
    app = create_app(data_dir=tmp_path)
    from justvoice.engines.llm.registry import get_llm_registry

    reg = get_llm_registry()
    saved = list(reg.all())
    reg._adapters = {}
    try:
        r = TestClient(app).get("/v1/extraction/config")
        assert r.status_code == 200
        body = r.json()
        assert body["resolved_provider_id"] is None
        assert body["system_prompts"]["guided"]  # prompts still served
    finally:
        reg._adapters = {a.provider_id: a for a in saved}


def _fake_chat_capture(captured):
    def fake_chat(*, settings, feature, messages, system=None, **kwargs):
        captured["system"] = system
        captured["user"] = messages[0].content

        class R:
            # Two dialogue segments: one confident, one at 0.6.
            text = '[{"speaker": "c_mara", "confidence": 0.9}, {"speaker": "c_sarah", "confidence": 0.6}]'

        return R()

    return fake_chat


TEXT = 'Mara stood up.\n\n"Hello," she said.\n\n"Hi."'
CAST = [{"id": "c_mara", "name": "Mara"}, {"id": "c_sarah", "name": "Sarah"}]


def test_provider_override_routes_call(app, monkeypatch) -> None:
    # Register a second provider; the Lab's provider_id override must
    # route through it (and pick up ITS default model).
    from justvoice.engines.llm.registry import get_llm_registry

    get_llm_registry().register(FakeAdapter("prov-cloud", "gpt-4o-mini"))
    captured: dict = {}

    def fake_adapter_chat(self, messages, *, model=None, **kwargs):
        captured["provider"] = self.provider_id
        captured["model"] = model

        class R:
            text = '[{"speaker": "c_mara", "confidence": 0.9}]'
            prompt_tokens = 0
            completion_tokens = 0
            model = ""

        return R()

    monkeypatch.setattr(FakeAdapter, "chat", fake_adapter_chat)
    client = TestClient(app)
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": '"Hello," Mara said.',
            "characters": CAST,
            "provider_id": "prov-cloud",
        },
    )
    assert r.status_code == 200
    assert captured["provider"] == "prov-cloud"
    assert captured["model"] == "gpt-4o-mini"


def test_user_prompt_and_floor_overrides(app, monkeypatch) -> None:
    captured: dict = {}
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.chat", _fake_chat_capture(captured)
    )
    client = TestClient(app)

    # Custom user template is interpolated and sent; custom floor (0.65)
    # keeps the 0.6 pick floored even on the direct tier (default 0.5),
    # and the response echoes the effective floor.
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": TEXT,
            "characters": CAST,
            "tier": "direct",
            "propagate": False,
            "user_prompt": "CAST:\n{characters}\nBODY:\n{paragraphs}",
            "confidence_floor": 0.65,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["confidence_floor"] == 0.65
    assert captured["user"].startswith("CAST:\n")
    assert 'id="c_mara"' in captured["user"]
    assert "{paragraphs}" not in captured["user"]

    dialogue = [row for row in body["rows"] if row["kind"] == "dialogue"]
    floored = [row for row in dialogue if row["source"] == "floored"]
    assert len(floored) == 1 and floored[0]["floored_from"] == "c_sarah"

    # Same call without the floor override: direct tier's 0.5 applies,
    # so the 0.6 pick survives.
    r2 = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": TEXT,
            "characters": CAST,
            "tier": "direct",
            "propagate": False,
        },
    )
    assert r2.status_code == 200
    assert r2.json()["confidence_floor"] == 0.5
    assert not [
        row for row in r2.json()["rows"] if row["source"] == "floored"
    ]
