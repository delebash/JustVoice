# Studio — Overview · Discover · Script · Cast · Render · Export

Studio is a project's home. Opening a project — from Projects, Home's
**Resume**, the title-bar switcher, or right after creating or importing one —
always lands on its **Overview**. From there the steps run in order:

**Discover → Script → Cast → Render → Export**

The step names adapt to your project kind (chapters for audiobooks, quests for
game projects, episodes for podcasts) — same flow, your vocabulary.

**Why Discover comes first.** Script can only give a line to a persona that
already exists. On an imported manuscript the project starts with one persona —
the Narrator — so Discover reads the prose for the other names and, when you say
so, creates personas for them. Casting before that would mean assigning voices
to a list of one.

**Game projects are the exception**: they have no Discover or Script step. A
line list arrives from the writers with its speakers already attached, so a game
project runs **Lines → Cast → Render → Export**, where **Lines** is the same
line-by-line grid as the Lines tab.

If your cast is already complete — a JustWrite import that brought its
characters, or a project you have analyzed before — nothing stops you clicking
straight to Cast. The order is the path of least surprise, not a lock.

## Overview

The project's own page. **Where it stands** has one row per step, and clicking a
row opens that step:

| Step | What the row says |
|---|---|
| Discover | how many chapters have been scanned, and how many proposed speakers are waiting for **＋ Add** or **Ignore** |
| Script | how many chapters are analyzed, and how many lines still need a speaker |
| Lines (game) | how many lines the sheet has |
| Cast | how many personas have a voice, and how many lines are blocked on one that doesn't |
| Render | how many lines are rendered and current, out of those that can render |
| Export | what Export makes — it keeps no record of past exports, so there is no count |

Every number is read from the project itself; nothing is estimated. Export
shows no count because nothing records an export.

**Continue ➜** opens the first step that still has work in it.

**Project** holds the settings, saved as you type:

- **Title** and **Description**.
- **Author** — written into the M4B you export as its author.
- **Kind** — shown, not editable; it is fixed when the project is created.
- **Mastering target** — what every render is mastered to, and what Export
  checks against. *This kind's default* means ACX for an audiobook, podcast
  loudness for a podcast, and raw for everything else; **None — raw** means
  raw whatever the kind. See [the mastering target](#the-mastering-target).

**Also from here:** **Re-import** merges a newer version of the source file into
this project, and **Export .justvoice.zip** saves the whole project as one file.
**Delete project** asks first, then removes the project and everything in it;
takes, generations, personas, voices and lexicons are kept.

## Discover

Finds the people your text names who aren't in the cast yet. It creates
nothing on its own.

1. Tick the chapters to read — the checkbox in the header selects them all. The
   line count updates as you tick. **Last scanned** says when each chapter was
   last read, and **Proposed** how many of its names still wait on you.
2. **Scan** reads them one at a time, one model call per chapter. The task strip
   at the top of the page shows which chapter it is reading and how far along
   it is, and **Cancel** stops it after the chapter in hand. Each row fills in
   as its chapter finishes, so you can start on the results before a long scan
   ends. Scanning a chapter again replaces its last scan.
3. **Proposed speakers** lists every new name found: roughly how many lines
   they speak in what was scanned (**0** means named but not heard speaking),
   the **First appearance** — the quote that names them — and which chapters.
   Spellings of one person are one row: "Sedge" and "Old Sedge" show as *Old
   Sedge, also written Sedge*.
   - **→ Name · in your library** means the name refers to a persona you
     already have, but not in this cast ("Brick" → *Brick Halvorn*). **＋ Add**
     then puts that persona in the cast and remembers "Brick" as another name
     for him — it never makes a duplicate. Discover shows the model the
     personas in your library that the chapter could be naming, with their
     *Also called* names and the first line of their description, so a
     nickname that only appears in a description is caught too: if Odeline
     Marran's description says *"Answers to Ode."*, "Ode" comes back as
     *→ Odeline Marran · in your library*, not as a new person.
   - Otherwise **＋ Add** creates a new persona, keeping any other spellings as
     its *Also called* names.
   - **quote not in the chapter** means the quote the model gave is not in the
     text — treat the name as suspect.
   - **Ignore** drops the name and keeps it out of every later scan of this
     project. Ignored names are listed under **Ignored**; **Restore** lets
     Discover propose one again.

**What counts as a name.** Discover proposes everyone the text *names* — a
proper name ("Edith") or a title used as one ("the harbour-master") — whether
or not they speak in the chapters scanned; Script decides who says which line.
It never invents a label from how someone talks or is addressed ("child", "the
elder"), so a chapter whose dialogue is never tied to a name proposes no one.

The instructions Discover gives the model are the **Find new speakers** feature
in AI Settings → Features. Edit and save them there and the next scan uses your
text; **Reset** puts the shipped text back.

**Already in the cast** shows who Script can choose from.

Scan results are saved with each chapter, so they are still there after you
move to another step, switch project, or restart the app. A scan keeps running
while you look at another step. Discover needs a language model; without one,
Scan says so.

Discover only proposes names that are **not** in the cast yet — someone you
already cast never appears here, however much they speak, and whatever the
text calls them: their full name, first name, surname, or any of their *Also
called* names. The model is also given each cast member's one-line character
sheet, so a nickname the sheet mentions ("Answers to Ode") is recognised too.

**A named thing can still slip through.** A named, enchanted object — a maul
called *Gudgeon* that rides a character's shoulder — can read to the model as
a being, and it may propose it. **Ignore** it once and it stays out.

## Script

**Analyze** works out who speaks each line, and **saves the result onto the
chapter**. Leave the tab, switch chapters, close the app — the analysis is
still there when you come back, and the Script step card counts how many
chapters are done. There is no separate "apply" step: the run *is* the save.

### How it decides — and what the labels mean

Attribution is four passes, and only one of them is the model. Each row's
**Decided by** chip says which pass answered it, so you can tell a certainty
from a guess at a glance:

| Chip | What happened |
|---|---|
| `narration` | Not speech at all. The text outside quote marks is prose; it goes to your **Narrator** and the model is never asked about it. |
| `tag` | A dialogue tag right next to the line named the speaker — *"…," said Hale*. Found by pattern matching, no model involved. |
| `propagated` | The line had no tag of its own, so it inherited the speaker from the nearest tagged line **in the same paragraph**. |
| `llm` | The model worked it out from context and was confident enough to keep. |
| `floored` | The model answered but wasn't sure enough, so its answer was **thrown away** and the line left with no speaker. The floor only ever discards a weak answer — it never promotes one. |
| `corrected` | You set this one. Re-analyzing leaves it exactly as it is. |
| `manual` | A block you wrote or pasted yourself. Nothing has attributed it. |

**How the model reads an `llm` line.** It reads each line in its surroundings —
who was just spoken to, whose actions and thoughts fill the paragraph, who a
*"she said"* points back to — and when two people trade untagged lines with
nothing breaking in, it follows the turn order (those answers carry a lower
confidence, because they are an inference rather than a tag). It thinks the
chapter through before it answers, which is what makes it accurate and also
what makes it take time: on the built-in Gemma model with an 8 GB graphics
card, expect about a minute per chapter. To trade some accuracy for speed,
turn thinking off on the **Reasoned extraction** preset (AI Settings →
Routing by feature).

**When the model can't answer, Analyze says so.** If the model call fails,
the run stops, the task strip shows it as failed, and the message says why;
nothing is saved and the chapter keeps its previous analysis. The common
case is a chapter too long for the model to read at once: *"The chapter is
too long for the model to read in one go. This chapter is 34,514 tokens and
the model holds 32,768."* The built-in Gemma model reads chapters of 8,000
words or so as well as short ones; past its limit, split the chapter into
smaller ones. A timeout or a model that would not load reports the
provider's own message the same way.

The **read** note in the header (*"read with examples"* / *"read rules only"*)
is which prompt the model got — the longer one carries worked examples, and
JustVoice picks based on your model's size. Click **what do these labels mean?**
for the same table in-app.

### Fixing what it got wrong

Every row has a speaker dropdown — narration included. That matters: a line of
prose the model mistook for dialogue, or a dialogue line handed to the wrong
character, are both fixed the same way. The change saves immediately, the chip
turns to `corrected`, and **that correction teaches the next run**: your recent
fixes are fed into the prompt as worked examples, so the same mistake stops
recurring across the rest of the book.

**Lines with no speaker block the render.** A line nobody speaks can't
become audio, and JustVoice will not quietly leave a sentence out of your
audiobook. The Script tab counts them and offers one button — *Assign N →
Narrator* — and if you go to Render first, the render stops and lists them
with the same button.

**Music and ad markers are not lines.** A podcast import turns `— Mid-roll —`
into a `♪ marker` row: it has no speaker by design, it is never counted
among them, and it never blocks a render. You can't assign it a voice, because
giving a music cue a narrator is the one wrong answer.

**Some chapters arrive already cast.** A podcast script that labels its
speakers (`HOST:`) is attributed the moment it's imported — Script shows the
table and offers **Re-analyze**, not a blank Analyze prompt, so a single click
can't throw away speaker names the file already told us.

**Cancel means cancel.** Stopping a run mid-flight leaves the chapter exactly
as it was; nothing is written.

### Re-analyze

Once a chapter is analyzed the button becomes **Re-analyze**. It does *not*
re-cut the text: the chapter keeps exactly the blocks it has, and rows you
corrected are left untouched. What changes between runs is everything around
the model — a bigger cast means more names the pattern passes can match, and
your corrections go into the prompt. That is what re-analyze is for: fix five
rows, run it again, and the model applies the same reasoning to the rest.

If neither the cast nor your corrections have changed, re-analyzing mostly
burns tokens for the same answer.

One case does re-cut: the **first** analyze of an imported chapter. Import
stores one block per paragraph, and attribution needs one block per speaker
turn, so the paragraphs are split. If the chapter already has recorded takes,
JustVoice refuses to re-cut rather than destroy them.

Analyze does not look for new speakers — that is [Discover](#discover). A line
whose speaker isn't in the cast comes back with no speaker; add that person in
Discover, then analyze again.

## Cast

Every character in the project, with their voice assignment — the speakers
Discover added, plus the Narrator and anyone a JustWrite import brought with it.
Add a character, open the voice params modal to tune their delivery, and press
**▶** to hear a voice preview before committing — the preview plays a stock
sample line, not a line from your script. **Smart assign** asks the LLM to
propose voices for the whole unassigned cast in one pass, and you accept or
change per row.

## Render

Batch-render the project scene by scene. Each scene can bind a **render preset**
(see [Presets](render-presets.md)) so a chapter or quest keeps one locked sound;
**Suggest** proposes a preset per scene. The progress panel shows per-scene
status, and the render cache means an unchanged line costs nothing to re-render
— cache hits are reported as such.

### One Qwen3 model at a time

Qwen3 is three separate models — **CustomVoice** for its nine preset speakers,
**Base** for anything cloned or trained, **VoiceDesign** for a designed voice
with no kept clip — and only one of them fits in memory at once. A cast that
mixes them cannot be rendered in a single pass.

JustVoice checks before it starts and refuses the whole render rather than
getting halfway, naming every voice and the model it needs. Load the model
those voices want, or split them into separate scenes. Casting everyone on
one kind of voice is the way to avoid it entirely — and note that
[keeping a designed voice](voices.md#keeping-a-designed-voice-is-what-makes-it-one-voice)
moves it from VoiceDesign to Base, which is usually where the rest of your
cast already is.

### What a render actually does to your audio

Three things happen to every line, in this order:

1. **The voice speaks it** — the persona's voice, its delivery settings, and
   the render preset's overlay on top.
2. **The persona's effects chain runs** — reverb, EQ, compression, whatever
   you built in the persona's effects editor, with the render preset's chain
   layered after it. This is the same processing the single-line preview
   applies, so what you auditioned is what the chapter contains. (Chapter
   renders skipped effects entirely until 2026-08-15: the editor saved them
   and only single-line previews ever played them.)
3. **The chapter is mastered** — see below.

Each line is cached on everything that shapes it, the effects chain included,
so editing one character's reverb re-renders that character's lines and leaves
the rest of the chapter alone.

### The mastering target

The pill at the top of the Render tab names the mastering target these
renders apply, and where that choice came from. JustVoice picks it in this
order, first answer wins:

1. the render preset bound to the scene, if it names a master target,
2. the project's own mastering target (Studio · **Overview**),
3. the default for the project kind — **audiobook → ACX**, **podcast →
   podcast**, and **game voicelines → none** (a game engine wants the raw
   line to run through its own audio bus), **custom → none**.

Setting a target to **none** at any level means exactly that: ship it raw.

A chapter render gives you a **WAV** — the mastering *processing* (loudness,
true-peak ceiling, head/tail silence) is applied, but the encoding is not.
That is deliberate: you are auditioning here, and the .m4b export encodes
once, at the end, instead of stacking two lossy passes. The encoded
deliverable (ACX's MP3, YouTube's M4A) comes from Export.

Mastering needs **ffmpeg**. Without it the pill says so and chapters render
raw rather than failing — install ffmpeg and restart the server to get the
target applied.

### The ACX check

**Run ACX QC** renders every chapter (cache-served when unchanged) and
measures RMS and peak against the ACX limits. It measures the **mastered**
chapter — the audio the export would ship — so a pass means the finished book
passes. If ffmpeg is missing, QC still runs and tells you the numbers are for
the raw render and not what the finished book would measure.
