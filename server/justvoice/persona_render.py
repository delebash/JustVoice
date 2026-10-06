# SPDX-License-Identifier: MIT
"""One resolver: a persona and a line → the request every render sends.

A persona is a finished spoken voice: a voice (which carries its model) plus
everything about how it speaks — its language, pace, pitch, gain, pauses, the
model's own direction (written direction and emotion, or tags), the model's
own sampling settings and seed, effects and a lexicon
(docs/plans/2026-10-03-persona-redesign.md §6.1).

Until 2026-10-03 four render paths built that request four ways: the chapter
render merged the persona's delivery and composed its direction, a line's
re-render (Lines ↻, takes, the game export) sent the raw delivery and dropped
the direction, Generate ignored the persona's voice, and nothing sent the
persona's language or seed. Every path now asks `plan_line`, so what you hear
in the persona editor is what the chapter contains (plan §6.2 Q7).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .audio.effects import chain_entries
from .delivery_merge import compose_instruct, merge_delivery, nest_engine_keys
from .models import EMOTION_VALUES, PersonaDelivery

# Kept on the persona for every model: done on the server after synthesis.
SHARED_KEYS = ("speed", "pitch", "gain_db", "pause_before", "pause_after")


# The persona editor's "Stock line" and what an empty Listen speaks: the
# mock's own line (`_s7`), in the persona's language where one is written
# here, else in English.
STOCK_LINES = {
    "en": "The fog came in over the pier before either of them said a word.",
    "es": "La niebla llegó sobre el muelle antes de que ninguno de los dos dijera una palabra.",
    "fr": "Le brouillard est arrivé sur la jetée avant que l'un d'eux ne dise un mot.",
    "de": "Der Nebel zog über den Pier, bevor einer von beiden ein Wort sagte.",
    "it": "La nebbia arrivò sul molo prima che uno dei due dicesse una parola.",
    "pt": "A névoa chegou ao cais antes que qualquer um deles dissesse uma palavra.",
    "nl": "De mist trok over de pier voordat een van beiden een woord zei.",
    "ru": "Туман накрыл пристань прежде, чем кто-либо из них успел сказать хоть слово.",
    "ja": "二人のどちらかが口を開く前に、霧が桟橋に流れ込んできた。",
    "zh": "他们俩还没开口，雾就已经漫过了码头。",
    "ko": "둘 중 누구도 말을 꺼내기 전에 안개가 부두 위로 밀려왔다.",
}


def stock_line(language: str | None) -> str:
    from .voice_model import base_lang

    return STOCK_LINES.get(base_lang(language), STOCK_LINES["en"])


@dataclass
class LinePlan:
    voice: str | None
    model: str | None
    text: str
    language: str | None
    # Delivery-shaped: speed, pitch, gain_db, pauses, emotion, instruct, tags,
    # temperature, and the model's own knobs under `engine`.
    delivery: dict[str, Any] = field(default_factory=dict)
    seed: int | None = None
    effects: list[dict] = field(default_factory=list)
    lexicons: list[str] = field(default_factory=list)


def _row(model: str | None):
    if not model:
        return None
    from .engines.capability_details import lookup

    row = lookup(model)
    return row if row is not None and row.engine_id == model else None


def _tagsets(model: str | None) -> dict[str, Any]:
    row = _row(model)
    return {t.category: t for t in (row.inline_tags if row is not None else [])}


def emotion_choices(model: str | None) -> list[str]:
    """The emotions a persona on `model` can pick from: the model's own
    emotion tags (Turbo's seven), or the app's nine where the model takes
    written direction, or none."""
    sets = _tagsets(model)
    if "emotion" in sets:
        return list(sets["emotion"].tags)
    row = _row(model)
    if row is not None and row.supports_instruct_freeform:
        return list(EMOTION_VALUES)
    return []


def register_choices(model: str | None) -> list[str]:
    sets = _tagsets(model)
    return list(sets["register"].tags) if "register" in sets else []


def knob_specs(model: str | None) -> dict[str, Any]:
    """The model's own knobs, minus Speed (the persona's shared Pace) and Seed
    (its own field)."""
    row = _row(model)
    if row is None:
        return {}
    return {k.key: k for k in row.knobs if k.key not in ("speed", "seed")}


def check_delivery(delivery: PersonaDelivery) -> list[str]:
    """Every value a model would not understand, as sentences — empty when
    the delivery is valid. A model's settings are checked against THAT
    model, whichever voice the persona has now (values are kept per model)."""
    problems: list[str] = []
    for model, ms in delivery.models.items():
        row = _row(model)
        if row is None:
            problems.append(f"{model} is not a speech model")
            continue
        name = row.display_name
        specs = knob_specs(model)
        for key, value in ms.knobs.items():
            spec = specs.get(key)
            if spec is None:
                problems.append(f"{name} has no {key} setting")
            elif not (spec.min <= value <= spec.max):
                problems.append(f"{name}'s {spec.label} runs {spec.min:g}–{spec.max:g}; {value:g} is outside it")
        if ms.emotion is not None and ms.emotion not in emotion_choices(model):
            problems.append(f"{name} has no emotion called {ms.emotion!r}")
        if ms.register_tag is not None and ms.register_tag not in register_choices(model):
            problems.append(f"{name} has no register called {ms.register_tag!r}")
    return problems


def _persona_delivery(persona) -> PersonaDelivery:
    dd = getattr(persona, "default_delivery", None)
    if isinstance(dd, PersonaDelivery):
        return dd
    return PersonaDelivery.model_validate(dd or {})


def model_settings(persona, model: str | None, line: dict | None = None) -> tuple[dict[str, Any], list[str], int | None]:
    """(delivery, tags, seed) the persona sets for `model`.

    The shared values first (pace, pitch, gain, pauses), then that model's
    own: its knobs (nested as the engines read them), its emotion — words for
    a written-direction model, a tag for a tag model — its register tag, and
    its seed. A model the persona has no settings for gets the shared values
    and nothing else. `line` is a line's own settings for this model
    (`line_takes.line_models`, 2026-10-06): its knobs, emotion and register
    win over the persona's; an emotion or register of "" is none on that line."""
    pd = _persona_delivery(persona)
    out: dict[str, Any] = {k: getattr(pd, k) for k in SHARED_KEYS if getattr(pd, k) is not None}
    tags: list[str] = []
    ms = pd.models.get(model) if model else None
    knobs = dict(ms.knobs) if ms is not None else {}
    emotion = ms.emotion if ms is not None else None
    register = ms.register_tag if ms is not None else None
    seed: int | None = ms.seed if ms is not None else None
    if line:
        knobs.update(line.get("knobs") or {})
        if "emotion" in line:
            emotion = line["emotion"] or None
        if "register_tag" in line:
            register = line["register_tag"] or None
    out.update(knobs)
    if emotion:
        if "emotion" in _tagsets(model):
            tags.append(emotion)
        else:
            out["emotion"] = emotion
    if register:
        tags.append(register)
    return nest_engine_keys(out), tags, seed


def persona_language(persona, vm, own: str | None = None) -> str | None:
    """The language the persona speaks (decided 2026-10-03: "we need to let
    user know this persona is speaking japanese or engilish").

    Where the voice or its model allows one language (a Kokoro voice, Kitten,
    Turbo) that is the answer. Otherwise the persona's own choice when the
    model speaks it, else the voice's own language (`own`), else the model's
    first."""
    from .voice_model import speaks_language

    chosen = (getattr(persona, "language", None) or "").strip() or None
    if vm is None:
        return chosen
    if len(vm.speaks) == 1:
        return vm.speaks[0]
    if chosen and (not vm.speaks or speaks_language(vm, chosen)):
        return chosen
    if own and (not vm.speaks or speaks_language(vm, own)):
        return own
    return vm.speaks[0] if vm.speaks else chosen


@dataclass(frozen=True)
class Candidate:
    """An unsaved voice heard through a persona — the persona page's Clone,
    Design and Blend makers (2026-10-04): the model it would speak on
    (`voice_model.describe`), its description when it is a design, and its own
    language."""

    vm: Any
    design_prompt: str | None = None
    language: str | None = None


def plan_line(
    state: Any,
    persona,
    *,
    text: str,
    direction: str | None = None,
    book_lexicon: str | None = None,
    request_delivery: dict[str, Any] | None = None,
    voice: str | None = None,
    candidate: Candidate | None = None,
    line_models: dict | None = None,
) -> LinePlan:
    """The request one line spoken by `persona` renders with.

    `voice` overrides the persona's (Generate speaking a persona's settings
    on its own voice pick); `candidate` stands in for a voice not saved yet
    (the plan's `voice` is then None); `request_delivery` sits on top of the persona's
    delivery (a Compare value, a line's override in Slice 4); `direction` is
    the line's own written direction, added after the persona's; `line_models`
    is a line's own settings per model — the one for this model wins over the
    persona's (2026-10-06).

    The written direction is composed most specific last, for every model
    and dropped by the ones that take none (slot.py): a clip-less designed
    voice's description, the persona's standing delivery (or an explicit
    instruct in the request), its emotion, the line's direction.
    """
    from .render_core import line_lexicons, voice_design_instruct_for_id
    from .voice_model import voice_language, voice_model

    if candidate is not None:
        voice_id = None
        vm = candidate.vm
        design = candidate.design_prompt
        own_language = candidate.language
    else:
        voice_id = voice or getattr(persona, "voice_id", None) or None
        vm = voice_model(state, voice_id) if voice_id else None
        design = voice_design_instruct_for_id(state, voice_id)
        own_language = voice_language(state, voice_id)
    model = vm.model if vm is not None else None

    persona_delivery, tags, seed = model_settings(persona, model, (line_models or {}).get(model) if model else None)
    request = dict(request_delivery or {})
    if request.get("seed") is not None:
        seed = request.pop("seed")
    else:
        request.pop("seed", None)
    delivery = merge_delivery(request, tier2_overlay=persona_delivery)
    if tags and "tags" not in request:
        delivery["tags"] = tags

    standing = (getattr(persona, "voice_instruct", None) or "").strip() or None
    composed = compose_instruct(
        design,
        delivery.get("instruct") or standing,
        delivery.get("emotion"),
        (direction or "").strip() or None,
    )
    if composed:
        delivery["instruct"] = composed

    return LinePlan(
        voice=voice_id,
        model=model,
        text=text,
        language=persona_language(persona, vm, own_language),
        delivery=delivery,
        seed=seed,
        effects=chain_entries(getattr(persona, "effects_chain", None)),
        lexicons=line_lexicons(book_lexicon, getattr(persona, "lexicon_id", None)),
    )
