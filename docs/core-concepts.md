# Core concepts

JustVoice's data model is generic on purpose. The five use cases share one tree shape; only the labels change.

## The tree

    Project  →  Scene  →  Block  →  Take

| In an audiobook | In a game | In a podcast |
|---|---|---|
| Book | Voice line set | Episode |
| Chapter | Scene / Quest | Segment |
| Paragraph | Voiceline | Block |

The terminology helper (`useCopy()`) renders the right word automatically based on the use case you picked at first launch.

## Project

The top-level container. Has a `project_type` (audiobook / game_voicelines / podcast / custom), an `imported_from` provenance tag, and a default mastering preset. Its **speakers** live here — the people in it (see below).

## Speaker

A person in one project: a **name**, the other names the text uses (**Also called**), their **Pronouns** (he/him, she/her, they/them, it/its, or not set), and **Who they are** — what the AI reads for attribution and for rewriting a line as the speaker would say it, never heard. Discover finds speakers, Script gives lines to them, and Cast gives each one a **persona** to speak with. Names are unique within a project — adding or renaming into a clash is refused (an import keeps the source's people as they are). One speaker can be the project's **narrator**, who reads everything outside quote marks; no project gets one on its own. Deleting a project deletes its speakers.

## Scene

A subdivision. Chapters for audiobooks, quests or dialogue sets for games, episodes or segments for podcasts. Ordered by `position`.

## Block

The smallest renderable unit. Holds the **text** that becomes audio, an optional **speaker_id** (who's speaking), and an optional **direction** (delivery hint — e.g. "with growing dread"). Auto-attribution from prose runs at the Block level via the Script tab — see [Studio → Script](studio.md#script) and [personas.md](personas.md).

## Take

A rendered audio version of a Block, kept with the seed and everything else it was made from. Every render makes a new take and nothing is overwritten; one take per Block is the **★ take**, the one the chapter plays and the export ships. When something the ★ take was made from changes, the Block is **stale** until you render it again. See [Studio → Render](studio.md#render).

## Voices, Personas, Lexicons — the three orthogonal layers

- **Voice** = a TTS profile (cloned / preset / designed / blended). The thing the engine actually speaks with.
- **Persona** = a finished spoken voice: a voice (which carries the model that speaks it), plus language, pace, pitch, gain, pauses, the model's own direction and sampling settings, effects, an optional lexicon, and a short **note on how it sounds**. It lives in your library, plays any number of speakers in any project, and is edited on its own page ([Personas](personas.md#the-personas-page)). Its **Style Instructions** become the TTS `instruct` for engines that take direction; its **note** is what Compose/Rewrite on its page (preview-then-accept — never an automatic render-time rewrite) and Smart-assign read.
- **Lexicon** = a pronunciation dictionary. Maps "Beauchamp" → "BEE-chum" before TTS sees it.

These compose. A Block's speaker is played by a persona; the persona has a voice and can carry effects and a lexicon override. Every Block render follows **line → speaker → persona → voice**, and stops on a line with no speaker, a speaker with no persona, or a persona with no voice.

## Lists

Every list in the app is the same grid, so what you learn on one page holds on
all of them:

- **Any column heading sorts.** Click once for ascending, again for descending.
  Lists that group their rows — game lines under their scene, adapters under
  built-in and trained — sort *within* the whole list, so a sort still finds
  what you are looking for.
- **An empty list says why it is empty** in its own body, in the words that fit
  that screen — "No webhooks. Add one below." — rather than showing an empty
  frame under a header.
- **Row state is on the row.** A voice whose engine is gone dims; the voice
  playing right now is tinted; an excluded chapter dims and strikes through its
  title.

## Mastering

Every render can go through a mastering preset on the way out. ACX (-20 LUFS / -3.5 dB peak / -60 dB noise floor) is the audiobook spec. See [mastering.md](mastering.md).
