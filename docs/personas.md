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
| Personality | A short prose description. Drives the explicit Compose/Rewrite flows (preview-then-accept — never applied automatically at render time) and the voice's TTS delivery instruction. |
| Engine override | Per-persona engine selection. Useful when one character sounds best in Chatterbox while the rest use Kokoro. |
| Lexicon override | A persona-scoped lexicon (e.g. street slang for Old Crow). Overrides any project-level lexicon for this character only. |

## Personality field — two distinct uses

The **Personality** field on a persona is a short description of how the character speaks. Examples: "Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful moments." or "Eager, optimistic, ends sentences with rising intonation."

It feeds two completely different surfaces:

### 1. TTS delivery instruction (automatic at render time)

Engines that accept a freeform style prompt (Qwen3-TTS, LuxTTS) receive the persona's personality as their `instruct` field when JustVoice renders a block voiced by that persona. The TTS model uses it to adjust *delivery* — pacing, intonation, vocal warmth — without changing the manuscript words.

Engines that don't accept freeform instructions (Kokoro, Chatterbox) ignore the field at render time.

The flow is automatic — no checkbox, no extra dispatch. Just write a personality, render a chapter, and instruct-capable engines pick it up.

A render preset's `delivery.instruct` overrides the persona's personality when both are set — useful when you want a chapter-specific delivery (whispered, intimate) without changing the persona's baseline.

### 2. Rewrite — explicit LLM tool (Generate + Studio Script)

The persona's personality is also the system prompt for the **Rewrite** button:

- **Generate view** — type a line, click ✏️ Rewrite. The LLM rewrites the line in the persona's voice. A preview appears; accept to replace the textarea, discard to keep the original.
- **Studio Script tab** — right-click a dialogue row attributed to a persona. Same preview-then-accept flow; accepted text replaces the block's text. The block is marked with a ✨ icon so you can spot rewritten blocks later.

Rewrite is always explicit — never auto-applied at render time. The manuscript words are sacred unless you ask for a rewrite and accept it.

Routes through your AI Features pin for `persona_rewrite` (see `ai-features.md`).

## Auto-create from JustWrite (and other imports)

When you import a manuscript, every character in the source becomes a Persona automatically, keyed on `(imported_from, imported_id)`. Re-importing the same source uses the existing persona rows instead of creating duplicates. See [import-formats.md](import-formats.md).

## Smart-assign

The Cast tab's **Smart-assign** button sends every character + every voice to your LLM and asks for the best mapping. Pre-flight:

1. Click ❓ chips in the voice library → cycle to set gender on any unset voices.
2. Confirm Gender + Pronouns on every main persona.
3. Then click Smart-assign.

Smart-assign is a starting point — review every assignment before rendering. Voices from different providers can coexist in one cast (OpenAI's voice for the protagonist, Kokoro for villagers, Chatterbox clone for the narrator).
