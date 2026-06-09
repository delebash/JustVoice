# Personas

A **persona** is a named character — name, role, gender, pronouns, aliases, plus an optional personality prompt for LLM rewrite and an optional lexicon override. Each persona maps to a Voice (see [voices.md](voices.md)).

## Why personas exist (vs just using voices)

In an audiobook with 8 characters, "voice profile" and "character" are not the same thing. Two characters can share a voice (Twin A and Twin B use the same Chatterbox clone with different exaggeration tweaks). One character can use different voices in different chapters (flashback Mara at age 12 vs present-day Mara).

The Persona layer holds the **character bio**, the **voice mapping** (which can change), and per-character delivery overrides. It survives voice changes.

## Fields

| Field | Used for |
|---|---|
| Name | Display in cast lists, in Script tab attribution dropdowns. |
| Role | Smart-assign uses this to match voice age/tone. |
| Gender / Pronouns | Smart-assign — matching voices on the gender axis. Speaker-attribution prompt context. |
| Aliases | "Mara", "she", "the detective" all attribute to the same persona. Set explicit aliases to keep the LLM consistent across chapters. |
| Personality | A short prose description used by the LLM-rewrite step (if enabled) — rewrites generated text "in character" before TTS. |
| Engine override | Per-persona engine selection. Useful when one character sounds best in Chatterbox while the rest use Kokoro. |
| Lexicon override | A persona-scoped lexicon (e.g. street slang for Old Crow). Overrides any project-level lexicon for this character only. |

## LLM rewrite

When enabled on a persona, every generated line for that persona goes through an LLM with the persona's personality prompt before TTS. The model rewrites the line in voice — adding mannerisms, contractions, characteristic phrases. Useful when the manuscript prose narrates dialogue plainly and you want the audio to carry more character.

Costs an LLM call per block; configure the model in Settings → Capture (the same LLM that drives refinement + Smart-assign).

## Auto-create from JustWrite (and other imports)

When you import a manuscript, every character in the source becomes a Persona automatically, keyed on `(imported_from, imported_id)`. Re-importing the same source uses the existing persona rows instead of creating duplicates. See [import-formats.md](import-formats.md).

## Smart-assign

The Cast tab's **Smart-assign** button sends every character + every voice to your LLM and asks for the best mapping. Pre-flight:

1. Click ❓ chips in the voice library → cycle to set gender on any unset voices.
2. Confirm Gender + Pronouns on every main persona.
3. Then click Smart-assign.

Smart-assign is a starting point — review every assignment before rendering. Voices from different providers can coexist in one cast (OpenAI's voice for the protagonist, Kokoro for villagers, Chatterbox clone for the narrator).
