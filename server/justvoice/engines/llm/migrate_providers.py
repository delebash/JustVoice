# SPDX-License-Identifier: MIT
"""One-time settings→DB migration for LLM providers — convergence part 2.

Until 2026-08-01 JustVoice persisted its LLM providers in `settings.engines.llm[]`
(its own settings-backed ProviderStore behind the shared provider router). Full
convergence moves provider storage to the shared DB table (`llm_providers`, owned
by `install_llm`), the same place JustWrite keeps them — one storage, one CRUD
surface, one registry boot path.

This migration copies each settings row into the DB store ONCE. Idempotent by
id-existence: a row already in the DB (migrated earlier, or user-edited since) is
never touched, so re-running on every boot is safe and user edits win forever
after. The settings list itself is left in place as dormant legacy data — an old
settings.json downgrade still has its providers — but NOTHING reads it anymore:
the registry boots from the DB store and the shared router writes it.

Follows the `database/migrate_profiles.py` precedent (the VoiceProfile→Persona
one-shot).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def migrate_settings_providers_to_db(settings) -> int:
    """Copy `settings.engines.llm[]` rows into the shared DB provider store.
    Returns how many rows were migrated (0 on every boot after the first)."""
    from llm_runner.llm import stores

    store = stores.get_provider_store()
    migrated = 0
    for cfg in list(getattr(settings.engines, "llm", []) or []):
        try:
            if store.get(cfg.id) is None:
                store.add(cfg)
                migrated += 1
        except Exception as e:  # noqa: BLE001 — one bad legacy row must not kill boot
            log.warning("provider migration skipped %r: %s", getattr(cfg, "id", "?"), e)
    if migrated:
        log.info("migrated %d LLM provider(s) from settings.engines.llm to the DB store", migrated)
    return migrated
