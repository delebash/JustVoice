# SPDX-License-Identifier: MIT
"""The Python half of the extraction parity check (wave D of step 5, check b).

    python compare-extraction.py plan <data_dir> <plan.json>
    python compare-extraction.py run  <data_dir> <plan.json> <fake_llm_base> <out.json>

`plan` reads a COPY of the dev database with the Analyze and Discover routes' own helpers
(extraction_api `_resolve_cast`, `_resolve_corrections`, `_analysis_input`,
`_neighbour_texts`, `_set_by_you`, the project's Speech marks) and writes, per chapter, exactly
what those routes hand the pipeline — so both languages run on the same inputs.

`run` boots the server's LLM half headless (init_db + AppState + install_llm with JustVoice's
arguments, as compare-seed.py), points the bundled runner's base URL at a FAKE llama-server
(compare-extraction.mjs serves it: /v1/models, /apply-template, /tokenize,
/v1/chat/completions — no model, nothing started) with the model-load hook off, then runs, per
chapter: Analyze (the kept lines' segments, the second look on), Analyze streamed (the text cut
afresh, the guided route), and Discover. Every request reaches the fake server, which records
it; the answers are derived from the request, so equal requests get equal answers.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def boot(data_dir: Path) -> None:
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
    # The serve boot's workspace seed — it also loads the stored providers into the registry.
    from justvoice.database.seed import seed_workspace

    seed_workspace()


def plan(data_dir: str, out_path: str) -> None:
    from justvoice.api import extraction_api as ea
    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as db_session
    from justvoice.database.models import Block, Scene
    from justvoice.extraction.segmentation import resolve_marks

    d = Path(data_dir)
    init_db(d)
    set_state(AppState(d))
    db = db_session.SessionLocal()
    chapters = []
    try:
        for scene in db.query(Scene).order_by(Scene.project_id, Scene.position).all():
            blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
            # The renderer's proseFromBlocks: the lines with text, trimmed, a paragraph each.
            body_text = "\n\n".join(b.text.strip() for b in blocks if (b.text or "").strip())
            text, marks, line_ids, segments = ea._analysis_input(db, scene, body_text)
            before, after = ea._neighbour_texts(db, scene)
            chapters.append({
                "title": scene.title,
                "body_text": body_text,
                "text": text,
                "marks": marks,
                "segments": segments,
                "characters": ea._resolve_cast(scene.id, db),
                "corrections": ea._resolve_corrections(scene.project_id, db),
                "before_text": before,
                "after_text": after,
                "second_look_skip": ea._set_by_you(db, line_ids),
                "discover_marks": resolve_marks(ea._project_meta(db, scene.project_id).get("speech_marks"), body_text),
                # The chapter as an edited one is re-read (each side cuts its own segments).
                "lines": [{"text": b.text, "source": b.source,
                           "paragraph": ea._json_meta(b.metadata_json).get("paragraph_idx")}
                          for b in blocks if (b.text or "").strip()],
            })
    finally:
        db.close()
    Path(out_path).write_text(json.dumps({"chapters": chapters}, ensure_ascii=False), encoding="utf-8")


def _rows(rows) -> list:
    return [dict(r.__dict__) for r in rows]


def _clean(raw: dict) -> dict:
    """The run's report with its clock readings blanked (they differ run to run)."""
    out = json.loads(json.dumps(raw))
    if isinstance(out.get("usage"), dict) and "duration_ms" in out["usage"]:
        out["usage"]["duration_ms"] = "<ms>"
    if isinstance(out.get("second_look"), dict) and "seconds" in out["second_look"]:
        out["second_look"]["seconds"] = "<s>"
    return out


def _attempt(fn):
    try:
        return {"ok": fn()}
    except Exception as e:  # noqa: BLE001 — a failure is a result to compare too
        return {"error": f"{type(e).__name__}: {e}"}


def run(data_dir: str, plan_path: str, base: str, out_path: str) -> None:
    import logging

    logging.disable(logging.CRITICAL)
    boot(Path(data_dir))
    from llm_runner.llm.dispatch import set_ensure_local_model, set_local_runner_base_url

    set_ensure_local_model(None)
    set_local_runner_base_url(lambda: base)

    from justvoice.app_state import get_state
    from justvoice.extraction.identify import identify_speakers
    from justvoice.extraction.pipeline import AnalyzeRequest, analyze_scene

    settings = get_state().settings.get()
    spec = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    out = []
    for ch in spec["chapters"]:
        rec: dict = {"title": ch["title"]}

        def analyze():
            raw: dict = {}
            req = AnalyzeRequest(
                text=ch["text"], characters=ch["characters"], corrections=ch["corrections"],
                before_text=ch["before_text"], after_text=ch["after_text"], second_look=True,
                second_look_skip=ch["second_look_skip"],
            )
            rows = analyze_scene(settings=settings, request=req, raw_out=raw, marks=ch["marks"],
                                 segments=ch["segments"])
            return {"rows": _rows(rows), "raw": _clean(raw)}

        def analyze_streamed():
            raw: dict = {}
            seen = {"deltas": [], "progress": [], "thinking": [], "steps": []}
            req = AnalyzeRequest(
                text=ch["body_text"], characters=ch["characters"], corrections=ch["corrections"],
                route="guided", before_text=ch["before_text"], after_text=ch["after_text"],
                second_look=True,
            )
            rows = analyze_scene(
                settings=settings, request=req, raw_out=raw, marks=ch["marks"],
                on_delta=seen["deltas"].append, on_progress=seen["progress"].append,
                on_thinking=seen["thinking"].append,
                on_step=lambda done, total, _rows: seen["steps"].append([done, total]),
            )
            return {"rows": _rows(rows), "raw": _clean(raw), **seen}

        def discover():
            raw: dict = {}
            got = identify_speakers(ch["body_text"], ch["characters"], settings=settings, raw_out=raw,
                                    marks=ch["discover_marks"])
            return {"candidates": [dict(c.__dict__) for c in got], "raw": _clean(raw)}

        def analyze_edited():
            from justvoice.extraction.flags import spoken_block
            from justvoice.extraction.segmentation import paragraphs_of, segments_from_lines

            segs = segments_from_lines([{"text": ln["text"], "spoken": spoken_block(ln["source"], ln["text"]),
                                         "paragraph": ln["paragraph"]} for ln in ch["lines"]])
            raw: dict = {}
            req = AnalyzeRequest(text="\n\n".join(paragraphs_of(segs)), characters=ch["characters"],
                                 corrections=ch["corrections"], route="direct", second_look=False)
            rows = analyze_scene(settings=settings, request=req, raw_out=raw, marks=ch["marks"], segments=segs)
            return {"segments": segs, "rows": _rows(rows), "raw": _clean(raw)}

        rec["analyze"] = _attempt(analyze)
        rec["analyze_edited"] = _attempt(analyze_edited)
        rec["analyze_streamed"] = _attempt(analyze_streamed)
        rec["discover"] = _attempt(discover)
        out.append(rec)
    Path(out_path).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "plan":
        plan(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "run":
        run(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        raise SystemExit(f"unknown command {sys.argv[1]!r}")
