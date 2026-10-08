# SPDX-License-Identifier: MIT
"""The Python half of compare-seed.mjs — JustVoice's seed + store parity check.

    python compare-seed.py texts <out.json>          the prompt texts seed_feature_prompts imports
                                                     (stand-ins for not-yet-ported modules) and
                                                     every seed constant, floats marked
    python compare-seed.py boot <dir>                init_db + AppState + install_llm(None, …)
                                                     + seed_workspace — the serve boot, headless
    python compare-seed.py ops <dir> <ops.json> <out.json>   boot (no seed), replay store ops,
                                                     dump every answer
    python compare-seed.py real <dir> <out.json>     a COPY of the dev data root: read every
                                                     store, rewrite every row unchanged, dump

Run with JustVoice's venv; JUST_AI_HOME / LLM_RUNNER_CACHE point into temp (set by the caller).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def marked(v):
    """JSON with every float marked {"$float": x} — the JS side compares PyFloat by it."""
    if isinstance(v, bool) or v is None or isinstance(v, (int, str)):
        return v
    if isinstance(v, float):
        return {"$float": v}
    if isinstance(v, dict):
        return {k: marked(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [marked(x) for x in v]
    if hasattr(v, "model_dump"):
        return marked(v.model_dump())
    if hasattr(v, "__dataclass_fields__"):
        return marked({k: getattr(v, k) for k in v.__dataclass_fields__})
    return repr(v)


def wire(m):
    """A store answer as the API's JSON (pydantic's mode="json")."""
    if m is None:
        return None
    if isinstance(m, list):
        return [wire(x) for x in m]
    if isinstance(m, tuple):
        return [wire(x) for x in m]
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    return m


def cmd_texts(out: str) -> None:
    from justvoice import feature_catalog, refinement, seed_feature_prompts, seed_presets
    from justvoice.database.seed import BUILTIN_EFFECT_PRESETS
    from justvoice.extraction import identify, prompts, second_look

    data = {
        "stubs": {
            "extraction/identify.js": {"IDENTIFY_SYSTEM": identify.IDENTIFY_SYSTEM},
            "extraction/prompts.js": {"DIRECT_SYSTEM": prompts.DIRECT_SYSTEM, "GUIDED_SYSTEM": prompts.GUIDED_SYSTEM},
            "extraction/second_look.js": {"SYSTEM": second_look.SYSTEM, "USER_TEMPLATE": second_look.USER_TEMPLATE},
            "refinement.js": {
                "_BASE_INSTRUCTIONS": refinement._BASE_INSTRUCTIONS,
                "_PRESERVE_TECHNICAL": refinement._PRESERVE_TECHNICAL,
                "_SELF_CORRECTION": refinement._SELF_CORRECTION,
                "_SMART_CLEANUP": refinement._SMART_CLEANUP,
            },
        },
        "constants": marked({
            "DEFAULT_ENGINE_PRESETS": seed_presets.DEFAULT_ENGINE_PRESETS,
            "JV_MODEL_CATALOG": seed_presets.JV_MODEL_CATALOG,
            "JV_CLASS_TUNES": seed_presets.JV_CLASS_TUNES,
            "JV_CLASS_TUNE_IDENTITY": seed_presets.JV_CLASS_TUNE_IDENTITY,
            "DEFAULT_FEATURE_PRESETS": seed_presets.DEFAULT_FEATURE_PRESETS,
            "DEFAULT_PRESET_ID": seed_presets.DEFAULT_PRESET_ID,
            "DEFAULT_TEST_SAMPLES": seed_presets.DEFAULT_TEST_SAMPLES,
            "DEFAULT_FEATURE_PROMPTS": seed_feature_prompts.DEFAULT_FEATURE_PROMPTS,
            "FEATURE_CATALOG": [
                {"key": e.key, "label": e.label, "hint": e.hint, "group": e.group}
                for e in feature_catalog.FEATURE_CATALOG
            ],
            "PREFER_LOCAL_FEATURES": sorted(feature_catalog.PREFER_LOCAL_FEATURES),
            "BUILTIN_EFFECT_PRESETS": BUILTIN_EFFECT_PRESETS,
        }),
    }
    Path(out).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def boot(data_dir: Path, *, seed: bool) -> None:
    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as _db_session
    from justvoice.feature_catalog import FEATURE_CATALOG, PREFER_LOCAL_FEATURES
    from justvoice.seed_feature_prompts import DEFAULT_FEATURE_PROMPTS
    from justvoice.seed_presets import (
        DEFAULT_ENGINE_PRESETS,
        DEFAULT_FEATURE_PRESETS,
        DEFAULT_PRESET_ID,
        DEFAULT_TEST_SAMPLES,
        JV_CLASS_TUNE_IDENTITY,
        JV_CLASS_TUNES,
        JV_MODEL_CATALOG,
    )
    from justvoice.version import PRODUCT
    from llm_runner.llm import install_llm

    init_db(data_dir)
    set_state(AppState(data_dir))
    install_llm(
        None,
        engine=_db_session.engine,
        session_factory=_db_session.SessionLocal,
        feature_catalog=FEATURE_CATALOG,
        feature_prompts=DEFAULT_FEATURE_PROMPTS,
        engine_presets=DEFAULT_ENGINE_PRESETS,
        feature_presets=DEFAULT_FEATURE_PRESETS,
        default_preset_id=DEFAULT_PRESET_ID,
        test_samples=DEFAULT_TEST_SAMPLES,
        model_catalog_extra=JV_MODEL_CATALOG,
        class_tunes_seed=JV_CLASS_TUNES,
        class_tune_identity=JV_CLASS_TUNE_IDENTITY,
        prefer_local_features=PREFER_LOCAL_FEATURES,
        data_dir=data_dir,
        product=PRODUCT,
    )
    if seed:
        from justvoice.database.seed import seed_workspace

        seed_workspace()


def cmd_ops(data_dir: str, ops_path: str, out: str) -> None:
    from justvoice.app_state import get_state
    from justvoice.models import LexiconEntry, SettingsPatch, VoiceRecord

    d = Path(data_dir)
    boot(d, seed=False)
    st = get_state()
    results = []
    for op, *a in json.loads(Path(ops_path).read_text(encoding="utf-8")):
        try:
            if op == "persona.create":
                r = st.personas.create(a[0], **a[1])
            elif op == "persona.update":
                r = st.personas.update(a[0], **a[1])
            elif op == "persona.get":
                r = st.personas.get(a[0])
            elif op == "persona.list":
                r = st.personas.list()
            elif op == "persona.delete":
                r = st.personas.delete(a[0])
            elif op == "lexicon.create":
                kw = dict(a[1])
                if "entries" in kw:
                    kw["entries"] = [LexiconEntry(**e) for e in kw["entries"]]
                r = st.lexicons.create(a[0], **kw)
            elif op == "lexicon.update":
                r = st.lexicons.update(a[0], [LexiconEntry(**e) for e in a[1]], a[2])
            elif op == "lexicon.append":
                r = st.lexicons.append_entry(a[0], LexiconEntry(**a[1]))
            elif op == "lexicon.get":
                r = st.lexicons.get(a[0])
            elif op == "lexicon.list":
                r = st.lexicons.list()
            elif op == "lexicon.delete":
                r = st.lexicons.delete(a[0])
            elif op == "settings.patch":
                new, restart = st.settings.patch(SettingsPatch.model_validate(a[0]))
                r = [new, restart]
            elif op == "settings.get":
                r = st.settings.get()
            elif op == "voice.create":
                r = st.voices.create(VoiceRecord.model_validate(a[0]))
            elif op == "voice.update":
                r = st.voices.update(a[0], **a[1])
            elif op == "voice.add_sample":
                r = st.voices.add_sample(a[0], b"RIFF")
            elif op == "voice.list":
                r = st.voices.list()
            else:
                raise SystemExit(f"unknown op {op}")
            results.append({"ok": wire(r)})
        except Exception as e:  # noqa: BLE001 — the error is part of the answer
            results.append({"error": type(e).__name__})
    Path(out).write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")


def cmd_real(data_dir: str, out: str) -> None:
    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db

    d = Path(data_dir)
    init_db(d)
    st = AppState(d)
    set_state(st)
    read = {
        "personas": wire(st.personas.list()),
        "persona_get": {p.id: wire(st.personas.get(p.id)) for p in st.personas.list()},
        "lexicons": wire(st.lexicons.list()),
        "lexicon_get": {x.id: wire(st.lexicons.get(x.id)) for x in st.lexicons.list()},
        "settings": wire(st.settings.get()),
        "voices": wire(st.voices.list()),
    }
    # Rewrite every row unchanged — the stored text must come out byte for byte the same.
    st.settings.set(st.settings.get())
    written = {"personas": [], "lexicons": []}
    for p in st.personas.list():
        written["personas"].append(wire(st.personas.update(p.id, name=p.name)))
    for x in st.lexicons.list():
        written["lexicons"].append(wire(st.lexicons.update(x.id, x.entries, None)))
    for v in st.voices.list():
        st.voices.update(v.id, name=v.name)
    Path(out).write_text(json.dumps({"read": read, "written": written}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "texts":
        cmd_texts(*args)
    elif cmd == "boot":
        boot(Path(args[0]), seed=True)
    elif cmd == "reboot":
        boot(Path(args[0]), seed=True)
    elif cmd == "ops":
        cmd_ops(*args)
    elif cmd == "real":
        cmd_real(*args)
    else:
        raise SystemExit(f"unknown command {cmd}")
