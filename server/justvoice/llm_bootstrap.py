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
# catalog shows the family's measured daily driver and nothing else — AMENDED
# 2026-08-06: the 12B and E4B rungs return by user ask, so their ids left this
# list and live in JV_MODEL_CATALOG; on an already-retired DB the seed's
# insert-if-missing simply re-adds them). Existing DBs seeded the rest before
# the suppression; the one-time cleanup below removes exactly this list — a
# user-ADDED row has a different id and is never touched. Downloaded GGUFs
# stay on disk (a removed row is re-addable via Add a model).
_RETIRED_DEFAULT_CATALOG_IDS = (
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


# The attribution restore's one-time fixups for EXISTING DBs (approved
# 2026-08-06 late — three routed cards + the Auto row; supersedes the same
# day's pieces-rework migration, whose code this replaced). Fresh installs get
# the new seeds directly. Exact-stale-value pattern for anything a user can
# edit; bare metadata (positions, the feature grouping) is forced.
_STALE_ATTR_DESCS = {
    # key: [stale (label, description) pairs from BOTH earlier wordings — the
    # §9 originals and the pieces-rework words. A row still wearing one gets
    # the restore's seed words; an edited row stays the user's.]
    "speaker_attribution.guided": [
        (
            "Reading instructions (with examples)",
            "What the AI is told when it reads your chapter. This version includes worked examples — used automatically when a smaller model is doing the reading, because small models need to be shown.",
        ),
        (
            "Guided",
            "For small models — the rules plus worked examples; small models follow better when shown. Below 0.7 confidence a pick becomes unknown.",
        ),
    ],
    "speaker_attribution.direct": [
        (
            "Reading instructions (rules only)",
            "The same job without the examples — used automatically with larger models. JustVoice picks between these two for you.",
        ),
        (
            "Direct",
            "For big models — the same rules without the examples. Below 0.5 confidence a pick becomes unknown. JustVoice picks between Guided and Direct from your model; the dial on Speaker attribution can force one.",
        ),
    ],
}

# The pieces rework's "Careful reading" preset, byte-exact as it seeded — an
# unedited copy retires with the rework; any user change keeps the preset.
_CARELESS_READING_SEED = {
    "name": "Careful reading", "provider_id": "local-llamacpp",
    "model": "", "temperature": 0.2, "think": True,
}

_ATTR_POSITIONS = {
    "speaker_attribution.guided": 1,
    "speaker_attribution.direct": 2,
    "speaker_attribution.reasoned": 3,
}


def migrate_attribution_restore() -> None:
    """Once, marker-guarded (the attribution restore, approved 2026-08-06):

    1. Display positions on the three route rows (bare metadata — forced) so
       the list reads Guided · Direct · Reasoned, not key-alphabetical.
    2. `speaker_attribution.identify` moves to its own feature key
       (`speaker_discovery`) so Find new speakers leaves the heading (bare
       metadata — forced; the row's texts are untouched).
    3. The pieces rework's FEATURE-level ref (p_read) is removed — routing is
       per-route action refs again (the same boot's seed_llm inserts them
       where missing). A user's hand-assigned feature ref survives.
    4. The "Careful reading" preset retires if byte-identical to its seed; an
       edited one stays (unassigned, deletable in the Lab).
    5. Route rows still wearing either earlier wording get the restore's
       words — edited rows stay the user's.

    Runs after seed_llm (the reasoned row + refs must exist). Also stamps the
    superseded pieces-rework marker so that retired migration can never fire
    on a DB that skipped it."""
    from llm_runner.llm import db as llm_db

    from .seed_feature_prompts import DEFAULT_FEATURE_PROMPTS

    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_attribution_restore_applied") is not None:
                return
            for key, pos in _ATTR_POSITIONS.items():
                row = s.get(llm_db.FeaturePrompt, key)
                if row is not None:
                    row.position = pos
            ident = s.get(llm_db.FeaturePrompt, "speaker_attribution.identify")
            if ident is not None:
                ident.feature = "speaker_discovery"
            fref = s.get(llm_db.FeaturePresetRef, "speaker_attribution")
            if fref is not None and fref.preset_id == "p_read":
                s.delete(fref)
            p_read = s.get(llm_db.EnginePreset, "p_read")
            if p_read is not None and all(
                getattr(p_read, k, None) == v for k, v in _CARELESS_READING_SEED.items()
            ):
                s.delete(p_read)
            for key, stale_pairs in _STALE_ATTR_DESCS.items():
                row = s.get(llm_db.FeaturePrompt, key)
                spec = DEFAULT_FEATURE_PROMPTS.get(key) or {}
                if row is not None and (row.label, row.description) in stale_pairs:
                    row.label = str(spec.get("label") or "")
                    row.description = str(spec.get("description") or "")
            s.add(llm_db.RunnerSetting(key="jv_attribution_restore_applied", value="1"))
            if s.get(llm_db.RunnerSetting, "jv_reading_rework_applied") is None:
                s.add(llm_db.RunnerSetting(key="jv_reading_rework_applied", value="1"))
            s.commit()
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001 — a fixup nicety, never boot-fatal
        log.warning("attribution-restore migration failed (stale rows remain): %s", e)


# Yesterday's restore wordings, byte-exact as they seeded — the Auto
# simplification (approved 2026-08-06) trims the "Auto runs this when…"
# tails (the Auto pane owns the picking; a card describes only itself) and
# names WHERE the examples live. A row still wearing the tailed words gets
# the trimmed seed; an edited row stays the user's.
_TAILED_ATTR_DESCS = {
    "speaker_attribution.guided": (
        "Guided",
        "For small models — the rules plus worked examples; small models follow better when shown. Below 0.7 confidence a pick becomes unknown. Auto runs this when your model is small.",
    ),
    "speaker_attribution.direct": (
        "Direct",
        "For big models — the same rules without the examples. Below 0.5 confidence a pick becomes unknown. Auto runs this when your model is big.",
    ),
    "speaker_attribution.reasoned": (
        "Reasoned",
        "Direct's rules with thinking on — for reasoning models. Below 0.5 confidence a pick becomes unknown. Auto runs this when your model is a reasoning model.",
    ),
}


# The restore's attribution Lab sample, byte-exact as it seeded — retired by
# the same user catch ("samples represent real world text"): it carried the
# pipeline-internal [D#] tags (segmentation adds those itself), a Mira/Mara
# typo, and a template-composer characters format the attribution adapter
# can't parse. The raw-prose replacement seeds under a NEW label, so an
# unedited old row is deleted here; an edited one stays the user's.
_TAGGED_SAMPLE_LABEL = "Quay scene — tagged + bare quotes"
_TAGGED_SAMPLE_VARS = {
    "characters": '- id="c_mara", name="Mara", gender="female"\n'
                  '- id="c_renn", name="Renn", gender="male"',
    "corrections": "",
    "paragraphs": 'Mira reached the quay as the bell finished counting. '
                  '[D1] "You knew before the funeral," Renn said. He did not look at her.\n\n'
                  '[D2] "The page told me," she said. [D3] "Ask me who else can read it."',
}
_ATTR_ROUTE_ACTIONS = (
    "speaker_attribution.guided",
    "speaker_attribution.direct",
    "speaker_attribution.reasoned",
)


def migrate_auto_simplify() -> None:
    """Once, marker-guarded (the Auto simplification, approved 2026-08-06):

    1. Route rows still wearing the restore's tailed wordings get the trimmed
       seed words — edited rows stay the user's.
    2. The pre-tagged attribution Lab sample retires if byte-identical to its
       seed; this boot's seed_fill has already inserted the raw-prose
       replacement under its new label.

    (The retired force needs no scrub: the settings model dropped `route`,
    so loads ignore a stale key and the next save rewrites the canonical
    shape.) Runs after seed_llm + migrate_attribution_restore, so a
    pre-restore DB has already landed on the current seeds before this
    looks."""
    from llm_runner.llm import db as llm_db

    from .seed_feature_prompts import DEFAULT_FEATURE_PROMPTS

    try:
        s = llm_db.session()
        try:
            if s.get(llm_db.RunnerSetting, "jv_attr_auto_simplify_applied") is not None:
                return
            for key, stale in _TAILED_ATTR_DESCS.items():
                row = s.get(llm_db.FeaturePrompt, key)
                spec = DEFAULT_FEATURE_PROMPTS.get(key) or {}
                if row is not None and (row.label, row.description) == stale:
                    row.label = str(spec.get("label") or "")
                    row.description = str(spec.get("description") or "")
            for action in _ATTR_ROUTE_ACTIONS:
                for sample in (
                    s.query(llm_db.TestSample)
                    .filter_by(action_key=action, label=_TAGGED_SAMPLE_LABEL)
                    .all()
                ):
                    vars_rows = (
                        s.query(llm_db.TestSampleVar).filter_by(sample_id=sample.id).all()
                    )
                    if {v.name: v.value for v in vars_rows} == _TAGGED_SAMPLE_VARS:
                        for v in vars_rows:
                            s.delete(v)
                        s.delete(sample)
            s.add(llm_db.RunnerSetting(key="jv_attr_auto_simplify_applied", value="1"))
            s.commit()
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001 — a fixup nicety, never boot-fatal
        log.warning("auto-simplify migration failed (stale rows remain): %s", e)


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
    migrate_attribution_restore()
    migrate_auto_simplify()
