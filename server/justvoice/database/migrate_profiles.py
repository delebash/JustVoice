# SPDX-License-Identifier: MIT
"""One-shot Profile → Persona migration (Slice 1 of the Profile-kill rollout).

For every VoiceProfile row in SQLite, materialize an orphan Persona JSON
record carrying the absorbed fields (voice_id, language, avatar_path,
personality, default_delivery, effects_chain, lexicon_id, engine_override).
Orphan = no ProjectPersona link; the user binds it to specific projects
later via the Personas tab's "Add to project" action (Slice 2).

Idempotent: each migrated Persona is tagged
``imported_from="voice_profile"`` + ``imported_id=<profile.id>`` so reruns
detect existing migrations and skip.

This runs at every app boot until the VoiceProfile table is dropped in
Slice 4. After the drop the helper becomes a no-op.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from sqlalchemy import inspect

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

    from ..storage.personas import PersonaStore

log = logging.getLogger(__name__)


def migrate_voice_profiles_to_personas(
    engine: "Engine", persona_store: "PersonaStore"
) -> int:
    """Copy every VoiceProfile row into an orphan Persona JSON record.

    Returns the number of profiles migrated this run. Existing migrated
    rows (tagged via imported_from/imported_id) are skipped.

    Reads VoiceProfile rows via a raw SQL SELECT — avoids importing the
    ORM model so this helper still works after Slice 4 drops the SQLAlchemy
    model definition (it'll find an empty table or a missing table and
    return 0).
    """
    inspector = inspect(engine)
    if "voice_profiles" not in set(inspector.get_table_names()):
        return 0

    # Build a quick lookup of already-migrated source ids so the second
    # pass through is O(personas) not O(personas × profiles).
    already_migrated = {
        p.imported_id
        for p in persona_store.list()
        if p.imported_from == "voice_profile" and p.imported_id
    }

    migrated = 0
    with engine.connect() as conn:
        rows = conn.execute(
            _select_voice_profiles_sql()
        ).mappings().all()

    for row in rows:
        profile_id = row["id"]
        if profile_id in already_migrated:
            continue

        # Voice resolution: preset profiles point at a concrete engine
        # voice id; cloned/designed profiles don't have a portable voice
        # id (the audio lives in ProfileSample rows). We seed `voice_id`
        # with the preset id when available and a `profile:<id>` stub
        # otherwise — the user fixes it in the Personas tab if the stub
        # doesn't resolve at render time.
        voice_id = row["preset_voice_id"] or f"profile:{profile_id}"

        default_delivery = _parse_json_dict(row["default_delivery"])
        effects_chain = _parse_json_list(row["effects_chain"])

        try:
            persona_store.create(
                name=row["name"],
                voice_id=voice_id,
                default_delivery=default_delivery,
                bio=row["description"],
                engine_override=row["default_engine"],
                lexicon_id=row["default_lexicon_id"],
                language=row["language"] or "en",
                avatar_path=row["avatar_path"],
                personality=row["personality"],
                effects_chain=effects_chain,
                imported_from="voice_profile",
                imported_id=profile_id,
            )
            migrated += 1
        except Exception as e:
            log.warning(
                "voice_profile %s could not be migrated to a persona: %s",
                profile_id,
                e,
            )

    if migrated:
        log.info("migrated %d voice_profile row(s) → orphan persona record(s)", migrated)
    return migrated


def _select_voice_profiles_sql():
    from sqlalchemy import text

    return text(
        """
        SELECT id, name, description, language, avatar_path,
               voice_type, preset_engine, preset_voice_id, design_prompt,
               default_engine, effects_chain, default_lexicon_id,
               personality, default_delivery
        FROM voice_profiles
        """
    )


def _parse_json_dict(blob: str | None) -> dict:
    if not blob:
        return {}
    try:
        v = json.loads(blob)
    except (json.JSONDecodeError, TypeError):
        return {}
    return v if isinstance(v, dict) else {}


def _parse_json_list(blob: str | None) -> list[dict]:
    if not blob:
        return []
    try:
        v = json.loads(blob)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(v, list):
        return []
    return [item for item in v if isinstance(item, dict)]
