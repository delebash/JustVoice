# SPDX-License-Identifier: MIT
"""The attribution routes + the Auto row (the restore 2026-08-06; the
tier-debris cleanup 2026-08-07 — Reasoned died, Auto routes by SIZE only,
`tier` renamed `route` end to end): route choice (per-run override > Auto;
no stored force), the reported route + source, and the size rule."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _import_project(client) -> str:
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
    return scenes[0]["id"]


def _fake_run(captured):
    def fake(action, variables, **overrides):
        captured["action"] = action

        class R:
            text = "[]"
            model = "stub-model"
            prompt_tokens = 7
            completion_tokens = 3

        return R()

    return fake


def test_route_override_and_auto_source(client, monkeypatch):
    """A per-run override beats Auto, and the response names the route AND why
    it ran (no silent state). No stored force exists anymore (the Auto
    simplification): a stale extraction.route in a PATCH is ignored and
    production stays on Auto."""
    captured = {}
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _fake_run(captured))
    scene_id = _import_project(client)

    # Auto (fresh install: no model routed → the size rule lands on Guided).
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.guided"
    assert r.json()["route_used"] == "guided"
    assert r.json()["route_source"] == "auto"
    # §16: the response carries the run's usage numbers.
    usage = r.json()["usage"]
    assert usage["prompt_tokens"] == 7 and usage["completion_tokens"] == 3
    assert usage["model"] == "stub-model" and usage["duration_ms"] >= 0

    # The retired pills' key is ignored wholesale — nothing gets forced.
    r = client.patch("/v1/settings", json={"extraction": {"route": "direct"}})
    assert r.status_code == 200, r.text
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.guided"
    assert r.json()["route_source"] == "auto"

    # A per-run override forces its route for THAT run only.
    r = client.post(
        f"/v1/scenes/{scene_id}/analyze",
        json={"text": '"Hi," said Mara.', "route": "direct"},
    )
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["route_used"] == "direct"
    assert r.json()["route_source"] == "forced"

    # The dead route value 422s loudly — no silent alias (the tier-debris
    # cleanup: Reasoned died; testing thinking = the think control).
    r = client.post(
        f"/v1/scenes/{scene_id}/analyze",
        json={"text": '"Hi," said Mara.', "route": "reasoned"},
    )
    assert r.status_code == 422


def test_auto_judges_each_card_by_its_own_model(client, monkeypatch):
    """The size rule — Auto's ONLY rule since the tier-debris cleanup —
    judged against THAT card's own model; the threshold is editable."""
    from justvoice.extraction import pipeline

    captured = {}
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _fake_run(captured))
    scene_id = _import_project(client)

    models = {"direct": "big-model-30b", "guided": "small-3b"}
    monkeypatch.setattr(pipeline, "route_model", lambda route: models.get(route, ""))

    # Direct's card carries a 30B model (30 ≥ 14) → Direct runs.
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["route_used"] == "direct" and r.json()["route_source"] == "auto"

    # Direct's card under the size line → Guided.
    models["direct"] = "mid-model-12b"
    client.patch("/v1/settings", json={"extraction": {"direct_min_b": 14}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.guided"

    # The size line is EDITABLE: lower it and the same 12B model is Direct.
    client.patch("/v1/settings", json={"extraction": {"direct_min_b": 10}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.direct"

    # Unknown size plays safe: an id with no size anywhere → Guided.
    models["direct"] = "mystery-model"
    client.patch("/v1/settings", json={"extraction": {"direct_min_b": 14}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.guided"


def test_stale_force_keys_are_ignored():
    """The retired dial's and pills' stored keys neither error nor force:
    the settings model drops them (production is always Auto)."""
    from justvoice.models import ExtractionSettings

    s = ExtractionSettings.model_validate({"reading_style": "direct", "route": "direct"})
    assert s.direct_min_b == 14.0
    dumped = s.model_dump()
    assert "route" not in dumped and "reading_style" not in dumped


def test_no_computed_budget_and_explicit_cap_rides(client, monkeypatch):
    """Caps ruling 2026-08-07: no code-computed budgets — a run with no
    explicit value sends maxTokens=None (preset empty = uncapped, nothing
    sent); an explicit per-call value still rides untouched."""
    captured = {}

    def fake(action, variables, **overrides):
        captured[action] = overrides.get("maxTokens")

        class R:
            text = "[]"
            model = "m"
            prompt_tokens = 0
            completion_tokens = 0

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake)
    scene_id = _import_project(client)

    client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.', "route": "direct"})
    assert captured["speaker_attribution.direct"] is None

    client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.', "route": "guided"})
    assert captured["speaker_attribution.guided"] is None

    r = client.post(
        "/v1/extraction/analyze-text",
        json={"text": '"Hi," said Mara.', "route": "direct", "maxTokens": 2048},
    )
    assert r.status_code == 200
    assert captured["speaker_attribution.direct"] == 2048


def test_lab_run_uses_stored_project_corrections(client, monkeypatch):
    """Part 5 (2026-08-06): the typed corrections box died — an adhoc Lab run
    carrying project_id uses that project's STORED corrections through the
    same resolver production uses."""
    captured = {}

    def fake(action, variables, **overrides):
        captured["variables"] = variables

        class R:
            text = "[]"
            model = "m"
            prompt_tokens = 0
            completion_tokens = 0

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake)
    _scene_id = _import_project(client)
    pid = client.get("/v1/projects").json()["projects"][0]["id"]
    persona = client.get("/v1/personas").json()["personas"][0]
    r = client.post(
        f"/v1/projects/{pid}/corrections",
        json={"text_snippet": '"Hi," said Mara.', "character_id": persona["id"]},
    )
    assert r.status_code == 200, r.text

    r = client.post(
        "/v1/extraction/analyze-text",
        json={"text": '"Hi," said Mara.', "project_id": pid},
    )
    assert r.status_code == 200, r.text
    assert '"Hi," said Mara.' in captured["variables"]["corrections"]


def test_cellar_sample_seeds(client):
    """The attribution Lab's seeded sample is the ORIGINAL Speaker Lab's
    cellar passage, word for word (the Lab restoration Part 3, 2026-08-06;
    seeds-direct since the one-time migrations died 2026-08-07)."""
    from llm_runner.llm import db as llm_db

    s = llm_db.session()
    try:
        cellar = (
            s.query(llm_db.TestSample)
            .filter_by(
                action_key="speaker_attribution.guided",
                label="Cellar scene — the original Speaker Lab sample",
            )
            .all()
        )
        assert len(cellar) == 1
        vars_rows = s.query(llm_db.TestSampleVar).filter_by(sample_id=cellar[0].id).all()
        by_name = {v.name: v.value for v in vars_rows}
        assert "cellar" in by_name["paragraphs"] and by_name["characters"] == "Mara\nSarah"
    finally:
        s.close()


def test_extraction_config_has_no_force_field(client):
    """The pane is words + the size line — the config response carries no
    stored force (the pills died; production always runs Auto)."""
    r = client.get("/v1/extraction/config")
    assert r.status_code == 200
    assert "route" not in r.json()


def test_lab_tunables_pass_through(client, monkeypatch):
    """Part 2 (2026-08-06): the Lab column's Reasoning / Max tok / Top-p /
    samplers are REAL — they ride the analyze request into the shared run
    path (they were verified inert before: adapter dropped them AND the
    request model rejected them)."""
    captured = {}

    def fake(action, variables, **overrides):
        captured["overrides"] = overrides

        class R:
            text = "[]"
            model = "m"
            prompt_tokens = 0
            completion_tokens = 0

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake)
    r = client.post(
        "/v1/extraction/analyze-text",
        json={
            "text": '"Hi," said Mara.',
            "route": "direct",
            "think": True,
            "reasoningEffort": "low",
            "maxTokens": 512,
            "topP": 0.9,
            "samplers": [{"flagName": "top_k", "flagValue": "40"}],
        },
    )
    assert r.status_code == 200, r.text
    o = captured["overrides"]
    assert o["think"] is True and o["reasoningEffort"] == "low"
    assert o["maxTokens"] == 512 and o["topP"] == 0.9
    assert o["samplers"] == [{"flagName": "top_k", "flagValue": "40"}]


def test_auto_judges_the_model_that_would_run(client, monkeypatch):
    """Judge-what-runs (ruled 2026-08-06: "it just defaults to default
    model"): a card whose preset ships model-empty is judged by the model the
    run would actually land on — its provider's default model — so the size
    rule works on a setup that never hand-filled the presets."""
    from justvoice.extraction import pipeline

    captured = {}
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _fake_run(captured))
    scene_id = _import_project(client)

    # Fresh state: presets ship model-empty and the provider has no default
    # → every card judges empty → Guided (the safe floor).
    assert pipeline.route_model("direct") == ""
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.guided"

    # Give the local provider a default model through the app's own door
    # (the PATCH re-registers the adapter, exactly like the provider form).
    rows = client.get("/v1/llm-providers").json()["providers"]
    local = next(p for p in rows if p["id"] == "local-llamacpp")
    r = client.patch(
        "/v1/llm-providers/local-llamacpp",
        json={**local, "apiKey": "", "defaultModel": "gemma-4-26b-a4b-qat"},
    )
    assert r.status_code == 200, r.text

    # The judge now sees what the run would use: preset model empty → the
    # provider default — a 26B MoE (TOTAL params) ≥ 14 → Direct, by Auto.
    assert pipeline.route_model("direct") == "gemma-4-26b-a4b-qat"
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["route_used"] == "direct" and r.json()["route_source"] == "auto"
