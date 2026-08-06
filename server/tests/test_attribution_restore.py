# SPDX-License-Identifier: MIT
"""The attribution restore + the Auto simplification (approved 2026-08-06 —
decision text in TASKS): three routed cards + the Auto row. Route choice
(per-run override > Auto; no stored force), the reported route + source, the
per-card Auto rules, and the one-time existing-DB migrations."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
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

    # Auto (fresh install: no model routed → the rules land on Guided).
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.guided"
    assert r.json()["tier_used"] == "guided"
    assert r.json()["tier_source"] == "auto"

    # The retired pills' key is ignored wholesale — nothing gets forced.
    r = client.patch("/v1/settings", json={"extraction": {"route": "reasoned"}})
    assert r.status_code == 200, r.text
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.guided"
    assert r.json()["tier_source"] == "auto"

    # A per-run override forces its route for THAT run only.
    r = client.post(
        f"/v1/scenes/{scene_id}/analyze",
        json={"text": '"Hi," said Mara.', "tier": "direct"},
    )
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["tier_used"] == "direct"
    assert r.json()["tier_source"] == "forced"


def test_auto_judges_each_card_by_its_own_model(client, monkeypatch):
    """The two visible rules, each against THAT card's own model: a thinking
    model on Reasoned's card wins rule 1; else Direct's card's size decides."""
    from justvoice.extraction import pipeline

    captured = {}
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _fake_run(captured))
    scene_id = _import_project(client)

    models = {"reasoned": "qwen3-32b", "direct": "big-model-30b", "guided": "small-3b"}
    monkeypatch.setattr(pipeline, "route_model", lambda route: models.get(route, ""))

    # qwen3-32b is a known thinker (name heuristic) → Reasoned runs.
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.reasoned"
    assert r.json()["tier_used"] == "reasoned" and r.json()["tier_source"] == "auto"

    # A NON-thinker on Reasoned's card (gpt-4o — uncataloged, the name list
    # says no) → the size rule on Direct's card decides (30B ≥ 14).
    models["reasoned"] = "gpt-4o"
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["tier_used"] == "direct"

    # Direct's card under the size line → Guided.
    models["direct"] = "mid-model-12b"
    client.patch("/v1/settings", json={"extraction": {"direct_min_b": 14}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.guided"

    # The size line is EDITABLE: lower it and the same 12B model is Direct.
    client.patch("/v1/settings", json={"extraction": {"direct_min_b": 10}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.direct"

    # The catalog's Thinking flag is rule 1's authority: the seeded gemma-4
    # rungs carry thinking=True (hybrid reasoners), so a cataloged gemma on
    # Reasoned's card routes there — editing the flag in the catalog is how
    # Auto's answer changes.
    models["reasoned"] = "gemma-4-12b-qat"
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert captured["action"] == "speaker_attribution.reasoned"


def test_stale_force_keys_are_ignored():
    """The retired dial's and pills' stored keys neither error nor force:
    the settings model drops them (production is always Auto)."""
    from justvoice.models import ExtractionSettings

    s = ExtractionSettings.model_validate({"reading_style": "direct", "route": "reasoned"})
    assert s.direct_min_b == 14.0
    dumped = s.model_dump()
    assert "route" not in dumped and "reading_style" not in dumped


def test_migration_restores_and_keeps_edits(client):
    """The one-time fixup: positions forced, identify moves to its own
    feature, the pieces-era feature ref + a PRISTINE "Careful reading" preset
    retire, stale wordings refresh — while an EDITED preset and EDITED words
    survive."""
    from llm_runner.llm import db as llm_db

    from justvoice.llm_bootstrap import migrate_attribution_restore

    s = llm_db.session()
    try:
        # Recreate the pieces-rework state: the feature-level ref on p_read,
        # the pristine "Careful reading" preset, the rework's wording on
        # guided, an edited label on direct, identify still under the
        # attribution feature — and no restore marker.
        for key in ("jv_attribution_restore_applied",):
            marker = s.get(llm_db.RunnerSetting, key)
            if marker is not None:
                s.delete(marker)
        for key in ("speaker_attribution.guided", "speaker_attribution.direct",
                    "speaker_attribution.reasoned"):
            ref = s.get(llm_db.FeaturePresetRef, key)
            if ref is not None:
                s.delete(ref)
        s.add(llm_db.FeaturePresetRef(key="speaker_attribution", preset_id="p_read"))
        s.add(llm_db.EnginePreset(
            id="p_read", name="Careful reading", provider_id="local-llamacpp",
            model="", temperature=0.2, think=True, position=6, built_in=True,
        ))
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        g.label = "Guided"
        g.description = ("For small models — the rules plus worked examples; small models "
                         "follow better when shown. Below 0.7 confidence a pick becomes unknown.")
        g.position = 0
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        d.label, d.description = "My own name", "my words"
        ident = s.get(llm_db.FeaturePrompt, "speaker_attribution.identify")
        ident.feature = "speaker_attribution"
        s.commit()
    finally:
        s.close()

    migrate_attribution_restore()

    s = llm_db.session()
    try:
        # Positions force the approved order Guided · Direct · Reasoned.
        assert s.get(llm_db.FeaturePrompt, "speaker_attribution.guided").position == 1
        assert s.get(llm_db.FeaturePrompt, "speaker_attribution.direct").position == 2
        assert s.get(llm_db.FeaturePrompt, "speaker_attribution.reasoned").position == 3
        # Find new speakers left the heading.
        assert s.get(llm_db.FeaturePrompt, "speaker_attribution.identify").feature == "speaker_discovery"
        # The pieces-era feature ref + the pristine preset retired.
        assert s.get(llm_db.FeaturePresetRef, "speaker_attribution") is None
        assert s.get(llm_db.EnginePreset, "p_read") is None
        # Stale wording refreshed to the CURRENT (tail-less) seed; the edited
        # row stayed the user's.
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        assert "Auto runs this when" not in g.description
        assert "system prompt carries the rules plus worked examples" in g.description
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        assert d.label == "My own name" and d.description == "my words"
        assert s.get(llm_db.RunnerSetting, "jv_attribution_restore_applied") is not None
    finally:
        s.close()


def test_migration_keeps_an_edited_careful_reading(client):
    """A user-EDITED "Careful reading" (temperature changed) survives the
    retirement; only the byte-identical seed copy goes."""
    from llm_runner.llm import db as llm_db

    from justvoice.llm_bootstrap import migrate_attribution_restore

    s = llm_db.session()
    try:
        marker = s.get(llm_db.RunnerSetting, "jv_attribution_restore_applied")
        if marker is not None:
            s.delete(marker)
        if s.get(llm_db.EnginePreset, "p_read") is None:
            s.add(llm_db.EnginePreset(
                id="p_read", name="Careful reading", provider_id="local-llamacpp",
                model="", temperature=0.35, think=True, position=6, built_in=True,
            ))
        else:
            s.get(llm_db.EnginePreset, "p_read").temperature = 0.35
        s.commit()
    finally:
        s.close()

    migrate_attribution_restore()

    s = llm_db.session()
    try:
        kept = s.get(llm_db.EnginePreset, "p_read")
        assert kept is not None and kept.temperature == 0.35
    finally:
        s.close()


def test_auto_simplify_trims_tails_and_keeps_edits(client):
    """The one-time simplification fixup: a row still wearing the restore's
    "Auto runs this when…" wording gets the trimmed seed words, the pristine
    pre-tagged Lab sample retires — while an edited row stays the user's."""
    from llm_runner.llm import db as llm_db

    from justvoice.llm_bootstrap import (
        _TAGGED_SAMPLE_LABEL,
        _TAGGED_SAMPLE_VARS,
        _TAILED_ATTR_DESCS,
        migrate_auto_simplify,
    )
    from justvoice.seed_feature_prompts import DEFAULT_FEATURE_PROMPTS

    s = llm_db.session()
    try:
        marker = s.get(llm_db.RunnerSetting, "jv_attr_auto_simplify_applied")
        if marker is not None:
            s.delete(marker)
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        g.label, g.description = _TAILED_ATTR_DESCS["speaker_attribution.guided"]
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        d.label, d.description = "My own name", "my words"
        old = llm_db.TestSample(
            action_key="speaker_attribution.guided", label=_TAGGED_SAMPLE_LABEL
        )
        s.add(old)
        s.flush()
        for name, value in _TAGGED_SAMPLE_VARS.items():
            s.add(llm_db.TestSampleVar(sample_id=old.id, name=name, value=value))
        s.commit()
    finally:
        s.close()

    migrate_auto_simplify()

    s = llm_db.session()
    try:
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        assert g.description == DEFAULT_FEATURE_PROMPTS["speaker_attribution.guided"]["description"]
        assert "Auto runs this when" not in g.description
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        assert d.label == "My own name" and d.description == "my words"
        assert (
            s.query(llm_db.TestSample)
            .filter_by(action_key="speaker_attribution.guided", label=_TAGGED_SAMPLE_LABEL)
            .all()
            == []
        )
        assert s.get(llm_db.RunnerSetting, "jv_attr_auto_simplify_applied") is not None
    finally:
        s.close()


def test_extraction_config_has_no_force_field(client):
    """The pane is words + the size line — the config response carries no
    stored force (the pills died; production always runs Auto)."""
    r = client.get("/v1/extraction/config")
    assert r.status_code == 200
    assert "route" not in r.json()
