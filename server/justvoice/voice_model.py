# SPDX-License-Identifier: MIT
"""What model speaks a voice — one answer for every screen and every render.

A voice is raw (mock `_s6`, "A voice is raw"): a timbre and the model it was
made for. A built-in belongs to its model; a clone's model is picked when it
is cloned (Chatterbox Turbo, Nano or Multilingual, Qwen3 Base, VoxCPM2,
Pocket); a design's model is the one it was designed on; a blend is Kokoro's.
Until 2026-10-03 a voice stored only its ENGINE, so a Turbo clone and a
Multilingual clone were the same voice to the app, and tags, knobs and the
render all followed whichever model happened to be loaded
(docs/plans/2026-10-03-persona-redesign.md §5.2, §6.3 P1).

"Model" here is the capability row id — the model FAMILY: `kokoro`, `kitten`,
`pocket`, `qwen3-cv`, `qwen3-base`, `qwen3-vd`, `chatterbox-multilingual`,
`chatterbox-turbo`, `chatterbox-nano`, `voxcpm2`. Its size and precision
(1.7B / 0.6B, 8-bit / 16-bit) stay the engine's choice on AI Settings; the
render picks the variant of the family (`variant_for_model`).

Everything a screen says about a voice's model — its name, how it can be
directed, the languages it can speak — comes from `voice_model`, so the
Voices table, the persona editor, Cast and the render can never disagree.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

# How a model can be directed (doc §5.5): written direction, tags from its own
# list, or nothing but the sliders.
WORDS = "words"
TAGS = "tags"
SLIDERS = "sliders"


class ModelUnavailable(RuntimeError):
    """The voice's model is not installed (or not in this runtime's catalog).

    A render refuses rather than downloading gigabytes behind the user's back
    (doc §6.2 call 4); the message names the model to install."""


@dataclass(frozen=True)
class VoiceModel:
    engine_id: str
    # The capability row id; the engine id for a registry engine (an online
    # provider), which has no families.
    model: str
    name: str
    directed_by: str
    # The languages this voice can be spoken in on this model, as the catalog
    # writes them ("en-US", "ja", …). One entry = fixed by the voice or model.
    speaks: tuple[str, ...]


def base_lang(code: str | None) -> str:
    """"en-US" → "en"; the comparison every language check uses."""
    return (code or "").split("-")[0].strip().lower()


def speaks_language(vm: VoiceModel, code: str | None) -> bool:
    want = base_lang(code)
    return bool(want) and any(base_lang(s) == want for s in vm.speaks)


# ── The catalog, read through the manager ────────────────────────────────


def _manager():
    from .engines.manager import get_manager

    return get_manager()


def _capability(model_or_variant: str):
    from .engines.capability_details import lookup

    return lookup(model_or_variant)


def model_of_variant(variant_id: str | None) -> str | None:
    """The family a catalog variant belongs to: "chatterbox-turbo-f16" →
    "chatterbox-turbo", "qwen3-base-0.6b-q8" → "qwen3-base"."""
    if not variant_id:
        return None
    row = _capability(variant_id)
    return row.engine_id if row is not None else None


def _variant_rows(engine_id: str) -> list[dict[str, Any]]:
    """The engine's catalog rows, or [] where there is no catalog (an online
    provider, a test's fake manager)."""
    try:
        from .engines.model_catalog import _variant_rows as rows

        return list(rows(engine_id))
    except Exception:  # noqa: BLE001 — no manifest module / no manager
        return []


def models_of_engine(engine_id: str) -> list[str]:
    """The model families an engine's catalog offers, in catalog order."""
    out: list[str] = []
    for row in _variant_rows(engine_id):
        fam = model_of_variant(row.get("id"))
        if fam and fam not in out:
            out.append(fam)
    return out


def engine_of_model(model: str) -> str | None:
    """The engine whose catalog offers this family."""
    try:
        manifests = _manager().manifests()
    except Exception:  # noqa: BLE001
        return None
    for engine_id in manifests:
        if model in models_of_engine(engine_id):
            return engine_id
    return None


def _family_rows(engine_id: str, model: str) -> list[dict[str, Any]]:
    return [r for r in _variant_rows(engine_id) if model_of_variant(r.get("id")) == model]


def model_name(model: str, engine_id: str | None = None) -> str:
    row = _capability(model)
    if row is not None and (row.engine_id == model or engine_id is None):
        return row.display_name
    try:
        m = _manager().get_manifest(engine_id or model)
        if m is not None and getattr(m, "name", None):
            return m.name
    except Exception:  # noqa: BLE001
        pass
    return model


def directed_by(model: str) -> str:
    """Written direction, tags, or sliders only — the model's own answer."""
    row = _capability(model)
    if row is None or row.engine_id != model:
        return SLIDERS
    if row.supports_instruct_freeform:
        return WORDS
    if row.inline_tags:
        return TAGS
    return SLIDERS


def model_speaks(engine_id: str, model: str) -> tuple[str, ...]:
    """Every language the family's variants list, in first-seen order."""
    out: list[str] = []
    for row in _family_rows(engine_id, model):
        for lang in row.get("languages") or []:
            if lang not in out:
                out.append(lang)
    return tuple(out)


def _default_model(engine_id: str, *, need: str | None = None) -> str | None:
    """The engine's own default family — the one a no-variant load resolves to
    — or, when that family can't do `need` ("clone" / "design" / "blend"), the
    first family in the catalog that can."""
    families = models_of_engine(engine_id)
    if not families:
        return None
    try:
        default = model_of_variant(_manager().resolved_default_variant(engine_id))
    except Exception:  # noqa: BLE001
        default = None
    ordered = ([default] if default in families else []) + [f for f in families if f != default]
    if need is None:
        return ordered[0]
    for fam in ordered:
        if can(fam, need):
            return fam
    return None


def can(model: str, action: str) -> bool:
    """Can this family clone / design / blend?"""
    row = _capability(model)
    if row is None:
        return False
    if action == "clone":
        return bool(row.supports_voice_cloning)
    if action == "design":
        return bool(row.supports_voice_design)
    if action == "blend":
        # Kokoro is the blending engine (engines/blending.py gates the file
        # math); `supports_voice_blending` follows the pinned runtime and says
        # whether a blend can be HEARD yet, not whether one can be made.
        return row.engine_id == "kokoro" or bool(row.supports_voice_blending)
    return False


def check_model_for(engine_id: str, model: str | None, action: str) -> str:
    """The family a new voice is stored with: the one asked for, checked; or
    the engine's default family that can do `action`. Raises ValueError with a
    sentence the API can return."""
    families = models_of_engine(engine_id)
    if model:
        if families and model not in families:
            raise ValueError(f"{model_name(model)} is not a {engine_id} model")
        if families and not can(model, action):
            verb = {"clone": "clone a voice", "design": "design a voice", "blend": "blend voices"}[action]
            raise ValueError(f"{model_name(model)} can't {verb}")
        return model
    chosen = _default_model(engine_id, need=action)
    if chosen is None:
        # No catalog to choose from (an online provider): the engine is the model.
        return engine_id
    return chosen


# ── A voice's model ───────────────────────────────────────────────────────


def _has_clip(state: Any, stored: Any) -> bool:
    from .render_core import resolve_audio_prompt_for_stored

    try:
        return bool(resolve_audio_prompt_for_stored(state, stored))
    except Exception:  # noqa: BLE001 — a store without files (tests)
        return False


def model_for_stored(state: Any, stored: Any) -> str:
    """The family a stored voice speaks on.

    Clip wins (2026-08-22): a Qwen3 designed voice saved with its preview
    renders as a clone on Qwen3 Base, and one without speaks from its
    description on VoiceDesign — decided by the clip, whatever was stored.
    A blend is Kokoro's. Everything else is the model it was made for, or —
    for a voice saved before models were stored — its engine's default family
    that can speak a voice of its kind.
    """
    engine_id = stored.engine
    if stored.source == "blended":
        return "kokoro" if engine_id == "kokoro" else (getattr(stored, "model", None) or engine_id)
    if stored.source == "designed" and engine_id == "qwen3":
        return "qwen3-base" if _has_clip(state, stored) else "qwen3-vd"
    families = models_of_engine(engine_id)
    model = getattr(stored, "model", None)
    if model and (not families or model in families):
        return model
    need = "design" if stored.source == "designed" and not _has_clip(state, stored) else "clone"
    return _default_model(engine_id, need=need) or engine_id


def model_for_preset(engine_id: str) -> str:
    """A built-in belongs to one model: Qwen3's nine speakers to CustomVoice,
    every other engine's presets to its own (single) family."""
    if engine_id == "qwen3":
        return "qwen3-cv"
    return _default_model(engine_id) or engine_id


def _registry_engine(state: Any, engine_id: str):
    registry = getattr(state, "engines", None)
    return registry.get(engine_id) if registry is not None else None


def describe(state: Any, engine_id: str, model: str, voice_language: str | None) -> VoiceModel:
    """The facts every screen shows for a voice on `model`."""
    if _registry_engine(state, engine_id) is not None and model == engine_id:
        # An online provider: no families, no direction the app can send.
        langs = (voice_language,) if voice_language else ()
        return VoiceModel(engine_id, model, model_name(model, engine_id), SLIDERS, langs)
    listed = model_speaks(engine_id, model)
    if model == "kokoro" and voice_language:
        # A Kokoro voice is bound to its own language's reader: Alpha
        # (Japanese) speaks Japanese, whatever else the model can read.
        speaks: tuple[str, ...] = (voice_language,)
    elif listed:
        # Kitten and Turbo / Nano list English alone; Pocket lists its five
        # language models; Qwen3, Multilingual and VoxCPM2 their many.
        speaks = listed
    else:
        speaks = (voice_language,) if voice_language else ()
    return VoiceModel(engine_id, model, model_name(model, engine_id), directed_by(model), speaks)


def voice_model(state: Any, voice_id: str | None) -> VoiceModel | None:
    """What model speaks `voice_id`, or None when no engine owns it."""
    if not voice_id:
        return None
    store = getattr(state, "voices", None)
    stored = store.get(voice_id) if store is not None else None
    if stored is not None:
        model = model_for_stored(state, stored)
        return describe(state, stored.engine, model, getattr(stored, "language", None))
    from .render_core import _resolve_engine_for_voice

    try:
        engine_id = _resolve_engine_for_voice(state, voice_id)
    except AttributeError:
        return None
    if engine_id is None:
        return None
    if _registry_engine(state, engine_id) is not None:
        lang = None
        for p in _registry_engine(state, engine_id).voices():
            if p.id == voice_id:
                lang = getattr(p, "language", None)
        return describe(state, engine_id, engine_id, lang)
    return describe(state, engine_id, model_for_preset(engine_id), _preset_language(engine_id, voice_id))


def voice_language(state: Any, voice_id: str | None) -> str | None:
    """The language a voice itself is in — a stored voice's own, a preset's
    catalog language — or None for a voice nothing owns."""
    if not voice_id:
        return None
    store = getattr(state, "voices", None)
    stored = store.get(voice_id) if store is not None else None
    if stored is not None:
        return getattr(stored, "language", None)
    from .render_core import _resolve_engine_for_voice

    try:
        engine_id = _resolve_engine_for_voice(state, voice_id)
    except AttributeError:
        # A duck-typed state carrying only the stores its caller touches
        # (the chapter resolver's tests) — nothing to look the voice up in.
        return None
    if engine_id is None:
        return None
    engine = _registry_engine(state, engine_id)
    if engine is not None:
        return next((getattr(p, "language", None) for p in engine.voices() if p.id == voice_id), None)
    return _preset_language(engine_id, voice_id)


def _preset_language(engine_id: str, voice_id: str) -> str | None:
    try:
        m = _manager().get_manifest(engine_id)
    except Exception:  # noqa: BLE001
        return None
    for v in getattr(m, "static_voices", None) or []:
        if v.get("id") == voice_id:
            return v.get("language")
    return None


def model_key(state: Any, voice_id: str) -> str:
    """The scheduler's grouping key: lines on one model render together, so a
    chapter swaps each model in once (doc §6.2 call 5)."""
    vm = voice_model(state, voice_id)
    return f"{vm.engine_id}:{vm.model}" if vm else f"?voice:{voice_id}"


# ── Loading the right variant ─────────────────────────────────────────────


def _size_tokens(variant_id: str | None) -> set[str]:
    """The size and precision parts of a variant id ("1.7b", "q8", "f16")."""
    parts = set((variant_id or "").split("-"))
    return {p for p in parts if p.endswith("b") and p[:-1].replace(".", "").isdigit()} | {
        p for p in parts if p in {"q8", "f16", "bf16", "f32"}
    }


def variant_for_model(engine_id: str, model: str, language: str | None = None) -> str | None:
    """The variant of `model` to load, or None where there is no catalog.

    Size and precision stay AI Settings' choice (doc §6.2 call 4): the loaded
    variant if it is this family, else the user's default if it is, else an
    installed variant of the family — same size and precision first. Nothing
    of the family on disk → the same pick among all of the family's variants,
    and the load fetches its file, as a first load always has ("Load never
    installs a program … it does fetch a missing MODEL file", manager.load).
    Pocket has one model per language, so its language picks among them; a
    language it has no model for → ModelUnavailable, naming the model.
    """
    rows = _family_rows(engine_id, model)
    if not rows:
        return None
    if language and len({tuple(r.get("languages") or []) for r in rows}) > 1:
        want = base_lang(language)
        by_lang = [r for r in rows if any(base_lang(x) == want for x in r.get("languages") or [])]
        if not by_lang:
            raise ModelUnavailable(
                f"{model_name(model)} has no model for {language} — pick a language it speaks"
            )
        rows = by_lang
    ids = [r["id"] for r in rows]
    mgr = _manager()
    current = getattr(mgr, "current_variant_id", lambda _e: None)(engine_id)
    if current in ids and mgr.current_for(_kind(engine_id)) == engine_id:
        return current
    try:
        default = mgr.resolved_default_variant(engine_id)
    except Exception:  # noqa: BLE001
        default = None
    want = _size_tokens(default)
    on_disk = [vid for vid in ids if _on_disk(engine_id, vid)]
    pool = on_disk or ids
    if default in pool:
        return default
    # Stable sort: catalog order (the 8-bit row first) breaks the ties.
    return sorted(pool, key=lambda vid: -len(_size_tokens(vid) & want))[0]


def _kind(engine_id: str) -> str:
    try:
        m = _manager().get_manifest(engine_id)
        return getattr(m, "kind", "tts") or "tts"
    except Exception:  # noqa: BLE001
        return "tts"


def _on_disk(engine_id: str, variant_id: str) -> bool:
    try:
        from . import speech_cache
        from .app_state import get_state

        return speech_cache.variant_on_disk(get_state().data_dir, engine_id, variant_id)
    except Exception:  # noqa: BLE001 — bare tests / no app state
        return False


def ensure_model_loaded(engine_id: str, model: str, language: str | None = None) -> None:
    """Make `model` the resident speech model before a synth.

    Where the engine has no catalog (a test's fake manager) this is the old
    engine-level rule: load the engine if it isn't the resident one."""
    mgr = _manager()
    kind = _kind(engine_id)
    rows = _family_rows(engine_id, model)
    if not rows:
        if mgr.current_for(kind) != engine_id:
            mgr.load(engine_id, device="auto")
        return
    if is_model_loaded(engine_id, model) and _language_resident(engine_id, model, language):
        return
    variant = variant_for_model(engine_id, model, language)
    mgr.load(engine_id, device="auto", variant=variant)


def _resident_variant(engine_id: str) -> str | None:
    """The loaded variant — or, for a load that recorded none, the default a
    no-variant load resolves to."""
    mgr = _manager()
    current = getattr(mgr, "current_variant_id", lambda _e: None)(engine_id)
    if current is None:
        try:
            current = mgr.resolved_default_variant(engine_id)
        except Exception:  # noqa: BLE001
            return None
    return current


def _language_resident(engine_id: str, model: str, language: str | None) -> bool:
    """Pocket has one model per language: the resident one must speak the
    line's. Every other family speaks all its languages in one model."""
    rows = _family_rows(engine_id, model)
    if not language or len({tuple(r.get("languages") or []) for r in rows}) <= 1:
        return True
    current = _resident_variant(engine_id)
    row = next((r for r in rows if r.get("id") == current), None)
    want = base_lang(language)
    return row is not None and any(base_lang(x) == want for x in row.get("languages") or [])


def is_model_loaded(engine_id: str, model: str) -> bool:
    """Is a variant of `model` the resident speech model right now?"""
    mgr = _manager()
    if mgr.current_for(_kind(engine_id)) != engine_id:
        return False
    if not _family_rows(engine_id, model):
        return True
    return model_of_variant(_resident_variant(engine_id)) == model
