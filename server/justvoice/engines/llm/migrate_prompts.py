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
      one-time (`jv_prompt_tunables_lifted` beside the warm-default marker):
      re-running every boot would clobber later Lab edits with the old values.

The old table itself is dropped in the deletion step, after every caller stops
reading it — not here.

Edit detection compares against the OLD seed defaults
(database/seed.py DEFAULT_FEATURE_PROMPTS), per field: an edited system
migrates while an untouched user_template still takes the NEW seed's template
(most old rows had empty user templates — their user messages were code-built,
and an edited system must not cost the feature its new user half).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# Old key → new key (the family dotted spelling; `identify` predates it).
_KEY_RENAMES = {"identify": "speaker_attribution.identify"}

# The attribution user template's pre-shared substitution tokens → {{var}}.
_BRACE_TOKENS = ("characters", "corrections", "paragraphs")


def _convert_braces(text: str) -> str:
    for name in _BRACE_TOKENS:
        text = text.replace("{" + name + "}", "{{" + name + "}}")
    return text


def _old_rows_and_seeds():
    """(old rows, old seed-defaults dict) — [] when the legacy table is absent
    or empty (a fresh install after the table drop lands)."""
    from ...database import session as db_session
    from ...database.models import FeaturePrompt
    from ...database.seed import DEFAULT_FEATURE_PROMPTS as OLD_SEEDS

    if db_session.SessionLocal is None:
        return [], {}
    s = db_session.SessionLocal()
    try:
        try:
            rows = s.query(FeaturePrompt).all()
        except Exception:  # noqa: BLE001 — table already dropped
            return [], {}
        return (
            [
                {
                    "key": r.key, "feature": r.feature, "system": r.system,
                    "user_template": r.user_template,
                    "temperature": r.temperature, "think": r.think,
                }
                for r in rows
            ],
            {d["key"]: d for d in OLD_SEEDS},
        )
    finally:
        s.close()


def migrate_jv_prompts_to_shared() -> None:
    """Insert every EDITED legacy row into the shared table under its new key.
    Idempotent by construction: insert only when the new key is absent, so the
    second boot (key present — from this migration or the seed) is a no-op."""
    from llm_runner.llm import db as llm_db

    from ...seed_feature_prompts import DEFAULT_FEATURE_PROMPTS as NEW_SEEDS

    old_rows, old_seeds = _old_rows_and_seeds()
    if not old_rows:
        return
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
        log.warning("jv prompt migration failed (old system still serves): %s", e)


def lift_edited_tunables_into_presets() -> None:
    """Once: a legacy row's hand-changed temperature/think overwrites its
    feature's ASSIGNED preset (the one-source rule — tunables live on presets).
    After seed_llm so the preset rows exist."""
    from llm_runner.llm import db as llm_db

    from ...seed_presets import DEFAULT_FEATURE_PRESETS

    old_rows, old_seeds = _old_rows_and_seeds()
    if not old_rows:
        return
    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_prompt_tunables_lifted") is not None:
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
    except Exception as e:  # noqa: BLE001
        log.warning("jv tunable lift failed (presets keep seed values): %s", e)
