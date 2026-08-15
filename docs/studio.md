# Studio — Script → Cast → Render

Studio is the multi-character production environment: work out who speaks each
line, give those speakers voices, render the whole project. The tab names adapt
to your project kind (chapters for audiobooks, quests for game projects,
segments for podcasts) — same flow, your vocabulary.

**Why Script comes first.** Analyzing a chapter is what *finds* your cast. On an
imported manuscript the project starts with one persona — the Narrator — and
**Find new speakers** discovers the rest from the prose and adds them to the
project. Casting before that would mean assigning voices to a list of one. So
the steps run **Script → Cast → Render → Export**, and each is numbered in the
tab strip.

**Game projects are the exception**: they have no Script step at all. A line
list arrives from the writers with its characters already attached, so a game
project runs **Cast → Render → Export**.

If your cast is already complete — a JustWrite import that brought its
characters, or a project you have analyzed before — nothing stops you clicking
straight to Cast. The order is the path of least surprise, not a lock.

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

When Analyze meets speakers that aren't in your cast, a **discover-speakers**
banner offers to promote them to personas in one click.

## Cast

Every character in the project, with their voice assignment — the speakers
Script found, plus the Narrator and anyone a JustWrite import brought with it.
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
2. the project's own mastering preset (Projects → the project's settings),
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
