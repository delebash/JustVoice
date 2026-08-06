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


# The shared DEFAULT_CATALOG ids JV retired (user direction 2026-08-05: the
# catalog shows the family's measured daily driver and nothing else). Existing
# DBs seeded these before the suppression; the one-time cleanup below removes
# exactly this list — a user-ADDED row has a different id and is never touched.
# Downloaded GGUFs stay on disk (a removed row is re-addable via Add a model).
_RETIRED_DEFAULT_CATALOG_IDS = (
    "gemma-4-12b-qat",
    "gemma-4-e4b-qat",
    "llama-3.3-70b-q4_k_m",
    "glm-4.5-air",
    "qwen3.6-27b",
    "gryphe-styletune-v2",
    "gemma-4-26b-a4b-uncensored-ez",
    "qwen3-embedding-4b",
    "qwen3-embedding-8b",
    "kalm-embedding-gemma3-12b",
)


def retire_default_catalog_rows() -> None:
    """Once, marker-guarded: drop the retired shared-default catalog rows (and
    their soft-ref sampler/embed-template children) from an existing DB, so an
    upgraded install shows the same one-row catalog as a fresh one."""
    from llm_runner.llm import db as llm_db

    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_default_catalog_retired") is not None:
                return
            removed = 0
            for mid in _RETIRED_DEFAULT_CATALOG_IDS:
                row = s.get(llm_db.ModelCatalog, mid)
                if row is not None:
                    s.delete(row)
                    removed += 1
                for child_model in (llm_db.ModelSampler, llm_db.ModelEmbedTemplate):
                    for child in s.query(child_model).filter_by(model_id=mid).all():
                        s.delete(child)
            s.add(llm_db.RunnerSetting(key="jv_default_catalog_retired", value="1"))
            s.commit()
            if removed:
                log.info("retired %d shared-default catalog row(s)", removed)
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001 — cleanup nicety, never boot-fatal
        log.warning("default-catalog retirement failed (rows remain visible): %s", e)


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
    retire_default_catalog_rows()
