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
    # Attribution's own preset asks for thinking — the runner's capability
    # gate turns that into "thinks on models that can" (approved 2026-08-06).
    assert presets["p_read"]["think"] is True
    # Every seeded row RESOLVES through the cascade: its own ref, or its
    # FEATURE's ref (the pieces rework — guided/direct and the refine sections
    # route through one feature-level assignment). And every ref names a
    # seeded row or a seeded feature.
    features_of = {k: (v.get("feature") or k) for k, v in DEFAULT_FEATURE_PROMPTS.items()}
    for key, feat in features_of.items():
        assert key in DEFAULT_FEATURE_PRESETS or feat in DEFAULT_FEATURE_PRESETS, key
    known = set(DEFAULT_FEATURE_PROMPTS) | set(features_of.values())
    for ref_key in DEFAULT_FEATURE_PRESETS:
        assert ref_key in known, ref_key


def _plant_legacy_row(key: str, system: str, temperature: float) -> None:
    """Recreate the pre-F1 state: a jv_feature_prompts table (the model is
    gone — raw SQL, like the migration's own reads) holding one user-edited
    row. Boots migrate it, then drop the table."""
    from sqlalchemy import text

    from justvoice.database import session as db_session

    s = db_session.SessionLocal()
    try:
        s.execute(text(
            "CREATE TABLE IF NOT EXISTS jv_feature_prompts ("
            "key TEXT PRIMARY KEY, feature TEXT NOT NULL DEFAULT '', "
            "system TEXT NOT NULL DEFAULT '', user_template TEXT NOT NULL DEFAULT '', "
            "temperature FLOAT NOT NULL DEFAULT 0.7, think BOOLEAN NOT NULL DEFAULT 0, "
            "built_in BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME)"
        ))
        s.execute(
            text("INSERT INTO jv_feature_prompts (key, feature, system, user_template, temperature, think) "
                 "VALUES (:k, :f, :sys, '', :t, 0)"),
            {"k": key, "f": "x", "sys": system, "t": temperature},
        )
        s.commit()
    finally:
        s.close()


def _clear_shared(key: str, *, clear_lift_marker: bool = False) -> None:
    from llm_runner.llm import db as llm_db

    ls = llm_db.session()
    try:
        row = ls.get(llm_db.FeaturePrompt, key)
        if row is not None:
            ls.delete(row)
        if clear_lift_marker:
            marker = ls.get(llm_db.RunnerSetting, "jv_prompt_tunables_lifted")
            if marker is not None:
                ls.delete(marker)
        ls.commit()
    finally:
        ls.close()


def test_edited_legacy_row_migrates_wins_and_table_drops(tmp_path):
    # Boot once (fresh shared seed), then simulate the 2026-08-01..05 state:
    # a user-edited legacy row + no shared row yet.
    _client(tmp_path)
    _plant_legacy_row("smart_assign", "MY EDITED CASTING PROMPT", 0.55)
    _clear_shared("smart_assign", clear_lift_marker=True)

    _client(tmp_path)
    row = _shared_rows()["smart_assign"]
    # The edit won over the seed default…
    assert row.system == "MY EDITED CASTING PROMPT"
    # …while the untouched (legacy-empty) user template took the NEW seed's.
    assert "{{voices}}" in row.user_template
    from llm_runner.llm import db as llm_db

    ls = llm_db.session()
    try:
        # The hand-changed temperature lifted onto the assigned preset.
        assert ls.get(llm_db.EnginePreset, "p_extract").temperature == 0.55
    finally:
        ls.close()
    # Both halves succeeded → the legacy table dropped.
    from sqlalchemy import text

    from justvoice.database import session as db_session

    s = db_session.SessionLocal()
    try:
        names = {r[0] for r in s.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
        assert "jv_feature_prompts" not in names
    finally:
        s.close()


def test_legacy_identify_key_renames(tmp_path):
    _client(tmp_path)
    _plant_legacy_row("identify", "EDITED DISCOVERY PROMPT", 0.2)
    _clear_shared("speaker_attribution.identify", clear_lift_marker=True)

    _client(tmp_path)
    row = _shared_rows()["speaker_attribution.identify"]
    assert row.system == "EDITED DISCOVERY PROMPT"
    assert "{{manuscript}}" in row.user_template


def test_catalog_is_the_measured_daily_driver_only(tmp_path):
    # User direction 2026-08-05: the shared writing-curated DEFAULT_CATALOG is
    # suppressed; JV seeds exactly the family's measured Gemma 4 26B-A4B QAT.
    c = _client(tmp_path)
    rows = c.get("/v1/ai/model-catalog").json()
    ids = {r["id"] for r in rows["rows"]}
    assert ids == {"gemma-4-26b-a4b-qat"}
    row = rows["rows"][0]
    assert row["quant"] == "UD-Q4_K_XL" and row["tier"] == "low-vram-moe"


def test_retired_default_rows_are_removed_once_from_existing_dbs(tmp_path):
    # Simulate the pre-suppression state: a DB that already carries two of the
    # retired shared-default rows + no marker.
    _client(tmp_path)
    from llm_runner.llm import db as llm_db

    ls = llm_db.session()
    try:
        ls.add(llm_db.ModelCatalog(id="gemma-4-12b-qat", name="Gemma 4 12B (QAT)"))
        ls.add(llm_db.ModelCatalog(id="gryphe-styletune-v2", name="StyleTune"))
        # A USER-added row must survive the cleanup untouched.
        ls.add(llm_db.ModelCatalog(id="my-own-model", name="Mine"))
        marker = ls.get(llm_db.RunnerSetting, "jv_default_catalog_retired")
        if marker is not None:
            ls.delete(marker)
        ls.commit()
    finally:
        ls.close()

    c = _client(tmp_path)
    ids = {r["id"] for r in c.get("/v1/ai/model-catalog").json()["rows"]}
    assert ids == {"gemma-4-26b-a4b-qat", "my-own-model"}

