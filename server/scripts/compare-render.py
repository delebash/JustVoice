# SPDX-License-Identifier: MIT
"""The Python half of compare-render.mjs / compare-render-real.mjs — the render layer's parity
check (wave C of step 5).

    python compare-render.py augment <data_dir>
    python compare-render.py dump <data_dir> <out.json>
    python compare-render.py prep <data_dir>
    python compare-render.py real <data_dir> <out_dir> <ids.json>

`augment` adds, through Python's own stores, what the real data lacks (it is ten Kokoro
personas with no delivery): stored voices of every source, personas with deliveries, per-model
settings, effects and lexicons, and a second book whose lines carry their own numbers, per-model
settings, direction, tags, a marker, a dialogue tag and a long line. `dump` writes every answer
the render layer derives without synthesizing (the render-cache key and its inputs, per line)
and every read answer (voice_model, persona_render, line_takes, render_jobs). `prep` adds two
small books from the real lines and gives the Kokoro personas seeds; `real` renders and exports
them for real (a render job, the voice-line export, a chapter, an M4B, every mastering preset).
Each runs on a COPY of a data root.
"""

from __future__ import annotations

import json
import math
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def boot(data_dir: str):
    from llm_runner.llm import db as llm_db

    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.database import session as db_session

    d = Path(data_dir)
    init_db(d)
    llm_db.configure_storage(db_session.SessionLocal)
    st = AppState(d)
    set_state(st)
    return st


def jtext(v) -> str:
    """The exact text of a value — floats as Python prints them, keys sorted."""
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def wav(seconds: float = 0.5, sr: int = 24000) -> bytes:
    pcm = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 220 * i / sr))) for i in range(int(sr * seconds)))
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
            + b"data" + struct.pack("<I", len(pcm)) + pcm)


# ── augment ───────────────────────────────────────────────────────────────


def augment(data_dir: str) -> None:
    from justvoice.database import session as db_session
    from justvoice.database.models import Block, Project, Scene, Speaker
    from justvoice.models import LexiconEntry, VoiceRecord

    st = boot(data_dir)
    now = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)

    def voice(**kw):
        base = dict(id="", language="en-US", created_at=now, updated_at=now)
        base.update(kw)
        return st.voices.create(VoiceRecord(**base))

    turbo = voice(engine="chatterbox", model="chatterbox-turbo", source="cloned", name="Turbo Clone", transcript="The tide turned.")
    st.voices.write_ref_wav(turbo.id, wav())
    multi = voice(engine="chatterbox", model="chatterbox-multilingual", source="cloned", name="Multi Clone")
    st.voices.write_ref_wav(multi.id, wav())
    designed = voice(engine="qwen3", source="designed", name="Harbourmaster", design_prompt="A gravel-voiced harbour-master, unhurried.")
    frozen = voice(engine="qwen3", source="designed", name="Frozen", design_prompt="A bright young voice.", transcript="Mind the rope.", model="qwen3-vd")
    st.voices.write_ref_wav(frozen.id, wav())
    base_clone = voice(engine="qwen3", model="qwen3-base", source="cloned", name="Base Clone", xvector_only=True)
    st.voices.write_ref_wav(base_clone.id, wav())
    blend = voice(engine="kokoro", source="blended", name="Mix", embedding=[0.1, 0.25, -1.0, 2.0])
    pocket_clone = voice(engine="pocket", source="cloned", name="Pocket Clone", language="de")
    st.voices.write_ref_wav(pocket_clone.id, wav())

    db = db_session.SessionLocal()
    try:
        project = Project(name="Parity Book", project_type="audiobook",
                          metadata_json=json.dumps({"leave_out_tags": True, "language": "en-US"}))
        db.add(project)
        db.flush()
        pid = project.id
        db.commit()
    finally:
        db.close()

    book_lex = st.lexicons.create("Facet names", scope="project", project_id=pid, entries=[
        LexiconEntry(grapheme="Odeline", alias="Oh-deh-leen"),
        LexiconEntry(grapheme="Cael", phoneme_ipa="kˈeɪl"),
        LexiconEntry(grapheme="Nettle", phoneme_ipa="nˈɛtəl", alias="Nettel"),
        LexiconEntry(grapheme="Sedge", alias=""),
        LexiconEntry(grapheme="Halvorn", phoneme_ipa="hˈælvɔːn"),
        LexiconEntry(grapheme="keystone", alias="key-stone"),
    ])
    persona_lex = st.lexicons.create("Iven's words", entries=[
        LexiconEntry(grapheme="Iven", alias="Eye-ven"),
        LexiconEntry(grapheme="Cael", alias="Kale"),
        LexiconEntry(grapheme="Marran", phoneme_ipa="mˈæɹən"),
    ])

    P = st.personas.create
    personas = [
        P("Q Narrator", "Sohee", {"speed": 1.1, "pitch": 2.0, "gain_db": -1.0, "pause_after": 300, "models": {
            "qwen3-cv": {"knobs": {"talker_temperature": 0.7, "talker_top_k": 50}, "emotion": "angry", "seed": 42}}},
          voice_instruct="Clipped, world-weary.", language="en",
          effects_chain=[{"type": "gain", "params": {"gain_db": 6.0}}]),
        P("Turbo", turbo.id, {"speed": 1.0, "models": {"chatterbox-turbo": {
            "knobs": {"top_k": 500, "temperature": 0.8}, "emotion": "fear", "register_tag": "dramatic"}}},
          effects_chain=[{"type": "pitch_shift", "params": {"semitones": 2.0}},
                         {"type": "eq_low", "params": {"cutoff_frequency_hz": 200.0, "gain_db": 3.0, "q": 1.0}}]),
        P("Designed", designed.id, {"speed": 2.0, "models": {"qwen3-vd": {"emotion": "happy"}}}, voice_instruct="Slow."),
        P("Frozen", frozen.id, {"pitch": -12.0, "gain_db": 12.0}),
        P("Kokoro Speed", "af_heart", {"speed": 1.25, "pitch": -3.5, "gain_db": 3.0, "pause_before": 200, "models": {
            "kokoro": {"seed": 7}}}, lexicon_id=persona_lex.id),
        P("Kitten", "kitten_bella", {"speed": 0.75, "gain_db": 0.0}),
        P("Pocket", "pocket_alba", {"models": {"pocket": {"knobs": {"temperature": 0.5}}}}, language="de"),
        P("Multi", multi.id, {"models": {"chatterbox-multilingual": {"knobs": {"exaggeration": 1.0, "cfg_weight": 0.5},
                                                                     "emotion": "sad"}}}, language="fr"),
        P("Blend", blend.id, {"pause_after": 0}),
        P("Base", base_clone.id, {"speed": 0.5, "models": {"qwen3-base": {"knobs": {"talker_temperature": 1.0}}}}),
        P("Pocket Clone", pocket_clone.id, {}, language="de-DE"),
        P("Ghost", "no-such-voice", {"speed": 1.5}),
        P("Japanese", "jf_alpha", {"gain_db": -2.5}, language="ja"),
    ]

    # The book: The Keystone's lines (the real book's longest-text chapter), over two chapters.
    db = db_session.SessionLocal()
    try:
        keystone = db.query(Scene).filter(Scene.title == "The Keystone").first()
        src = db.query(Block).filter(Block.scene_id == keystone.id).order_by(Block.position).all()
        speakers = []
        for i, p in enumerate(personas):
            s = Speaker(project_id=pid, name=f"Speaker {p.name}", persona_id=p.id)
            db.add(s)
            speakers.append(s)
        nobody = Speaker(project_id=pid, name="Uncast")
        db.add(nobody)
        db.flush()
        long_text = " ".join(b.text for b in src[:6])
        for chap in range(2):
            sc = Scene(project_id=pid, position=chap, title=f"Parity {chap + 1}")
            db.add(sc)
            db.flush()
            part = src[chap * 25:(chap + 1) * 25]
            pos = 0
            for i, b in enumerate(part):
                meta = json.loads(b.metadata_json or "{}")
                text = b.text
                if i % 3 == 0:
                    text = "[laugh] " + text
                if i % 5 == 0:
                    text = text + " [warm]"
                if i % 7 == 0:
                    text = "[sigh] " + text + " [clear throat]"
                if i == 2:
                    meta["speed"] = 1.0
                if i == 4:
                    meta.update({"speed": 1.25, "pitch": -2})
                if i == 6:
                    meta["gain_db"] = 3
                if i == 8:
                    meta["pause_after_ms"] = 900
                if i == 10:
                    meta["line_models"] = {"qwen3-cv": {"knobs": {"talker_temperature": 0.4}, "emotion": "sad"}}
                if i == 12:
                    meta["line_models"] = {"chatterbox-turbo": {"emotion": "", "register_tag": "narration"}}
                if i == 14:
                    meta["line_models"] = {"chatterbox-multilingual": {"knobs": {"exaggeration": 2}}, "kokoro": {"emotion": "sad"}}
                speaker = speakers[(i + chap * 3) % len(speakers)]
                db.add(Block(scene_id=sc.id, position=pos, text=text, speaker_id=speaker.id,
                             direction=("edge of irritation" if i % 4 == 1 else None),
                             source=b.source, metadata_json=json.dumps(meta)))
                pos += 1
            # A long line (split on every model), a marker, a dialogue tag between two spoken lines
            # of one paragraph (left out), a line nobody says and a line whose speaker has no persona.
            db.add(Block(scene_id=sc.id, position=pos, text=long_text, speaker_id=speakers[4 + chap].id,
                         metadata_json=json.dumps({"source_ref": f"long#{chap}"})))
            db.add(Block(scene_id=sc.id, position=pos + 1, text="[music: sting]", metadata_json=json.dumps({"marker": True})))
            db.add(Block(scene_id=sc.id, position=pos + 2, text="“Run,”", speaker_id=speakers[0].id, source="tag",
                         metadata_json=json.dumps({"paragraph_idx": 900 + chap})))
            db.add(Block(scene_id=sc.id, position=pos + 3, text="said Cael.", speaker_id=speakers[2].id, source="narration",
                         metadata_json=json.dumps({"paragraph_idx": 900 + chap})))
            db.add(Block(scene_id=sc.id, position=pos + 4, text="“or they’ll find us.”", speaker_id=speakers[0].id, source="tag",
                         metadata_json=json.dumps({"paragraph_idx": 900 + chap})))
            db.add(Block(scene_id=sc.id, position=pos + 5, text="Nobody says this."))
            db.add(Block(scene_id=sc.id, position=pos + 6, text="Uncast speaks.", speaker_id=nobody.id))
        project = db.query(Project).filter(Project.id == pid).first()
        project.default_lexicon_id = book_lex.id
        db.commit()
    finally:
        db.close()
    print(json.dumps({"project": pid, "personas": len(personas)}))


# ── dump ──────────────────────────────────────────────────────────────────


def plan_out(plan) -> dict:
    return {"voice": plan.voice, "model": plan.model, "text": plan.text, "language": plan.language,
            "delivery": jtext(plan.delivery), "seed": plan.seed, "effects": jtext(plan.effects),
            "lexicons": plan.lexicons}


def attempt(fn):
    try:
        return {"ok": fn()}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {getattr(e, 'detail', None) or e}"}


def dump(data_dir: str, out: str) -> None:
    from justvoice import line_takes, persona_render, render_core, render_jobs, voice_model as vm
    from justvoice.api import render_chapter_api as rca
    from justvoice.api._speaker_helpers import persona_for_block
    from justvoice.audio.chunked import split_text_into_chunks
    from justvoice.audio.effects import effects_chain_hash
    from justvoice.database import session as db_session
    from justvoice.database.models import Block, Project, RenderJob, Scene
    from justvoice.delivery import canonical_json
    from justvoice.engines.capability_details import CAPABILITY_DETAILS
    from justvoice.engines.manager import get_manager

    st = boot(data_dir)
    t0 = time.monotonic()
    mgr = get_manager()
    out_d: dict = {}

    # ── models ──
    families = sorted({row.engine_id for row in CAPABILITY_DETAILS.values()})
    models: dict = {}
    for m in families:
        models[m] = {
            "name": vm.model_name(m), "directed_by": vm.directed_by(m),
            "can": {a: vm.can(m, a) for a in ("clone", "design", "blend")},
            "engine_of": vm.engine_of_model(m), "emotions": persona_render.emotion_choices(m),
            "registers": persona_render.register_choices(m), "knobs": list(persona_render.knob_specs(m)),
            "phoneme": render_core._supports_phoneme_input(m), "emotion_tagset": render_core._emotion_tagset(m) is not None,
            "model_of_variant": vm.model_of_variant(m),
        }
    engines: dict = {}
    for e in sorted(mgr.manifests()):
        fams = vm.models_of_engine(e)
        rec = {"families": fams, "preset_model": vm.model_for_preset(e),
               "default": {str(n): vm._default_model(e, need=n) for n in (None, "clone", "design", "blend")},
               "native": render_core.speed_native(st, e), "takes_tags": render_core._engine_takes_tags(st, e),
               "per_model": {}}
        for m in fams + ["kokoro", "nonsense"]:
            rec["per_model"][m] = {
                "name": vm.model_name(m, e), "speaks": list(vm.model_speaks(e, m)),
                "check": {a: attempt(lambda a=a: vm.check_model_for(e, m, a)) for a in ("clone", "design", "blend")},
                "variants": {str(lang): attempt(lambda lang=lang: vm.variant_for_model(e, m, lang))
                             for lang in (None, "en", "de-DE", "ja", "fr")},
                "loaded": vm.is_model_loaded(e, m), "native": render_core.speed_native(st, e, m),
                "split": render_core.line_split_chars(st, e, None),
            }
        rec["check_none"] = {a: attempt(lambda a=a: vm.check_model_for(e, None, a)) for a in ("clone", "design", "blend")}
        engines[e] = rec
    out_d["models"] = models
    out_d["engines"] = engines

    # ── voices ──
    ids = [v["id"] for m in mgr.manifests().values() for v in m.static_voices]
    ids += [v.id for v in st.voices.list()] + ["no-such-voice", ""]
    voices: dict = {}
    for vid in ids:
        v = vm.voice_model(st, vid)
        stored = st.voices.get(vid)
        fields = render_core.voice_synth_fields(st, stored)
        if "audio_prompt_path" in fields:
            fields["audio_prompt_path"] = Path(fields["audio_prompt_path"]).relative_to(Path(data_dir).resolve()).as_posix()
        voices[vid] = {
            "vm": None if v is None else {"engine_id": v.engine_id, "model": v.model, "name": v.name,
                                          "directed_by": v.directed_by, "speaks": list(v.speaks)},
            "language": vm.voice_language(st, vid), "key": vm.model_key(st, vid),
            "versions": attempt(lambda vid=vid: vm.versions_of(st, vid)),
            "versions_de": attempt(lambda vid=vid: vm.versions_of(st, vid, "de-DE")),
            "design": render_core.voice_design_instruct_for_id(st, vid),
            "is_desc": render_core.is_description_voice(st, vid),
            "desc_seed": render_core.description_seed(vid), "synth_fields": fields,
            "engine": render_core._resolve_engine_for_voice(st, vid),
            "split": attempt(lambda vid=vid: render_core.line_split_chars(st, render_core._resolve_engine_for_voice(st, vid) or "x", vid)),
            "stored_model": vm.model_for_stored(st, stored) if stored is not None else None,
        }
    out_d["voices"] = voices

    # ── personas ──
    personas: dict = {}
    for p in st.personas.list():
        settings = {}
        for m in families + [None]:
            d, tags, seed = persona_render.model_settings(p, m)
            settings[str(m)] = [jtext(d), tags, seed]
        v = vm.voice_model(st, p.voice_id) if p.voice_id else None
        personas[p.id] = {
            "stock": plan_out(persona_render.plan_line(st, p, text=persona_render.stock_line(p.language))),
            "directed": plan_out(persona_render.plan_line(
                st, p, text="Hello there, Cael.", direction="quietly", book_lexicon="lex-x",
                request_delivery={"speed": 1.25, "seed": 5, "engine": {"top_k": 3}},
                line_models={(v.model if v else "x"): {"emotion": "", "knobs": {"temperature": 0.25}}})),
            "check": persona_render.check_delivery(p.default_delivery),
            "settings": settings,
            "language": persona_render.persona_language(p, v, vm.voice_language(st, p.voice_id)),
        }
    out_d["personas"] = personas
    out_d["stock_lines"] = {lang: persona_render.stock_line(lang) for lang in ("en", "ja", "de-DE", "xx", None, "zh-CN")}

    # ── chapters: every line of every chapter, as the render derives it ──
    db = db_session.SessionLocal()
    try:
        projects = db.query(Project).order_by(Project.created_at).all()
        project_ids = [p.id for p in projects]
        scene_rows = db.query(Scene).order_by(Scene.project_id, Scene.position).all()
        scenes_meta = [(s.id, s.project_id) for s in scene_rows]
        blocks = db.query(Block).order_by(Block.scene_id, Block.position).all()
        block_rows = []
        for b in blocks:
            persona = persona_for_block(db, b)
            block_rows.append((b, persona.id if persona else None))
        job_ids = [j.id for j in db.query(RenderJob).order_by(RenderJob.created_at).all()]
        book_lex = {p.id: p.default_lexicon_id for p in projects}
        scene_project = dict(scenes_meta)
        db.expunge_all()
    finally:
        db.close()

    lines_out: dict = {}
    n_lines = 0
    for sid, _pid in scenes_meta:
        try:
            lines = rca._resolve_scene_to_lines(sid, st, strict=False)
        except Exception as e:  # noqa: BLE001
            lines_out[sid] = {"error": f"{type(e).__name__}: {getattr(e, 'detail', None) or e}"}
            continue
        recs = []
        for line in lines:
            n_lines += 1
            kw = rca._line_kwargs(line, f"scene:{sid}")
            engine = render_core._resolve_engine_for_voice(st, line.voice)
            rec = {"chapter_line": line.model_dump(), "delivery_text": jtext(kw["delivery"]),
                   "kwargs": {k: v for k, v in kw.items() if k != "delivery"}, "engine": engine}
            if engine is not None and render_core._engine_takes_tags(st, engine) is not None:
                model = render_core._line_model(st, line.voice, engine)
                text, prepared = render_core.prepare_line_text(st, engine, model, line.text, dict(kw["delivery"] or {}), list(kw["lexicons"] or []))
                seed = kw["seed"]
                if seed is None and render_core.is_description_voice(st, line.voice):
                    seed = render_core.description_seed(line.voice)
                native = render_core.speed_native(st, engine, model)
                split = render_core.line_split_chars(st, engine, line.voice)
                rec.update({
                    "model": model, "effective_text": text, "prepared": jtext(prepared), "seed": seed, "native": native,
                    "phoneme": render_core._supports_phoneme_input(model), "split": split,
                    "chunks": split_text_into_chunks(text, max_chars=split) if len(text) > split else [text],
                    "shape": render_core.line_shape(prepared, speed_native=native),
                    "fx_hash": effects_chain_hash(kw["effects"] or []),
                    "key_delivery": canonical_json(render_core._key_delivery(prepared, native)),
                })
            rec["key"] = render_core.line_inputs_key(st, line.voice, line.text, language=kw["language"], delivery=kw["delivery"],
                                                     seed=kw["seed"], lexicons=kw["lexicons"], effects=kw["effects"])
            rec["probe"] = render_core.probe_line_cached(st, line.voice, line.text, language=kw["language"], delivery=kw["delivery"] or {},
                                                         seed=kw["seed"], lexicons=kw["lexicons"], effects=kw["effects"], cache_scope=f"scene:{sid}")
            recs.append(rec)
        lines_out[sid] = {"lines": recs, "played_texts": rca.played_texts(lines)}
    out_d["chapters"] = lines_out
    out_d["line_count"] = n_lines

    # ── every block: its own numbers and the take path's plan and key ──
    blocks_out: dict = {}
    for b, persona_id in block_rows:
        rec = {"override": jtext(line_takes.line_override(b)), "line_models": jtext(line_takes.line_models(b)),
               "override_delivery": jtext(line_takes.override_delivery(b)), "marker": line_takes.is_marker(b),
               "meta": jtext(line_takes.block_meta(b))}
        p = st.personas.get(persona_id) if persona_id else None
        if p is not None and p.voice_id:
            r = attempt(lambda b=b, p=p: plan_out(line_takes.plan_block(st, p, b, book_lexicon=book_lex[scene_project[b.scene_id]])))
            rec["plan"] = r
            if "ok" in r:
                rec["plan_key"] = attempt(lambda b=b, p=p: line_takes.plan_key(
                    st, line_takes.plan_block(st, p, b, book_lexicon=book_lex[scene_project[b.scene_id]])))
                rec["plan_key_seed"] = attempt(lambda b=b, p=p: line_takes.plan_key(
                    st, line_takes.plan_block(st, p, b, book_lexicon=book_lex[scene_project[b.scene_id]], seed=123456)))
        blocks_out[b.id] = rec
    out_d["blocks"] = blocks_out

    # ── read answers: Render's line pages, the projects' states, the jobs ──
    db = db_session.SessionLocal()
    try:
        out_d["scene_lines"] = {sid: attempt(lambda sid=sid: line_takes.scene_lines(db, st, sid)) for sid, _ in scenes_meta}
        out_d["render_state"] = {pid: line_takes.project_render_state(db, st, pid) for pid in project_ids}
        heard = {}
        for sid, pid in scenes_meta:
            scene = db.query(Scene).filter(Scene.id == sid).first()
            project = db.query(Project).filter(Project.id == pid).first()
            hb = line_takes.heard_blocks(db, scene, project)
            ids_ = [b.id for _n, b in hb]
            heard[sid] = {
                "heard": [[n, b.id] for n, b in hb],
                "joins": sorted(line_takes.paragraph_joins([b for _n, b in hb])),
                "ends": sorted(line_takes.scene_ends([b for _n, b in hb])),
                "live": {bid: [t.id, g.id] for bid, (t, g) in line_takes.live_takes(db, ids_).items()},
                "played": {bid: g.id for bid, g in line_takes.played_takes(db, ids_).items()},
            }
        out_d["heard"] = heard
    finally:
        db.close()
    out_d["jobs"] = {jid: render_jobs.job_status(jid, include_blocks=True) for jid in job_ids}

    merges = []
    for meta, patch in [
        ({}, {"speed": 1, "pitch": "-2.5", "pause_after_ms": 900.7}),
        ({"speed": 1.5, "x": 1.0}, {"speed": None, "gain_db": 12}),
        ({}, {"models": {"chatterbox": {"knobs": {"exaggeration": 1}, "emotion": " sad "}}}),
        ({"line_models": {"chatterbox": {"knobs": {"a": 1.0, "b": 2.0}}}}, {"models": {"chatterbox": {"knobs": {"a": None}}}}),
        ({}, {"speed": 5}), ({}, {"volume": 2}), ({}, {"pause_after_ms": "x"}), ({}, {"models": "x"}),
        ({}, {"models": {"k": {"emotion": "x" * 61}}}), ({}, {"models": {"k": {"nope": 1}}}),
    ]:
        merges.append(attempt(lambda meta=meta, patch=patch: jtext(line_takes.merge_override(meta, patch))))
    out_d["merges"] = merges
    out_d["seconds"] = round(time.monotonic() - t0, 1)
    Path(out).write_text(json.dumps(out_d, ensure_ascii=False, indent=1), encoding="utf-8")


# ── the real render (compare-render-real.mjs) ─────────────────────────────


def prep(data_dir: str) -> None:
    """Two small books from The Keystone's lines, spoken by the real Kokoro personas, each persona
    given a Kokoro seed (Kokoro's decoder draws noise: a random seed is a different take)."""
    from justvoice.database import session as db_session
    from justvoice.database.models import Block, Project, Scene, Speaker

    st = boot(data_dir)
    for i, p in enumerate(st.personas.list()):
        st.personas.update(p.id, default_delivery={"models": {"kokoro": {"seed": 1000 + i}}})
    db = db_session.SessionLocal()
    try:
        keystone = db.query(Scene).filter(Scene.title == "The Keystone").first()
        src = {b.position: b for b in db.query(Block).filter(Block.scene_id == keystone.id)}
        speakers = {s.id: s for s in db.query(Speaker).filter(Speaker.project_id == keystone.project_id)}

        def book(name, kind, chapters, mastering=None):
            project = Project(name=name, project_type=kind, mastering_preset=mastering)
            db.add(project)
            db.flush()
            mine = {}
            out = {"project": project.id, "scenes": [], "blocks": []}
            for ci, positions in enumerate(chapters):
                sc = Scene(project_id=project.id, position=ci, title=f"{name} {ci + 1}")
                db.add(sc)
                db.flush()
                out["scenes"].append(sc.id)
                for pos, src_pos in enumerate(positions):
                    b = src[src_pos]
                    sp = speakers[b.speaker_id]
                    if sp.id not in mine:
                        mine[sp.id] = Speaker(project_id=project.id, name=sp.name, persona_id=sp.persona_id)
                        db.add(mine[sp.id])
                        db.flush()
                    nb = Block(scene_id=sc.id, position=pos, text=b.text, speaker_id=mine[sp.id].id,
                               metadata_json=json.dumps({"source_ref": f"KEY_{src_pos:03d}"}))
                    db.add(nb)
                    db.flush()
                    out["blocks"].append(nb.id)
            return out

        game = book("Parity Game", "game_voicelines", [[0, 1, 3]])
        audio = book("Parity Audio", "audiobook", [[1, 2], [5, 7]], mastering="acx")
        db.commit()
    finally:
        db.close()
    print(json.dumps({"game": game, "audio": audio}))


def real(data_dir: str, out_dir: str, ids_json: str) -> None:
    """The game book's three lines through a render job, its voice-line export, the audio book's
    first chapter through render_scene_to_wav, the whole audio book as an M4B, and one take
    through every mastering preset — the ffmpeg argv of each recorded."""
    from unittest import mock

    from justvoice import mastering, render_jobs
    from justvoice.api.render_chapter_api import render_scene_to_wav
    from justvoice.audio.wav import parse_wav_header
    from justvoice.database import session as db_session
    from justvoice.database.models import Generation, RenderJobBlock, Take
    from justvoice.engines.manager import shutdown_manager
    from justvoice.export_audiobook import assemble_project, mux_m4b
    from justvoice.export_voicelines import export_voicelines
    from justvoice.media_paths import media_file
    from llm_runner.platform import procs

    ids = json.loads(Path(ids_json).read_text(encoding="utf-8"))
    st = boot(data_dir)
    out = Path(out_dir)
    (out / "gen").mkdir(parents=True, exist_ok=True)
    (out / "master").mkdir(exist_ok=True)
    argvs: dict = {"_now": []}
    real_run = procs.run

    def spy(cmd, **kw):
        if Path(str(cmd[0])).stem.lower() == "ffmpeg":  # the kit's own probes go through procs.run too
            argvs["_now"].append(list(cmd))
        if "-safe" in cmd:
            tdir = Path(cmd[cmd.index("-i") + 1]).parent
            argvs["concat"] = (tdir / "concat.txt").read_text(encoding="utf-8")
            argvs["chapters"] = (tdir / "chapters.txt").read_text(encoding="utf-8")
        return real_run(cmd, **kw)

    def take(name):
        argvs[name] = argvs["_now"]
        argvs["_now"] = []

    times = {}
    try:
        with mock.patch.object(procs, "run", spy):
            t0 = time.monotonic()
            game = ids["game"]
            job = render_jobs.create_job(game["project"], "blocks", game["blocks"])
            render_jobs.start_job(job.id)
            while True:
                s = render_jobs.job_status(job.id, include_blocks=True)
                if s["status"] in ("completed", "failed", "cancelled"):
                    break
                time.sleep(0.05)
            times["job"] = round(time.monotonic() - t0, 1)
            db = db_session.SessionLocal()
            try:
                gens = db.query(Generation).filter(Generation.block_id.in_(game["blocks"])).all()
                gen_ids = {g.id for g in gens}
                cols = ("block_id", "persona_id", "profile_id", "project_id", "chapter_id", "text", "language", "engine", "model",
                        "seed", "instruct", "duration_sec", "status", "ok_status", "error", "source", "effects_chain", "cache_key")
                rows = {
                    "generations": sorted(({c: getattr(g, c) for c in cols} for g in gens), key=lambda r: r["block_id"]),
                    "takes": sorted(([t.block_id, t.is_default, t.label, t.source_take_id, t.generation_id in gen_ids]
                                     for t in db.query(Take).filter(Take.block_id.in_(game["blocks"]))), key=lambda r: (r[0], r[4])),
                    "job_blocks": sorted(([r.block_id, r.status, r.generation_id in gen_ids, r.attempts]
                                          for r in db.query(RenderJobBlock).filter(RenderJobBlock.job_id == job.id)), key=lambda r: r[0]),
                }
                for g in gens:
                    (out / "gen" / f"{g.block_id}.wav").write_bytes(media_file(g.audio_path).read_bytes())
                first = min(gens, key=lambda g: game["blocks"].index(g.block_id))
                first_take = media_file(first.audio_path).read_bytes()
            finally:
                db.close()
            s.pop("id")
            for b in s.get("blocks", []):
                b["generation_id"] = b["generation_id"] in gen_ids
            (out / "job.json").write_text(json.dumps({"status": s, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
            (out / "voicelines.zip").write_bytes(export_voicelines(st, game["project"]))
            take("voicelines")

            t0 = time.monotonic()
            audio = ids["audio"]
            (out / "chapter.wav").write_bytes(render_scene_to_wav(st, audio["scenes"][0]))
            take("chapter")
            chapters = assemble_project(st, audio["project"])
            take("assemble")
            (out / "book.m4b").write_bytes(mux_m4b(chapters, "Parity Audio", "Tamsin Vale"))
            take("m4b")
            times["audio"] = round(time.monotonic() - t0, 1)

            fmt, off, size = parse_wav_header(first_take)
            pcm = first_take[off:off + size]
            for preset in ("acx", "inaudio", "podcast", "youtube"):
                data = mastering.master(pcm, fmt.sample_rate, fmt.channels, preset_name=preset, presets=st.settings.get().mastering,
                                        title="The Ninth Facet", author="Tamsin Vale", book="Facets")
                (out / "master" / f"{preset}.mp3").write_bytes(data)
                take(preset)
                data = mastering.master_to_wav(pcm, fmt.sample_rate, fmt.channels, preset_name=preset, presets=st.settings.get().mastering)
                (out / "master" / f"{preset}.wav").write_bytes(data)
                take(f"{preset}_wav")
    finally:
        shutdown_manager()
    argvs.pop("_now", None)
    (out / "argv.json").write_text(json.dumps(argvs, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "times.json").write_text(json.dumps(times), encoding="utf-8")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"augment": augment, "dump": dump, "prep": prep, "real": real}[cmd](*args)
