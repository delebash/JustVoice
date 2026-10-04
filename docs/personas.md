# Personas

A **persona** is a finished spoken voice. It's a **voice** — which carries the
model that speaks it — plus everything about **how it speaks**: its language,
pace, pitch, gain and pauses, the model's own direction (written direction and
emotion, or tags, or nothing), the model's sampling settings and seed, effects,
a lexicon, and a short **note on how it sounds**. Personas live in your
library, and you can use one in any book.

A persona is not a person. The people in a book are its **speakers**:
[Studio · Discover](studio.md#discover) finds them and
[Studio · Script](studio.md#script) gives lines to them. On
[Studio · Cast](studio.md#cast), each speaker gets a persona. **One persona can
play many speakers.** Change the persona once and every speaker it plays
changes with it: in this book, in every other book, and in the next render.

| Word | What it is | Where it lives |
|---|---|---|
| **Persona** | A finished spoken voice: a voice (and so its model), how it speaks, effects, lexicon, a note on how it sounds | Your library, used in any book |
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

The Personas page lists your library, one row per persona:

| Column | Shows |
|---|---|
| ▶ | Plays the persona speaking the stock line in its language — its voice, model, pace, pitch, gain, direction and effects, through the same path a chapter renders. If its model isn't loaded it asks first: *Load Kokoro?* (with **Always auto-load** once it has loaded, the same choice Voices offers). One compact player above the list serves every row |
| Persona | Its name, and the start of its note |
| Built on | The voice it's built on and how that voice was made: `Sohee built-in`, `Mara clone`, `Old Crow design`, `Warm mix blend`. *No voice yet* when none is picked, *voice missing* when its voice was deleted |
| Model | The model that speaks its voice: `Qwen3-TTS CustomVoice`, `Kokoro` |
| Can be directed | **✓ written direction**, **✓ 19 tags** (the model's own tags) or **sliders only** — see [Voice](#voice) for what each means |
| Speaks | The language it speaks: `Korean`, `British English` |
| Shaped | What it does to its voice: `1.05× · −1.0 dB · 2 effects`, `0.92× · −3 st · reverb`. *as the voice* when it changes nothing |
| Used by | Who it plays, as *speaker — book*: `June — Stillwater`. The same speaker name in several books reads `Narrator — Stillwater · Emberfall`. A persona that plays no one reads **— not used yet —** |
| ⋯ | **✎ Edit**, **✏️ Rename**, **🔗 Merge into…**, **🗑 Delete** |

Click a row to open that persona's page. **＋ New persona** opens a blank one.

**Filters** above the list narrow it, and combine:

- **Search personas…** matches a persona's name or its note.
- **Model** — the models your personas use, each with its count: *Kokoro (9)*.
- **Can be directed** — Any direction · Written direction · Tags · Sliders only.
  The open list shows each one's example (*describe it: clipped, world-weary* ·
  *pick from the model's list: [fear] [sigh]* · *pace, pitch, gain — no words*).
- **Languages** — the languages your personas speak, with counts.
- **Used** — All · In use · Unused · *In* each book (*In The Ninth Facet*).

When nothing matches, **Clear filters** puts them all back. With no personas at
all the page says *No personas yet* and offers **＋ Create your first
persona**.

### Rename and Merge into…

**✏️ Rename** asks for the new name and changes it everywhere the persona
plays — Cast, *Used by*, Generate. Names stay unique (see [Names](#names)).

**🔗 Merge into…** folds one persona into another, for when two personas have
become the same voice. Pick the persona to keep: every speaker the merged one
plays, in every book, is played by the kept one from then on; its own
lexicons, its generations and its MCP bindings move too; then the merged
persona is deleted. The kept persona keeps its own voice and settings — the
merged one's are not copied over. The toast says how many speakers moved:
*Gruff dockhand merged into Gravel old man — 2 speakers moved.* Merging can't
be undone.

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

**⋯ → 🗑 Delete** on a row asks first. If the persona plays anyone, the confirmation
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

## The persona's page

Each persona has its own page: **Personas › June**. You get there from a row
on the Personas list, from **＋ New persona** (a blank page), and from Cast's
**Edit their persona →**, so a speaker's voice is one click from the cast.

Along the top: the voice and its model (`Sohee · Qwen3-TTS CustomVoice`), the
language it speaks (`Speaks Korean`), **used by N speakers**, and **Unsaved
changes** once you've changed anything. When the voice's model isn't the one in
memory a banner says so: *Qwen3-TTS CustomVoice isn't loaded. The first listen
swaps it in — about a minute.* If the persona's voice has been deleted, a red
banner asks you to pick another.

The page is a column of cards, with a summary, **This model** and **Used by**
beside them. On a new persona only **Persona** and **Voice** are live: every
card below them depends on the voice's model, so they open once a voice is
picked (*Pick a voice first — everything below depends on its model*).

Leaving the page with unsaved changes asks first: *June has changes that
aren't saved. They are lost if you leave.*

### Persona

| Field | Used for |
|---|---|
| Name | How the persona shows on Cast, in *Used by*, and in Generate's persona list. Required, and unique in your library (see [Names](#names)). |
| Note on how it sounds | A sentence or two about the voice, for example *"Warm and unhurried, a little gravel at the bottom of the range."* **Never heard**: Compose and Rewrite on the Generate page read it, and so does Smart-assign when it matches speakers to personas. See [The note](#the-note-what-the-ai-reads-about-the-voice). |

### Voice

A persona is built on one voice, and **the voice decides the model**: every
voice knows the model it was made for
([Voices](voices.md#every-voice-knows-the-model-that-speaks-it)). There is no
separate engine or model field — pick the voice and the model comes with it.
(An *Engine override* field sat on the old editor until 2026-10-03; nothing
read it.)

**The kind** comes first. It filters the voice list to voices made one way:

| Kind | Lists | Made on |
|---|---|---|
| Built-in | The models' own voices — Kokoro's `af_heart`, Qwen3 CustomVoice's Sohee | AI Settings → Speech engines, by installing a model |
| Clone from audio | Voices cloned from a recording, and imported ones | [Voices → Clone](voices.md) |
| Design from words | Voices designed from a description, with or without a kept clip | [Voices → Design](voices.md) |
| Blend | Kokoro blends of two or more voices | [Voices → Blend](voices.md) |
| Trained LoRA | Off: *Needs voice training, which isn't rebuilt yet.* | — |

**Three filters** sit beside the list:

- **Can be directed** — how the voice's model can be told how to speak:

  | Choice | What you do | Example | Models |
  |---|---|---|---|
  | Written direction | describe it in words | *Clipped, world-weary. Dry wit.* | Qwen3 CustomVoice, VoxCPM2 (its clones too), Qwen3 VoiceDesign (the words reshape the voice) |
  | Tags | pick from the model's own list | `[fear]` … `[sigh]` | Chatterbox Turbo, Chatterbox Nano |
  | Sliders only | pace, pitch, gain — no words | Pace 1.05×, Pitch −2 st | Kokoro, KittenTTS, Pocket TTS, Chatterbox Multilingual, Qwen3 Base |

- **Model** — the models with voices of this kind, each with its count:
  *Qwen3-TTS CustomVoice (9)*.
- **Gender** — Any · Female · Male · Neutral. A voice's gender is worked out the
  same way everywhere: your own override first (Voices → click the letter), then
  what the voice says about itself, then the voice's id or first name.

Each voice reads *name · gender · language · model*: `Sohee · Female · Korean ·
Qwen3-TTS CustomVoice`. **▶ Raw** plays the voice on its own, before anything
on this page shapes it; if its model isn't loaded it asks before loading it.

**Speaks** is the language this persona speaks. It starts as the voice's own
language. Where the voice or its model allows only one (a Kokoro voice,
KittenTTS, Chatterbox Turbo) it is plain text: *Speaks English*. Where the model
can speak several (Qwen3, Chatterbox Multilingual, VoxCPM2, Pocket TTS) it is a
list of exactly those, so one Qwen3 speaker can be an English persona and a
Korean one; when the two differ the page says *Speaks English · voice is
Korean*. Every render of a line this persona plays is sent in this language.

**Changing the voice** of a persona that plays anyone warns that its lines go
stale: *Changing this makes June's 61 lines stale.* When the new voice's model
can't take written direction and some of those lines carry a direction of their
own, it adds how many: *18 carry a written direction — Chatterbox Turbo won't
perform them.* The language stays when the new voice's model speaks it, and
falls back to the voice's own when it doesn't.

### Hear it

Type a line and press **▶ Listen** to hear it spoken by this persona **as it is
on the page, unsaved changes included**. Listen goes through exactly the path a
chapter render uses, so what you hear is what the book gets. An empty box
speaks the **stock line**; **↻ Stock line** puts it in the box, in the
persona's language where one is written (English, Spanish, French, German,
Italian, Portuguese, Dutch, Russian, Japanese, Chinese, Korean) and in English
otherwise.

**🏷️ Insert tag…** opens the voice's model's own tags and puts the one you pick
at the cursor — on Chatterbox Turbo, `[laugh]`, `[sigh]`, `[fear]` and the rest
of its nineteen. On a model with no tags the button is off and says so.
**⤓ WAV** saves what you last heard.

### How it speaks

**Pace, Pitch and Gain** apply to every model. Each is a slider with a number
beside it, and **↺** puts it back to the voice's own:

| Setting | Range | Example |
|---|---|---|
| Pace | 0.5× – 2× | 1.05× — a touch quicker |
| Pitch | −12 – +12 semitones | −2 st — a little lower |
| Gain | −12 – +12 dB | −1.0 dB — a little quieter |

Some models pace themselves and some don't. On one that doesn't, the page says
*Pace is time-stretched after Qwen3-TTS CustomVoice speaks — it doesn't pace
itself.*

**Pause before** and **Pause after** are in milliseconds. Empty uses the
project's gap between lines.

**Direction** depends on the model:

- **Written-direction models** (Qwen3 CustomVoice, VoxCPM2, Qwen3 VoiceDesign):
  **Standing delivery** — how this voice always speaks, in words (see
  [Standing delivery](#standing-delivery-the-words-that-change-the-performance))
  — and **Emotion**, one of the app's nine: neutral, happy, sad, angry, fearful,
  whispered, shouted, sarcastic, contemptuous. On Qwen3 VoiceDesign the page
  warns: *On Qwen3 VoiceDesign these words reshape the voice itself, not just
  how it speaks.*
- **Tag models** (Chatterbox Turbo and Nano): **Emotion** from their own seven
  (`[angry]` `[fear]` `[happy]` `[sarcastic]` `[surprised]` `[crying]`
  `[whispering]`) and **Register** from its three (`[narration]` `[dramatic]`
  `[advertisement]`), put at the start of every line. Sounds like `[sigh]` or
  `[laugh]` go inside a line, so you type them in the line's text. Standing
  delivery is shown off with the reason: *Chatterbox Turbo takes tags, not
  written direction — pick its emotion and register below.* (Turbo and Nano
  arrive with the next speech-runtime release — see
  [Not available yet](engines.md#not-available-yet).)
- **Sliders-only models** (Kokoro, KittenTTS, Pocket TTS, Chatterbox
  Multilingual, Qwen3 Base): Standing delivery and Emotion are off, with the
  reason: *Kokoro takes no direction — shape it with the numbers, or pick a
  voice on a model that takes direction.*

**Effects** shows the chain as chips (`reverb`, `eq`); **＋ Edit** opens the
effects editor. Effects run after the voice speaks.

**Lexicon** is a lexicon for this persona only (for example, street slang for
one voice). It is read on every line this persona speaks, after the book's own
lexicon — and only on those lines. Where both have an entry for the same word
that the engine can use, the book's wins. See
[Lexicons](lexicons.md#which-lexicons-a-line-is-read-with).

### Sampling

Titled with the model, this card shows **exactly that model's own sampling
settings**, with its own defaults and ranges — Temperature, Top k, Top p and
Repetition penalty on Qwen3 CustomVoice; others on other models. **↺** puts one
back to the model's default. A model with none says *Kokoro has no sampling
settings.*

**Seed** makes a take repeatable: the same seed gives the same take, and empty
gives a new one each time. **🎲** picks a new seed. On a model that doesn't
repeat with a seed the field is off: *KittenTTS doesn't repeat with a seed.*

**⚖️ Compare settings…** hears the same line three ways. Pick a setting (Pace,
Pitch, Gain, or one of the model's sampling settings) and three values — the
dialog starts them around the current value, for example Pace 0.9× · 1.0× ·
1.1× — then **▶ Hear all three**. **Use this** under a take sets that value on
the page.

**Settings are kept per model.** A persona's emotion, register, sampling
settings and seed are stored for the model they were set on. Switch the persona
to a voice on another model and that model's own settings show; switch back and
the first model's come back as you left them. Pace, pitch, gain and the pauses
are shared across every model.

### Save

**💾 Save** saves the page; on a new persona it creates the persona and the
page becomes its page. Saving a persona that plays anyone says how many lines
are now stale: *Saved. 61 lines are now stale.* **Save** stays off while
nothing has changed or the name is blank. **↺ Revert** goes back to the last
save.

**Save as a new persona** (on a saved persona) makes a copy under the name you
type, with everything on the page, and opens it; the persona you started from
stays as it was saved: *Saved as a new persona. June is untouched.*

**🔀 Blend** opens Voices → Blend, to make a new voice out of others. **🧪 Train
a LoRA** is off until voice training is rebuilt.

Clearing a field and saving clears it (until 2026-10-03, emptying the delivery,
the note or the lexicon kept the old value while the page said it was saved).

### This model, Used by

**This model** shows what the voice's model can do: ✓/✗ written direction, ✓/✗
tags (and lists them by kind — Emotion, Register, Non-verbal), the languages it
speaks, ✓/✗ cloning and ✓/✗ seed. **Compare models →** opens AI Settings →
Speech engines.

**Used by** lists every speaker the persona plays as
`🎭 June — Stillwater · 61 lines`, with the total line count beside the heading.
**Open Cast →** takes you to that book's Cast step. When the persona plays
speakers in several books there is one button per book: **Open Stillwater Cast
→**.

### One persona, one sound, everywhere

Every way a persona is heard builds its request the same way: the page's
Listen and Compare, a chapter render, a line's ↻ re-render, a take, the game
voice-line export, Generate with the persona picked and MCP's speak with a
persona. Each gets the persona's voice and model, its pace, pitch, gain and
pauses, its model's own settings and seed, its standing delivery joined with
the emotion and the line's own direction, its language, its effects, and the
book's lexicon then its own. Until 2026-10-03 a line's re-render and the game
export left out the delivery and the line's direction, and no render sent the
persona's language or seed.

## Standing delivery: the words that change the performance

**Standing delivery** is a short description of how the voice always speaks,
for example *"Clipped, world-weary noir delivery. Dry wit. Boston accent in
stressful moments."* or *"Eager, optimistic, ends sentences with rising
intonation."* (Until 2026-10-03 the field was called *Spoken delivery*.)

**Qwen3-TTS (CustomVoice and VoiceDesign) and VoxCPM2 read it.** On Qwen3
CustomVoice it arrives as the model's instruction when JustVoice renders a line
this persona plays, and the model uses it to adjust *delivery* (pacing,
intonation, vocal warmth) without changing the manuscript words. On a designed
voice with no kept clip it is added after the voice's description — and on
VoiceDesign the words reshape the voice itself, not just how it speaks. VoxCPM2
reads it on its cloned voices too. Every other model has no use for it:
Kokoro, KittenTTS, Pocket TTS, Chatterbox, and Qwen3 **Base**, which clones
voices and has no instruction input.

The page tells you which case you're in: on a model that can't take it the box
is off and says why. Cast shows the same verdict as a tag on each persona row
(**✓ written**, **tags** or **✗ none**).

There is no checkbox or extra step. Write a standing delivery, render a
chapter, and a model that takes direction picks it up.

### How it combines with the line

Standing delivery is the voice's **standing** instruction, not the last word.
At render time three things join into the one instruction the engine receives,
most specific last:

1. this persona's **Standing delivery**
2. the **Emotion** label, if one is set
3. the line's own **direction**, from the Chapters editor's `+ direction` button

So a persona whose delivery reads *"gravel-voiced harbour-master, always weary"*
on a line marked *"shouting over the wind"* sends the engine `gravel-voiced
harbour-master, always weary. shouting over the wind`. A single hint passes
through untouched; nothing reformats a note you wrote by hand.


**Emotion is set per model.** On a written-direction model it is one of the
app's nine labels and joins the instruction as a word. On Chatterbox Turbo it is
one of Turbo's own seven tags and goes at the start of the line, with the
Register tag. The persona keeps each model's choice, so a persona moved between
the two keeps both. See [generate.md](generate.md).

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
persona's Standing delivery. *"female, age 34, protagonist"* is a casting hint, not
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
