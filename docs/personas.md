# Personas

A **persona** is a named character: a voice, a note on how they sound, a note on who they are, and optional delivery / effects / lexicon overrides. Each persona maps to a Voice (see [voices.md](voices.md)).

## Why personas exist (vs just using voices)

In an audiobook with 8 characters, "voice profile" and "character" are not the same thing. Two characters can share a voice (Twin A and Twin B use the same Chatterbox clone with different exaggeration tweaks). One character can use different voices in different chapters (flashback Mara at age 12 vs present-day Mara).

The Persona layer holds the **character sheet**, the **voice mapping** (which can change), and per-character delivery overrides. It survives voice changes.

## The Narrator

Audiobook and podcast projects get a persona called **Narrator** the moment
they're created — whether you started the project by hand or imported one.
It's the voice of everything that isn't spoken: when [Studio ·
Script](studio.md) analyzes a chapter, every stretch of prose outside quote
marks is bound to it.

It behaves like any other persona — rename it, give it a voice, write its two
notes — with one exception: it can't be deleted, because the prose has to
belong to someone. Cast it a voice early; a chapter whose narration has no
voice won't render.

## The editor has two halves

The persona editor is split, and the split is the whole point: **one half
changes what you hear, the other half doesn't.** Before this split a single
"Personality" box did both jobs, so adding a sentence about a character's
childhood could quietly change how they were performed.

### How they sound

Voice, engine override, lexicon override, the delivery overlay, the effects
chain — and **Spoken delivery**, the free-text instruction for engines that
accept one.

### How they're written

**Character sheet** — prose about who the character is. It drives Compose,
Rewrite, casting suggestions and the game-export sidecar, and it **never
reaches the TTS engine**.

## Fields

| Field | Half | Used for |
|---|---|---|
| Name | — | Display in cast lists, in Script tab attribution dropdowns. |
| Language | — | Per-persona language tag. |
| Voice | Sound | Which TTS voice speaks these lines. |
| Spoken delivery | Sound | The `instruct` / style prompt for engines that take direction. How the line is *performed*. |
| Engine override | Sound | Per-persona engine selection. Useful when one character sounds best in Chatterbox while the rest use Kokoro. |
| Lexicon override | Sound | A persona-scoped lexicon (e.g. street slang for Old Crow). Overrides any project-level lexicon for this character only. |
| Default delivery overlay | Sound | Speed / pitch / gain / pause defaults for this character (Tier-2). |
| Effects chain | Sound | Reverb, EQ, compression applied after the TTS renders. |
| Character sheet | Prose | Who they are. Drives Compose / Rewrite, Smart-assign's casting suggestions, and the game-export sidecar. |

> Role, gender, pronouns and aliases are **not** persona fields yet. Smart-assign
> and the attribution prompt accept them, but nothing on the persona supplies
> them — tracked in `docs/dev/TASKS.md`.

## Spoken delivery — the one field that changes the audio

**Spoken delivery** is a short description of how the character speaks. Examples: "Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful moments." or "Eager, optimistic, ends sentences with rising intonation."

**Qwen3-TTS CustomVoice is the only engine that reads it.** It arrives as that model's `instruct` field when JustVoice renders a block voiced by this persona, and the model uses it to adjust *delivery* — pacing, intonation, vocal warmth — without changing the manuscript words. Every other engine ignores the field, including Qwen3 **Base**, which clones but drops the instruction. (This page named LuxTTS here until 2026-08-17; its adapter reads no instruction at all.)

The editor tells you which case you're in: a line under the box names the engine your cast voice uses and says whether it takes direction. Trust that line over any list — it reads the engine's real capability.

The flow is automatic — no checkbox, no extra dispatch. Just write a delivery note, render a chapter, and an instruct-capable engine picks it up.

### How it combines with the line

Spoken delivery is the character's **standing** instruction, not the last word. At render time three things join into the one instruction the engine receives, most specific last:

1. this persona's **Spoken delivery** — who they are
2. the **Emotion** label, if one is set
3. the line's own **direction**, from the Chapters editor's `+ direction` button

So a persona reading *"gravel-voiced harbour-master, always weary"* on a line marked *"shouting over the wind"* arrives as `gravel-voiced harbour-master, always weary. shouting over the wind`. A single hint passes through untouched — nothing reformats a note you wrote by hand.

A render preset's `delivery.instruct` replaces the persona's in that first slot when both are set — useful for a chapter-specific delivery (whispered, intimate) without changing the persona's baseline. The line's direction still rides on the end.

**Emotion is portable in a way this field is not.** Prose only reaches Qwen3; the nine-value Emotion label also compiles into a tag for Chatterbox Turbo, so it survives recasting a character onto a cloning engine. See [generate.md](generate.md) and [engines.md](engines.md).

## Character sheet — the prose half

The sheet is what the LLM features read, and nothing else:

### Compose 🎲 and Rewrite ✏️

The character sheet is the system prompt for both:

- **Generate view** — type a line, click ✏️ Rewrite. The LLM rewrites the line in the persona's voice. A preview appears; accept to replace the textarea, discard to keep the original.
- **Studio Script tab** — right-click a dialogue row attributed to a persona. Same preview-then-accept flow; accepted text replaces the block's text. The block is marked with a ✨ icon so you can spot rewritten blocks later.

Both refuse with a clear message when the sheet is empty — there is nothing to write in the voice of.

Rewrite is always explicit — never auto-applied at render time. The manuscript words are sacred unless you ask for a rewrite and accept it.

Routes through your AI Features pin for `persona_rewrite` (see `ai-features.md`).

### Casting

Smart-assign sends the first 200 characters of each sheet to the LLM as that character's description (see below).

## Auto-create from JustWrite (and other imports)

When you import a manuscript, every character in the source becomes a Persona automatically, keyed on `(imported_from, imported_id)`. Re-importing the same source uses the existing persona rows instead of creating duplicates. See [Import & export](import-and-export.md).

**What an import fills.** Everything the source knows about a character is
sheet material, so it all lands in the **character sheet**: the one-liner and
any aliases, followed by a `Voice hint:` block carrying gender, age and role.
The **Spoken delivery** box starts **empty** — "female, age 34, protagonist"
is a casting hint, not a direction to the TTS, and guessing one would change
how your book sounds without you asking. That box is yours to write.

## Smart-assign

The Cast tab's **Smart-assign** button sends every character + every voice to your LLM and asks for the best mapping. Pre-flight:

1. Click ❓ chips in the voice library → cycle to set gender on any unset voices.
2. Confirm Gender + Pronouns on every main persona.
3. Then click Smart-assign.

Smart-assign is a starting point — review every assignment before rendering. Voices from different providers can coexist in one cast (OpenAI's voice for the protagonist, Kokoro for villagers, Chatterbox clone for the narrator).
