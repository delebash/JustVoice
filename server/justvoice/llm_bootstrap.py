# SPDX-License-Identifier: MIT
"""Shared-LLM boot/reseed helpers used by BOTH create_app and factory-reset.

JV's SQLite file carries TWO seed sets — its own (effect/render presets) and
the shared stack's (prompt rows, presets, providers, runner settings). A
factory reset deletes the file, so the shared half must be re-wired and
re-seeded too (the family's dual-table reset lesson): storage re-pointed at
the NEW session factory (the old one is a disposed engine), tables re-created,
JV's warm-OFF default re-applied, then the shared seed.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def apply_jv_warm_default() -> None:
    """Seed JV's warm-on-startup default OFF, once (ruling 2026-08-05).

    Runs after the shared tables exist and before seed_llm (whose
    insert-if-missing then leaves the row alone). The marker row is what makes
    it one-time: without it, a user's later warm-ON choice would be flipped
    back on every boot. Best-effort — a failure here must never stop a boot
    (the cost is the family default, warm ON)."""
    from llm_runner.llm import db as llm_db

    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_warm_default_applied") is not None:
                return
            row = s.get(llm_db.RunnerSetting, "warm_default_on_startup")
            if row is None:
                s.add(llm_db.RunnerSetting(key="warm_default_on_startup", value="0"))
            else:
                row.value = "0"
            s.add(llm_db.RunnerSetting(key="jv_warm_default_applied", value="1"))
            s.commit()
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001 — a seed nicety, never boot-fatal
        log.warning("could not apply JV's warm-default-off seed: %s", e)


def reseed_shared_llm(engine, session_factory) -> None:
    """Factory-reset's shared-stack half: re-point storage at the NEW session
    factory, re-create the shared tables in the fresh file, re-apply JV's warm
    default, re-run the shared seed. Router mounts are untouched — they read
    through the store accessors, which follow the re-configured storage."""
    from llm_runner.llm import db as llm_db
    from llm_runner.llm.seed import seed_llm

    llm_db.configure_storage(session_factory)
    llm_db.create_all(engine)
    apply_jv_warm_default()
    seed_llm()
