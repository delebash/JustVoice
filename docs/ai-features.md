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
| **Speaker attribution** | Tags each paragraph with its speaker (narrator vs character) | Studio Script tab → Analyze |
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

## Prompts are editable

Every feature's prompt is a **template row** — the wording lives in the
database, editable in the AI Settings Lab (each row ships a sample so you can
test it standalone). Dictation cleanup is four rows (base + the three
transformation sections your Capture toggles enable); production runs the
composition of whichever sections are on.

## The attribution Lab

The speaker-attribution rows' **Lab** (Routing by feature → open a "Who
speaks" row) runs the **real reading pipeline** — the same
segmentation, "Tom said" anchors, and confidence floor as Studio's Analyze —
so what you tune there is exactly what production runs:

- **Reading instructions** — per column: Auto (matched to the model), With
  examples, Rules only, or Rules + thinking. Auto lets JustVoice pick from the
  model's size.
- **Confidence floor & anchors** — below the floor a pick becomes *unknown*
  instead of a guess; the anchor toggle controls the pre-AI "Tom said"
  attribution.
- **Results you can correct** — every row shows speaker · line ·
  confidence, with a reassign dropdown. Reassigning to a real character
  records a **speaker correction** for the open project, exactly like fixing
  a block on the Studio Script tab.
- **Correction memory** — the card under the results counts the open
  project's corrections; the top-12 most recent inject into the next Analyze
  run as worked examples. **Clear all** wipes the project's correction
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
