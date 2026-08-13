# Studio — Cast → Script → Render

Studio is the multi-character production environment: assign voices to
characters, attribute every line to its speaker, render the whole project. The
tab names adapt to your project kind (chapters for audiobooks, quests for game
projects, segments for podcasts) — same flow, your vocabulary.

## Cast

Every character in the project, with their voice assignment. Add a character,
open the voice params modal to tune their delivery, and press **▶** to hear a
voice preview before committing — the preview plays a stock sample line, not a
line from your script. **Smart assign** asks the LLM to propose voices for
the whole unassigned cast in one pass, and you accept or change per row.

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

## Render

Batch-render the project scene by scene. Each scene can bind a **render preset**
(see [Presets](render-presets.md)) so a chapter or quest keeps one locked sound;
**Suggest** proposes a preset per scene. The progress panel shows per-scene
status, and the render cache means an unchanged line costs nothing to re-render
— cache hits are reported as such.
