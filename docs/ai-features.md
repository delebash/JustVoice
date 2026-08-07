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

## Prompts are editable — features and Dictation cleanup's pieces

Every prompt a feature sends is a **template row** — the wording lives in the
database, visible and editable under Routing by feature. Most features are one
row. **Dictation cleanup** is made of **pieces** — four texts (the ground
rules plus the three sections your Capture toggles switch on) you can read,
edit and test, that never run alone: production pastes the enabled ones
together and makes **one** call. A piece's card shows what it belongs to
instead of a routing arrow — the cleanup card itself is where its engine
preset is chosen, once, for all four.

The cleanup card's own pane carries the full Lab over the **real composed
call**: open it and the system prompt you see is the ground rules plus
whichever of *Remove filler*, *Take your corrections* and *Keep technical
words* your Capture toggles have on right now — flip a toggle and the
composition follows. Every cleanup Lab run (the card's or a single
piece's) also rides the same worked examples production sends with each
dictation, so what you test is exactly what a real capture runs. What that
looks like in practice: paste
`um can you check if the uh export finished before we send it`
and a working model returns something like
`Can you check if the export finished before we send it?` — fillers
dropped, punctuation added, nothing answered back.

## Speaker attribution — three routes and the Auto row

Under the **SPEAKER ATTRIBUTION** heading there are three real routed
features — each with its own editable text, its own engine preset, its own
Lab:

- **Guided** — its system prompt carries the rules **plus worked examples**;
  small models follow better when shown.
- **Direct** — the **same system-prompt rules without the examples**, for
  big models. (The user prompt — your text and cast — is identical on every
  route; only the system prompt differs.)
- **Reasoned** — Direct's rules with thinking on, for reasoning models. (Its
  text starts as a copy of Direct's; edit it separately whenever you like.)

Above them sits the **Auto** row — *"Picks which of the three features below
runs."* Its page is plain sentences plus one number. Auto never picks a
model — it looks at the model you've already assigned and picks the feature
that suits it. If your model can think, **Reasoned** runs (the **Thinking**
flag on the model's catalog row decides; edit it there). If it can't think
but has at least the editable number of billion parameters (default 14),
**Direct** runs; smaller models get **Guided**. When JustVoice can't tell
the size, it plays it safe and uses **Guided**.

Auto always judges the model a card would **actually run**: the card's
engine preset names a model, and when it doesn't, your default model fills
in — the same fall-through the run itself uses. So on a fresh setup where
the presets were never hand-filled, Auto still judges your real default
instead of giving up.

Production always runs Auto's pick — there is no stored force. After every
Analyze, Studio's meta line reports the route that ran and whether it was
Auto's pick or forced per run ("Route: Reasoned — Auto's pick"). A route
card's Lab run or an API call forces its own route for that run only — that
always wins. Thinking itself rides the route's preset: Reasoned's preset
asks for it, Guided's and Direct's don't.

## The attribution Lab

Open any route's row and its **Lab** runs the **real reading pipeline** — the
same segmentation, anchor propagation, and confidence floor as Studio's
Analyze — so what you tune is exactly what production runs.

**The card is the route.** A card's Lab run always forces its own route:
Guided's card tests Guided, Direct's tests Direct, Reasoned's tests
Reasoned. The prompt boxes you see are exactly what runs — there is no
separate route picker to disagree with them.

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
  chapter's real prose in the passage box.
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
(the same most-recent-12). The card under the results shows the count, and
**Clear all** wipes the project's correction history — use it when you
change your mind about a character's identity and don't want old
corrections steering the next run.

**Results you can correct.** Every row shows speaker · line · confidence,
with a reassign dropdown. Reassigning to a real character records a
**speaker correction** for the open project, exactly like fixing a block on
the Studio Script tab — the Lab teaches production. (The correction
examples inject into the run's **user prompt**, which is separate from
Guided's built-in worked examples — those live in its system prompt.)

**Confidence floor & Anchor propagation.** Below the floor a pick becomes
*unknown* instead of a guess; anchor propagation is the pre-AI step where
"Tom said" attributes the quote beside it before the model is ever asked.

**The tunables are real.** Temperature, **Reasoning**, **Max tok**,
**Top-p** and the sampler rows on a column all ride the run — set them and
the run actually uses them, exactly like any feature's Lab. A practical
example: on a Reasoned test, raising **Max tok** to 2048 gives the model's
hidden thinking room to finish AND still answer — thinking tokens count
against the same budget as the visible reply.

**Race configurations.** Add a second column to run two setups over the
same passage; disagreements between columns are underlined so the better
config is obvious at a glance.

**Every run is a real task.** The strip at the top of the page appears the
moment a run starts and counts live — something like
`Lab — Guided · 12.3s · 42 words · 1,234 tok` when it finishes — with
**Cancel** to stop the run mid-flight and **Details** to open the task
panel with recent history. A failed run's strip stays until you dismiss it,
so errors don't vanish before you read them. The same strip follows every
AI button in the app: Studio's Analyze, Smart-assign, 💡 Suggest, Show
notes, the persona 🎲/✏️ buttons, and the voice ✨ gender guess.

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
exceptions, nothing second-guessing it. Out of the box only ONE preset
asks: **Reasoned extraction**, behind the Reasoned speaker-attribution
card. Dictation cleanup, Smart-assign, Compose, Rewrite, Show notes,
Preset suggest and the voice gender guess all ship with thinking off. The
effort level sets how MUCH a thinking run reasons — lower is a shorter
hidden pass and a faster answer.

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

**The catalog's Thinking flag does exactly one thing, and only here.**
Rows in the model catalog can carry a **Thinks** tag — a fact about the
model, editable on its row. In the entire app it has a single consumer:
**speaker attribution's Auto row**, where "if your model can think,
Reasoned runs." That is the complete list — it changes nothing for
dictation cleanup, smart-assign, compose, rewrite, show notes, preset
suggest or the gender guess (their thinking is their presets' own
setting), it never touches what any run sends, and it does nothing in
JustWrite at all (the sibling app has no Auto and keeps its own catalog).
If you never use speaker attribution, this checkbox does nothing.

Worth knowing when you pick: a thinking run spends hundreds to a thousand
hidden tokens before its first visible word, so it is many times slower
than the same model answering directly — on the built-in Gemma models,
the same attribution answered identically in a few seconds without
thinking and in half a minute with it. If a model routes to Reasoned and
you'd rather have it fast, turn its Thinking flag off in the catalog and
Auto routes by size instead; if you want the deep route but shorter,
lower the reasoning effort on the Reasoned extraction preset.

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
