# SPDX-License-Identifier: MIT
"""POST /v1/voices/gender-guess — the voice_gender feature (F1 Phase 3).

Explicit-trigger contract (ruling 2): the renderer sends the voices its
dictionary could not label; the run rides the `voice_gender` template row +
its preset; the route maps male/female/unknown onto JV's F/M/"" vocabulary.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from llm_runner.llm import LLMResponse, get_llm_registry
from llm_runner.llm.dispatch import set_ensure_local_model

from justvoice.app import create_app


class _FakeLocalAdapter:
    provider_id = "local-llamacpp"
    provider_type = "openai-compat"
    default_model = "m"

    def __init__(self, text):
        self.text = text
        self.last = {}

    def chat(self, messages, *, model=None, system=None, **kwargs):
        self.last = {"system": system, "user": messages[-1].content}
        return LLMResponse(text=self.text, model=model or self.default_model)

    def models(self):
        return [self.default_model]

    def ping(self):
        return True


def _client(tmp_path) -> TestClient:
    app = create_app(data_dir=tmp_path)
    get_llm_registry()._adapters = {}
    set_ensure_local_model(None)
    return TestClient(app, raise_server_exceptions=False)


def test_gender_guess_maps_contract_to_jv_vocabulary(tmp_path):
    c = _client(tmp_path)
    adapter = _FakeLocalAdapter(
        '{"Marcus": "male", "Finch": "female", "Ryo": "unknown", "Ghost": "female"}'
    )
    get_llm_registry().register(adapter)
    r = c.post("/v1/voices/gender-guess", json={"voices": [
        {"name": "Marcus", "description": "deep narrator"},
        {"name": "Finch"},
        {"name": "Ryo"},
    ]})
    assert r.status_code == 200, r.text
    # male/female → M/F, unknown → "" (left unset); names the caller never
    # sent ("Ghost") are dropped — the model can't invent rows.
    assert r.json()["guesses"] == {"Marcus": "M", "Finch": "F", "Ryo": ""}
    # The template row rendered the formatted list into the user turn.
    assert "- Marcus — deep narrator" in adapter.last["user"]
    assert "voice names" in adapter.last["system"].lower()


def test_gender_guess_501_without_provider_and_empty_ok(tmp_path):
    c = _client(tmp_path)
    assert c.post("/v1/voices/gender-guess", json={"voices": []}).status_code == 200
    r = c.post("/v1/voices/gender-guess", json={"voices": [{"name": "X"}]})
    assert r.status_code == 501
