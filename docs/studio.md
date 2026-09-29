# Studio — Overview · Discover · Script · Cast · Render · Export

Studio is a project's home. Opening a project — from Projects, Home's
**Resume**, the title-bar switcher, or right after creating or importing one —
always lands on its **Overview**. From there the steps run in order:

**Discover → Script → Cast → Render → Export**

The step names adapt to your project kind (chapters for audiobooks, quests for
game projects, episodes for podcasts) — same flow, your vocabulary.

**Why Discover comes first.** Script can only give a line to a persona that
already exists. A new project starts with an empty cast, and an import brings
only the characters its manuscript lists — so Discover reads the prose for
everyone it names and, when you say so, creates personas for the new ones.
Casting before that would mean assigning voices to a list that isn't finished.

**Game projects are the exception**: they have no Discover or Script step. A
line list arrives from the writers with its speakers already attached, so a game
project runs **Lines → Cast → Render → Export**, where **Lines** is the same
line-by-line grid as the Lines tab.

If your cast is already complete — a JustWrite import that brought its
characters, or a project you have analyzed before — nothing stops you clicking
straight to Cast. The order is the path of least surprise, not a lock.

**Switching steps keeps your place.** Go from Script to Cast and back and Script
is as you left it: the same chapter or grid, the same ticks and filters, the same
selected line and scroll position. Discover keeps its ticks the same way.

## Overview

The project's own page. **Where it stands** has one row per step, and clicking a
row opens that step:

| Step | What the row says |
|---|---|
| Discover | how many chapters have been scanned, and how many proposed speakers are waiting for **＋ Add** or **Ignore** |
| Script | how many chapters are analyzed (or, for a script whose speakers came with the import, how many have speakers), and — in what Analyze decided — how many lines have **no speaker** and how many are **flagged**. Either number opens Script's grid on *To check* |
| Lines (game) | how many lines the sheet has |
| Cast | how many personas have a voice, and how many lines are blocked on one that doesn't |
| Render | how many lines are rendered and current, out of those that can render |
| Export | what Export makes — it keeps no record of past exports, so there is no count |

Every number is read from the project itself; nothing is estimated. Export
shows no count because nothing records an export.


**Project** holds the settings, saved as you type:

- **Title** and **Description**.
- **Author** — written into the M4B you export as its author.
- **Kind** — shown, not editable; it is fixed when the project is created.
- **Mastering target** — what every render is mastered to, and what Export
  checks against. A new project starts on its kind's target — ACX for an
  audiobook, Podcast for a podcast, **None — raw** for everything else — and you
  can change it to any of them. See [the mastering target](#the-mastering-target).

**Also from here:** **Re-import** merges a newer version of the source file into
this project, and **Export .justvoice.zip** saves the whole project as one file.
**Delete project** asks first, then removes the project and everything in it;
takes, generations, personas, voices and lexicons are kept.

## Discover

Finds everyone your text names — people already in your cast, people in your
library, and new names — and keeps that record for each chapter. It creates
nothing on its own.

1. Tick the chapters to read — the checkbox in the header selects them all. The
   line count updates as you tick. **Last scanned** says when each chapter was
   last read, and **Found** how many people it names, with how many of them are
   **new** (not in this cast yet).
2. **Scan** reads them one at a time, one model call per chapter. The task strip
   at the top of the page shows the chapter it is reading, and **Cancel** stops
   the scan. Each row fills in as its chapter finishes, so you can start on the
   results before a long scan ends. Scanning a chapter again replaces its last
   scan. The scan shares one run of chapters with Script's Analyze: if an
   Analyze is going, the scan **starts after** it, and a chapter already in the
   run can't be ticked.
3. **Characters found** lists everyone the scanned chapters name, each person
   once, with a **status**, roughly how many lines they speak in what was
   scanned (**0** means named but not heard speaking; a cast member shows how
   many times the text names them instead), the **First appearance** — the
   quote that names them — and which chapters. Spellings of one person are one
   row: "Sedge" and "Old Sedge" show as *Old Sedge, also written Sedge*. The
   chips above it filter the list: **All**, **New** (everyone not in this cast
   yet — new names and people in your library), **In the cast** and
   **Ignored**. The statuses:
   - **In the cast** — someone this cast already has, whatever the text calls
     them: full name, first name, surname, or one of their *Also called* names.
     Nothing to do.
   - **In your library** — a persona you already have, but not in this cast
     ("Brick" → *Brick Halvorn*). **＋ Add** puts that persona in the cast and
     remembers "Brick" as another name for him — it never makes a duplicate.
     Discover shows the model the personas in your library that the chapter
     could be naming, with their *Also called* names and the first line of
     their description, so a nickname that only appears in a description is
     caught too: if Odeline Marran's description says *"Answers to Ode."*,
     "Ode" comes back as *Odeline Marran*, In your library, not as a new person.
   - **New** — no persona has this name. **＋ Add** creates one, keeping any
     other spellings as its *Also called* names. Names are unique within a
     book, so Add is refused if the cast already has someone by that name
     ([Personas → Names](personas.md#names)).
   - **Ignored** — you ignored the name for this project. **Undo** (or its **✕**
     in the **Ignored** box below) shows it as new again; **Clear all** there
     empties the list.

   **Add** and **Ignore** change a row's status — they never remove it, so
   rescanning a chapter you've finished still shows everyone it names.
   - **quote not in the chapter** means the quote the model gave is not in the
     text — treat the name as suspect.
   - **Several at once:** tick the waiting names (the box in the header ticks
     every New and In-your-library row shown), then **＋ Add N selected** or
     **Ignore N selected**. Each works exactly as its row's own button would — a
     library match still links that persona.

**What counts as a name.** Discover proposes everyone the text *names* — a
proper name ("Edith") or a title used as one ("the harbour-master") — whether
or not they speak in the chapters scanned; Script decides who says which line.
It never invents a label from how someone talks or is addressed ("child", "the
elder"), so a chapter whose dialogue is never tied to a name proposes no one.

The instructions Discover gives the model are the **Find new speakers** feature
in AI Settings → Features. Edit and save them there and the next scan uses your
text; **Reset** puts the shipped text back.

**Already in the cast** shows who Script can choose from. A name's **✕** takes
that persona out of this project's cast, and **Clear all** takes out everyone
but the Narrator. Neither asks first. The persona stays in your library, and
lines already given to them keep them — Script then says they aren't in the
cast, with a button to put them back.

Scan results are saved with each chapter, so they are still there after you
move to another step, switch project, or restart the app. Scanning a chapter
again replaces that chapter's record. A scan keeps running while you look at
another step. Discover needs a language model; without one, Scan says so.

**Your cast is found without the model.** A cast member counts as named when
the chapter uses their full name or one of their *Also called* names, or their
first name or surname alone (three letters or more, capitalised) when no one
else in the cast shares it — so the same scan always finds the same people. The
model is asked only for the names that are new. It is given each cast member's
one-line character sheet, so a nickname the sheet mentions ("Answers to Ode")
is not proposed as someone new.

**A named thing can still slip through.** A named, enchanted object — a maul
called *Gudgeon* that rides a character's shoulder — can read to the model as
a being, and it may propose it. **Ignore** it once and it stays out.

## Script

Script answers one question: **who says each line**, so each one is voiced by
the right persona. It has two pages: the **chapter grid**, where Script opens,
and a **chapter**, where you read and fix one chapter's lines.

Every spoken line gets its speaker in one of three ways:

- **Narration** — text outside quote marks. It goes to your **Narrator** and
  the model is never asked about it. Certain.
- **The book names the speaker** — the words next to the line say who
  (*“By twenty minutes,” said Marius.*). Found by pattern, with no model
  involved, and near-certain: 62 of 62 right on the published test book. A line
  with no name of its own in the same paragraph as a named one takes that
  speaker too.
- **The AI decides** — nothing names the speaker, so the model reads the story
  around the line and works it out. Most spoken lines are decided this way, and
  the AI is right on nearly all of them (about 99 % on the three test books) —
  but it is sure even when it is wrong, so its confidence alone is no warning.

Its most common mistake is losing track of turns in a back-and-forth: two
people alternate, and it gives two lines in a row to one of them. That is what
the **Check** column is for — see [the marks](#the-marks-where-to-read-closely).

Analyze saves the result **onto the chapter**. Leave the page, switch
chapters, close the app — it is still there when you come back. There is no
separate "apply" step: the run *is* the save.

### The chapter grid

One row per chapter:

| Column | What it says |
|---|---|
| **Lines** | every line with text, narration included |
| **Analyzed** | when Analyze last ran on it — *never*, *from the import*, or a time. A chapter analyzed before this version shows *analyzed* with no time |
| **Book says** | lines whose speaker the book names next to them, or elsewhere in the same paragraph |
| **AI decided** | lines whose speaker the AI worked out |
| **Flagged** | lines that carry a mark — [where to read closely](#the-marks-where-to-read-closely) |
| **No speaker** | lines with no speaker. These block the render |

*Book says* + *AI decided* + the lines you set + *No speaker* add up to the
chapter's spoken lines. The numbers only count what Analyze decided: a chapter
never analyzed shows **—**.

A row can also carry a tag:

- **Name added since** — the chapter was analyzed before that persona joined
  the cast, and its text names them (their name or an *Also called* name).
  Analyze couldn't choose them then. **Re-analyze** on the row runs it again;
  lines you set are kept.
- **no dialogue found** — nothing in the text was read as speech, so every line
  went to the Narrator. Speech in ‘single quotes’, «guillemets» or after a dash
  isn't read as dialogue.
- **failed** — the model call failed; the reason is on the row, and nothing
  was saved.
- **can't re-cut** — the text changed after takes were recorded, and analyzing
  would re-cut the lines and delete those takes, so it stopped. **Takes ➜**
  opens Render.

**The chips** above the grid show the chapters in one state: **To check**
(flagged lines, or lines with no speaker), **Not analyzed**, **Re-analyze**
(someone was added since), **Needs attention** (failed, no text, no dialogue
found). The tick box in the header ticks **only the chapters shown**, so "To
check" → tick all → Analyze re-runs exactly those.

**Analyzing chapters.** Tick them and click **✨ Analyze N chapters**. They run
one at a time, one model call per chapter (a long chapter is read in pieces —
see below), and each row fills in as its chapter finishes. The run shows
above the grid with the chapter it is on, how many are done, the time so far
and — once one has finished — about how long is left, and the task strip
below it shows that chapter's live progress. **Cancel** stops the run; the
chapters already analyzed are kept.

**The run keeps going while you work elsewhere** — another step, another view.
There is one run of chapters per project at a time, shared with Discover's
scan: start one while another is going and it **starts after the current run**.
A chapter already in the run can't be ticked again.

**How the model reads.** The dropdown beside Analyze says how the model will
read: *chosen for your model* (the default — JustVoice picks by the model's
size), *with examples* (a longer prompt with worked examples, for smaller
models) or *rules only*. **Keeps answers above** is the confidence the model's
answer must reach to be kept; below it the line is left with no speaker.

**Two things stop Analyze**, and the grid says so instead of letting it fail:

- *Analyze needs a language model. Set one in AI Settings ➜*
- *Your cast has only the Narrator, so Analyze has nobody to choose from. Find
  the speakers first — Discover ➜*

A row opens its chapter. **Review** opens it at the first line to check.

### A chapter

The chapter page is a table in reading order: **one row per line**, with a
speaker dropdown on every row.

| Column | What it says |
|---|---|
| **Speaker** | who says the line. Change it here; a line you set is yours, and Analyze leaves it alone |
| **Decided by** | why the line has its speaker — the evidence, not a category (below) |
| **Text** | the line |
| **Confidence** | how sure the AI said it was. A low number is worth a look; a high one is not proof — the AI has been 100 % sure and wrong. A line you set shows **—** |
| **Check** | the question to ask about a marked line, or why a line can't render |

**Decided by** reads:

| It says | Meaning |
|---|---|
| **Narration** | prose, not speech |
| **“said Marius”** *the book says so* | the book's own words next to the line name the speaker — you can check it against the text |
| **“said Marius”** *earlier in the same paragraph* (or *later*) | no name on this line; it has the speaker named elsewhere in its paragraph |
| **AI, from the story around it** | the AI worked it out |
| **AI wasn't sure** | the AI answered, but below *Keeps answers above*, so the answer was dropped and the line has no speaker |
| **AI gave no answer** | the AI's answer had no entry for this line |
| **AI named no one in the cast** | the AI's answer wasn't anyone in the cast |
| **You** | you set or confirmed it |
| **From the import** | the imported script named the speaker; nothing analyzed it |

A line whose speaker the **last Analyze changed** carries **changed · was
June**. The lines of one paragraph sit together — the divider is drawn only
under a paragraph's last line.

**Filters.** **All**, **To check** (marked lines and lines with no speaker),
**No speaker**, and — after a re-analyze that changed anyone — **Changed**.
Each chip's number is the number of rows it shows. The speaker dropdown beside
them shows one persona's lines. **Next to check ➜** jumps to the next marked or
no-speaker line in reading order, and scrolls it into view. Past the last one it
starts again from the top ("Back to the first line to check"), so with a single
line to check it always takes you there. `Shift+N` goes the other way and wraps
to the bottom.

**Fixing lines.**

- Pick a speaker in the row's dropdown. It saves at once, and the line becomes
  yours. (On a chapter Analyze has never run on, the speaker is saved but the line
  isn't marked yours, so a first Analyze can still decide it.)
- **Tick** several rows, then **Set the speaker of ticked lines…**, or **⇄ Swap
  their two speakers** — for ticked lines spoken by exactly two personas, each
  line goes to the other one. That is the fix for a back-and-forth the AI got
  the wrong way round, which no mark can spot.
- **✓ Looks right** on ticked lines makes them yours without changing them.
- **↶ Undo** steps back through your changes since you opened the chapter,
  newest first. Opening another chapter, or re-analyzing this one, clears it;
  switching to another step and back does not.
- **👁 Show the lines around** (at the foot) adds the line either side of each
  line a filter shows.

**Your fixes teach the next Analyze.** Changing a speaker the AI chose saves
it as a worked example; the next run gets your recent fixes in its prompt, so
the same mistake stops recurring across the book. **Undo** also removes the
example the undone change saved, so a mis-click doesn't teach anything.

**Lines with no speaker block the render.** A line nobody speaks can't become
audio, and JustVoice will not quietly leave a sentence out of your audiobook.
The banner above the table counts them and offers **Assign N → Narrator**. If
you go to Render first, the render stops and lists them; **Fix in Script ➜**
there opens the chapter on its lines with no speaker, the first one selected.

**A speaker who left the cast.** Removing a persona from the cast leaves the
lines already given to them as they are. The chapter says so — *Tom Harlan
isn't in this cast. 14 lines in this chapter are theirs* — with **Put them back
in the cast**. Their rows show *Tom Harlan — not in this cast* in the dropdown.
It doesn't block the render.

**Music and ad markers are not lines.** A podcast import turns `— Mid-roll —`
into a `♪ Marker` row: it has no speaker by design, it is never counted, and it
never blocks a render.

**✨ Re-analyze this chapter** runs Analyze on this chapter and stays on the
page. **📚 Analyze several chapters** opens the grid. **🔍 A speaker is
missing** opens Discover — Analyze can only choose personas in the cast.
**← Previous** and **Next chapter ➜** at the foot walk the book in order; the
next one says how many lines it has to check.

**Rewrite in character.** Right-click a spoken line's text to have the AI
rewrite it in its persona's voice; you see the rewrite before anything
changes, and accepting replaces the line's text.

Direction, takes and rendering are not on this page: Script decides who says
what, and how it is performed is [Render](#render).

### The marks: where to read closely

A mark tints the line and asks its question in the **Check** column. It marks
the shape the AI's mistakes take, measured on three answer-keyed books before
it was built:

| Mark | The question |
|---|---|
| One persona speaks **three or more times in a row** — back-to-back spoken paragraphs, no narration-only paragraph between, all theirs | *Marius speaks 3 times with no reply — is one of these the other person's?* The **whole run** is marked: the wrong line is as often the middle one as the last |
| A persona's **only line** in the chapter | *Harbek's only line in this chapter — is it theirs?* |
| **The book and the AI disagree** — the book's words named one speaker, the AI said another | *The book says June, the AI says Marius — whose line is it?* |

A speech that runs over several paragraphs — each opens a quote, only the last
closes it — counts as **one** turn, so a long account never looks like three.

The line may well be right. **👁 Show the lines around** shows every line
again with this one selected, so you can read the exchange. **✓ Looks right**
is optional: it makes every line sharing the mark yours and takes them out of
*To check* — the lines render the same either way.

Marks only go on what Analyze decided: never on a line you set or confirmed,
and never on a chapter whose speakers came with the import.

**What the marks can't see.** On the published test book the marks caught 1 of
4 wrong lines: two people trading lines the wrong way round breaks no rule of
prose, so nothing marks it. Reading stays necessary; the marks shorten it, and
**⇄ Swap their two speakers** fixes exactly that miss.

### Keyboard shortcuts

An extra, behind **⌨ Shortcuts** — everything is also a click. They act on the
selected line (click a row to select it), and do nothing while you type or a
dropdown is open.

| Key | Does |
|---|---|
| `j` / `k` | next / previous line |
| `n` / `Shift+N` | next / previous line to check |
| `1`–`9` | give the line to that speaker — this chapter's, most lines first |
| `0` | give the line to the Narrator |
| `Enter` | this line looks right |
| `Shift+Enter` | looks right, for every line sharing its mark |
| `Space` | tick or untick the line |
| `[` / `]` | previous / next chapter |
| `Ctrl+Z` | undo your last change |

### How Analyze reads a chapter

Attribution is four passes, and only one of them is the model: the text is cut
into narration and speech at the quote marks; lines the book names are found by
pattern; lines with no name inherit one from the same paragraph; the model
decides the rest, and a model answer below the confidence floor is dropped.

**Quote marks.** Straight (`"`) and curly (`“ ”`) quotes both count, and a
speech that runs over several paragraphs — each opening a quote, only the last
closing it — is speech on every paragraph, with either kind. Single quotes are
never read as dialogue (they are apostrophes too often).

**How the model reads a line.** It reads each line in its surroundings — who
was just spoken to, whose actions and thoughts fill the paragraph, who a *"she
said"* points back to — and when two people trade untagged lines with nothing
breaking in, it follows the turn order (those answers carry a lower
confidence, because they are an inference rather than a tag). It thinks the
chapter through before it answers, which is what makes it accurate and also
what makes it take time: on the built-in Gemma model with an 8 GB graphics
card, expect about a minute per chapter. To trade some accuracy for speed,
turn thinking off on the **Reasoned extraction** preset (AI Settings →
Routing by feature).

**Long chapters are read in pieces.** Before it sends a chapter, Analyze
measures it against what the model can hold. The prompt goes through the
model's own tokenizer and is checked against its real context, with room kept
for the answer: about 65 tokens per dialogue line, since the model thinks
before it answers. On the built-in Gemma model a chapter of up to about
12,000 words fits in one go and is read whole. That is the most accurate way,
and real chapters are well under it. A longer chapter, such as a book
imported as one chapter, is cut into pieces:

- Cuts fall only between paragraphs, and at a scene break (`***`, `---`)
  when there is one near the end of a piece. A line and its *"…," said Hale*
  are never separated.
- Each piece starts with the last few paragraphs of the piece before, so the
  model knows who was speaking when the piece begins. Those lines are
  answered by the earlier piece; the repeat is only context.
- Every piece gets the whole cast, your corrections and the same prompt.
- It is still **one run**: one result, saved the same way. Nothing about the
  chapter changes.

Pieces also catch what measuring can't see. If the model refuses a piece as
too big, or its answer runs out of room and stops short, that piece is cut in
half and both halves are read. Discover reads a long chapter in pieces the
same way, and merges the names it finds in each.

**When the model can't answer, Analyze says so.** If the model call fails,
that chapter's row says **failed** with the reason; nothing is saved and the
chapter keeps its previous analysis. A timeout or a model that would not load
reports the provider's own message. The one length problem splitting can't
solve is a single paragraph too big for the model on its own: *"A paragraph of
this chapter is too long for the model to read, even on its own. It needs about
… tokens and the model holds …. Use a model with a larger context."*

**Cancel means cancel.** Stopping a run mid-chapter leaves that chapter exactly
as it was; nothing is written.

### Re-analyze

Re-analyzing a chapter does *not* re-cut its text: the chapter keeps exactly
the lines it has, and lines you set are left untouched. What changes between
runs is everything around the model — a bigger cast means more names the
pattern passes can match, and your fixes go into the prompt. That is what
re-analyze is for: fix five lines, run it again, and the model applies the
same reasoning to the rest. A line whose speaker it changes is marked
**changed · was June**, and the **Changed** filter shows just those — check
what moved, at no extra model cost. Setting or confirming the line clears the
mark.

If neither the cast nor your fixes have changed, re-analyzing mostly spends
time for the same answer.

One case does re-cut: the **first** analyze of an imported chapter. Import
stores one line per paragraph, and attribution needs one line per speaker
turn, so the paragraphs are split. If the chapter already has recorded takes,
JustVoice refuses to re-cut rather than destroy them (**can't re-cut**).

**Some chapters arrive with their speakers.** A podcast script that labels its
speakers (`HOST:`) is attributed the moment it's imported. Script shows those
chapters as **from the import** and never marks them; Analyze would replace
speakers the file already told us with the model's guesses, so run it only if
you mean to.

Analyze does not look for new speakers — that is [Discover](#discover). A line
whose speaker isn't in the cast comes back with no speaker; add that person in
Discover, then analyze again.

## Cast

Every character in the project, with their voice assignment — the speakers
Discover added, your narrator, and anyone a JustWrite import brought with it.
Names are unique within a book: adding someone whose name the cast already has
is refused ([Personas → Names](personas.md#names)).

Every card has a **Narrator** checkbox: the narrator reads everything that isn't
spoken, and any cast member can be it, because a first-person narrator also
speaks — tick it on Watson's card and his narration and his lines share one
voice. There is one narrator per project: ticking someone takes the role off the
persona who had it (they stay in the cast), and moves the narration Analyze
decided to them; lines you set yourself stay. The narrator's own box stays ticked
until you tick someone else's. A book has no narrator until you choose one —
nothing makes one on its own. With nobody in the role, **Add Narrator** puts a
persona called Narrator from your library that isn't in any book into the cast,
or makes one if there is none, and moves the narration that has no speaker to
it ([The Narrator](personas.md#the-narrator)).
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
