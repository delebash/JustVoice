# Core concepts

JustVoice's data model is generic on purpose. The five use cases share one tree shape; only the labels change.

## The tree

    Project  →  Scene  →  Block  →  Take

| In an audiobook | In a game | In a podcast |
|---|---|---|
| Book | Voice line set | Episode |
| Chapter | Scene / Quest / NPC | Segment |
| Paragraph | Voiceline | Block |

The terminology helper (`useCopy()`) renders the right word automatically based on the use case you picked at first launch.

## Project

The top-level container. Has a `project_type` (audiobook / game_voicelines / podcast / custom), an `imported_from` provenance tag, a default mastering preset, and an optional default render preset. Cast (Personas assigned to the project) lives here.

## Scene

A subdivision. Chapters for audiobooks, quests or dialogue sets for games, episodes or segments for podcasts. Ordered by `position`.

## Block

The smallest renderable unit. Holds the **text** that becomes audio, an optional **persona_id** (who's speaking), and an optional **direction** (delivery hint — e.g. "with growing dread"). Auto-attribution from prose runs at the Block level via the Script tab — see [take-versioning.md](take-versioning.md) and [personas.md](personas.md).

## Take

A rendered audio version of a Block. Multiple takes per Block; one is the **default** (rendered). Source-lineage chains preserved via `source_take_id` so you can see how Take 4 (with effects) came from Take 3 (regenerate) which came from Take 2 (original). See [take-versioning.md](take-versioning.md).

## Voices, Personas, Lexicons — the three orthogonal layers

- **Voice** = a TTS profile (cloned / preset / designed / blended). The thing the engine actually speaks with.
- **Persona** = a named character bound to a voice. Optional LLM-rewrite prompt that rewrites generated text "in character." Optional lexicon override.
- **Lexicon** = a pronunciation dictionary. Maps "Beauchamp" → "BEE-chum" before TTS sees it.

These compose. A persona has a voice; the voice can have effects; the persona can have a lexicon override; all three are queried for every Block render.

## Mastering

Every render can go through a mastering preset on the way out. ACX (-20 LUFS / -3.5 dB peak / -60 dB noise floor) is the audiobook spec. See [mastering.md](mastering.md).
