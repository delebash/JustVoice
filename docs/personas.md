# Personas

A **persona** is a finished spoken voice. It's a voice and its engine, plus
speed, pitch, gain, spoken direction, effects and lexicon, and a short **note
on how it sounds**. Personas live in your library, and you can use one in any
book.

A persona is not a person. The people in a book are its **speakers**:
[Studio · Discover](studio.md#discover) finds them and
[Studio · Script](studio.md#script) gives lines to them. On
[Studio · Cast](studio.md#cast), each speaker gets a persona. **One persona can
play many speakers.** Change the persona once and every speaker it plays
changes with it: in this book, in every other book, and in the next render.

| Word | What it is | Where it lives |
|---|---|---|
| **Persona** | A finished spoken voice: voice, engine, delivery, effects, lexicon, a note on how it sounds | Your library, used in any book |
| **Speaker** | A person in one book: a name, the other names the text uses (*Also called*), and *Who they are* | One book |
| **Cast** | Which persona plays each speaker | The speaker's persona |

## Why a persona is separate from a speaker

Until 2026-09-29 one record did both jobs. A persona was the person Discover
found *and* the sound, so Discover made a voiceless persona for every name it
found, and Cast needed a voice list to finish each one. Keeping the two apart
does three things:

- **Reuse without copies.** A steady narrator voice, a gruff dockhand voice or a
  child's voice is made once and plays speakers in every book.
- **Minor speakers can share a voice.** One persona can play thirty minor
  speakers; tune it once and all thirty follow.
- **Recasting doesn't lose the person.** A speaker's *Who they are* and *Also
  called* stay on the speaker whichever persona plays them, so trying a
  different voice never loses what Discover and Script know about them.

A book's lines, its cast and the corrections Script remembers all point at
**speakers**. Generations, lexicons, audio channels and MCP bindings stay on
the **persona**, because they belong to the voice.

## The list

The Personas page lists your library with filter chips (**All · Used · Unused ·
By project**), a search box that matches a persona's name or its note, and one
row per persona:

| Column | Shows |
|---|---|
| Persona | Its name, and the start of its note |
| Voice | The voice it's built on, or *no voice yet* |
| Used by | Who it plays, as *speaker — book*: `June — Stillwater`. The same speaker name in several books reads `Narrator — Stillwater · Emberfall`. A persona that plays no one reads **— not used yet —** |

### Names

**Every persona has a name, and no two personas share one** — across your whole
library, with case and extra spaces not counting ("Gravel old man", "gravel  OLD
man" and " Gravel old man " are the same name). Creating or renaming a persona
into a name another persona has is refused: *A persona called "Gravel old man"
already exists. Persona names are unique — rename one of them first.* **Save**
stays off while the name is blank.

A persona is a voice, so name it for how it sounds — "Narrator (warm)", "Gravel
old man" — not for one book's person. The person's name belongs to the
**speaker**, and speaker names are unique within a book instead, so every book
can have its own speaker called Narrator (see [Studio · Discover](studio.md#discover)).

Unique names are what make **casting by name** dependable: a new speaker whose
name is exactly a persona's name arrives already cast with it. A persona you
call exactly "Narrator" is the one **+ Add Narrator** casts; for a book that
needs a different narrator voice, cast its Narrator speaker by hand in Cast.
(Personas made before 2026-09-29 could share a name. If two still do, a new
speaker of that name matches neither and arrives uncast; rename one to fix it.)

### Deleting

**Delete** on a row asks first. If the persona plays anyone, the confirmation
says who: *"It plays Nettle (The Ninth Facet) — that speaker loses its
persona."* The speakers stay in their books and keep their lines, but they have
no persona until Cast gives them another. A chapter won't render while any of
its speakers has no persona. The voice and lexicon are kept, and the toast has
**Undo**.

### Deleting several at once

Tick personas in the list (the box in the header ticks every one shown), then
use **Delete N selected**. One confirmation names them and, when any of them
plays someone, how many speakers lose their persona and which: *"2 speakers lose
their persona and need another in Cast before rendering: Nettle (The Ninth
Facet), Old Sedge (The Ninth Facet)."* Each persona goes exactly as a single
**Delete** does. Voices and lexicons are kept.

## The editor

Click a row, or **Edit**, to open the editor. **＋ New persona** opens it blank,
and **Save** creates the persona. Cast's **Edit their persona →** and a persona
row's ✎ open the editor straight onto that persona, so a speaker's voice is one
click from the cast.

The header shows **Used in N projects** when the persona plays anyone.

### Name, language, note

| Field | Used for |
|---|---|
| Name | How the persona shows on Cast, in *Used by*, and in Generate's persona list. |
| Language | The language this persona speaks. It starts as its voice's own language. Where the voice's model can speak others (Qwen3, Chatterbox Multilingual, VoxCPM2, Pocket TTS) you can pick another of them — one Qwen3 speaker can be an English persona and a Korean one. Where the voice or model allows only one (a Kokoro voice, KittenTTS, Chatterbox Turbo) that one is used whatever is typed. A language the model can't speak is refused on Save: *Qwen3-TTS CustomVoice can't speak tlh with this voice — it speaks zh, en, ja, ko, de, fr, ru, pt, es, it.* Every render of a line this persona plays is sent in this language. |
| Note on how it sounds | A sentence or two about the voice, for example *"Warm and unhurried, a little gravel at the bottom of the range."* **Never heard**: Compose and Rewrite on the Generate page read it, and so does Smart-assign when it matches speakers to personas. |
| Avatar path | Optional. |

### How they sound

Everything in this half reaches the synthesizer.

| Field | Used for |
|---|---|
| Voice | Which TTS voice speaks. The voice decides the model too — every voice knows the model it was made for ([Voices](voices.md#every-voice-knows-the-model-that-speaks-it)). (An *Engine override* field sat here until 2026-10-03; nothing read it.) |
| Lexicon | A lexicon for this persona only (for example, street slang for one voice). It is read on every line this persona speaks, after the book's own lexicon — and only on those lines. Where both have an entry for the same word that the engine can use, the book's wins. See [Lexicons](lexicons.md#which-lexicons-a-line-is-read-with). |
| Spoken delivery | The `instruct` / style prompt for engines that take direction: how a line is *performed*. |
| Default delivery | Pace, pitch, gain and the pauses before and after a line, for every model — plus, per model, its own emotion (or tags, on Chatterbox Turbo), sampling settings and seed, kept per model so switching a persona's voice to another model and back restores them. |
| Effects chain | Reverb, EQ and compression, applied after the TTS renders. |

Clearing a field and saving clears it (until 2026-10-03, emptying Spoken
delivery, the note or the lexicon kept the old value while the page said
*Persona saved*).

### One persona, one sound, everywhere

Every way a persona is heard builds its request the same way: a chapter
render, a line's ↻ re-render, a take, the game voice-line export, Generate with
the persona picked and MCP's speak with a persona. Each gets the persona's
voice and model, its pace, pitch, gain and pauses, its model's own settings
and seed, its spoken delivery joined with the emotion and the line's own
direction, its language, its effects, and the book's lexicon then its own.
Until 2026-10-03 a line's re-render and the game export left out the spoken
delivery and the line's direction, and no render sent the persona's language or
seed.

### Used by

Below the fields, **Used by** lists every speaker the persona plays as
`🎭 June — Stillwater · 61 lines`, with the total line count beside the heading.
**Open Cast →** takes you to that book's Cast step. When the persona plays
speakers in several books there is one button per book: **Open Stillwater Cast
→**.

## Spoken delivery: the one text field that changes the audio

**Spoken delivery** is a short description of how the voice speaks, for example
*"Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful
moments."* or *"Eager, optimistic, ends sentences with rising intonation."*

**Qwen3-TTS (CustomVoice and VoiceDesign) and VoxCPM2 read it.** On Qwen3
CustomVoice it arrives as the model's instruction when JustVoice renders a line
this persona plays, and the model uses it to adjust *delivery* (pacing,
intonation, vocal warmth) without changing the manuscript words. On a designed
voice with no kept clip it is added after the voice's description — and on
VoiceDesign the words reshape the voice itself, not just how it speaks. VoxCPM2
reads it on its cloned voices too. Every other model ignores the field: Kokoro,
KittenTTS, Pocket TTS, Chatterbox, and Qwen3 **Base**, which clones voices and
has no instruction input.

The editor tells you which case you're in. A line under the box names the
engine this persona's voice uses and says whether it takes direction. Trust
that line over any list: it reads the engine's real capability. Cast shows the
same verdict as a tag on each persona row (**✓ written**, **tags** or **✗
none**).

There is no checkbox or extra step. Write a delivery note, render a chapter, and
an instruct-capable engine picks it up.

### How it combines with the line

Spoken delivery is the voice's **standing** instruction, not the last word. At
render time three things join into the one instruction the engine receives,
most specific last:

1. this persona's **Spoken delivery**
2. the **Emotion** label, if one is set
3. the line's own **direction**, from the Chapters editor's `+ direction` button

So a persona whose delivery reads *"gravel-voiced harbour-master, always weary"*
on a line marked *"shouting over the wind"* sends the engine `gravel-voiced
harbour-master, always weary. shouting over the wind`. A single hint passes
through untouched; nothing reformats a note you wrote by hand.


**Emotion is meant to be portable in a way this field is not.** Written
direction only reaches Qwen3, but the nine-value Emotion label can also compile
into an engine's own tag, so it would survive moving a speaker onto a cloning
engine. The engine that took it as a tag, Chatterbox Turbo, is not available on
the speech runtime yet, so today Emotion reaches Qwen3 CustomVoice and
VoiceDesign only. See [generate.md](generate.md) and
[engines.md](engines.md#not-available-yet).

## The note: what the AI reads about the voice

The note is for the language-model features, and nothing else reads it:

- **Compose 🎲 and Rewrite ✏️ on the Generate page.** Generate has no book, so
  there is no speaker to read. Both buttons use the chosen persona's note as the
  voice to write in. Rewrite shows a preview; accept it to replace the textarea,
  or discard it to keep the original. Both buttons are disabled until the
  persona has a note. The server refuses with *"{name} has no note on how it
  sounds — write one on the Personas page to use Compose / Rewrite."*
- **Smart-assign on Cast** sends each persona's name, its voice's gender and
  language, and its note (as the persona's tone) to your language model, which
  matches them against the speakers.

**Rewrite in character** in Studio · Script is different. It rewrites a line as
the *speaker*, so it reads the speaker's *Who they are* on Cast, not the
persona's note (see [Studio · Script](studio.md#script)).

Rewriting is always explicit and never happens at render time. The manuscript's
words are only changed when you ask for a rewrite and accept it.

## The Narrator

A book's narrator is a **speaker**, not a persona. When
[Studio · Script](studio.md#script) analyzes a chapter, it gives the narrator
every stretch of prose outside quote marks. The narrator is cast like anyone
else: give it a persona on Cast, and that persona reads the narration. One
steady narrator persona can narrate every book you make.

**No book gets a narrator on its own.** A project you create or import starts
with none, unless the manuscript has its own speaker called *Narrator*, who then
becomes the narrator. There are two ways to get one on Cast:

- **Add Narrator** makes a speaker called Narrator, cast with your persona called
  *Narrator* if the library has exactly one by that name. If the book already
  has a speaker called Narrator, that speaker takes the role instead. Narration
  with no speaker moves to it.
- **Tick Narrator** on any speaker's card. A book told in the first person has
  a narrator who also speaks (Watson tells *The Speckled Band* and talks in it),
  and both should be one voice. There is one narrator per book. The speaker who
  had the role stays in the cast as an ordinary speaker. The narration Analyze
  decided moves to the new narrator at once; lines you set yourself stay where
  you put them.

Until a book has a narrator, Analyze leaves its narration with no speaker, and a
chapter won't render. Removing the narrator from the cast returns its lines to
no speaker in the same way. Script's **Assign N → Narrator** and the render's
**Assign all to Narrator** (each shows the narrator's name) send lines with no
speaker to the narrator once there is one.

## Imports

An import (JustWrite, CSV, SRT, podcast script) turns the people the source
lists into the book's **speakers**, not personas. Each speaker is keyed on the source's own
id, so re-importing the same book reuses its speakers instead of duplicating
them. An import keeps them exactly as the source has them, even two with the
same name. Each new speaker is cast with the persona of exactly its
name if your library has one. See [Import & export](import-and-export.md).

Everything the source knows about a person lands in the speaker's **Who they
are**: the one-liner, then a `Voice hint:` block carrying gender, age and role.
Its aliases become the speaker's **Also called**. Nothing is written into any
persona's Spoken delivery. *"female, age 34, protagonist"* is a casting hint, not
a direction to the TTS, and guessing a direction would change how your book
sounds without you asking.

## Smart-assign

**✨ Smart-assign** on Studio · Cast sends the book's speakers, the narrator
aside (name, *Also called*, *Who they are*), and your personas (name, voice gender, language, note)
to your language model, which proposes a persona for each speaker. The matches
apply straight away. It is a starting point, so listen to each assignment before
rendering and change any you disagree with by clicking another persona.

Personas on different engines and providers can share one cast, for example an
OpenAI voice for the protagonist, Kokoro for the villagers and a Chatterbox clone
for the narrator. Cast warns when a cast spans several engines (chapters swap
engines while rendering) or uses online voices (billed per use).
