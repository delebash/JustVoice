"""Render orchestration — voice + text + delivery → PCM bytes.

Single source of truth for the per-line render pipeline used by
both `/v1/generate` (one line) and `/v1/render_chapter` (many).
Handles: cache lookup, lexicon substitution, engine auto-load,
synthesize, speed / gain / pitch on the finished line (`apply_line_delivery`),
cache store.

Phase 3 lift: long-text inputs (> settings.generation.max_chunk_chars)
go through the chunked path (audio/chunked.py — upstream MIT lift) so
chapter-scale renders split at sentence boundaries and crossfade-blend
to eliminate clicks.

No sample math happens here: speed, gain, pitch, the effects chain, the joins
and a line's fit into a chapter are requests to `audiocpp_dsp`
(audio/dsp_client.py; 2026-10-07).
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass
from typing import Any

from .app_state import AppState
from .audio import dsp_client
from .audio.chunked import (
    DEFAULT_MAX_CHUNK_CHARS,
    split_text_into_chunks,
)
from .audio.effects import effects_chain_hash
from .audio.wav import parse_wav_header, strip_wav_header, write_wav_container
from .cache import CacheKeyBuilder, pack_pcm_with_format, unpack_pcm_with_format
from .delivery import canonical_json
from .engines.base import SynthRequest
from .engines.manager import EngineRequestError, TermsRequired
from .errors import bad_request, internal, not_found
from .inline_tags import strip as strip_tags
from .version import VERSION

log = logging.getLogger(__name__)


@dataclass
class RenderedLine:
    pcm: bytes
    sample_rate: int
    channels: int
    effective_delivery: dict[str, Any]
    # What the audio was made from (`inputs_key`, the render cache's key) and
    # the seed it was made with — a take records both, so Render can tell a
    # line whose inputs changed since (stale) from one that still matches
    # (Studio Slice 4, 2026-10-04). Empty for audio that was not rendered here.
    inputs_key: str = ""
    seed: int | None = None
    # The engine and model that spoke it — a take's generation records both
    # (2026-10-06: every render was saved as "managed", so the Cache page had
    # nothing to name).
    engine: str = ""
    model: str = ""


def _resolve_engine_for_voice(state: AppState, voice_id: str) -> str | None:
    """Find the engine id that owns a voice id (preset or stored).

    Checks three sources: in-process engine voice lists, stored voices,
    and managed-engine manifest static_voices. The manifest pass matters
    for preset voices of NOT-YET-LOADED engines (e.g. kokoro's af_heart
    before first load) — without it any render/preview against them
    404s before auto-load can even run.
    """
    for engine in state.engines.all():
        if any(p.id == voice_id for p in engine.voices()):
            return engine.meta.engine_id
    stored = state.voices.get(voice_id)
    if stored:
        return stored.engine
    try:
        from .engines.manager import get_manager

        for manifest in get_manager().manifests().values():
            if any(v.get("id") == voice_id for v in manifest.static_voices):
                return manifest.id
    except Exception:
        pass
    return None


def resolve_audio_prompt_for_stored(state: AppState, stored) -> str | None:
    """The absolute path of a stored voice's reference WAV, so an engine
    subprocess can read it as `audio_prompt_path`; None when there is none.

    Cloned and imported voices always have one — it is the whole voice.
    A DESIGNED voice has one only if its preview was frozen at save
    (2026-08-22): the Designer's own clip becomes the reference, and from
    there the voice renders as an ordinary clone with a stable identity
    instead of re-rolling a speaker per line. Designed voices saved before
    that, and any whose file is missing, fall through to None and stay
    dynamic — see `voice_design_instruct` for the other half of that rule.
    """
    if stored.source not in ("cloned", "imported", "designed"):
        return None
    store = getattr(state, "voices", None)
    if store is None:
        return None
    path = store.ref_wav_path(stored.id)
    if not path.is_file():
        return None
    return str(path.resolve())


def voice_design_instruct(state: AppState, stored) -> str | None:
    """The description a DESIGNED voice contributes to the instruct slot.

    **Clip wins.** A designed voice whose preview was frozen to `ref.wav`
    renders as a clone — the identity is in the audio — so its description
    is provenance and display only, and must NOT also be spoken as
    direction. Without a clip the description IS the voice: it has to reach
    the engine on every line or the VoiceDesign checkpoint has no identity
    to render at all (`qwen3/engine.py` refuses outright: "renders from a
    voice description and this voice has none").

    Separate from `voice_synth_fields` on purpose. That one carries synth
    INPUTS keyed as the engine protocol expects, and is called inside
    `render_line` — after the API layer has already composed the instruct.
    This is prose for the instruct slot, so it belongs at the compose sites
    (`render_chapter_api`, `generate_api`), first in the order: the
    description says who the voice is, everything after it says how this
    line goes. Both live here so the clip-wins rule has one home.
    """
    if stored is None or getattr(stored, "source", None) != "designed":
        return None
    if resolve_audio_prompt_for_stored(state, stored):
        return None
    return (getattr(stored, "design_prompt", None) or "").strip() or None


def is_description_voice(state: AppState, voice_id: str | None) -> bool:
    """A voice drawn from its written description on every request — designed, no clip
    (`voice_design_instruct`'s clip-wins rule)."""
    return voice_design_instruct_for_id(state, voice_id) is not None


def description_seed(voice_id: str) -> int:
    """The seed a description voice speaks with when none is set (audit 2026-10-04 §13.3).

    Its voice is drawn from the description on every request, so with a random seed each line
    — and each piece of a long line — came out as a different person. A fixed seed per voice
    makes it one voice; a persona's own seed still wins. Stable across runs (crc32 of the id)."""
    import zlib

    return zlib.crc32(voice_id.encode("utf-8")) & 0x7FFFFFFF


def line_split_chars(state: AppState, engine_id: str, voice: str | None) -> int:
    """The longest piece a line goes to its model in: the model's split size (the user's per
    model, else the catalog's — `EngineManager.split_chars_for`) under
    `generation.max_chunk_chars`, which a model with none gets. A description voice keeps
    `max_chunk_chars`: split, it drifted into a different person from piece to piece (the
    user's listening verdict, 2026-10-04 — audit §13.6). The host splits at
    sentence ends and crossfades; a piece under audio.cpp's own budget is never re-split with
    its hard join (audit §5 D5)."""
    cap = int(getattr(state.settings.get().generation, "max_chunk_chars", DEFAULT_MAX_CHUNK_CHARS))
    if is_description_voice(state, voice):
        return cap
    try:
        from .engines.manager import get_manager

        mgr = get_manager()
        split = mgr.split_chars_for(engine_id, mgr.current_variant_id(engine_id))
    except Exception:  # noqa: BLE001 — a registry engine / bare tests: no split of its own
        split = None
    return min(cap, split) if split else cap


def voice_design_instruct_for_id(state: AppState, voice_id: str | None) -> str | None:
    """`voice_design_instruct` by voice id — the form the compose sites want,
    since they hold an id and a missing/preset voice must be a quiet None.

    Tolerates a state with no voice store. `_resolve_scene_to_lines` is
    duck-typed on purpose and several tests hand it a namespace carrying only
    the stores that path used to touch; no store simply means no designed
    voice to find, which is the right answer rather than an AttributeError
    from inside a render.
    """
    store = getattr(state, "voices", None)
    if not voice_id or store is None:
        return None
    return voice_design_instruct(state, store.get(voice_id))


def voice_synth_fields(state: AppState, stored) -> dict:
    """Everything a stored voice contributes to a synth request, keyed as
    the engine protocol expects. THE one place that knows how each voice
    source reaches an engine — added 2026-08-19 with the acquisition build,
    because three call sites (render, generate, audition) each resolved the
    reference clip and nothing else, so blended voices rendered
    as their bare id and came out in the wrong voice entirely.

        cloned / imported → audio_prompt_path (+ ref_text where the engine
                            takes the clip's transcript)
        blended          → voice_vector (the style vector; kokoro)
        designed         → audio_prompt_path + ref_text IF its preview was
                           frozen at save; otherwise nothing here, and its
                           description reaches the engine as instruct prose
                           through `voice_design_instruct` at the compose
                           sites. Until 2026-08-22 this line claimed the
                           description already rode `delivery.instruct` —
                           no call site implemented that, so a saved
                           designed voice contributed nothing at all.
        preset           → nothing

    A None value means "not applicable", and every field is optional on the
    wire, so an engine that ignores one is unaffected.
    """
    if stored is None:
        return {}
    out: dict = {}
    prompt = resolve_audio_prompt_for_stored(state, stored)
    if prompt:
        out["audio_prompt_path"] = prompt
        if getattr(stored, "transcript", None):
            out["ref_text"] = stored.transcript
        if getattr(stored, "xvector_only", False):
            out["xvector_only"] = True   # Qwen3 Base's "Skip the words", as auditioned
    if stored.source == "blended" and getattr(stored, "embedding", None):
        out["voice_vector"] = list(stored.embedding)
    return out


def _registry_engine(state: AppState, engine_id: str):
    registry = getattr(state, "engines", None)
    return registry.get(engine_id) if registry is not None else None


def _line_model(state: AppState, voice: str, engine_id: str) -> str:
    """The model `voice` speaks on — voice_model.py's one answer — or the
    engine itself where nothing finer is known."""
    from .voice_model import voice_model

    vm = voice_model(state, voice)
    return vm.model if vm is not None else engine_id


def _model_row(model: str | None) -> Any | None:
    """The capability row of exactly this model (family), or None.

    Since 2026-10-03 every tag, emotion tag and knob follows the model the
    VOICE speaks on (voice_model.py) — not the loaded variant, which is how a
    Turbo clone rendered while Multilingual was loaded lost its tags. An exact
    match only: a family must never fall through to its engine's row, or
    Multilingual would inherit Turbo's tags."""
    if not model:
        return None
    from .engines.capability_details import lookup

    row = lookup(model)
    return row if row is not None and row.engine_id == model else None


def _engine_takes_tags(state: AppState, engine_id: str) -> bool | None:
    """The engine-level answer, for an engine with no capability row of its
    own (an online provider, a test's fake engine). None = the engine exists
    nowhere (a render would 404)."""
    engine = _registry_engine(state, engine_id)
    if engine is not None:
        return bool(engine.meta.supports_paralinguistic_tags)
    try:
        from .engines.manager import get_manager

        manifest = get_manager().get_manifest(engine_id)
    except Exception:
        return None
    if manifest is None:
        return None
    return bool(manifest.capabilities.get("paralinguistic_tags"))


def performable_text(state: AppState, engine_id: str, model: str | None, text: str) -> str:
    """`text` with every `[tag]` this model cannot perform removed (decided
    2026-09-29: "drop every [word] tag the chosen engine doesn't list, not
    only the ones the app recognises").

    A model that takes no tags loses them all. One that takes tags keeps
    exactly the bracket tags its capability row lists — Chatterbox Turbo
    keeps its vocabulary, Multilingual (one engine, a tokenless model) keeps
    none. Without a capability row the engine's own flag decides, and a tag
    engine keeps the parser's own set. Shared by the chapter render, the cache
    probe and Generate, so all three speak the same words."""
    from .inline_tags import ATOMIC, SPANS

    row = _model_row(model) if _registry_engine(state, engine_id) is None else None
    if row is None:
        if not _engine_takes_tags(state, engine_id):
            return strip_tags(text)
        return strip_tags(text, keep=ATOMIC | SPANS)
    known = {
        t.lower()
        for tagset in row.inline_tags
        if (tagset.syntax or "").startswith("[")
        for t in tagset.tags
    }
    return strip_tags(text, keep=known) if known else strip_tags(text)


def _emotion_tagset(model: str | None) -> Any | None:
    """The emotion tag set of the model that speaks the line, or None.

    `Delivery.emotion` has two possible expressions and the model decides
    which: models that take freeform prose get it folded into `instruct` by
    `delivery_merge.compose_instruct` up at the API layer, and models with an
    emotion token vocabulary get it compiled into the text here. Today that
    second group is Chatterbox Turbo and Nano.

    Exactly the voice's model (`_model_row`): Turbo and Multilingual are one
    engine and one adapter but two tokenizers — Multilingual has no such
    tokens and would read `[angry]` aloud as a word.
    """
    row = _model_row(model)
    if row is None:
        return None
    for tagset in row.inline_tags:
        if tagset.category == "emotion" and tagset.value_map:
            return tagset
    return None


def _apply_emotion_tag(text: str, delivery: dict[str, Any], tagset: Any | None) -> str:
    """Prefix this line with the engine's tag for `delivery.emotion`.

    Line-level, so it goes at the front: the emotion is the state the whole
    line is spoken in, unlike a non-verbal sound, which is positional and the
    author types where they want it.

    Silent no-op in three cases, all deliberate: the engine has no emotion
    vocabulary, no emotion is set, or the value is not in this engine's map.
    `neutral` maps to the empty string and so lands in that last case — it is
    expressible precisely by adding nothing.
    """
    if tagset is None:
        return text
    value = delivery.get("emotion")
    if not value:
        return text
    tag = (tagset.value_map or {}).get(value)
    if not tag:
        return text
    return f"{tagset.syntax.format(value=tag)} {text}"


def _apply_lead_tags(text: str, delivery: dict[str, Any], model: str | None) -> str:
    """A tag model's own tags for the whole line — `delivery.tags`, a
    persona's emotion and register on Chatterbox Turbo / Nano (2026-10-03) —
    at the start of the line, each once, and only the tags the model lists.
    A tag the line already carries is not added again."""
    wanted = delivery.get("tags") or []
    if not wanted:
        return text
    row = _model_row(model)
    if row is None:
        return text
    known = {
        t.lower(): tagset
        for tagset in row.inline_tags
        if (tagset.syntax or "").startswith("[")
        for t in tagset.tags
    }
    lead: list[str] = []
    for tag in wanted:
        tagset = known.get(str(tag).lower())
        if tagset is None:
            continue
        token = tagset.syntax.format(value=tag)
        if token not in lead and token not in text:
            lead.append(token)
    return f"{' '.join(lead)} {text}" if lead else text


def _supports_phoneme_input(model: str) -> bool:
    """Whether this model can pronounce a word from IPA NOW: its capability row says so (the
    pinned runtime splices it — Kokoro, gap 3) and the INSTALLED runtime is new enough. On an
    older installed runtime an entry's respelling is used instead, as on an engine without IPA."""
    try:
        from .engines.capability_details import lookup

        cap = lookup(model)
        if not (cap and cap.supports_phoneme_input):
            return False
        from .engines.audiocpp.runtime import has_feature

        return has_feature("inline_ipa")
    except Exception:  # noqa: BLE001 — capability table or runtime unavailable → no IPA
        return False


def speed_native(state: AppState, engine_id: str, model: str | None = None) -> bool:
    """Whether the model paces itself (Kokoro, KittenTTS, the OpenAI-compatible
    provider). Every other model renders at its own pace and the server
    time-stretches the finished line (switch plan §5, gap 8)."""
    engine = _registry_engine(state, engine_id)
    if engine is not None:
        return bool(getattr(engine.meta, "supports_speed", False))
    try:
        from .engines.capability_details import lookup

        cap = lookup(model or engine_id)
        return bool(cap and cap.speed_native)
    except Exception:  # noqa: BLE001 — capability table unavailable → the server stretches
        return False


def server_speed(delivery: dict[str, Any], native: bool) -> float | None:
    """The factor the server stretches a finished line by, or None when the
    model paced it or the line is at its own pace."""
    if native or delivery.get("speed") is None:
        return None
    try:
        factor = float(delivery["speed"])
    except (TypeError, ValueError):
        return None
    lo, hi = STRETCH_RANGE
    factor = max(lo, min(hi, factor))
    return None if abs(factor - 1.0) < 1e-6 else factor


#: The speed range the server stretches over — a persona's pace and a line's own
#: (audiocpp_dsp clamps to the same range).
STRETCH_RANGE = (0.5, 2.0)

#: What made a line's pace and pitch, as the render cache keys it. Signalsmith Stretch moved
#: from python-stretch (the library at commit ffa45981) to 1.4.0 inside audiocpp_dsp, with a
#: fixed seed, on 2026-10-07 — its output changed (the move plan §3), so a line the server
#: paced or pitched is keyed anew, and only those.
STRETCH_ENGINE = "ss-1.4.0"


def _key_delivery(delivery: dict[str, Any], native: bool) -> dict[str, Any]:
    """The delivery the cache key hashes. A line the server stretches or pitches carries a
    marker naming what did it: until gap 8 the same delivery rendered unstretched on these
    engines, and until 2026-10-07 python-stretch did the stretching — neither's cached entries
    may be served as the new audio."""
    key = dict(delivery)
    if server_speed(delivery, native):
        key["speed_by"] = f"server {STRETCH_ENGINE}"
    if _pitch_semitones(delivery):
        key["pitch_by"] = STRETCH_ENGINE
    return key


def _pitch_semitones(delivery: dict[str, Any]) -> float:
    """A line's pitch, clamped to ±12 semitones; 0 when it has none."""
    if not delivery.get("pitch"):
        return 0.0
    return max(-12.0, min(12.0, float(delivery["pitch"])))


def line_shape(delivery: dict[str, Any], *, speed_native: bool) -> dict[str, Any]:
    """What the server does to a finished line from its delivery, as `dsp_client.shape`'s
    parameters: Speed (when the model did not pace itself), then Gain, then Pitch."""
    gain = max(-24.0, min(12.0, float(delivery["gain_db"]))) if delivery.get("gain_db") else 0.0
    return {
        "stretch_factor": server_speed(delivery, speed_native),
        "gain_db": gain,
        "pitch_semitones": _pitch_semitones(delivery),
    }


def apply_line_delivery(
    pcm: bytes, sample_rate: int, channels: int, delivery: dict[str, Any], *, speed_native: bool,
) -> bytes:
    """What the server does to a finished line from its delivery: Speed (when
    the model did not pace itself), then Gain, then Pitch. One function for a
    chapter render and Generate, so the same settings sound the same from
    both — Generate applied none of the three until 2026-10-02 (gap 8 plan §4).
    The effects chain is not here: it sits on top of the finished line and
    each caller applies it after this.

    `capability_details` advertises pitch_post_process on every engine that
    has no native transposer, and nothing ever applied the value until the
    2026-08-17 audit: no engine reads `delivery.pitch`. It comes before the
    effects chain, because pitch is part of how the line was spoken."""
    return dsp_client.shape(pcm, sample_rate, channels, **line_shape(delivery, speed_native=speed_native))


def line_lexicons(book_lexicon_id: str | None, persona_lexicon_id: str | None) -> list[str]:
    """The lexicons one line is read with, in order: the book's (Overview →
    Pronunciation lexicon), then the lexicon of the persona that speaks it.

    The one rule every door that renders a line shares — the chapter resolver,
    the single-line door and the name scan — so they cannot drift. The book's
    goes first because `_apply_lexicons` lets the first entry for a word win:
    a name belongs to the book, not to a voice reused across books (decided
    2026-09-30). Until then the render read every persona's lexicon on every
    line of the chapter and never read the book's.
    """
    out: list[str] = []
    for lid in (book_lexicon_id, persona_lexicon_id):
        if lid and lid not in out:
            out.append(lid)
    return out


def _apply_lexicons(
    text: str, lexicon_ids: list[str], state: AppState, *, ipa_capable: bool = False
) -> tuple[str, dict[str, str]]:
    """Apply lexicon entries. Returns (text, ipa_map).

    Two kinds of entry, two mechanisms:

    * ``alias`` — a spelling that the engine's own text reader gets right
      ("Worcester" → "Wooster"). Plain text replacement, any engine.
    * ``phoneme_ipa`` — the exact pronunciation. Text replacement would
      make the engine READ the IPA letters, so instead the entries are
      collected into ``ipa_map`` and, on an engine that accepts phonemes,
      spliced into the phoneme stream engine-side (kokoro/ipa.py). On an
      engine that cannot, the alias is the fallback; an IPA-only entry
      does nothing there — a guess beats reading "wˈʊstər" aloud.

    Until 2026-08-21 only ``alias`` was ever applied: the IPA column was
    stored, displayed, and silently ignored at render.

    Lexicons apply in order, and the first entry that ACTS on a word wins it,
    whichever kind it is (2026-09-30). That is what lets the book's lexicon,
    listed first by `line_lexicons`, beat the persona's: an IPA entry never
    touched the text, so a later lexicon's respelling of the same word used
    to replace it and leave the IPA nothing to pronounce. An entry claims
    only what it can match — an IPA entry the word in any case, a respelling
    its exact spelling — and one that does nothing here (a blank row, or
    IPA-only on an engine that can't take it) claims nothing, so a later
    lexicon can still answer.

    ``ipa_map`` holds only the words THIS line contains. It rides in the
    delivery and so in the cache key; carrying every entry made any IPA edit
    re-render every line. The match is the engine's own (`_ipa_words`).
    """
    if not lexicon_ids:
        return text, {}
    out = text
    ipa_map: dict[str, str] = {}
    # lower(), not casefold(): both matchers compare lowercased, and casefold
    # folds "Maße" into "Masse", two words to the engine.
    spoken_as_ipa: set[str] = set()   # lowercased — IPA matches any case
    respelt: set[str] = set()         # exact — a respelling matches its own spelling
    for lid in lexicon_ids:
        lex = state.lexicons.get(lid)
        if not lex:
            continue
        for entry in lex.entries:
            word = entry.grapheme.strip().lower()
            if not word or word in spoken_as_ipa:
                continue
            if ipa_capable and entry.phoneme_ipa and entry.phoneme_ipa.strip():
                ipa_map[entry.grapheme] = entry.phoneme_ipa.strip()
                spoken_as_ipa.add(word)
            elif entry.alias and entry.grapheme not in respelt:
                out = out.replace(entry.grapheme, entry.alias)
                respelt.add(entry.grapheme)
    if ipa_map:
        spoken = _ipa_words(out, ipa_map)
        ipa_map = {g: p for g, p in ipa_map.items() if g.strip().lower() in spoken}
    return out, ipa_map


def _ipa_words(text: str, ipa_map: dict[str, str]) -> set[str]:
    """The mapped words the engine will speak from IPA in `text`, lowercased.

    Step for step what engines/kokoro/ipa.py `splice` does: whole words, case
    aside, the longest entry first so "Mara Vance" is not also "Mara"; split
    on those, and every piece that IS an entry is spoken from its IPA — which
    includes an entry ending in punctuation ("Dr.") that the regex itself
    can't match but that stands alone between two matches. Two matchers, one
    rule; test_project_lexicon pins them together.
    """
    entries = sorted(
        (g.strip() for g, p in ipa_map.items() if g.strip() and (p or "").strip()),
        key=len, reverse=True,
    )
    if not entries or not text.strip():
        return set()
    pattern = re.compile(r"\b(" + "|".join(re.escape(g) for g in entries) + r")\b", re.IGNORECASE)
    parts = pattern.split(text)
    if len(parts) == 1:
        return set()
    known = {g.lower() for g in entries}
    return {p.lower() for p in parts if p and p.lower() in known}


def probe_line_cached(
    state: AppState,
    voice: str,
    text: str,
    *,
    language: str | None = None,
    delivery: dict[str, Any] | None = None,
    seed: int | None = None,
    lexicons: list[str] | None = None,
    effects: list[dict] | None = None,
    cache_scope: str = "default",
) -> bool | None:
    """Would render_line serve this line from cache? Mirrors render_line's
    key derivation byte-for-byte WITHOUT rendering or loading the engine.
    Returns None when the voice can't be resolved (the render would 404)."""
    settings = state.settings.get()
    delivery = delivery or {}
    lexicons = lexicons or []
    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        return None
    if _engine_takes_tags(state, engine_id) is None:
        return None
    model = _line_model(state, voice, engine_id)
    # The same preparation render_line runs (prepare_line_text) — one function,
    # so the probe can't drift from the render. An IPA map rides the delivery
    # so it enters the key: a changed pronunciation is a different render.
    effective_text, delivery = prepare_line_text(state, engine_id, model, text, delivery, lexicons)
    # A description voice speaks with a fixed seed when none is set — one voice, not a new one
    # per line (§13.3). Before the cache key, so the key holds the seed the audio was made with
    # (the probe and the render apply it alike).
    if seed is None and voice and is_description_voice(state, voice):
        seed = description_seed(voice)
    key = _inputs_key(
        engine_id, voice, effective_text, language, seed, delivery,
        speed_native(state, engine_id, model), effects,
    )
    cache = getattr(state, "_render_cache", None)
    if not settings.cache.enabled or cache is None:
        return False
    return cache.has(cache_scope, key)


def _inputs_key(
    engine_id: str,
    voice: str,
    effective_text: str,
    language: str | None,
    seed: int | None,
    delivery: dict[str, Any],
    native: bool,
    effects: list[dict] | None,
) -> str:
    """THE key of what a line's audio is made from — the render cache's key,
    and the one a take records (Studio Slice 4). One builder, so the render,
    the cache probe and Render's stale check can never disagree."""
    return (
        CacheKeyBuilder()
        .with_engine(engine_id, VERSION)
        .with_voice(voice)
        .with_text(effective_text)
        .with_language(language)
        .with_seed(seed)
        .with_delivery_json(canonical_json(_key_delivery(delivery, native)))
        .with_effects_chain(effects_chain_hash(effects or []))
        .finish()
    )


def line_inputs_key(
    state: AppState,
    voice: str,
    text: str,
    *,
    language: str | None = None,
    delivery: dict[str, Any] | None = None,
    seed: int | None = None,
    lexicons: list[str] | None = None,
    effects: list[dict] | None = None,
) -> str | None:
    """The key `render_line` would give these inputs, without rendering or
    loading anything — what Render compares a take's recorded key with to say
    whether the line is stale. None when the voice can't be resolved."""
    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        return None
    if _engine_takes_tags(state, engine_id) is None:
        return None
    model = _line_model(state, voice, engine_id)
    effective_text, prepared = prepare_line_text(
        state, engine_id, model, text, dict(delivery or {}), list(lexicons or []),
    )
    if seed is None and voice and is_description_voice(state, voice):
        seed = description_seed(voice)
    return _inputs_key(
        engine_id, voice, effective_text, language, seed, prepared,
        speed_native(state, engine_id, model), effects,
    )


def prepare_line_text(
    state: AppState,
    engine_id: str,
    model: str | None,
    text: str,
    delivery: dict[str, Any],
    lexicons: list[str],
) -> tuple[str, dict[str, Any]]:
    """The text a model is sent for one line, and the delivery that goes with it:
    tags the model can't perform go, the lexicons respell (as IPA where the
    model reads it), then the lead and emotion tags. `render_line` and the
    persona page's preview of an unsaved voice share it (2026-10-04), so a
    voice heard before it is kept is prepared exactly as a chapter would be."""
    effective_text = performable_text(state, engine_id, model, text)
    effective_text, ipa_map = _apply_lexicons(
        effective_text, lexicons, state,
        ipa_capable=_supports_phoneme_input(model),
    )
    if ipa_map:
        delivery = {**delivery, "ipa_map": ipa_map}
    # After the lexicon, never before — a lexicon entry must not be able to
    # rewrite the inside of a tag we just generated.
    effective_text = _apply_lead_tags(effective_text, delivery, model)
    effective_text = _apply_emotion_tag(effective_text, delivery, _emotion_tagset(model))
    return effective_text, delivery


def shape_line_pcm(
    pcm: bytes,
    sample_rate: int,
    channels: int,
    delivery: dict[str, Any],
    *,
    speed_native: bool,
    effects: list[dict],
) -> bytes:
    """What a persona does to a line once the model has spoken it: speed (when
    the model did not pace itself), gain, pitch, then the effects chain on top
    of the finished line. Shared by `render_line` and the persona page's
    preview of an unsaved voice — one implementation, one sound. One request to
    the DSP program, which runs the steps in that order."""
    return dsp_client.shape(
        pcm, sample_rate, channels, **line_shape(delivery, speed_native=speed_native), effects=effects or [],
    )


def render_line(
    state: AppState,
    voice: str,
    text: str,
    *,
    language: str | None = None,
    delivery: dict[str, Any] | None = None,
    seed: int | None = None,
    lexicons: list[str] | None = None,
    effects: list[dict] | None = None,
    cache_scope: str = "default",
    use_cache: bool = True,
) -> RenderedLine:
    """Render one line.

    `effects` is the chain of the persona that speaks this line. It is applied to the audio
    here and it is part of the cache key, so two lines that differ only in
    their chain never share an entry — and editing a persona's chain
    invalidates exactly the blocks that persona speaks. Chapter renders left
    this out entirely until 2026-08-15: effects existed, the editor saved
    them, and only the single-line `/v1/generate` path ever applied them.
    """
    settings = state.settings.get()
    delivery = delivery or {}
    lexicons = lexicons or []
    effects = effects or []

    if len(text) > settings.limits.text_max_chars:
        raise bad_request(
            f"text length {len(text)} > limit {settings.limits.text_max_chars}"
        )

    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        raise not_found(f"voice {voice}")
    # Registry backends (external providers + test fakes) win; managed
    # plugin engines never sit in the registry and route via the manager
    # below (the 2026-08-08 §7d fix — before it, every managed voice 404'd
    # here and the whole multi-line render family was cloud-only).
    engine = state.engines.get(engine_id)
    manifest = None
    if engine is None:
        from .engines.manager import get_manager

        manifest = get_manager().get_manifest(engine_id)
        if manifest is None:
            raise not_found(f"engine {engine_id}")

    # The model the voice speaks on (voice_model.py): its tags, its emotion
    # tags, its pacing and the variant loaded below all follow it.
    model = _line_model(state, voice, engine_id)
    # Every [tag] this model can't perform goes, the lexicons respell, the
    # lead and emotion tags go on (prepare_line_text). Kept in lockstep with
    # `probe_line_cached` — the two derive the same key and any transform added
    # to one has to land in the other or the probe starts lying about what is
    # cached.
    effective_text, delivery = prepare_line_text(state, engine_id, model, text, delivery, lexicons)
    # A description voice speaks with a fixed seed when none is set — one voice, not a new one
    # per line (§13.3). Before the cache key, so the key holds the seed the audio was made with
    # (the probe and the render apply it alike).
    if seed is None and voice and is_description_voice(state, voice):
        seed = description_seed(voice)

    # Cache lookup. The key holds what the lexicons CHANGED in this line — the
    # respelt text, and the IPA for its own words (in the delivery) — never
    # which lexicons were attached. It held their ids until 2026-09-30, so
    # choosing a lexicon on Overview re-rendered every line of the book.
    cache_enabled = use_cache and settings.cache.enabled
    native = speed_native(state, engine_id, model)
    cache_key = _inputs_key(engine_id, voice, effective_text, language, seed, delivery, native, effects)

    cache = getattr(state, "_render_cache", None)
    if cache_enabled and cache is not None:
        cached = cache.get(cache_scope, cache_key)
        if cached:
            sr, ch, pcm = unpack_pcm_with_format(cached)
            return RenderedLine(
                pcm=pcm, sample_rate=sr, channels=ch, effective_delivery=delivery,
                inputs_key=cache_key, seed=seed, engine=engine_id, model=model,
            )

    # Auto-load on first synthesize + the per-door synth call. Registry
    # backends keep their object door; managed engines load through the
    # manager and synth via its HTTP proxy.
    if engine is not None:
        if not engine.ready():
            try:
                engine.load("auto", None)
                state.engines.set_current(engine_id)
            except Exception as e:
                raise bad_request(
                    f"engine '{engine_id}' failed to load on first use: {e}. "
                    f"Try POST /v1/engines/{engine_id}/load with explicit device + model_variant."
                )

        def _synth_piece(piece: str) -> tuple[bytes, int | None, int]:
            out = engine.synthesize(
                SynthRequest(
                    voice_id=voice,
                    text=piece,
                    language=language,
                    delivery=delivery,
                    seed=seed,
                )
            )
            if not out.is_wav_container:
                return out.bytes, out.sample_rate, out.channels
            # A provider's WAV header is authoritative — its `sample_rate` is a
            # placeholder (external_openai.py). Read from it here until
            # 2026-10-02, a 44.1 kHz WAV would have been labelled 24 kHz and
            # played back slowed and lowered.
            fmt, offset, size = parse_wav_header(out.bytes)
            return out.bytes[offset:offset + size], fmt.sample_rate, fmt.channels
    else:
        from .engines.manager import get_manager

        from .voice_model import ModelUnavailable, ensure_model_loaded

        mgr = get_manager()
        # The voice's own model, in the size AI Settings chose — a Turbo clone
        # loads Turbo even while Multilingual is resident (2026-10-03). Pocket
        # has one model per language, so the line's language picks it.
        try:
            ensure_model_loaded(engine_id, model, language)
        except ModelUnavailable as e:
            raise bad_request(str(e))
        except Exception as e:
            raise bad_request(
                f"engine '{engine_id}' failed to load on first use: {e}. "
                f"Load it on the Engines tab first, or POST /v1/engines/{engine_id}/load."
            )
        voice_fields = voice_synth_fields(state, state.voices.get(voice))

        def _synth_piece(piece: str) -> tuple[bytes, int | None, int]:
            audio_bytes, meta = mgr.synth(
                engine_id,
                {
                    "voice_id": voice,
                    "text": piece,
                    "language": language,
                    "delivery": delivery,
                    "seed": seed,
                    **voice_fields,
                },
            )
            piece_pcm = (
                strip_wav_header(audio_bytes) if meta.get("is_wav_container") else audio_bytes
            )
            return piece_pcm, meta.get("sample_rate") or 24000, meta.get("channels") or 1

    # Phase 3: chunked generation for long-form input. Below the threshold,
    # use the single-shot fast path. Above, split at sentence boundaries +
    # crossfade-blend the per-chunk audio.
    # Each model's own piece length (audit 2026-10-04 §13.3) — its working memory grows with
    # the line, and the price its load was checked against was measured at this length.
    max_chunk_chars = line_split_chars(state, engine_id, voice)
    crossfade_ms = int(getattr(settings.generation, "crossfade_ms", 50))

    if len(effective_text) > max_chunk_chars:
        chunks = split_text_into_chunks(effective_text, max_chars=max_chunk_chars)
        pieces: list[tuple[bytes, int, int]] = []
        for piece in chunks:
            try:
                piece_pcm, piece_sr, piece_ch = _synth_piece(piece)
            except (TermsRequired, EngineRequestError) as e:
                raise e.api_error() from e
            except Exception as e:
                raise internal(f"engine synthesize (chunked): {e}")
            pieces.append((piece_pcm, piece_sr or 22050, piece_ch))
        # Every seam by chunked.PIECE_JOIN_*, in the DSP program — even one piece, which comes
        # back through the same float round trip the numpy join gave it.
        pcm = dsp_client.join(pieces, crossfade_ms)
        out_sample_rate = pieces[-1][1]
        out_channels = pieces[-1][2]
    else:
        try:
            pcm, out_sample_rate, out_channels = _synth_piece(effective_text)
        except (TermsRequired, EngineRequestError) as e:
            raise e.api_error() from e
        except Exception as e:
            raise internal(f"engine synthesize: {e}")

    # Speed (when the model did not pace itself), gain, pitch — the same
    # function Generate calls — then the effects chain on top of the finished
    # line (shape_line_pcm).
    pcm = shape_line_pcm(pcm, out_sample_rate, out_channels, delivery, speed_native=native, effects=effects)

    # Cache write
    if cache_enabled and cache is not None:
        cache.put(cache_scope, cache_key, pack_pcm_with_format(pcm, out_sample_rate, out_channels))

    return RenderedLine(
        pcm=pcm,
        sample_rate=out_sample_rate,
        channels=out_channels,
        effective_delivery=delivery,
        inputs_key=cache_key,
        seed=seed,
        engine=engine_id,
        model=model,
    )


def pcm_to_wav(rl: RenderedLine) -> bytes:
    return write_wav_container(rl.pcm, rl.sample_rate, rl.channels)


#: A take's own silence at either end is cut at the join, down to TRIM_KEEP_MS
#: (decided 2026-10-07): models pad — Kokoro ~265 ms before and ~715 ms after, exact
#: digital zero — so a 600 ms pause played as ~1.6 s, uneven by line. Only what is
#: quieter than TRIM_BELOW_DBFS goes, so a word's quiet tail never does (−45 dBFS
#: cut up to 710 ms of one). The take itself is never changed.
TRIM_BELOW_DBFS = -70.0
TRIM_KEEP_MS = 50


def _pause_ms(line: RenderedLine, key: str) -> int | None:
    """`pause_before` / `pause_after` off a rendered line's delivery."""
    raw = (line.effective_delivery or {}).get(key)
    if raw is None:
        return None
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return None


def concat_lines(lines: list[RenderedLine], silence_ms: int = 250) -> RenderedLine:
    """Concatenate rendered lines with silence between them.

    `silence_ms` is the project's gap. A line's own `pause_after` and the next
    line's `pause_before` override it for that join: blank means "as the
    project", a value means this join is special — the same
    only-show-what-differs rule the line table uses.

    Each line's own silence at either end is trimmed first (TRIM_BELOW_DBFS,
    TRIM_KEEP_MS; 2026-10-07), so the gap is the pause heard.

    Until 2026-08-17 this used the project gap unconditionally, so every
    per-line pause in the app — the Generate slider, the delivery overlay, and
    the `pause_after_ms` every import adapter parses — was stored and silently
    ignored.

    Lines from engines with different sample rates or channel counts are
    brought to the chapter's highest rate and channel count before joining
    (polyphase resampling), so no line loses quality. Until 2026-10-02 this
    docstring said it resampled while the code appended a mismatched line raw
    — harmless while every engine rendered 24 kHz mono, wrong the moment
    VoxCPM2 (48 kHz) spoke one character in a chapter: half speed, an octave low.
    """
    if not lines:
        raise ValueError("no lines")
    sr = max(line.sample_rate for line in lines)
    ch = max(line.channels for line in lines)
    out_pcm = io.BytesIO()

    def silence(ms: int) -> bytes:
        return b"\x00\x00" * (int((ms / 1000) * sr) * ch)

    for i, line in enumerate(lines):
        if i > 0:
            after = _pause_ms(lines[i - 1], "pause_after")
            before = _pause_ms(line, "pause_before")
            gap = silence_ms if after is None and before is None else (after or 0) + (before or 0)
            if gap > 0:
                out_pcm.write(silence(gap))
        # Trimmed, then brought to the chapter's rate and channels — one request per line.
        out_pcm.write(dsp_client.fit(
            line.pcm, line.sample_rate, line.channels, sr, ch,
            trim_below_dbfs=TRIM_BELOW_DBFS, trim_keep_ms=TRIM_KEEP_MS,
        ))
    return RenderedLine(
        pcm=out_pcm.getvalue(),
        sample_rate=sr,
        channels=ch,
        effective_delivery={},
    )
