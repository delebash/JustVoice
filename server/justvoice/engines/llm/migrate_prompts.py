# SPDX-License-Identifier: MIT
"""One-time prompt migration: `jv_feature_prompts` → the SHARED `feature_prompts`
table + preset tunable lift (convergence part 3's data half; ruling 1+9,
2026-08-05: prompt TEXT always migrates preserving user edits — seed-if-missing
semantics, never clobber; a row's hand-changed temperature/think lifts into
that feature's assigned preset).

Runs from create_app in two halves around `seed_llm()`:

  migrate_jv_prompts_to_shared()   BEFORE seed_llm — an EDITED old row is
      inserted under its new key first, so the shared insert-if-missing seed
      skips it (the edit wins). UNEDITED rows are NOT copied: the new seed
      defaults are deliberately better shaped (user messages that were
      code-built are {{var}} templates now; the attribution user template's
      single-brace .replace tokens became {{var}}), and copying an unedited old
      row would pin the worse shape forever.

  lift_edited_tunables_into_presets()   AFTER seed_llm — presets must exist
      before their temperature/think can be overwritten. Marker-guarded
      one-time (`jv_prompt_tunables_lifted` beside the warm-default marker),
      and on success it DROPS the legacy table — the old system's code
      (model, store, editor router, seeder) is deleted, so this module reads
      the legacy rows by raw SQL and is the table's last consumer.

Edit detection compares against the OLD seed defaults, reconstructed here:
the old system texts are the same constants the new seed uses (they never
forked), and the old user templates were the single-brace attribution template
for the tier pair and "" everywhere else (those user messages were code-built).
"""

from __future__ import annotations

import logging

from sqlalchemy import text

log = logging.getLogger(__name__)

# Old key → new key (the family dotted spelling; `identify` predates it).
_KEY_RENAMES = {"identify": "speaker_attribution.identify"}

# The attribution user template's pre-shared substitution tokens → {{var}}.
_BRACE_TOKENS = ("characters", "corrections", "paragraphs")

# The OLD seeded attribution user template, verbatim (single-brace .replace
# tokens — extraction/prompts.py's USER_TEMPLATE before the {{var}} move).
_OLD_ATTR_USER_TEMPLATE = """Characters in this scene:
{characters}
{corrections}
Paragraphs (dialogue segments tagged inline):

{paragraphs}

Return only the JSON array, one entry per [D#] in the order they appear.
"""


def _convert_braces(text_: str) -> str:
    for name in _BRACE_TOKENS:
        text_ = text_.replace("{" + name + "}", "{{" + name + "}}")
    return text_


def _old_seed_defaults() -> dict:
    """The retired seeder's per-key defaults, for edit detection. System texts
    import from the same homes the old seeder used — they never forked."""
    from ...extraction.identify import IDENTIFY_SYSTEM
    from ...extraction.prompts import DIRECT_SYSTEM, GUIDED_SYSTEM
    from ...seed_feature_prompts import (
        _PRESET_SUGGEST_SYSTEM,
        _SHOW_NOTES_SYSTEM,
        _SMART_ASSIGN_SYSTEM,
    )

    return {
        "smart_assign": {"system": _SMART_ASSIGN_SYSTEM, "user_template": "",
                         "temperature": 0.2, "think": False},
        "render_preset_suggest": {"system": _PRESET_SUGGEST_SYSTEM, "user_template": "",
                                  "temperature": 0.0, "think": False},
        "show_notes": {"system": _SHOW_NOTES_SYSTEM, "user_template": "",
                       "temperature": 0.4, "think": False},
        "speaker_attribution.guided": {"system": GUIDED_SYSTEM,
                                       "user_template": _OLD_ATTR_USER_TEMPLATE,
                                       "temperature": 0.2, "think": False},
        "speaker_attribution.direct": {"system": DIRECT_SYSTEM,
                                       "user_template": _OLD_ATTR_USER_TEMPLATE,
                                       "temperature": 0.2, "think": False},
        "identify": {"system": IDENTIFY_SYSTEM, "user_template": "",
                     "temperature": 0.2, "think": False},
    }


def _old_rows() -> list[dict]:
    """The legacy table's rows via raw SQL (its ORM model is deleted) — []
    when the table is absent (fresh install, or already migrated + dropped)."""
    from ...database import session as db_session

    if db_session.SessionLocal is None:
        return []
    s = db_session.SessionLocal()
    try:
        try:
            rows = s.execute(text(
                "SELECT key, feature, system, user_template, temperature, think "
                "FROM jv_feature_prompts"
            )).fetchall()
        except Exception:  # noqa: BLE001 — no such table
            return []
        return [
            {"key": r[0], "feature": r[1], "system": r[2], "user_template": r[3],
             "temperature": r[4], "think": bool(r[5])}
            for r in rows
        ]
    finally:
        s.close()


def _drop_legacy_table() -> None:
    """DROP the migrated table (idempotent). Only called from the lift's
    success paths — a failed migration must keep the rows for the next boot."""
    from ...database import session as db_session

    if db_session.SessionLocal is None:
        return
    s = db_session.SessionLocal()
    try:
        s.execute(text("DROP TABLE IF EXISTS jv_feature_prompts"))
        s.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("could not drop legacy jv_feature_prompts: %s", e)
    finally:
        s.close()


def migrate_jv_prompts_to_shared() -> None:
    """Insert every EDITED legacy row into the shared table under its new key.
    Idempotent by construction: insert only when the new key is absent, so the
    second boot (key present — from this migration or the seed) is a no-op."""
    from llm_runner.llm import db as llm_db

    from ...seed_feature_prompts import DEFAULT_FEATURE_PROMPTS as NEW_SEEDS

    old_rows = _old_rows()
    if not old_rows:
        return
    old_seeds = _old_seed_defaults()
    try:
        s = llm_db.session()
        try:
            existing = {r.key for r in s.query(llm_db.FeaturePrompt.key).all()}
            migrated = 0
            for row in old_rows:
                new_key = _KEY_RENAMES.get(row["key"], row["key"])
                new_seed = NEW_SEEDS.get(new_key)
                old_seed = old_seeds.get(row["key"])
                if new_seed is None or old_seed is None or new_key in existing:
                    continue
                system_edited = row["system"] != old_seed["system"]
                user_edited = row["user_template"] != old_seed["user_template"]
                if not (system_edited or user_edited):
                    continue  # untouched → the new seed's better shape wins
                s.add(llm_db.FeaturePrompt(
                    key=new_key,
                    feature=str(new_seed.get("feature") or new_key),
                    system=row["system"] if system_edited else str(new_seed.get("system") or ""),
                    user_template=(
                        _convert_braces(row["user_template"]) if user_edited
                        else str(new_seed.get("user_template") or "")
                    ),
                    built_in=True,
                    json_mode=bool(new_seed.get("json_mode", False)),
                    json_schema=str(new_seed.get("json_schema") or ""),
                ))
                migrated += 1
            if migrated:
                s.commit()
                log.info("migrated %d edited jv_feature_prompts row(s) into the shared table", migrated)
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001 — migration must never stop a boot
        log.warning("jv prompt migration failed (rows kept for the next boot): %s", e)


def lift_edited_tunables_into_presets() -> None:
    """Once: a legacy row's hand-changed temperature/think overwrites its
    feature's ASSIGNED preset (the one-source rule — tunables live on presets).
    After seed_llm so the preset rows exist. On success (either the fresh lift
    or the marker saying it already happened) the legacy table drops."""
    from llm_runner.llm import db as llm_db

    from ...seed_presets import DEFAULT_FEATURE_PRESETS

    old_rows = _old_rows()
    if not old_rows:
        return
    old_seeds = _old_seed_defaults()
    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_prompt_tunables_lifted") is not None:
                # Lifted on an earlier boot (before the drop existed) — the
                # table is migrated residue; drop it now.
                s.close()
                _drop_legacy_table()
                return
            lifted = 0
            for row in old_rows:
                old_seed = old_seeds.get(row["key"])
                if old_seed is None:
                    continue
                new_key = _KEY_RENAMES.get(row["key"], row["key"])
                preset_id = DEFAULT_FEATURE_PRESETS.get(new_key, "")
                preset = s.get(llm_db.EnginePreset, preset_id) if preset_id else None
                if preset is None:
                    continue
                if row["temperature"] != old_seed.get("temperature"):
                    preset.temperature = row["temperature"]
                    lifted += 1
                if bool(row["think"]) != bool(old_seed.get("think", False)):
                    preset.think = bool(row["think"])
                    lifted += 1
            s.add(llm_db.RunnerSetting(key="jv_prompt_tunables_lifted", value="1"))
            s.commit()
            if lifted:
                log.info("lifted %d hand-changed prompt tunable(s) into presets", lifted)
        finally:
            s.close()
        # Both halves succeeded — the legacy rows are fully absorbed.
        _drop_legacy_table()
    except Exception as e:  # noqa: BLE001
        log.warning("jv tunable lift failed (presets keep seed values): %s", e)
