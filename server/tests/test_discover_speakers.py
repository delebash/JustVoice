# SPDX-License-Identifier: MIT
"""Speaker identification — parser + discover/promote endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import LLMNotConfiguredError

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from justvoice.extraction.identify import SpeakerCandidate, parse_candidates
from tests.jw_fixtures import book_json

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
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _import_project(client) -> tuple[str, str]:
    # A real JustWrite book.json (tests/jw_fixtures.py). Its lines arrive
    # SPEAKERLESS — JustWrite does not attribute dialogue — which is exactly
    # the state these discovery tests are about.
    r = client.post("/v1/projects/import?source=justwrite", json=book_json())
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    scenes = client.get(f"/v1/projects/{pid}/scenes").json()
    return pid, scenes[0]["id"]


def test_discover_501_without_llm(client, monkeypatch):
    """No LLM configured must map to 501, and the no-LLM state is FORCED.

    This used to assert 501 while relying on the machine simply not having a
    working LLM. That made it pass for the wrong reason — and it broke the
    moment the engine venv was repaired, because a real local LLM then answered
    and returned 200. It had never been testing the 501 mapping at all.

    Its sibling below forces the LLM path by patching; this forces the other
    side of the same seam, so both are independent of what is installed.
    """
    from llm_runner.llm import dispatch

    def refuse(*_a, **_kw):
        raise LLMNotConfiguredError("no LLM provider registered")

    monkeypatch.setattr(dispatch, "chat", refuse)
    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", refuse, raising=False)

    _pid, scene_id = _import_project(client)
    r = client.post(f"/v1/scenes/{scene_id}/discover-speakers", json={"text": "“Hi,” said Tom."})
    assert r.status_code == 501, r.text


def test_discover_with_stubbed_llm(client, monkeypatch):
    _pid, scene_id = _import_project(client)

    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
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
    body = {"candidates": [{"name": "Tom Harlan", "personality": "neighbor"}]}
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


# ── The ad-hoc discovery door (the attribution Lab's identify twin) ──


def test_discover_adhoc_free_text(client, monkeypatch):
    """POST /v1/extraction/discover-speakers — no scene, caller-supplied known
    names (parity batch 2026-08-06: the Lab's identify columns run this)."""

    def fake_identify(text, known, *, settings, run_fn=None, raw_out=None):
        assert known == ["Mara Vance"]
        assert "Tom" in text
        return [SpeakerCandidate(name="Tom Harlan", role_hint="neighbor", approx_lines=3)]

    monkeypatch.setattr("justvoice.extraction.identify.identify_speakers", fake_identify)
    r = client.post(
        "/v1/extraction/discover-speakers",
        json={"text": "“Hi,” said Tom.", "known_characters": ["Mara Vance"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["scene_id"] == "(adhoc)"
    assert r.json()["candidates"] == [
        {"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 3}
    ]


def test_discover_adhoc_threads_column_pins(client, monkeypatch):
    """The Lab column's pins (provider/model/temperature/prompts) thread through
    the route's run_fn into the shared run path's kwargs."""
    captured = {}

    def fake_run(action, variables, **overrides):
        captured.update(action=action, **overrides)

        class R:
            text = '[{"name": "Tom Harlan"}]'

        return R()

    monkeypatch.setattr("justvoice.engines.llm.run.run_feature", fake_run)
    r = client.post(
        "/v1/extraction/discover-speakers",
        json={
            "text": "“Hi,” said Tom.",
            "known_characters": ["Mara Vance"],
            "providerId": "anthropic",
            "model": "claude-sonnet-5",
            "temperature": 0.1,
            "systemPrompt": "CUSTOM DISCOVERY PROMPT",
        },
    )
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.identify"
    assert captured["providerId"] == "anthropic"
    assert captured["model"] == "claude-sonnet-5"
    assert captured["temperature"] == 0.1
    assert captured["system"] == "CUSTOM DISCOVERY PROMPT"
    assert [c["name"] for c in r.json()["candidates"]] == ["Tom Harlan"]


# ── Speaker Lab per-column overrides reach the LLM call ──────────────


def test_analyze_text_threads_model_temp_prompt_overrides(client, monkeypatch):
    # The pipeline runs through the shared run path now (F1 Phase 2); the seam
    # is its run_feature import — capture what the Lab's overrides thread into
    # the RunRequest kwargs.
    captured = {}

    def fake_run(action, variables, **overrides):
        captured.update(action=action, variables=variables, **overrides)

        class R:
            text = '[{"speaker": "mara", "confidence": 0.9}]'

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake_run)
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": '"Hello," said Mara.',
            "characters": [{"id": "mara", "name": "Mara"}],
            "model": "qwen3:14b",
            "temperature": 0.05,
            "systemPrompt": "CUSTOM PROMPT BODY",
        },
    )
    assert r.status_code == 200, r.text
    assert captured["model"] == "qwen3:14b"
    assert captured["temperature"] == 0.05
    assert captured["system"] == "CUSTOM PROMPT BODY"
    # A per-call model override is the model that actually runs, so Auto
    # judges IT (the old system's documented behavior, kept by the restore):
    # qwen3:14b reads 14B ≥ 14 → the Direct route (Auto is SIZE-ONLY since
    # the tier-debris cleanup 2026-08-07). The pipeline still never FORCES
    # think — the caller sent none, so it rides as None (Part 2, 2026-08-06:
    # the controls are real passthroughs; None = the route's preset value).
    assert captured["action"] == "speaker_attribution.direct"
    assert captured.get("think") is None
    assert 'id="mara"' in captured["variables"]["characters"]
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
    assert det[0]["providerType"] == "ollama"
    assert "qwen3:14b" in det[0]["models"]
    assert det[0]["alreadyRegistered"] is False


# ── AI usage ledger ──────────────────────────────────────────────────


def test_usage_ledger_records_chat_calls(client, monkeypatch):
    from llm_runner.llm import get_ledger, get_llm_registry
    from llm_runner.llm.dispatch import set_ensure_local_model

    get_ledger().clear()

    class FakeAdapter:
        # The preset routes to local-llamacpp; registering the fake under that
        # id lets the REAL resolution find it (no resolve patching).
        provider_id = "local-llamacpp"
        provider_type = "openai-compat"
        default_model = "qwen3:8b"

        def chat(self, messages, *, model, temperature, max_tokens, system, think, **kwargs):
            # **kwargs: the shared chat() surface grows (extra=, reasoning knobs);
            # a strict stub signature breaks on every addition — tolerate like a
            # real adapter does.
            from llm_runner.llm import LLMResponse

            return LLMResponse(
                text='[{"speaker": "mara", "confidence": 0.9}]',
                model=model or self.default_model, prompt_tokens=120, completion_tokens=18,
            )

    get_llm_registry()._adapters = {}
    get_llm_registry().register(FakeAdapter())
    set_ensure_local_model(None)  # no bundled-runner load in unit tests
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


# ── show notes ───────────────────────────────────────────────────────


def test_show_notes_501_without_llm_and_works_with_stub(client, monkeypatch):
    pid, _scene = _import_project(client)

    from llm_runner.llm import LLMResponse, get_llm_registry
    from llm_runner.llm.dispatch import set_ensure_local_model

    # Force the no-LLM half: an EMPTY registry makes the shared run path's own
    # resolution raise LLMNotConfiguredError — testing the real 501 mapping.
    get_llm_registry()._adapters = {}
    set_ensure_local_model(None)
    r = client.post(f"/v1/projects/{pid}/show-notes")
    assert r.status_code == 501, r.text

    # Success half: a capturing adapter under the preset's provider id — the
    # {{script}} template row renders the project's segments into the user turn.
    class FakeAdapter:
        provider_id = "local-llamacpp"
        provider_type = "openai-compat"
        default_model = "m"

        def chat(self, messages, *, model=None, system=None, **kwargs):
            # The chapter heading and its prose, rendered from the project's
            # segments. The speaker reads NARRATION, not "Mara Vance": a
            # JustWrite import arrives speakerless by design, and Analyze is
            # what assigns characters to lines.
            assert "## One" in messages[-1].content
            assert "NARRATION: Hello." in messages[-1].content
            assert "show notes" in (system or "").lower()
            return LLMResponse(text="## Episode summary\nA test episode.",
                               model=model or self.default_model)

    get_llm_registry().register(FakeAdapter())
    r = client.post(f"/v1/projects/{pid}/show-notes")
    assert r.status_code == 200, r.text
    assert r.json()["markdown"].startswith("## Episode summary")
