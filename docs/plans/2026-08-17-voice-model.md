# 2026-08-17 — The voice model

<!-- SPDX-License-Identifier: MIT -->

**This is the normative doc for how sound is organised in JustVoice. Read it
before designing, building or arguing about anything to do with voices, personas,
casting or per-line delivery.**

It exists because the model kept being re-derived. `2026-08-15-voice-workflow-redesign.md`
grew to 1,800 lines and the answer to *"where do the knobs live"* was spread across
§2.4, §2.6, §8.3, §8.22, §9.6 and §10 — so every time the question came up it got
re-answered from whichever fragment was in view, with different words each time.
The user's verdict, and it was correct:

> *"we keep going over this you keep forgeting where are the knobs, how is reuse,
> how does one persona speak in an angry voice or quiet voice … its like you keep
> looking at the problem withpout thinking about the whole issue"*

**Where this and the redesign doc disagree, this doc wins.** What that doc still
owns and this one does not touch: the five steps (§8.5), Script doing one job
(§8.6), the scope grid (§8.7–8.8), manual Review (§8.9), the attribution sources
and suspicion checks (§8.12–8.15), and the state vocabulary (§8.16).

---

## §1 The model — four things, one rule

**A voice** is what an engine gives you. Heart, Sohee, Uncle Fu. 63 built in, plus
any you clone, blend, train or design. You can pick one; you cannot change what it
fundamentally sounds like.

**A persona** is a voice you have shaped and named. Pace, pitch, level, how it
always speaks, its effects. You make it once and reuse it anywhere — any project,
any number of speakers.

**The cast** is the list of names in this book. Each name points at a persona. A
name carries **no sound settings at all** — only who they are, written in words for
the AI to read.

**A line** is one moment. It carries whatever direction its persona's engine can
actually take, and it may point at a different persona than its speaker's.

> ### THE RULE
> **Every audible setting lives on the persona. Nowhere else.**
>
> Hear it → **persona**. Read it → **cast**. True only right here → **line**.
>
> The corollary: changing a persona's voice or engine never moves a setting. It
> only **enables or disables** controls on the line.

### Why each one has to exist

**Voice → persona**, because a voice cannot be tuned. Something has to hold the
tuning, and it has to be shareable — a clone that came out quiet must be fixed
*once*, not once per speaker.

**Persona → cast**, because two names can want the same sound. Twenty personas can
cover 500 game NPCs. If the name and the sound were one object you would tune the
same voice 500 times.

**Cast has no knobs**, because that is what makes the model unambiguous. There is
exactly one answer to "where do I tune this", forever.

---

## §2 The complete knob inventory

This table is the whole answer. If a setting is not here it does not exist.

| Layer | What it holds |
|---|---|
| **Persona** | which voice · pace · pitch · level · pause before / after · **standing delivery** (how it always speaks, in prose) · effects chain · sampling: temperature, top-k, top-p, repetition penalty, seed |
| **Cast row** (a speaker) | name · which persona · **who they are** (prose the AI reads, never heard) · role · aliases |
| **Line** | direction — **whatever that engine takes**: free prose (Qwen3 CustomVoice), tag chips (Chatterbox Turbo), or nothing · pause · numeric override (pace / pitch / level, this line only) · **which persona speaks it** (blank = the speaker's) |
| **Scene** | appended direction text · an effects chain stacked on top. **No numbers** — a scene may only add what *stacks*, and a number would overwrite everyone's and flatten the cast |
| **Project** | master target · default gaps · lexicon |

**Sampling is the only part of the persona that changes shape per engine.** A
Kokoro persona shows no sampling at all, because Kokoro is deterministic — same
input, same output, every time.

---

## §3 Reuse — the reason persona is separate from cast

A persona is library-level and crosses projects. Three cases it is built for:

- **A series.** Make *June* in book one. Book two's cast points at the same
  persona and she is identical, with no re-tuning and no drift.
- **A crowd.** Make *Gruff old man*. Point thirty NPC names at it. One tuning
  session covers thirty speakers.
- **A fix.** A clone came out 3 dB quiet. Fix the persona once; everyone using it
  is fixed.

Cast rows are cheap and disposable — a name and a pointer. **Personas are the
thing you build and keep.**

A project starting fresh offers **copy a cast**, which copies the names *and* their
persona assignments from another project.

---

## §4 How one persona speaks angry, then quiet

**You do not need a second persona for a mood.** The persona is the standing sound;
the line carries the deviation.

### There is no portable emotion enum — it was invented and it fit nothing

**Deleted 2026-08-17.** A nine-value `Emotion` enum (`neutral · happy · sad · angry
· fearful · whispered · shouted · sarcastic · contemptuous`) sat in `models.py` and
the design was built around it as a *portable* layer that would compile to prose for
Qwen and to a token for Turbo. **The nine values were derived from nothing** — not
from Qwen, not from Chatterbox, not from any spec.

The proof it matched nothing:

| | |
|---|---|
| The enum (9) | neutral · happy · sad · angry · fearful · whispered · shouted · sarcastic · contemptuous |
| Turbo's real emotions (7) | angry · fear · happy · sarcastic · **surprised** · **crying** · whispering |

They agree on five. The enum invents `sad`, `shouted` and `contemptuous`, for which
Turbo has no token. Turbo has `surprised` and `crying`, for which the enum has no
slot. **Neither list is a subset of the other** — it was a third vocabulary matching
neither engine.

And it was worse than both alternatives it sat between:

- **For Qwen it added nothing.** Qwen reads free prose. Any nine-item list is poorer
  than a sentence.
- **For Turbo it subtracted.** It reduced an engine with 19 tags to six mismatched
  chips, discarding `surprised`, `crying`, all three registers and all nine
  non-verbal sounds.

**The rule that replaces it: use each engine's own vocabulary, and invent nothing in
between.** The cost is that direction does not survive moving a persona across
engine families — which is honest, because the timbre changes completely in that
move anyway and the performance is being redone regardless.

### The direction column — what is in the cell, per engine

Every line has the column. What it contains comes from the persona's engine variant,
and the only thing that ever happens on a recast is that controls **enable or
disable**.

| Persona's engine | The cell is | Empty state reads |
|---|---|---|
| **Qwen3 CustomVoice** | free text, editable in the row | *"as June always speaks"* |
| **Chatterbox Turbo** | tag chips — 7 emotions, 3 registers | *"as Marius always speaks"* |
| **Kokoro · Chatterbox Multilingual · Qwen3 Base · LuxTTS** | disabled, with the reason on it | *"Kokoro takes no direction — use the numbers"* |
| **No persona yet** | disabled | *"no persona, so no controls"* |

**The numeric override is on every line regardless** — pace, pitch, level. On the
four engines that read nothing it stops being a hidden hatch and becomes the visible
control.

**Non-verbal sounds are not in this column.** `[sigh]` goes at a point *inside the
sentence*, so it is a palette that inserts into the text itself. Turbo only.

**A chapter shows all three kinds at once** — June's row a text box, Marius' row
chips, the Narrator's disabled. That is correct: the column means *how it is said*,
and each row shows what that row can actually do.

**Two consequences:**

- **"Suggest directions" emits different things per engine.** Prose for June, tags
  for Marius, numbers only for the Narrator. One button, three outputs.
- **Recasting needs two warnings, not one.** Free text written for Qwen goes silent
  on Turbo. Turbo tags sitting *in the line text* are read aloud as words on
  Multilingual, which shares the engine but not the tokenizer. Different failures,
  both need a count before committing.

### A line may point at a different persona

**One optional field on the line: which persona speaks it.** Blank means the
speaker's own.

It covers everything a mood-persona is for — "Marius angry", a young-Mara flashback,
a possession, a character shouting from another room — and it does **not** have the
render-preset problem, because it *swaps which whole persona is used* rather than
overlaying settings on top of one. Nothing blends, so nothing flattens.

**This replaces a workaround that was wrong.** The previous answer was to add a
second cast row called "Marius (angry)" and re-attribute those lines to it. That
pollutes the cast with people who do not exist, splits his line count, duplicates his
character sheet, and makes Discover propose them as two people on every run.

The Cast screen stays honest about it: *"Marius — persona Marius, 40 lines use
another."*

### "Marius angry" as a persona is allowed

A render preset was bad because it applied to a **whole scene or chapter and
overrode everyone in it**. A persona named "Marius angry" overrides nobody — it is
one persona, used where it is chosen. **It needs no change to the app**, and a user
who prefers working that way should not be stopped.

Per-line direction is easier where the engine supports it. That is a
recommendation, not a rule.

### What a scene does instead

A whole passage that should be hushed is a **scene**. A scene appends direction text
and stacks an effects chain — and **nothing else**.

**It sets no numbers.** A scene-level pace was proposed and **rejected 2026-08-17**:
a blunt multiplier across 231 lines sounds mechanical, and even a *relative* ×0.92
would be a third place that touches pace. The need it claimed to serve is already
met — **select the lines and set the numeric override in bulk**.

**It sets no direction vocabulary of its own** — it appends prose, which reaches the
one engine that reads prose, and that limit is stated on the scene screen.

## §5 The one real constraint — engines are not equal

**This is the fact the whole design has to keep saying out loud.** What a line can
express is decided when you choose the persona's voice, not when you write the line.

| Voice's engine | Emotion | Written direction | Cloning |
|---|---|---|---|
| **Qwen3 CustomVoice** | ✓ all nine | **✓ prose** | ✗ — nine presets only |
| **Chatterbox Turbo** | ✓ **six of nine** | ✗ ignored | ✓ |
| **Chatterbox Multilingual** | ✗ | ✗ | ✓ — 23 languages |
| **Qwen3 Base** | ✗ | ✗ — dropped silently | ✓ |
| **Kokoro** | ✗ | ✗ | ✗ — 54 presets |
| **LuxTTS** | ✗ | ✗ | ✓ — runs on CPU |

Chatterbox Turbo has no tag for **sad**, **shouted** or **contemptuous**. The
picker greys those three and says why. It does **not** substitute a near neighbour:
`[crying]` is a behaviour, not sadness, and sending it would put sobbing into a
quietly sad line.

**Three consequences the UI must carry:**

1. **The cast row states the trade at the moment of choosing.** Picking a cloned
   voice silently costs written direction; you must not find that out later, when
   the direction you wrote does nothing.
2. **Prefer emotion over prose** wherever both would do, because emotion survives a
   recast and prose does not.
3. **Nothing is ever silently dropped.** A control the engine cannot honour is
   shown, disabled, with its reason on it — never hidden, or the user cannot tell
   "off" from "absent".

### The direction-vs-identity trade, stated once

There are three routes to a directable custom voice and they are not equivalent:

| Route | Identity | Direction |
|---|---|---|
| Qwen3 CustomVoice preset | one of nine | **kept** |
| Clone (Chatterbox / Qwen3 Base / LuxTTS) | their own | **lost** — the identity comes entirely from the reference clip |
| LoRA trained on an instruct-capable checkpoint | their own | **kept** — costs a training run |

**A LoRA is the only way to have both.** The app should say so where the choice is
made, not in a help page.

---

## §6 The flow

```
Discover → Script → Cast → Render → Export
```

| Step | The one question it answers |
|---|---|
| **Discover** | Who is in this book? Reads the prose, proposes names, creates cast rows |
| **Script** | Who says each line? Attribution, and nothing else |
| **Cast** | What does each name sound like? Point each at a persona |
| **Render** | How is *this* line said? Emotion, direction, takes, and the render itself |
| **Export** | Master and ship |

Personas and Voices are **libraries**, not steps — you visit them from Cast when a
name needs a sound that does not exist yet, and they are equally reachable with no
project open at all.

### Screen by screen

**Voices** — a catalogue. 63 presets plus what you have cloned. Read-mostly: you
browse, audition, rename, export, delete. **No tuning, and it is not where work
happens** — you can go a whole project without opening it.

**Personas** — what you have made, and the surface where everything happens. Each
is a voice plus its tuning, named. Opening one is the **workbench**:

1. **Pick or make its voice** — the picker carries every source inline: a built-in
   preset, clone from audio, design from words, blend two, a trained LoRA. **You
   never leave the persona to make a voice.** Whatever you make also lands in the
   Voices catalogue so another persona can use it later.
2. **Hear it** — your own text, no project and no cast. Keep the WAV.
3. **Tune it** — level, pace, pitch, pauses, standing delivery, effects, sampling.
4. **Save** — or *save as a new persona*, a record pointing at a parent plus your
   changes: no audio, no training, so a variant costs nothing.

> **The gotcha that has to be on the card: design-from-words does not give you a
> directable voice.** Qwen's VoiceDesign produces *audio* from your description,
> which is then cloned — and a clone always loses written direction, because the
> identity comes entirely from the reference. You use Qwen to design it and the
> result cannot take Qwen's prose. Counterintuitive enough that it must be said
> where the choice is made.

**Cast** — names. Name, persona, who they are, role, aliases. Zero sliders. The row
states what this persona's engine can do, and links to the workbench for tuning.

**Render** — the lines. Per line: emotion, direction, pause, numeric override, the
takes list. Who speaks a line is read-only here; that is Script's job.

**A persona must be listenable standing alone**, with no project and no cast
anywhere near it. That is not a nicety — it is the entire product for the dictation
and accessibility audiences, who never open a project.

---

## §7 Vocabulary — five words, and the ones that are banned

| Word | Means | Never means |
|---|---|---|
| **Voice** | the raw timbre an engine ships, or one you cloned | a tuned, named sound |
| **Persona** | a voice + its tuning, named and reusable | a person in a book |
| **Cast** | the collective — this project's speakers. A screen and a list, **never an entity** | anything with settings on it |
| **Speaker** | one row of the cast: a name pointing at a persona | the persona itself |
| **Line** | one block of text and its moment | — |

**Banned: "character", "cast member", "voice profile", "render preset".** Every one
of them is a second name for something above, and every one of them has already
cost a session to untangle.

Casting is the verb, and it means exactly one thing: **point a speaker at a
persona.**

---

## §8 What this changes from the previous design

| Was | Now | Why |
|---|---|---|
| Knobs on the persona **and** the voice workbench | All on the persona | Two places was the whole confusion |
| Cast row carried delivery sliders | Cast row carries no audio settings | Made the cast look like it owned the sound |
| Persona = the character, project-scoped | Persona = the tuned sound, library-level; the **speaker** is the name in the book | 20 personas can cover 500 NPCs |
| Personas screen was an "index" pointing at Cast | Personas is the workbench — where tuning happens | An index that owns nothing was a signpost, not a door |
| "Voice tuning" vs "persona tuning" as two layers | One layer | The audit found no legitimate voice-level slider once level became a *measurement* |

**Level is a gain control with a measuring assist — not a ritual.** An earlier draft
made it a measurement you performed, "calibrated against the ACX target". That was
wrong: ACX applies to the **finished file**, which `mastering.py` already handles with
ffmpeg `loudnorm`. A single persona is never mastered against it.

What is real: a clone can land 6 dB down, and only rendering reveals it, because the
reference clip is an *input* to the model rather than its output. And mastering does
not rescue it — normalising the finished mix leaves that character quiet **relative to
the rest of the cast**.

So: a plain **gain** slider, plus a **Match the cast** button that renders one probe
line, reads its RMS via `audio/analyzer.py::_compute_loudness`, and sets the gain so
this persona sits level with the others. The slider is the control; the measurement is
an assist.

---

## §9 Decided, and still open

**Decided** — §1 the four things and the rule · §2 the knob inventory · §3 reuse ·
§4 emotion on the line · §5 the engine constraint and that nothing is silently
dropped · §7 the vocabulary.

**Closed 2026-08-17.** Three things were briefly listed here as open. All three are
now shut, and the record of *why* matters more than the answers:

1. ~~**Scene-level pace.**~~ **Rejected.** It could not be justified: a blunt
   multiplier across a chapter sounds mechanical, and it is the render-preset shape
   — a scoped thing that reaches everyone. **Bulk-select lines and set the numeric
   override** does the job precisely and adds no layer. *I proposed it without
   justifying it, which is the failure mode this doc exists to stop.*
2. ~~**Can a speaker change persona mid-book?**~~ **Not a question.** Old Mara and
   young Mara are genuinely **two personas** — two voices, two tunings, built
   separately. Two personas and two cast rows, with the flashback lines
   re-attributed. The "default persona plus per-scene exceptions" mechanism I
   sketched was machinery for something the model already handles honestly.
3. ~~**Half the roster can only be directed with numbers.**~~ **Not a product
   crisis — a rendering rule.** The persona knows its voice, the voice knows its
   engine, the engine declares what it supports, and the UI draws exactly that:
   direction box shown or disabled with its reason, emotion picker full / partial /
   absent, sampling knobs per engine, paralinguistic tags only where they exist.
   Someone who picks Kokoro gets 54 clean voices and directs with numbers, and the
   persona said so when they chose. Someone who wants both a cloned identity and
   written direction trains a LoRA. Nothing further is needed.

**Genuinely still open:** nothing in the model. If something feels open, it is
probably a feature nobody has justified yet — and the rule is now explicit:
**justify a feature fully before proposing it, or do not raise it.**

**Requires building, not designing:**

- a `blocks.emotion` column — per-line emotion has no home in the database today,
  and the import path already writes an emotion column into `Block.direction` as
  prose, where it reaches one engine
- host-side pace, so it works on every engine rather than two
- the capability verdict being **variant-aware**, not engine-level — Qwen3 declares
  cloning at engine level as the union of its variants, so a persona on CustomVoice
  would otherwise show a green tick for something it cannot do
- the "N lines have an emotion this voice cannot perform" count on the voice picker

---

## §10 How to use this doc

Before designing any surface that touches sound, answer three questions from §1–§2:
**which layer owns this setting, what happens to it when the persona's voice
changes, and what does the engine actually do with it.** If a screen cannot answer
all three, it is not ready to build.

And if the question *"where do the knobs live"* is ever asked again, the answer is
one line: **on the persona** — and this doc, not a fragment of a longer one.
