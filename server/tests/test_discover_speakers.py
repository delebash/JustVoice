# SPDX-License-Identifier: GPL-3.0-or-later
"""Speaker identification — parser + discover/promote endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.extraction.identify import SpeakerCandidate, parse_candidates


# ── parser ───────────────────────────────────────────────────────────


def test_parse_plain_array():
    raw = '[{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11}]'
    out = parse_candidates(raw, ["Mara Vance"])
    assert out == [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=11)]


def test_parse_code_fenced_with_chatter():
    raw = 'Sure! Here are the new speakers:\n```json\n[{"name": "The Stranger"}]\n```\nLet me know!'
    out = parse_candidates(raw, [])
    assert [c.name for c in out] == ["The Stranger"]


def test_parse_dedupes_known_and_self_case_insensitive():
    raw = '[{"name": "MARA VANCE"}, {"name": "Tom"}, {"name": "tom"}, {"name": "narrator"}]'
    out = parse_candidates(raw, ["Mara Vance"])
    assert [c.name for c in out] == ["Tom"]


def test_parse_garbage_returns_empty():
    assert parse_candidates("I could not find any JSON to give you.", []) == []
    assert parse_candidates('{"name": "not a list"}', []) == []


# ── endpoints ────────────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _import_project(client) -> tuple[str, str]:
    payload = {
        "schema": "justwrite/v1",
        "book": {"title": "Stillwater", "author": "x", "language": "en-US", "description": None},
        "characters": [{"id": "mara", "name": "Mara Vance", "voice_hint": None, "notes": None}],
        "chapters": [
            {"id": "ch1", "title": "One", "lines": [{"character_id": "mara", "text": "Hello."}]}
        ],
        "lexicon": [],
    }
    r = client.post("/v1/projects/import?source=justwrite", json=payload)
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    scenes = client.get(f"/v1/projects/{pid}/scenes").json()
    return pid, scenes[0]["id"]


def test_discover_501_without_llm(client):
    _pid, scene_id = _import_project(client)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 501


def test_discover_with_stubbed_llm(client, monkeypatch):
    _pid, scene_id = _import_project(client)

    def fake_identify(text, known, *, settings, chat_fn=None):
        assert "Mara Vance" in known
        return [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=3)]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 200, r.text
    assert r.json()["candidates"] == [
        {"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 3}
    ]


def test_promote_creates_then_reuses(client):
    pid, _scene_id = _import_project(client)
    body = {"candidates": [{"name": "Tom Harlan", "bio": "neighbor"}]}
    r1 = client.post(f"/v1/projects/{pid}/personas/promote", json=body)
    assert r1.status_code == 200, r1.text
    assert len(r1.json()["created"]) == 1 and r1.json()["reused"] == []
    new_id = r1.json()["created"][0]

    # File-store twin exists (dual-write) → Studio/Personas can see it.
    names = [p["name"] for p in client.get("/v1/personas").json()["personas"]]
    assert "Tom Harlan" in names

    # Promoting again reuses, never duplicates.
    r2 = client.post(f"/v1/projects/{pid}/personas/promote", json=body)
    assert r2.json()["created"] == [] and r2.json()["reused"] == [new_id]


# ── Speaker Lab per-column overrides reach the LLM call ──────────────


def test_analyze_text_threads_model_temp_prompt_overrides(client, monkeypatch):
    captured = {}

    def fake_chat(*, settings, feature, messages, system=None, temperature=0.7,
                  max_tokens=None, think=None, model_override=None):
        captured.update(system=system, temperature=temperature, model_override=model_override)

        class R:
            text = '[{"speaker": "mara", "confidence": 0.9}]'

        return R()

    from justvoice.engines.llm.tiers import TIERS

    monkeypatch.setattr("justvoice.extraction.pipeline.chat", fake_chat)
    # No provider in the test env — pin resolution would 501 before the
    # stubbed chat runs. Tier resolution is stubbed in both call sites
    # (pipeline prompt pick + endpoint echo-back).
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.resolve_tier", lambda settings, feature: TIERS["guided"]
    )
    monkeypatch.setattr(
        "justvoice.engines.llm.dispatch.resolve_tier", lambda settings, feature: TIERS["guided"]
    )
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": '"Hello," said Mara.',
            "characters": [{"id": "mara", "name": "Mara"}],
            "model": "qwen3:14b",
            "temperature": 0.05,
            "system_prompt": "CUSTOM PROMPT BODY",
        },
    )
    assert r.status_code == 200, r.text
    assert captured["model_override"] == "qwen3:14b"
    assert captured["temperature"] == 0.05
    assert captured["system"] == "CUSTOM PROMPT BODY"
    assert r.json()["raw_llm"] == '[{"speaker": "mara", "confidence": 0.9}]'


# ── local LLM detection probe ────────────────────────────────────────


def test_detect_local_llm_providers(client, monkeypatch):
    class FakeResp:
        status_code = 200

        def json(self):
            return {"models": [{"name": "llama3.1:8b"}, {"name": "qwen3:14b"}]}

    def fake_get(url, timeout=None):
        if "11434" in url:
            return FakeResp()
        raise ConnectionError("down")

    import httpx

    monkeypatch.setattr(httpx, "get", fake_get)
    r = client.get("/v1/llm-providers/detect-local")
    assert r.status_code == 200, r.text
    det = r.json()["detected"]
    assert len(det) == 1
    assert det[0]["provider_type"] == "ollama"
    assert "qwen3:14b" in det[0]["models"]
    assert det[0]["already_registered"] is False


# ── AI usage ledger ──────────────────────────────────────────────────


def test_usage_ledger_records_chat_calls(client, monkeypatch):
    from justvoice.engines.llm.tiers import TIERS
    from justvoice.engines.llm.usage import get_ledger

    get_ledger().clear()

    class FakeAdapter:
        def chat(self, messages, *, model, temperature, max_tokens, system, think):
            from justvoice.engines.llm.base import LLMResponse

            return LLMResponse(
                text='[{"speaker": "mara", "confidence": 0.9}]',
                model=model, prompt_tokens=120, completion_tokens=18,
            )

    monkeypatch.setattr(
        "justvoice.engines.llm.dispatch.resolve_pin",
        lambda settings, feature: (FakeAdapter(), "qwen3:8b", None),
    )
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.resolve_tier", lambda s, f: TIERS["guided"]
    )
    monkeypatch.setattr(
        "justvoice.engines.llm.dispatch.resolve_tier", lambda s, f: TIERS["guided"]
    )
    r = client.post(
        "/v1/extraction/analyze-text",
        json={"text": '"Hi," said Mara.', "characters": [{"id": "mara", "name": "Mara"}]},
    )
    assert r.status_code == 200, r.text

    usage = client.get("/v1/ai-usage").json()
    feat = usage["by_feature"]["speaker_attribution"]
    assert feat["calls"] == 1 and feat["errors"] == 0
    assert feat["prompt_tokens"] == 120 and feat["completion_tokens"] == 18
    assert usage["recent"][0]["model"] == "qwen3:8b"

    client.delete("/v1/ai-usage")
    assert client.get("/v1/ai-usage").json()["total_calls"] == 0
