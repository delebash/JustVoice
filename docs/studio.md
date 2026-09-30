# Studio — Overview · Discover · Script · Cast · Render · Export

Studio is a project's home. Opening a project — from Projects, Home's
**Resume**, the title-bar switcher, or right after creating or importing one —
always lands on its **Overview**. From there the steps run in order:

**Discover → Script → Cast → Render → Export**

The step names adapt to your project kind (chapters for audiobooks, quests for
game projects, episodes for podcasts) — same flow, your vocabulary.

**Three words, one job each.** A **speaker** is a person in this book: a name,
the other names the text uses (*Also called*) and *Who they are*. A
**persona** is a finished spoken voice from your library: a voice and its
engine, plus speed, pitch, gain, direction and effects
([Personas](personas.md)). **Cast** gives each speaker a persona. One persona
can play many speakers, so change it once and all of them change. Discover
finds speakers, Script gives lines to speakers, Cast gives speakers personas.

**Why Discover comes first.** Script can only give a line to a speaker the book
already has. A new project starts with no speakers, and an import brings only
the ones its manuscript lists. So Discover reads the prose for everyone it
names and, when you say so, adds the new ones to the book as speakers. Casting
before that would mean giving personas to a list that isn't finished.

**Game projects are the exception**: they have no Discover or Script step. A
line list arrives from the writers with its speakers already attached, so a game
project runs **Lines → Cast → Render → Export**, where **Lines** is the same
line-by-line grid as the Lines tab.

If your speakers are already complete — a JustWrite import that brought them,
or a project you have analyzed before — nothing stops you clicking straight to
Cast. The order is the path of least surprise, not a lock.

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
| Cast | how many of the book's speakers are cast (*3 of 5 speakers cast*) — played by a persona that has a voice — and how many lines are blocked on a speaker who isn't |
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
- **Speech marks** — how the book marks speech: **Auto — from the text** (the
  default), **“Double”**, **‘Single’**, **«Guillemets»** or **„German“**. Every
  project but a game has it. See [speech marks](#speech-marks).
- **Leave out dialogue tags** — off by default. When it's on, the narrator skips
  lines like *“said Marius,”* that only say who spoke. See [leaving out dialogue
  tags](#leaving-out-dialogue-tags).

**Also from here:** **Re-import** merges a newer version of the source file into
this project, and **Export .justvoice.zip** saves the whole project as one file.
**Delete project** asks first, then removes the project and everything in it,
its speakers included; takes, generations, personas, voices and lexicons are
kept.

## Discover

Finds everyone your text names — speakers already in the cast, names a
persona in your library has, and new names — and keeps that record for each
chapter. It creates nothing on its own.

1. Tick the chapters to read — the checkbox in the header selects them all. The
   line count updates as you tick. **Last scanned** says when each chapter was
   last read, and **Found** how many people it names, with how many of them are
   **new** (not in the cast yet).
2. **Scan** reads them one at a time, one model call per chapter. The task strip
   at the top of the page shows the chapter it is reading, and **Cancel** stops
   the scan. Each row fills in as its chapter finishes, so you can start on the
   results before a long scan ends. Scanning a chapter again replaces its last
   scan. The scan shares one run of chapters with Script's Analyze: if an
   Analyze is going, the scan **starts after** it, and a chapter already in the
   run can't be ticked.
3. **Speakers found** lists everyone the scanned chapters name, each person
   once, with a **status**, roughly how many lines they speak in what was
   scanned (**0** means named but not heard speaking; a speaker in the cast
   shows how many times the text names them instead), the **First appearance**
   — the quote that names them — and which chapters. Spellings of one person
   are one row: "Sedge" and "Old Sedge" show as *Old Sedge, also written Sedge*.
   The chips above it filter the list: **All**, **New** (everyone not in the
   cast yet — new names and names a persona in your library has), **In the
   cast** and **Ignored**. The statuses:
   - **In the cast** — a speaker this book already has, whatever the text calls
     them: full name, first name, surname, or one of their *Also called*
     names. The row's action cell says *already in the cast*, with **Remove
     from cast** beside it (see [Removing a speaker](#removing-a-speaker)).
   - **In your library** — no speaker yet, but a persona in your library has
     exactly this name. **＋ Add** makes the speaker already cast with that
     persona, so Cast shows the assignment and you can change it. Only an exact
     name counts (case and extra spaces aside): the match is made in code, and
     the model is not sent your library. "Brick" is not matched to a persona
     called *Brick Halvorn* — it shows as New.
   - **New** — no speaker or persona has this name. **＋ Add** makes them a
     speaker in this book, keeping any other spellings as their *Also called*
     names. Names are unique within a book, so Add is refused when the book
     already has a speaker by that name: *This book already has a speaker
     called "Mara". Names are unique within a book — rename one of them first.*
   - **Ignored** — you ignored the name for this project. **Undo** (or its **✕**
     in the **Ignored** box below) shows it as new again; **Clear all** there
     empties the list.

   **Add**, **Ignore** and **Remove from cast** change a row's status — they
   never take it off the list, so rescanning a chapter you've finished still
   shows everyone it names.
   - **quote not in the chapter** means the quote the model gave is not in the
     text — treat the name as suspect.
   - **Several at once:** tick rows — the box in the header ticks every New, In
     your library and In the cast row shown — then **＋ Add N selected**,
     **Ignore N selected** or **Remove N selected**. Add and Ignore act on the
     ticked New and In-your-library rows, Remove on the ticked In-the-cast rows.
     Each works exactly as its row's own button would.

**What counts as a name.** Discover proposes everyone the text *names* — a
proper name ("Edith") or a title used as one ("the harbour-master") — whether
or not they speak in the chapters scanned; Script decides who says which line.
It never invents a label from how someone talks or is addressed ("child", "the
elder"), so a chapter whose dialogue is never tied to a name proposes no one.

The instructions Discover gives the model are the **Find new speakers** feature
in AI Settings → Features. Edit and save them there and the next scan uses your
text; **Reset** puts the shipped text back.

**Already in the cast** lists the book's speakers — the ones Script can choose
from. A name's **✕** removes that speaker, and **Clear all** removes everyone
but the Narrator. Both ask first.

Scan results are saved with each chapter, so they are still there after you
move to another step, switch project, or restart the app. Scanning a chapter
again replaces that chapter's record. A scan keeps running while you look at
another step. Discover needs a language model; without one, Scan says so.

**Your cast is found without the model.** A speaker counts as named when the
chapter uses their full name or one of their *Also called* names, or their
first name or surname alone (three letters or more, capitalised) when no other
speaker shares it — so the same scan always finds the same people. The model
is asked only for the names that are new. It is given each speaker's *Also
called* names and the first line of their *Who they are*, so a nickname written
there ("Answers to Ode") is not proposed as someone new.

**A named thing can still slip through.** A named, enchanted object — a maul
called *Gudgeon* that rides on someone's shoulder — can read to the model as
a being, and it may propose it. **Ignore** it once and it stays out.

### Removing a speaker

Removing a speaker deletes them from the book: every line they had goes back to
**no speaker**, and the fixes Script remembered for them no longer point at
anyone. The persona that played them stays in your library. Because lines
change, every door asks first, naming who goes and how many lines each has:

- one speaker — *Remove Cael Ferren from the cast? 21 lines will have no
  speaker.*
- several (**Remove N selected**, **Clear all**) — *Remove 2 speakers from the
  cast? Cael Ferren — 21 lines · Nettle — 22 lines. 43 lines will have no
  speaker.*

After a removal the row stays in **Speakers found** and shows as **New** again
(or **In your library**, if a persona has that name), with **＋ Add** to bring
them back. Their lines show in Script as **No speaker** and block the render
until each has a speaker again.

## Script

Script answers one question: **who says each line**. It gives each line to one
of the book's speakers; the persona Cast gives that speaker is the voice it is
read in. It has two pages: the **chapter grid**, where Script opens,
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

- **Name added since** — the chapter was analyzed before that speaker joined
  the cast, and its text names them (their name or an *Also called* name).
  Analyze couldn't choose them then. **Re-analyze** on the row runs it again;
  lines you set are kept.
- **no dialogue found** — nothing in the text was read as speech, so every line
  went to the Narrator. Speech after a dash isn't read as dialogue, and neither
  are marks other than Overview → [Speech marks](#speech-marks) is set to.
  Changing that setting and re-analyzing fixes it, unless you've edited the
  chapter's lines — then it keeps them.
- **failed** — the model call failed; the reason is on the row, and nothing
  was saved.
- **can't re-cut** — analyzing would cut the chapter's lines differently from
  the ones that have takes, and that would delete those takes, so it stopped
  (see [Re-analyze](#re-analyze) for when a chapter is re-cut). **Takes ➜**
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
| **AI named no one in the cast** | the AI's answer wasn't any of the book's speakers |
| **You** | you set or confirmed it |
| **From the import** | the imported script named the speaker; nothing analyzed it |

A line whose speaker the **last Analyze changed** carries **changed · was
June**. The lines of one paragraph sit together — the divider is drawn only
under a paragraph's last line.

**Filters.** **All**, **To check** (marked lines and lines with no speaker),
**No speaker**, and — after a re-analyze that changed anyone — **Changed**.
Each chip's number is the number of rows it shows. The speaker dropdown beside
them shows one speaker's lines. **Next to check ➜** jumps to the next marked or
no-speaker line in reading order, and scrolls it into view. Past the last one it
starts again from the top ("Back to the first line to check"), so with a single
line to check it always takes you there. `Shift+N` goes the other way and wraps
to the bottom.

**Fixing lines.**

- Pick a speaker in the row's dropdown — it lists the book's speakers, the
  narrator first. It saves at once, and the line becomes yours. (On a chapter Analyze has never run on, the speaker is saved but the line
  isn't marked yours, so a first Analyze can still decide it.)
- **Tick** several rows, then **Set the speaker of ticked lines…**, or **⇄ Swap
  their two speakers** — for ticked lines spoken by exactly two speakers, each
  line goes to the other one. That is the fix for a back-and-forth the AI got
  the wrong way round, which no mark can spot.
- **✓ Looks right** on ticked lines makes them yours without changing them.
- **✎ Edit…** (tick exactly one line) opens the line's words, with **Save**,
  **Split at the cursor** and **Cancel**. See [a line's words](#a-lines-words-edit-split-merge).
- **⇲ Merge** (tick two or more lines that sit next to each other) joins them
  into one line.
- **↶ Undo** steps back through your changes since you opened the chapter,
  newest first — edited words included. Opening another chapter, re-analyzing
  this one, or a split or merge clears it; switching to another step and back
  does not.
- **👁 Show the lines around** (at the foot) adds the line either side of each
  line a filter shows.

**Your fixes teach the next Analyze.** Changing a speaker the AI chose saves
it as a worked example; the next run gets your recent fixes in its prompt, so
the same mistake stops recurring across the book. **Undo** also removes the
example the undone change saved, so a mis-click doesn't teach anything.

**Lines with no speaker block the render.** A line nobody speaks can't become
audio, and JustVoice will not quietly leave a sentence out of your audiobook.
The banner above the table counts them and offers **Assign N → Narrator**. A
book with no narrator yet says *This book has no narrator — choose one on Cast
➜* instead, and the link opens Cast. If you go to Render first, the render
stops and lists them; **Fix in Script ➜** there opens the chapter on its lines
with no speaker, the first one selected.

**Left out.** With Overview's **Leave out dialogue tags** on, a line that only
says who spoke carries a grey **Left out** tag. It stays in the script so you
can see it; the audio skips it.

**A speaker you removed.** Removing a speaker from the cast (on Discover or
Cast — both ask first) gives every line they had back to **no speaker**, so
those lines show under **No speaker** and **To check**, and block the render
until each has a speaker again. The dropdown only ever lists the book's own
speakers.

**Music and ad markers are not lines.** A podcast import turns `— Mid-roll —`
into a `♪ Marker` row: it has no speaker by design, it is never counted, and it
never blocks a render.

**✨ Re-analyze this chapter** runs Analyze on this chapter and stays on the
page. **📚 Analyze several chapters** opens the grid. **🔍 A speaker is
missing** opens Discover — Analyze can only choose the book's speakers.
**← Previous** and **Next chapter ➜** at the foot walk the book in order; the
next one says how many lines it has to check.

**Rewrite in character.** Right-click a spoken line's text to have the AI
rewrite it as its speaker would say it. It reads the speaker's **Who they are**
on Cast — not the persona's note — and refuses when that is empty: *Nettle has
nothing under Who they are — write it on Cast to rewrite in character.* You see
the rewrite before anything changes, and accepting replaces the line's text.

Direction, takes and rendering are not on this page: Script decides who says
what, and how it is performed is [Render](#render).

### The marks: where to read closely

A mark tints the line and asks its question in the **Check** column. It marks
the shape the AI's mistakes take, measured on three answer-keyed books before
it was built:

| Mark | The question |
|---|---|
| One speaker speaks **three or more times in a row** — back-to-back spoken paragraphs, no narration-only paragraph between, all theirs | *Marius speaks 3 times with no reply — is one of these the other person's?* The **whole run** is marked: the wrong line is as often the middle one as the last |
| A speaker's **only line** in the chapter | *Harbek's only line in this chapter — is it theirs?* |
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

**Speech marks.** The text is cut at the book's own speech marks — double
quotes, single quotes, guillemets or German marks, as [speech
marks](#speech-marks) describes. A speech that runs over several paragraphs —
each opening a mark, only the last closing it — is speech on every paragraph.

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

**A chapter you've edited is read as its lines.** Once you've changed a line's
words, or split or merged lines, Analyze reads the chapter as its lines stand.
Lines from one paragraph are read together, so *"said Marius"* still names the
speaker of the line beside it. Each line stays one line, and only the speakers
are decided again — what you cut by hand is never re-cut.

Two cases do re-cut. The **first** analyze of an imported chapter: import
stores one line per paragraph, and attribution needs one line per speaker
turn, so the paragraphs are split. And a chapter you haven't edited since it
was analyzed, when [speech marks](#speech-marks) now read its text differently
— it is cut again from its original text. If the chapter already has recorded
takes, JustVoice refuses to re-cut rather than destroy them (**can't re-cut**).

**Some chapters arrive with their speakers.** A podcast script that labels its
speakers (`HOST:`) is attributed the moment it's imported. Script shows those
chapters as **from the import** and never marks them; Analyze would replace
speakers the file already told us with the model's guesses, so run it only if
you mean to.

Analyze does not look for new speakers — that is [Discover](#discover). A line
whose speaker isn't in the cast comes back with no speaker; add that person in
Discover, then analyze again.

### Speech marks

Books mark speech in different ways, and Analyze can only find dialogue where
it knows to look. Overview → **Speech marks** says which way this book does it:

| Setting | Speech looks like |
|---|---|
| **Auto — from the text** (the default) | whichever of the styles below the chapter uses |
| **“Double”** | “Come here,” said Marius. — or straight `"` quotes |
| **‘Single’** | ‘Come here,’ said Marius. — the British style, or straight `'` quotes |
| **«Guillemets»** | «Come here», dit Marius. — or »Komm her«, pointing inward |
| **„German“** | „Komm her“, sagte Marius. — or „…” |

**Auto** looks at the first speech mark of each paragraph and takes the style
that opens the most. Only the first counts, because a speech's own mark always
comes before any quote inside it: when Helen quotes her sister *‘…’* inside her
own *“…”*, the book is still double-quoted. Set the style yourself if Auto ever
picks the wrong one — a chapter that is mostly quotations inside speeches, say.

One style is read at a time. The book's other marks are quotes inside a speech,
never speech of their own.

**Single quotes are apostrophes too.** In single-quote mode a speech opens only
at the start of a word, never on an elision (*'tis*, *rock 'n' roll*, *the
'90s*), and closes only where no letter follows — the apostrophe in *don’t*
never ends a speech. One case still cuts a line early: an apostrophe at the end
of a word inside the speech (*‘The boys’ bikes are gone,’*). Fix that line with
**✎ Edit…** → **Split at the cursor**, or **⇲ Merge**.

**Speech after a dash** (— Come here, said Marius.) isn't read as dialogue in
any setting. A chapter where nothing was read as speech says **no dialogue
found** on the grid.

Changing the setting takes effect the next time a chapter is analyzed — for a
chapter you haven't edited. A chapter whose lines you've edited (a word
changed, a split, a merge) keeps them, so a new setting won't cut it again (see
[Re-analyze](#re-analyze)).

### A line's words: edit, split, merge

The segmenter can cut a line wrong — a trailing apostrophe in single-quote
mode, a speech the marks didn't catch. These fix it by hand, from the bar
under the table:

- **✎ Edit…** — tick exactly one line. Its text becomes an editor:
  - **Save** keeps the new words. **↶ Undo** puts the old ones back.
  - **Split at the cursor** cuts the line where the cursor is: the words after
    it become a new line straight below, with the same speaker. The first line
    keeps any rendered takes — its words changed, so it re-renders — and the
    new line has none.
  - **Cancel** closes the editor unchanged.
- **⇲ Merge** — tick two or more lines that sit next to each other. They become
  one line: their words joined with a space, with the first line's speaker. If
  the other lines have rendered takes, it asks first — *Merge 3 lines? This
  deletes 2 rendered takes.*

A split or merge changes which lines the chapter has, so it clears **↶ Undo**,
as a re-analyze does. Each undoes the other: merge the two halves of a split,
or split a merged line where it was joined. After either, the chapter is read
as its lines (see [Re-analyze](#re-analyze)): what you cut stays cut.

Changing a line's words is not direction — *how* a line is said stays on
[Render](#render).

## Cast

Cast gives each speaker a persona. The book's **speakers** are on the left, and
your **personas** (the finished voices in your library) are on the right.
Select a speaker, then click a persona. One persona can play many speakers
(thirty minor speakers can share one), and changing that persona changes every
speaker it plays. Cast never changes a voice: pace, pitch, gain, delivery and
effects all belong to the persona, on the [Personas](personas.md) page.

### The speakers (left)

**The narrator** has its own full-width card at the top (every kind but
a game). It reads everything that isn't spoken. Its card shows its role line
(*carries the narration* until you write its *Who they are*) and a ticked
**Narrator** box. A book has no narrator until you choose one; nothing makes one
on its own. Until then the card is **Add Narrator**: *"Makes a speaker called
Narrator, played by your persona called Narrator if you have one. Or tick
Narrator on any speaker."* It moves the narration that has no speaker to the new
narrator ([Personas → The Narrator](personas.md#the-narrator)).

**Speakers** below it counts everyone else and how many have no persona yet
(*4 · 2 unassigned*). Its head has three buttons:

- **＋ Add** asks for a name and adds a speaker to the book. If your library
  has a persona of exactly that name, the new speaker arrives cast with it;
  otherwise pick a persona for them. Names are unique within a book, so a name
  the book already has is refused.
- **✕ Clear cast** asks first, then takes the persona away from every speaker:
  *"Unassign personas from all 5 speakers. The speakers stay — only the persona
  links go."*
- **✨ Smart-assign** sends the speakers (name, *Also called*, *Who they are*)
  and your personas (name, voice gender, language, note) to your language model,
  which proposes a persona for each speaker. The matches apply at once. Change
  any you disagree with by clicking another persona. It needs a language model;
  without one it says so.

Each speaker's card shows:

- the name, and **also called …** when the text has other names for them;
- the first line of their *Who they are*;
- a **Narrator** box. Tick it to make them the narrator. A first-person narrator
  also speaks (Watson tells *The Speckled Band* and talks in it), so ticking
  Watson gives his narration and his lines one voice. There is one narrator per
  book: the one who had the role stays in the cast as an ordinary speaker, the
  narration Analyze decided moves to the new narrator, and lines you set
  yourself stay where you put them;
- what plays them: **Persona · engine · 61 lines** when a persona with a voice
  plays them. Otherwise it says what blocks them, in amber: **⚠ no persona · 22
  lines blocked**, or **⚠ Harbek (warm) has no voice · 22 lines blocked** when
  their persona has no voice yet. A speaker with no persona has a dashed edge;
- **✕** (on hover) removes the speaker from the book. It asks first — *Remove
  Harbek from the cast? 22 lines will have no speaker.* — because their lines go
  back to no speaker ([Removing a speaker](#removing-a-speaker)). The persona
  that played them stays in your library.

A **game project** lists its speakers in a table instead (Speaker · Role ·
Persona), since a game can have hundreds. Click a row to select it.

Under the cards, a hint names what can't render yet: *"40 lines can't render
until Harbek and Renn have a persona."* A banner warns when the cast spans
several engines (chapters swap engines while rendering) or uses an online voice
(billed per use, and the text leaves this machine).

### The selected speaker

Selecting a speaker opens their card below the grid. Each field saves when you
leave it (or press Enter in a one-line field):

- **Name** — rename them here. A name the book already has is refused.
- **Also called** — the other names the text uses, separated by commas
  (*Sedge*). Discover counts these as this speaker, and Script's attribution
  matches *"said Sedge"* to them.
- **Who they are** — *"Read by Discover, Smart-assign and Rewrite in character.
  Never heard."* Discover reads its first line; Script's line-by-line
  attribution does not read it. An import fills it from the book.
- **Edit their persona →** opens the persona that plays them on the Personas
  page — *"Pace, pitch, gain, delivery, effects — all of it lives there."* It
  is off until they have a persona.

### The personas (right)

**Personas** lists your whole library, with its count. Above the list, *"Select
a speaker, then click a persona to assign it."* **Search by name or tone…**
matches a persona's name or its note, and the engine dropdown shows one engine's
personas (it remembers your choice).

Each row shows:

- the persona's name, and the voice it's built on with its engine (*Sohee ·
  qwen3*), or *no voice*;
- **✓ June, Marius** — who in this book it already plays;
- whether it can be directed, the same verdict as the Personas editor: **✓
  written** (the engine performs written direction and the voice isn't a
  clone), **tags** (the engine takes inline tags like `[sigh]`, not written
  direction), **✗ none** (numbers and effects only) or **no voice**;
- **▶** plays its voice. This is the voice's own sample, not a line from your
  script, and it plays without the persona's delivery settings or effects. If
  its engine isn't loaded, JustVoice asks before loading it (*Load qwen3?*),
  and once it has loaded offers **Always auto-load**;
- **✎** opens the persona on the Personas page.

Click a row to give that persona to the selected speaker (*Assigned Gruff
dockhand to Harbek.*). Click the persona that already plays them to take it
away. The row that plays the selected speaker is tinted green. Rows can't be clicked until a
speaker is selected.

The foot of the list: *"Two speakers can share one persona — change it once and
both change."* With no personas yet, the list says **No personas yet** and
**Open Personas** takes you there to make one.

## Render

Batch-render the project scene by scene. Each scene can bind a **render preset**
(see [Presets](render-presets.md)) so a chapter or quest keeps one locked sound;
**Suggest** proposes a preset per scene. The progress panel shows per-scene
status, and the render cache means an unchanged line costs nothing to re-render
— cache hits are reported as such.

Lines are joined with **Pause between lines** (Settings → Generation pipeline,
600 ms by default) — the same pause in Render, in the exported audiobook and in
ACX QC, so the chapter you audition is the chapter that ships. A line's own pause
from an import (a script's `pause_after_ms`) still wins for that line.

### What a chapter needs before it renders

A line's voice is found in three steps: the line's **speaker**, the **persona**
Cast gave that speaker, and the persona's **voice**. A chapter renders only when
every line gets all three, and JustVoice will not quietly leave a sentence out
of your audiobook. With nobody cast at all, the Render buttons are off and say
why: *"Nobody is cast yet — give a speaker a persona with a voice in Cast
first."* Otherwise a chapter that isn't ready is refused, and the message names
what is missing:

- **lines with no speaker** — the render stops and lists them, with **Fix in
  Script ➜** for each chapter and **Assign all to** the narrator (the button
  shows the narrator's name) once the book has one;
- **a speaker no persona plays** — *"Nobody plays Harbek yet — give them a
  persona in Studio · Cast."*;
- **a persona with no voice** — *"The persona Harbek (warm) has no voice — pick
  one on the Personas page."*

### Leaving out dialogue tags

In a full-cast book every speaker has their own voice, so the narrator reading
*"said Marius"* between two of Marius's lines only repeats what the listener
already hears. Overview → **Leave out dialogue tags** (off by default) skips
those lines.

A line is left out only when it is **nothing but a tag** — who spoke, a speaking
verb, perhaps an adverb — and it sits next to a spoken line of the same
paragraph:

| Line | Read? |
|---|---|
| *said Marius,* · *she whispered.* · *Marius said quietly.* | left out |
| *said Marius, turning away.* | read — it says more than who spoke |
| *He sat down.* | read — not a tag |

The rule is the same for chapter audio, the exported M4B and its captions, so
the captions always match what you hear. Script shows each line it skips with a
grey **Left out** tag, and a left-out line never stops a render for want of a
speaker. It works on analyzed chapters (it needs to know which lines are
speech and which paragraph each came from), and the speaking verbs it knows are
English.

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

1. **The voice speaks it** — the voice of the persona that plays the line's
   speaker, its delivery settings, and the render preset's overlay on top.
2. **The persona's effects chain runs** — reverb, EQ, compression, whatever
   you built in the persona's effects editor, with the render preset's chain
   layered after it. This is the same processing the single-line preview
   applies, so what you auditioned is what the chapter contains. (Chapter
   renders skipped effects entirely until 2026-08-15: the editor saved them
   and only single-line previews ever played them.)
3. **The chapter is mastered** — see below.

Each line is cached on everything that shapes it, the effects chain included,
so editing one persona's reverb re-renders the lines of the speakers it plays
and leaves the rest of the chapter alone.

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
