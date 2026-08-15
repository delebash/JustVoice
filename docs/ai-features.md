# AI features — routing, prompts & the AI Settings area

JustVoice's text-AI features (speaker attribution, smart assign, persona
compose/rewrite, preset suggest, show notes, dictation cleanup, voice-gender
guess) all run on the **shared AI stack** — the same providers, model catalog,
routing and prompt system as the rest of the family. The surface for all of it
is the **AI Settings** page in the sidebar.

## The features

| Feature | What it does | When you use it |
|---|---|---|
| **Compose** | Writes a fresh in-character line from a persona's personality prompt | Generate view → 🎲 Compose button |
| **Persona rewrite** | Rewrites the current text in a character's voice (preview-then-accept) | Generate view → ✏️ Rewrite · Studio Script → right-click a dialogue block |
| **Speaker attribution** | Extracts who says what and what they say | Studio Script tab → Analyze |
| **Smart-assign** | Matches each character in your cast to a TTS voice | Studio Cast tab → Smart-assign |
| **Render preset suggest** | Classifies a chapter's tone and picks the best render preset | Studio Render tab → 💡 Suggest |
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
here, the row shows the **real measured tokens/second** instead. When the app
doesn't know a model's file details or your machine's speed yet, the chip
shows plain fit and no band — it never guesses.

**The estimate never decides for you.** Every model dropdown lists every
model — a *Won't fit* pick just shows an honest warning and loads anyway if
the engine can manage it. The engine's own attempt is the final authority.

The engine's memory and speed settings live with the **loaded-models knobs**
on the engine panel ("Models kept loaded at once"): the VRAM safety margin,
the default context cap, the RAM headroom, and the speed-band thresholds the
badges switch over at — all editable, one Save.

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

## The attribution Lab

Open any route's row and its **Lab** runs the **real reading pipeline** — the
same segmentation, anchor propagation, and confidence floor as Studio's
Analyze — so what you tune is exactly what production runs.

**The card is the route.** A card's Lab run always forces its own route:
Guided's card tests Guided, Direct's tests Direct. The prompt boxes you see
are exactly what runs — there is no separate route picker to disagree with
them.

**The cast editor.** The Characters box isn't a raw text area — it's the
original Speaker Lab's cast editor: your cast as removable chips, a
**Character name** input, an **Aliases** input, and a **＋ Add** button
(Enter adds too). A chip shows the name in bold and its aliases beside it
("**Renn** — aliases: Old Renn, the harbor-master"). Under the hood each
character is one line of plain text you could also type by hand — the name,
then a `|` and comma-separated aliases when it has any:

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
- **Insert from cast…** lists your projects ("Cast of Stillwater") and
  fills the Characters box with that project's real cast, one name per
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
with a reassign dropdown. The dropdown lists the open project's cast **by
name** and starts on the row's current speaker, so it reads like any other
dropdown — change it and the correction is recorded. A row whose speaker
isn't in the project's cast starts on **Assign…** instead. Reassigning to a
real character records a
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
errors don't vanish before you read them. The same strip follows every AI
button in the app: Studio's Analyze, Smart-assign, 💡 Suggest, Show notes,
the persona 🎲/✏️ buttons, and the voice ✨ gender guess.

The **Find new speakers** row's Lab runs the discovery scan instead — the
same pipeline behind Studio's "new speakers found" banner. It lists names
that speak but aren't in the known-characters list, as a review list;
nothing is created from the Lab. Its Characters box is the same cast
editor, and Insert from chapter/cast fill it the same way.

## Filling the other features' Labs from your app

Every feature's Lab has the same idea — the test input should be your real
app data in exactly the shape a production run sends, never hand-typed
fakes:

- **Smart-assign**: *Insert from cast…* fills the Characters box with your
  project's cast in the run's own wire shape
  (`- id="c_mara", name="Mara", description="dry, mid-30s archivist"`),
  and *Insert from voices…* fills the Voices box with your fetched voice
  library the same way. The result renders as a readable table —
  **Character → Voice by name** (hover a name to see the underlying id);
  if a model returns something unreadable, the Lab says so and points you
  at the raw output instead of pretending.
- **Voice gender guess**: *Insert from voices…* fills the box with
  `- Name — description` lines, the exact format the ✨ button sends.
- **Render preset suggest**: one picker inserts your render-preset list,
  another inserts a chapter's text — the two inputs the 💡 Suggest button
  composes.
- **Show notes**: *Insert from script…* builds a project's script the way
  production does — `## Chapter title` headings with `SPEAKER: line` rows,
  NARRATION where no one is assigned.
- **Compose / Rewrite**: *Insert from persona…* drops a persona's
  personality text into the box, so you test with the same character sheet
  the 🎲 and ✏️ buttons use.

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
ships with thinking off** — speaker attribution, dictation cleanup,
Smart-assign, Compose, Rewrite, Show notes, Preset suggest, the voice
gender guess, all of them. Thinking only ever happens because you turned
it on, on that feature's preset. The effort level sets how MUCH a thinking
run reasons — lower is a shorter hidden pass and a faster answer.

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
thinking and in half a minute with it. That's why everything ships off:
enable it deliberately, on the one feature where you've tested that it
earns its time, and lower the effort level if you want the reasoning pass
shorter.

## Show notes (podcast projects)

`POST /v1/projects/{id}/show-notes` drafts podcast show notes from the
project's script — an episode summary with segment beats you can paste into
your feed. It routes through the `show_notes` action's preset like every other
feature, and answers **501** with a clear message when no model is set up.

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
- **An answer stops mid-sentence** — a **Max tok** cap is set on that
  feature's preset and the answer hit it. No feature ships with one, so if
  there's a number there, someone typed it: raise it or clear the box
  (empty = no limit). Remember that on thinking runs the hidden reasoning
  counts against the same cap.
