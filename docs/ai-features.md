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
runs."* Its pane is plain words plus one number. Auto never picks a model —
it looks at the model you've already assigned and picks the feature that
fits it: can your model think (the **Thinking** flag on its catalog row —
edit it there)? **Reasoned** runs. Otherwise, at or above the **editable
size line** (billions of parameters, default 14) **Direct** runs; under it,
**Guided**. Unknown size counts as small.

Production always runs Auto's pick — there is no stored force. After every
Analyze, Studio's meta line reports the route that ran and whether it was
Auto's pick or forced per run. A route card's Lab run or an API call forces
its own route for that run only — that always wins. Thinking itself rides
the route's preset (Reasoned's has it on), and models that can't think are
simply never asked to (the family-wide capability gate).

## The attribution Lab

Open any route's row and its **Lab** runs the **real reading pipeline** — the
same segmentation, anchor propagation, and confidence floor as Studio's
Analyze — so what you tune is exactly what production runs:

- **The card is the route** — a card's Lab run always forces its own route:
  Guided's card tests Guided, Direct's tests Direct, Reasoned's tests
  Reasoned. The prompt boxes you see are exactly what runs.
- **Confidence floor & Anchor propagation** — below the floor a pick becomes
  *unknown* instead of a guess; anchor propagation is the pre-AI step where
  "Tom said" attributes the quote beside it.
- **Results you can correct** — every row shows speaker · line ·
  confidence, with a reassign dropdown. Reassigning to a real character
  records a **speaker correction** for the open project, exactly like fixing
  a block on the Studio Script tab.
- **Correction memory** — the card under the results counts the open
  project's corrections; the top-12 most recent inject into the next Analyze
  run's **user prompt** as correction examples (separate from Guided's
  built-in worked examples, which live in its system prompt). **Clear all**
  wipes the project's correction
  history — use it when you change your mind about a character's identity and
  don't want old corrections steering the next run.

Add a second column to race two configurations over the same passage;
disagreements between columns are underlined.

The **Find new speakers** row's Lab runs the discovery scan instead — the
same pipeline behind Studio's "new speakers found" banner. It lists names
that speak but aren't in the known-characters list, as a review list;
nothing is created from the Lab.

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
