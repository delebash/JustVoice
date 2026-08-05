# SPDX-License-Identifier: MIT
"""F1 Phase 2 — every JV action is a template row in the SHARED prompt system
(ruling 9), the preset library is the one source of tunables, and the legacy
`jv_feature_prompts` system migrates preserving user edits (ruling 1).

Prompt assertions read the SHARED store directly (llm_runner.llm.stores): JV's
legacy ai_prompts_api still shadows GET /v1/ai/prompts by design until the
deletion step, so the HTTP door shows the OLD rows for now.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.seed_feature_prompts import DEFAULT_FEATURE_PROMPTS
from justvoice.seed_presets import DEFAULT_ENGINE_PRESETS, DEFAULT_FEATURE_PRESETS


def _client(tmp_path) -> TestClient:
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _shared_rows() -> dict:
    from llm_runner.llm import stores

    return {r.key: r for r in stores.get_prompt_store().list()}


def test_all_actions_seed_as_shared_rows(tmp_path):
    _client(tmp_path)
    rows = _shared_rows()
    for key in DEFAULT_FEATURE_PROMPTS:
        assert key in rows, f"missing shared row {key}"
    # 13 actions over 9 features (the refine ×4 composition + the tier pair +
    # discovery under speaker_attribution).
    assert len(DEFAULT_FEATURE_PROMPTS) == 13
    assert rows["refine.base"].user_template == "{{transcript}}"
    assert "{{characters}}" in rows["speaker_attribution.guided"].user_template
    assert rows["smart_assign"].json_mode is True
    assert rows["speaker_attribution.guided"].json_mode is False  # array output


def test_presets_and_refs_seed(tmp_path):
    c = _client(tmp_path)
    body = c.get("/v1/ai/engine-presets").json()
    presets = {p["id"]: p for p in body["presets"]}
    for p in DEFAULT_ENGINE_PRESETS:
        assert p["id"] in presets
    # compose runs at its preset's 0.9 (the hardcoded personas_api temperature
    # moved onto the preset — ruling 9).
    assert presets["p_compose"]["temperature"] == 0.9
    # Every seeded action carries a ref, and refs only name seeded actions.
    assert set(DEFAULT_FEATURE_PRESETS) == set(DEFAULT_FEATURE_PROMPTS)


def test_edited_legacy_row_migrates_and_wins_over_seed(tmp_path):
    # Boot once (seeds both systems), then simulate the 2026-08-01..05 state:
    # a user-edited legacy row + no shared row yet.
    _client(tmp_path)
    from llm_runner.llm import db as llm_db

    from justvoice.database import session as db_session
    from justvoice.database.models import FeaturePrompt as JvPrompt

    s = db_session.SessionLocal()
    try:
        s.query(JvPrompt).filter(JvPrompt.key == "smart_assign").update(
            {"system": "MY EDITED CASTING PROMPT", "temperature": 0.55})
        s.commit()
    finally:
        s.close()
    ls = llm_db.session()
    try:
        ls.delete(ls.get(llm_db.FeaturePrompt, "smart_assign"))
        marker = ls.get(llm_db.RunnerSetting, "jv_prompt_tunables_lifted")
        if marker is not None:
            ls.delete(marker)
        ls.commit()
    finally:
        ls.close()

    _client(tmp_path)
    row = _shared_rows()["smart_assign"]
    # The edit won over the seed default…
    assert row.system == "MY EDITED CASTING PROMPT"
    # …while the untouched (legacy-empty) user template took the NEW seed's.
    assert "{{voices}}" in row.user_template
    # The hand-changed temperature lifted onto the assigned preset.
    ls = llm_db.session()
    try:
        assert ls.get(llm_db.EnginePreset, "p_extract").temperature == 0.55
    finally:
        ls.close()


def test_legacy_identify_key_renames(tmp_path):
    _client(tmp_path)
    from llm_runner.llm import db as llm_db

    from justvoice.database import session as db_session
    from justvoice.database.models import FeaturePrompt as JvPrompt

    s = db_session.SessionLocal()
    try:
        s.query(JvPrompt).filter(JvPrompt.key == "identify").update(
            {"system": "EDITED DISCOVERY PROMPT"})
        s.commit()
    finally:
        s.close()
    ls = llm_db.session()
    try:
        ls.delete(ls.get(llm_db.FeaturePrompt, "speaker_attribution.identify"))
        ls.commit()
    finally:
        ls.close()

    _client(tmp_path)
    row = _shared_rows()["speaker_attribution.identify"]
    assert row.system == "EDITED DISCOVERY PROMPT"
    assert "{{manuscript}}" in row.user_template
