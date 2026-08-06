# SPDX-License-Identifier: MIT
"""The 2026-08-06 reading rework (approved — decision text in TASKS):
the production reading-style dial, and the one-time existing-DB migration
(unedited piece refs fall away; the §9 wording becomes Guided/Direct)."""

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


def test_scene_analyze_honors_the_dial(client, monkeypatch):
    """Production Analyze reads settings.extraction.reading_style when the body
    doesn't say — "direct" forces the rules-only text even though the resolved
    model would auto-classify guided."""
    captured = {}

    def fake_run(action, variables, **overrides):
        captured["action"] = action

        class R:
            text = "[]"

        return R()

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fake_run)
    scene_id = _import_project(client)

    r = client.patch("/v1/settings", json={"extraction": {"reading_style": "direct"}})
    assert r.status_code == 200, r.text

    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.direct"
    assert r.json()["tier_used"] == "direct"

    # Back to auto → the model-size pick returns (the default local model is
    # small → guided).
    client.patch("/v1/settings", json={"extraction": {"reading_style": "auto"}})
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": '"Hi," said Mara.'})
    assert r.status_code == 200, r.text
    assert captured["action"] == "speaker_attribution.guided"


def test_migration_repoints_unedited_and_keeps_edits(client):
    """The one-time fixup: an UNEDITED piece action-ref (still the old seed
    value) is removed so the feature ref routes; an EDITED ref survives. The
    §9 wording becomes Guided/Direct only where unedited."""
    from llm_runner.llm import db as llm_db
    from justvoice.llm_bootstrap import _OLD_ROW_WORDS, migrate_reading_rework

    s = llm_db.session()
    try:
        # Recreate the pre-rework state: piece action refs at the OLD seed
        # values, one of them user-edited to a different preset; the §9 words
        # on guided, an edited label on direct; and no migration marker.
        marker = s.get(llm_db.RunnerSetting, "jv_reading_rework_applied")
        if marker is not None:
            s.delete(marker)
        s.add(llm_db.FeaturePresetRef(key="speaker_attribution.guided", preset_id="p_extract"))
        s.add(llm_db.FeaturePresetRef(key="speaker_attribution.direct", preset_id="p_compose"))  # edited
        old_label, old_desc = _OLD_ROW_WORDS["speaker_attribution.guided"]
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        g.label, g.description = old_label, old_desc
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        d.label, d.description = "My own name", "my words"
        s.commit()
    finally:
        s.close()

    migrate_reading_rework()

    s = llm_db.session()
    try:
        assert s.get(llm_db.FeaturePresetRef, "speaker_attribution.guided") is None
        edited = s.get(llm_db.FeaturePresetRef, "speaker_attribution.direct")
        assert edited is not None and edited.preset_id == "p_compose"
        g = s.get(llm_db.FeaturePrompt, "speaker_attribution.guided")
        assert g.label == "Guided"
        d = s.get(llm_db.FeaturePrompt, "speaker_attribution.direct")
        assert d.label == "My own name" and d.description == "my words"
        assert s.get(llm_db.RunnerSetting, "jv_reading_rework_applied") is not None
    finally:
        s.close()
