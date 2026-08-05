# SPDX-License-Identifier: MIT
"""Seed data for the SHARED `feature_prompts` table — every JustVoice AI action
as a template row (ruling 9, 2026-08-05: EVERYTHING is a template row, nothing
hardcoded — code computes variable VALUES, rows own the WORDING, presets own
every tunable).

Passed to `install_llm(feature_prompts=…)` (app.py). Same shape as JustWrite's
`seed_feature_prompts.py`: keyed by ACTION id, carrying feature / system /
user_template / the JSON CONTRACT (json_mode; tunables live on presets —
`seed_presets.py`). Insert-if-missing; a row the user edited in the Lab is
never clobbered, and rows migrated from the retired `jv_feature_prompts` table
land FIRST (engines/llm/migrate_prompts.py) so edits win over these defaults.

Placeholder style is the shared renderer's `{{var}}` (fail-loud on absence).
The attribution user template converts the old single-brace `.replace` tokens;
the previously code-built user messages (smart_assign, preset_suggest,
show_notes, identify, compose, persona_rewrite) become templates here, with
their callers passing the SAME formatted blocks as variables.

System texts import from their measured homes (extraction/prompts.py,
extraction/identify.py, refinement.py, database/seed.py) — one source, no text
forks. compose / persona_rewrite texts moved here from personas_api.py's
f-strings; voice_gender is the one NEW prompt (feature ships in Phase 3).
"""

from __future__ import annotations

from .database.seed import (
    _PRESET_SUGGEST_SYSTEM,
    _SHOW_NOTES_SYSTEM,
    _SMART_ASSIGN_SYSTEM,
)
from .extraction.identify import IDENTIFY_SYSTEM
from .extraction.prompts import DIRECT_SYSTEM, GUIDED_SYSTEM
from .refinement import (
    _BASE_INSTRUCTIONS,
    _PRESERVE_TECHNICAL,
    _SELF_CORRECTION,
    _SMART_CLEANUP,
)

# The attribution user template — extraction/prompts.py's USER_TEMPLATE with the
# three .replace tokens converted to the shared {{var}} form (the pipeline now
# passes format_characters/format_corrections/format_paragraphs output as
# variables instead of substituting inline).
_ATTR_USER_TEMPLATE = """Characters in this scene:
{{characters}}
{{corrections}}
Paragraphs (dialogue segments tagged inline):

{{paragraphs}}

Return only the JSON array, one entry per [D#] in the order they appear.
"""

# refine.base carries the no-sections fallback IN THE ROW (ruling 9: retiring
# build_refinement_prompt's hardcoded fallback line by construction — with no
# section rows appended, the base alone still states the identity behavior).
_REFINE_BASE_SYSTEM = _BASE_INSTRUCTIONS + """

If no transformation sections follow, return the transcript unchanged."""

# compose / persona_rewrite — verbatim from personas_api.py's f-strings
# (2026-08-05), the persona's personality lifted to a {{personality}} slot.
_COMPOSE_SYSTEM = """You are voicing a character. Their personality:

{{personality}}

Write a single, fresh in-character line they would say. Reply with the line only — no quotes, no preamble, no narration."""

_PERSONA_REWRITE_SYSTEM = """Rewrite the user's line in this character's voice.

Character personality:
{{personality}}

Rules:
- Preserve the line's meaning.
- Match the character's diction, rhythm, vocabulary, accent markers.
- Reply with the rewritten line only — no quotes, no preamble, no narration, no explanation."""

# voice_gender — the ONE new prompt (Phase 3 wires the feature; the row seeds
# now so the Lab can shape it first). Object output → json_mode on.
_VOICE_GENDER_SYSTEM = """You label voice names by apparent gender for a text-to-speech catalog.

Given voice names (each with any description the catalog carries), return a JSON object mapping each EXACT input name to "male", "female", or "unknown". Use widely known name conventions; when a name is ambiguous, invented, or not a personal name, return "unknown" — never guess from how a word sounds.

Return only the JSON object. No prose, no preamble."""


DEFAULT_FEATURE_PROMPTS: dict[str, dict] = {
    # ── speaker_attribution (the pipeline's tier pair + discovery) ──────────
    # Array outputs → json_mode stays OFF (json_object constrains to an OBJECT;
    # the tolerant array extraction is the measured contract).
    "speaker_attribution.guided": {
        "feature": "speaker_attribution",
        "system": GUIDED_SYSTEM,
        "user_template": _ATTR_USER_TEMPLATE,
    },
    "speaker_attribution.direct": {
        "feature": "speaker_attribution",
        "system": DIRECT_SYSTEM,
        "user_template": _ATTR_USER_TEMPLATE,
    },
    # Discovery ("who exists?") — renamed from the old bare `identify` key to
    # the family dotted spelling; the migration maps old rows across.
    "speaker_attribution.identify": {
        "feature": "speaker_attribution",
        "system": IDENTIFY_SYSTEM,
        "user_template": """Known characters:
{{known_characters}}

Manuscript text:
{{manuscript}}""",
    },
    # ── casting / production helpers ────────────────────────────────────────
    "smart_assign": {
        "feature": "smart_assign",
        "system": _SMART_ASSIGN_SYSTEM,
        "user_template": """Characters:
{{characters}}

Available voices:
{{voices}}

Return only the JSON object.""",
        "json_mode": True,
    },
    "render_preset_suggest": {
        "feature": "render_preset_suggest",
        "system": _PRESET_SUGGEST_SYSTEM,
        "user_template": """Available presets:
{{presets}}

Chapter text:
{{chapter_text}}

Return only the JSON object.""",
        "json_mode": True,
    },
    "show_notes": {
        "feature": "show_notes",
        "system": _SHOW_NOTES_SYSTEM,
        "user_template": "{{script}}",
    },
    # ── persona voice features ──────────────────────────────────────────────
    "compose": {
        "feature": "compose",
        "system": _COMPOSE_SYSTEM,
        "user_template": "Compose a line.",
    },
    "persona_rewrite": {
        "feature": "persona_rewrite",
        "system": _PERSONA_REWRITE_SYSTEM,
        "user_template": "{{text}}",
    },
    # ── dictation cleanup — the ×4 composition (ruling 9) ──────────────────
    # Production concatenates base + the enabled sections' system texts and runs
    # through run_action's explicit-system door; each row carries its OWN
    # {{transcript}} user half so the Lab tests every PART standalone.
    "refine.base": {
        "feature": "refine",
        "system": _REFINE_BASE_SYSTEM,
        "user_template": "{{transcript}}",
    },
    "refine.smart_cleanup": {
        "feature": "refine",
        "system": _SMART_CLEANUP,
        "user_template": "{{transcript}}",
    },
    "refine.self_correction": {
        "feature": "refine",
        "system": _SELF_CORRECTION,
        "user_template": "{{transcript}}",
    },
    "refine.preserve_technical": {
        "feature": "refine",
        "system": _PRESERVE_TECHNICAL,
        "user_template": "{{transcript}}",
    },
    # ── voices ──────────────────────────────────────────────────────────────
    "voice_gender": {
        "feature": "voice_gender",
        "system": _VOICE_GENDER_SYSTEM,
        "user_template": """Voices:
{{voices}}

Return only the JSON object.""",
        "json_mode": True,
    },
}
