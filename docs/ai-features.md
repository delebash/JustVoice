# AI features — routing, prompts & the AI Settings area

JustVoice's text-AI features (speaker attribution, smart assign, persona
compose/rewrite, show notes, dictation cleanup, voice-gender guess) all run on the **shared AI stack** — the same providers, model catalog,
routing and prompt system as the rest of the family. The surface for all of it
is the **AI Settings** page in the sidebar.

## The features

| Feature | What it does | When you use it |
|---|---|---|
| **Compose** | Writes a fresh line in a persona's voice from its note on how it sounds | A persona's page → Hear it → 🎲 Compose |
| **Persona rewrite** | Rewrites the current text in a persona's voice, or a line in its speaker's character (preview-then-accept) | A persona's page → Hear it → ✏️ Rewrite · Studio Render → a line's ✏️ Rewrite as *name* |
| **Speaker attribution** | Extracts who says what and what they say; its Find new speakers row lists the people a chapter names | Studio Script tab → Analyze · Studio Discover → Scan |
| **Smart-assign** | Matches each speaker in a book to a persona | Studio Cast tab → Smart-assign |
| **Show notes** | Chapter summaries for podcast descriptions | Projects → Show notes |
| **Dictation cleanup** | Raw speech → clean text before paste | Captures — runs after a dictation when auto-refine is on |
| **Voice gender guess** | Labels fetched voices the built-in dictionary doesn't know | Voices → ✨ Guess unknown genders (only when you click) |

## How routing works

Every feature action is assigned an **engine preset** — the one source of which
provider + model it runs on and every tunable (temperature, token budget,
samplers, thinking). Open **AI Settings → Routing by feature** to see each
feature, what it resolves to right now, and to point it somewhere else. One
model can serve everything, or heavy analysis (attribution) can run on a bigger
model than the quick features.

Until a model is picked, features answer with a "run the LLM engine setup"
message — the one-click wizard on the AI Settings page installs the built-in
engine, downloads a model sized to your PC, and sets it as the default.

## Picking models: fit, speed, and your override

The built-in provider's model catalog grades every model against **this PC**:
the **Fit** badge says whether it fits your memory (*Fits* / *Tight* / *CPU* /
*Won't fit*), and beside it a **speed band** says how fast it would run —
*~fast*, *~fine* (comfortable reading speed), *~slow*, *~very slow* — computed
from the model file's own physics against your machine's memory speed, erring
on the slow side. The **~** marks an estimate; once a model has actually run
here, the row shows the **real measured tokens/second** instead. The LLM engine
setup takes that first measurement for you: right after it loads your model it
spends about fifteen seconds in the background timing one short answer, so the
model you just set up shows *Measured on this PC* rather than a guess — and
that number includes the speed-up from speculative decoding (MTP), which the
estimate deliberately leaves out. Setup never waits on it; if it fails, the
chip keeps its estimate.

**On a PC with no hardware preset, the LLM engine setup offers a one-minute
speed check** before it recommends anything. The estimate's weakest input is
how fast this machine streams model data out of system RAM; the check
measures it with the engine itself. It downloads one small test model (about
800 MB, once — served from the app's own release page and verified against
its checksum), runs it twice (entirely on the graphics card, then with its
experts in system memory), and records the difference. Every speed estimate in
the catalog uses that number afterwards. It's always optional — *Skip — use
estimates* carries on exactly as before — and a PC with a preset never sees it,
because its preset is already measured. It asks again only after an engine
update. The test model's address and checksum live under **Engine binaries →
Speed-check model**.

### Updating the local engine

The **Update** button beside the built-in provider appears when there is a newer engine
than yours. It offers one of two builds, whichever is newer: the build this version of
the app is **tested with**, or the build named by llama.cpp's newest **official
release**. Hover the button to see which one it is offering. Before
the new engine replaces the one you have, the app checks that it starts *and* that it
accepts the settings the app launches models with; if it fails either, your current
engine is kept and the message says what it refused. If the newer release has no
download for your kind of graphics card, the app says so and changes nothing. The old
build's folder is removed only after the new one is installed and working.

A newer engine is not automatically a faster one. Speed depends on the model as much
as the engine — a release can improve one kind of model and set another back — so
updating is always your deliberate click, and it is worth re-running a speed check
afterwards on a model you care about.

**Why two kinds of build.** Each version of the app is tested with one engine build, and
new installs get that build. llama.cpp publishes official releases less often than its
daily builds, so the tested build can be newer than the newest official release. Without
offering it, an install that started on an older engine could never reach it.

On a PC without a preset the setup also won't recommend a model whose speed is
well below reading speed — by default under 6.4 tokens per second, 20 % under
the *fine* line. The margin keeps a model that lands just under the line from
being swapped for a much weaker one; a model with no estimate is never skipped
for being unknown.

When an estimate lands **right on a band line** — by default within 10 % of
one — the chip shows the number instead of a word: *Fits · ~7.9 tok/s*, not
*~slow*. A word there would be a coin flip: the next reading of this machine's
memory speed could put it on the other side of the line without anything
about the model changing. A **measured** speed always keeps its word. When the
app doesn't know a model's file details or your machine's speed yet, the chip
shows plain fit and no band — it never guesses.

**The estimate never decides for you.** Every model dropdown lists every
model — a *Won't fit* pick just shows an honest warning and loads anyway if
the engine can manage it. The engine's own attempt is the final authority.

The engine's memory and speed settings live with the **loaded-models knobs**
on the engine panel ("Models kept loaded at once"): the VRAM safety margin,
the default context cap, the RAM headroom, the speed-band thresholds the
badges switch over at, and **Show the number within (%)** — how close an
estimate may sit to one of those lines before the chip shows the number
instead (0 turns it off) — and **Recommend down to (% under Fine)**, how far
under the *fine* line the setup still recommends a model on a PC with no
preset — all editable, one Save. They open under **Details ▾**
on the built-in provider's engine panel.

### The catalog row's controls

An AI model row and a **speech** model row (Speech engines → the engine's model
list) work the same way, in the same order, with the same words — the two
catalogs are one interaction grammar, not two:

**Download** (until the files are on disk) → **Load model** / **Unload model**
(warm it now, or free its memory) → **Set as default** → the **⋯** menu.

The **⋯** menu holds **Tune & measure**, **Re-download**, **Open folder** (the
model's own folder in your file explorer — desktop app only), **View on Hugging
Face** (the upstream repository page), **Delete downloaded model** (frees the
disk, keeps the catalog row) and **Delete from catalog**. Full detail on the
shared catalog: [JustWrite's model docs](../../justwrite-app/docs/models.md).

## Prompts are editable — and Dictation cleanup is one card with sections

Every prompt a feature sends is a **template row** — the wording lives in the
database, visible and editable under Routing by feature. Most features are one
row. **Dictation cleanup** is one card whose prompt is built from **sections**:
the ground-rules text is a template, and its `{{…}}` markers place the three
section texts — *Remove filler*, *Take your corrections*, *Keep technical
words* — into the prompt when their Capture toggle is on. The sections never
run alone: production renders the template and makes **one** call, on the one
preset the card is assigned.

Everything lives on the cleanup card's pane, and everything on it is real:

- **The toggles at the top are your actual Capture settings** — flip one here
  and your next dictation changes too, and you watch the section enter or
  leave the generated prompt below.
- **The four text boxes are the stored texts.** The ground-rules box is the
  template — move a marker and you've changed the order the sections paste
  in. Saving a box refreshes the generated prompt; the pane never shows a
  composition built from unsaved text.
- **The generated prompt is the real composed call**, and the Lab under it
  runs that exact call — with the same worked examples production sends with
  each dictation. What you test is what a capture runs.

What that looks like in practice: paste
`um can you check if the uh export finished before we send it`
and a working model returns something like
`Can you check if the export finished before we send it?` — fillers
dropped, punctuation added, nothing answered back.

## Who the AI features read (speakers and personas)

Since 2026-09-29 a book's people and the voices that play them are two things,
and each AI feature reads the half it needs:

- **Speakers** are the people in one book — a name, **Also called**,
  **Pronouns**, and **Who they are**. Discover finds them, Script's Analyze gives
  lines to them (it is told each speaker's pronouns, so *"she said"* can only be
  someone who is *she*), and
  Render's *Rewrite in character* (a line's ✏️ Rewrite as *name*) reads the
  line's speaker's **Who they are** (`POST /v1/speakers/{id}/rewrite`; a speaker with nothing there is
  refused with "*name* has nothing under Who they are — write it on Cast to
  rewrite in character.").
- **Personas** are finished voices. A persona's page has no book, so its 🎲
  Compose and ✏️ Rewrite read the persona's **Note on how it sounds** instead (a persona
  without one is refused: "*name* has no note on how it sounds — write one on
  the Personas page to use Compose / Rewrite."). The Compose and Rewrite prompts
  keep their `{{personality}}` variable; its value is the persona's note on its
  page and the speaker's Who they are on Render.
- **Smart-assign** matches the book's speakers (name, Also called, Pronouns, Who they are)
  to your personas (name, their voice's gender, language, and the note as
  `tone`), and applies its matches straight away — change any of them on Cast.

**Discover no longer sends your library to the model.** The Find new speakers
prompt (`speaker_attribution.identify`) used to list "people in the library,
not in this cast" so the model could link nicknames to them. The library now
holds voices, not people, so that list and its paragraph are gone; Discover's
**In your library** status is worked out in code instead — a found name that is
**exactly** the name of a persona in your library (persona names are unique since
2026-09-29; two older personas that still share a name match neither). The removal was measured on 2026-09-29 with `npm run
eval:discover` (2 runs over *The Ninth Facet*, with some of its people taken out
of the cast for the model to find) before it was made:

| Prompt | Library sent | Found | Wrong |
|---|---|---|---|
| The old prompt | yes | 28/28 | 0 |
| The old prompt | no | 26/28 | 4 |
| The new prompt (paragraph removed) | no | 26/28 | 4 |

The paragraph itself changed nothing — the old and new prompts score the same
without a library. The drop from 28 to 26 comes from no longer handing the model
descriptions of people who are not in this book's cast: it missed Haldane Threll
twice and proposed Gudgeon — Brick's enchanted maul, an object — four times. The
book's own speakers are still sent as its known cast.

## Speaker attribution — two routes and the Auto row

Under the **SPEAKER ATTRIBUTION** heading there are two real routed
features — each with its own editable text, its own engine preset, its own
Lab:

- **Guided** — its system prompt carries the rules **plus worked examples**;
  small models follow better when shown.
- **Direct** — the **same system-prompt rules without the examples**, for
  big models. (The user prompt — your text and cast — is identical on both
  routes; only the system prompt differs.)

Above them sits the **Auto** row — *"Picks which of the two features below
runs."* Its page is plain sentences plus one number. Auto never picks a
model — it looks at the model you've already assigned and picks the feature
that suits it, **by size alone**: at least the editable number of billion
parameters (default 14) and **Direct** runs; smaller models get **Guided**.
A mixture-of-experts model counts its **total** size (the built-in Gemma
reads as 26B). When JustVoice can't tell the size, it plays it safe and
uses **Guided**.

Auto always judges the model a card would **actually run**: the card's
engine preset names a model, and when it doesn't, your default model fills
in — the same fall-through the run itself uses. So on a fresh setup where
the presets were never hand-filled, Auto still judges your real default
instead of giving up.

Production always runs Auto's pick — there is no stored force. After every
Analyze, Studio's meta line reports the route that ran and whether it was
Auto's pick or forced per run ("Route: Direct — Auto's pick"). A route
card's Lab run or an API call forces its own route for that run only — that
always wins. Thinking is a per-preset setting like on any feature — both
routes ship with it off; to try attribution with thinking, turn **think**
on in a card's Lab column, compare, and **Use in production** if it earns
it.

**Long chapters.** Two settings shape how Script splits a chapter too long
for the model. They have no control in the app yet; they are set through
`PATCH /v1/settings` under `extraction`:

| Setting | Default | What it does |
|---|---|---|
| `split_lead_in_paragraphs` | 6 | Paragraphs of the previous piece sent again at the start of the next, for context. 0 sends none. |
| `answer_tokens_per_line` | 65 | Room kept for the model's answer, per dialogue line. Measured at 45-65 with thinking on; raise it if a model thinks at greater length. |

## The attribution Lab

Open any route's row and its **Lab** runs the **real reading pipeline** — the
same segmentation, anchor propagation, and confidence floor as Studio's
Analyze — so what you tune is exactly what production runs.

**The card is the route.** A card's Lab run always forces its own route:
Guided's card tests Guided, Direct's tests Direct. The prompt boxes you see
are exactly what runs — there is no separate route picker to disagree with
them.

**The cast editor.** The Speakers box (the prompt's `{{speakers}}`
variable) isn't a raw text area — it's the original Speaker Lab's cast editor:
your speakers as removable chips, a **Speaker name** input, an **Aliases**
input, and a **＋ Add** button (Enter adds too). A chip shows the name in bold
and its aliases beside it ("**Renn** — aliases: Old Renn, the harbor-master").
Under the hood each speaker is one line of plain text you could also type by
hand — the name, then a `|` and comma-separated aliases when it has any:

```
Mara
Renn | Old Renn, the harbor-master
```

No ids anywhere — JustVoice generates those internally. The model only
attributes dialogue to names on this list, so add everyone who speaks in
the passage.

**Live counters.** The passage box's header counts as you type or paste —
`42 words · 230 chars · ~58 tokens` — so you can see what a run will cost
before you press Run. The token number is an estimate (about four
characters per token).

**Filling the boxes from your app.** Above the input boxes sit fill
controls so you never have to invent test data:

- **Insert from chapter…** lists the open project's chapters and puts a
  chapter's real prose in the passage box. The picker then shows what you
  inserted, so you can see which chapter is in the box; pick its top row to
  clear the label.
- **Insert from cast…** lists your projects ("Speakers of The Ninth Facet") and
  fills the Speakers box with that project's real speakers, one name per
  line.
- **Sample** fills the passage AND the cast together with the built-in
  cellar scene — the original Speaker Lab's sample passage, word for word
  (Mara, Sarah, the fog, the cellar). It has anchored quotes, bare quotes
  and a narration-only opener, so every part of the pipeline has something
  to do.

**Corrections ride automatically.** There is no corrections box to type
into — nothing honest could be typed there, because corrections only exist
by fixing real results. With a project open, every Lab run automatically
uses that project's stored corrections, exactly like a production Analyze
(the same most-recent-12).

**Results you can correct.** Every row shows speaker · line · confidence,
with a reassign dropdown. The dropdown lists the open project's speakers **by
name** and starts on the row's current speaker, so it reads like any other
dropdown — change it and the correction is recorded. A row whose speaker
isn't one of the project's speakers starts on **Assign…** instead. Reassigning
to a real speaker records a
**speaker correction** for the open project, exactly like fixing a block on
the Studio Script tab — the Lab teaches production. (The correction
examples inject into the run's **user prompt**, which is separate from
Guided's built-in worked examples — those live in its system prompt.)

**Confidence floor & Anchor propagation.** Below the floor a pick becomes
*unknown* instead of a guess; anchor propagation is the pre-AI step where
"Tom said" attributes the quote beside it before the model is ever asked.

**The tunables are real.** Temperature, **Reasoning**, **Max tok**,
**Top-p** and the sampler rows on a column all ride the run — set them and
the run actually uses them, exactly like any feature's Lab. **Max tok is
empty out of the box — on every feature.** No feature ships with a token
cap, and an empty box sends no limit at all: a run simply ends when the
model finishes its answer. Type a number only when you want a hard ceiling
(say, a cost limit on a paid provider) — and know that on a thinking run
the model's hidden reasoning counts against that same ceiling, so a tight
cap can cut an answer off mid-sentence.

**Race configurations.** Add a second column to run two setups over the
same passage; disagreements between columns are underlined so the better
config is obvious at a glance.

**Every run is a real task.** The moment a run starts, the shared progress
strip appears in the column under the Run row and counts live seconds, with
**Cancel** to stop the run mid-flight and **Details** to open the AI-tasks
panel. When the run finishes, the strip yields to the result pane, which
carries the numbers (elapsed, words, tokens, tok/s); the run is also
recorded in the panel's Recent list with its token counts. A failed run
shows its error right in the column, badges the AI-tasks button until you
open the panel, and keeps its error in the panel until you dismiss it — so
errors don't vanish before you read them. The same strip shows under every AI
button in the app, on that button's own page — see
[AI tasks](#ai-tasks--where-they-show-and-the-panel).

The **Find new speakers** row's Lab runs the discovery scan instead — the
same prompt behind Studio's **Discover** step. It lists the people the text
names who aren't in the Known speakers list, speaking or not, each with the
quote that names them; nothing is created from the Lab. Its Known speakers box is the same cast
editor, and Insert from chapter/cast fill it the same way.

## Filling the other features' Labs from your app

Every feature's Lab has the same idea — the test input should be your real
app data in exactly the shape a production run sends, never hand-typed
fakes:

- **Smart-assign**: *Insert from cast…* fills the Speakers box with your
  project's speakers in the run's own wire shape
  (`- id="…", name="Renn", aliases="Old Renn", description="gravel-voiced"` —
  the description is the first 200 characters of the speaker's Who they are),
  and *Insert from personas…* fills the Personas box with your personas the
  same way (`- id="…", name="Slate", gender="male", tone="low and dry",
  language="en-US"` — the tone is the persona's note on how it sounds). The
  result renders as a readable table — **Speaker → Persona by name** (hover a
  name to see the underlying id);
  if a model returns something unreadable, the Lab says so and points you
  at the raw output instead of pretending.
- **Voice gender guess**: *Insert from voices…* fills the box with
  `- Name — description` lines, the exact format the ✨ button sends.
- **Show notes**: *Insert from script…* builds a project's script the way
  production does — `## Chapter title` headings with `SPEAKER: line` rows,
  NARRATION where no one is assigned.
- **Compose / Rewrite**: *Insert from persona…* drops a persona's note on how
  it sounds into the box, so you test with the same text a persona page's 🎲
  and ✏️ buttons use.

## Thinking — one control, honest errors

Some models can reason in a hidden "thinking" pass before they answer.
Thinking is not words in the prompt — it's a **request setting** sent
alongside temperature and max tokens: your local engine receives a thinking
budget ("you may spend up to this many hidden tokens reasoning"), a cloud
provider that speaks it receives an effort word. With the setting present
the model reasons privately first, then answers; without it, the same
prompt gets a direct answer.

**The one control is the feature's engine preset.** The preset's thinking
control — Off, or an effort level from Low to Max — is the whole story:
what you set there is exactly what every run of that feature sends, no
exceptions, nothing second-guessing it. **Out of the box every preset
ships with thinking off except one: speaker attribution** (Studio ·
Script's Analyze), which runs on its own preset, **Reasoned extraction**,
with thinking on. That one was measured: on two sample novels the built-in
Gemma got 928 of 940 lines right without thinking and 937 with it, and the
one mistake it kept repeating went away — at about 1.7 times the time per
chapter. Everything else — dictation cleanup, Discover's Find new speakers,
Smart-assign, Compose, Rewrite, Show notes, the voice gender guess — ships
off. The effort level sets how MUCH a thinking run
reasons — lower is a shorter hidden pass and a faster answer. To trade
accuracy for speed on attribution, turn thinking off on Reasoned
extraction.

**If a model can't take it, you hear it from the provider — not from
JustVoice guessing.** Ask for thinking on a model that doesn't support the
parameter and the provider rejects the run with its own error; JustVoice
shows you that message and adds one sentence naming the fix:

> Unsupported parameter: 'reasoning_effort' is not supported with this
> model. — this usually means the model can't think: turn thinking off on
> this feature's preset, or pick another model.

That's the whole safety story — no hidden switch quietly turning your
thinking off, no run silently succeeding differently than you configured
it. (Your local engine accepts the thinking setting for any model, so this
error can only come from a cloud provider.)

Worth knowing before you turn it on: a thinking run spends hundreds to a
thousand hidden tokens before its first visible word, so it is many times
slower than the same model answering directly — on the built-in Gemma
models, the same attribution answered identically in a few seconds without
thinking and in half a minute with it. That's why everything else ships
off: enable it deliberately, on a feature where you've tested that it
earns its time — as speaker attribution was — and lower the effort level
if you want the reasoning pass shorter.

## Show notes (podcast projects)

`POST /v1/projects/{id}/show-notes` drafts podcast show notes from the
project's script — an episode summary with segment beats you can paste into
your feed. It routes through the `show_notes` action's preset like every other
feature, and answers **501** with a clear message when no model is set up.

## AI tasks — where they show, and the panel

Every long-running job shows as a progress **strip** — the same shared strip
every app in the family uses, reading one shared task queue, so a run keeps going
when you move to another page. **A task's strip shows on the page that started
it** (since 2026-10-05; it used to sit at the top of every page, so a chapter
render showed on Voices): a chapter render and the ACX check on Render, Smart-
assign and New personas on Cast, Show notes on Export, *Re-render changed* on
Lines, the gender guess on Voices, Compose and Rewrite on a persona's page, and
Discover's scan and Script's Analyze each on their own step. Anywhere else, the
✨ button in the title bar counts what is running, and its panel lists
everything.

Two kinds of work get a strip, and only these two:

- **Anything that asks a language model** — Compose, Rewrite, Script's Analyze,
  Discover's scan, Smart-assign, New personas, Show notes, the gender guess. This
  is what the strip exists for, and it is the same queue JustWrite and the docs
  generator use for their own AI features.
- **Long speech renders** — a chapter render, Render's line renders and ACX
  check, and Lines' *Re-render changed*.

Installing an engine, downloading a model and loading a model are not tasks:
each reports on its own row on Speech engines (see
[Engines](engines.md#cancelling-an-in-flight-load)).

### A strip's life

| State | Looks like | Goes away |
|---|---|---|
| running | animated ✨, elapsed seconds, the task's own numbers | — (**Cancel** while it runs) |
| done | green ✓ and `done` | after 5 seconds |
| failed | red ⚠, `failed` and the error | **never** on its own — ✕ it once you've read the error |
| cancelled | grey ⊘ and `cancelled` | after 3 seconds |

The numbers are what each job reports: characters, words and seconds of audio
for a render; tokens and tokens per second for a language-model job. A batch
(*Re-render changed*) also shows `done/total` with a real bar. A single call shows
elapsed time only — the strip never invents a percentage for work that doesn't
report one.

The buttons: **Details** opens the panel; **Cancel** stops the actual request or
batch, not just the display; **Retry** re-runs a finished job that can run again
(also in the panel's Recent list, after the strip is gone); **✕** dismisses a
finished strip. A failed task also turns the ✨ button red until you open the
panel, so a failure can't slip past while you're on another page.

### The AI tasks panel

The panel slides in from the right — open it from a strip's **Details**, the ✨
button in the title bar, or the ✨ AI tasks row in the sidebar. (The server status
in the title bar — "Operational", and how many tasks are in flight — is status
only, not a button.) It has two parts:

- **Running** — a card per active task: elapsed time, its numbers, its own
  Cancel, and **Cancel all** when more than one runs. A streaming language-model
  task also shows a live / stalling / stuck dot, judged against that stream's own
  pace.
- **Recent** — tasks just finished, then the last 50 done, cancelled or failed,
  each with its icon (✓ / ⊘ / ⚠), duration, numbers, the error when it failed,
  and Retry where the job supports it. **🗑 Clear** clears the list.

It closes on a click outside, Escape, or ✕ Close.

## Troubleshooting

- **501 / "run the LLM engine setup"** — no model is set up yet. AI Settings →
  Run LLM engine setup (or connect an online provider on the same page).
- **A feature uses the wrong model** — check its row under Routing by feature;
  the chip shows exactly what the next run resolves to.
- **A feature's row shows no model** — its preset was never given one (this
  could happen to features added after your first setup). Run the LLM engine
  setup again, or click **Set as default** on your model's catalog row — both
  now fill every preset that was never configured by hand, while a preset you
  pointed somewhere yourself is never touched.
- **An error mentions "reasoning" or "thinking"** — the model this feature
  ran on can't take the thinking parameter. The message is the provider's
  own, and the fix is the sentence at its end: turn thinking off on that
  feature's preset (Routing by feature → the feature → its preset's thinking
  control), or route the feature to a model that can think.
- **"Timed out"** — the provider gave up waiting for an answer. The built-in
  provider waits up to 15 minutes per call, because a thinking run on a long
  chapter can take several minutes on a home PC. An online or other local
  provider waits 60 seconds, so if Script times out there, use a smaller
  chapter or route the feature to the built-in provider.
- **"A paragraph of this chapter is too long for the model to read, even on
  its own"** — Script reads long chapters in pieces (see
  [Studio → Script](studio.md#script)), but it never cuts inside a paragraph.
  Only a paragraph bigger than the model's whole context gives this; use a
  model with a larger context.
- **"The answer was cut off"** — the model ran out of room before it
  finished, so the run fails instead of handing back half an answer. Either
  a **Max tok** cap is set on that feature's preset and the answer hit it (no
  feature ships with one, so if there's a number there, someone typed it:
  raise it or clear the box, empty = no limit), or the text sent filled the
  model's context. On thinking runs the hidden reasoning counts against both.
  Script is the exception: it reads a chapter that fills the context in
  pieces instead (see [Studio → Script](studio.md#script)).
