# 2026-08-15 — The voice-workflow redesign

**THIS IS THE RESUME SURFACE.** It supersedes the unbuilt half of
`2026-08-15-voice-workbench.md` (whose Slices A and B are built and stay as the
record) and the `2026-08-15-pipeline-truth-and-first-run.md` item 6.

**Status: DESIGN, nothing built from it. No go given for any of it.**
Live mock (unwired, both interaction models):
`https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`

---

## §0 Why this doc exists — read before adding to it

The voice-workbench plan was written as **416 lines of implementation with no
design section**. It specified files, props, cache keys, copy and tests, and
never said what was being built or why. The design that produced those slices
was discussed in the same session and **never written down**; the compact ate
it. Two slices were then built exactly to spec, passed every gate (574 server
tests, ruff, biome, vitest, build, smoke) and produced a cramped drawer inside a
table row. The user's verdict: *"you presented to me that you had a nice good
design combining all these features in a nice workflow and you present me with
crap"*.

Worse, on the same day the user supplied **12 Alexandria screenshots** and I
wrote a research record from them (`2026-08-15-pipeline-truth-and-first-run.md`
§2) — then designed without reading either, and "discovered" their contents one
screenshot at a time across the following session. The user, correctly:
*"why are you finding new stuff to steal did you not look at all the images i
gave you… you are inconsistant"*.

**The rules this doc exists to enforce:**

1. **The design is written before the slices, and the slices serve it.** If a
   slice contradicts §2, §2 wins — stop and raise it.
2. **A step toward a surface says so.** Slice B was a step toward the workbench;
   the doc never said what the destination was, so it got built as the
   destination.
3. **Read the research record before designing.** §5 here is the Alexandria
   take/skip decision, made once, in writing.
4. **No code without an explicit go.** Repeatedly broken this session; it wastes
   the user's time while they are still talking.

---

## §1 The complaints this redesign answers (user, verbatim, 2026-08-15)

- *"the voice inspector is hidden behind double click i think we need a better
  desing for managing voices blending cloning ect, it just doesnt seem like an
  easy workflow, like the generate tab that seems like render tab, we have too
  many hidden places to do stuff with voices and not a nice workflow"*
- *"another place is the persona, we have voice selection then personality voice
  hint effect, all of which change what it sounds like this is another scattered
  area that changes what we hear"*
- On Chapters: *"this workflow never made sense to me you cant even have this
  until you rin script and identify speakers"*
- On render presets: *"i mean a chapter has a narrotor and usually many voices we
  have defined these voices and narator so what would render preset do? … how
  many places do we define the way something is spoken?"*
- *"i think we really are doing a full redesing of the app from a voice workflow
  standpoint whihc is most of the app"*
- *"i dont just want a copy of alexadira if it does not make sense in our app, if
  it does fine but I wanted some creativity and how we use it in our app"*
- *"dont overenginner"*

---

## §2 THE DESIGN

### 2.1 The shape — three levels, none hidden

**Identity → hear → make.** Each level earns its place and the double-click
disappears.

1. **The row is identity.** Name, engine, type, gender. No drawer for three fields.
2. **Hearing happens inline, in context.** NOT a dock — the GlobalAudioPlayer was
   deleted 2026-08-15 and a persistent audition dock is the same fixed furniture
   wearing a different job.
3. **A page is where you make things.** The heavyweight work — clone, blend,
   train, finish a voice — reached deliberately.

### 2.2 The chapter surface — the line is the unit

**Three screens become one.** Chapters, Studio·Script and Studio·Render are three
windows onto the same rows, and none shows a whole line:

| Screen today | Shows | Hides |
|---|---|---|
| Chapters | text, takes, "+ direction", fix pronunciation | who speaks it |
| Studio · Script | who speaks it, confidence, provenance | the audio, the direction |
| Studio · Render | batch progress, cache | the individual line |

That split is why Chapters makes no sense: it offers **"Generate first take" on a
block with no speaker**, and the render path refuses exactly that. The
prerequisite is invisible because it lives on another screen.

The data model has no such split: a `Block` already owns everything transitively
— `persona_id` → character → voice → delivery → lexicon → takes. **One row is
already the whole decision.**

**Steps become states, not tabs.** A book is not a single pass — you re-attribute
a line in chapter 9 long after chapter 1 is mastered. So the old steps become
filter chips over one surface:

> unattributed → attributed → cast → directed → rendered → promoted

Header shows the histogram: *"214 lines · 12 unattributed · 40 uncast · 187 not
rendered · 9 stale"*. Each is a filter. "Go to the Cast step" becomes "show me
the uncast rows".

**Two densities of one surface** (this is the answer to "one table doing three
jobs"):

- **Script mode** — reads like a screenplay: speaker label, prose, flowing. A
  **playhead** moves through it, current line highlighted and auto-scrolling.
  This is for writing, attributing and **QC listening**. An audiobook producer
  casts for a day and listens for weeks; nobody QCs a book row by row.
- **Table mode** — dense, sortable, state columns. Triage and batch work.

**Render is a panel, not a place.** You don't *go to* render — you render what
you are looking at. Refusals, cost and progress belong in a panel over the
chapter. A separate Render tab is exactly what makes the app not flow.

**Row contents.** Always visible: reorder/insert/delete · **Speaker** (full name,
never truncated — Alexandria truncates to "MAR" and it is unusable) · **Text** ·
**Direction** · **Pause** · **State** · **Audio** (play + take count, or Gen).

In the expansion — deliberately small: per-line numeric overrides, the take list
with promote/compare, "fix a pronunciation", attribution provenance. **The voice
is a read-only chip with a link to Cast** — see 2.3.

**The scannability rule:** the table shows **only what differs from the default**.
Blank direction = "as the character". Blank pause = "as the project". A value
means *this line is special*, so the eye lands on exceptions instead of a wall of
repeated defaults. Cells render as text and become inputs on focus — same look, a
fraction of the DOM at 214+ rows.

### 2.3 Casting — pick the kind, then the voice

**The word "voice" is overloaded and it confused the user in review.** A field
labelled "Their voice" containing "Sohee" reads as two names for one speaking
part. June's voice *is* June's voice; Sohee is the **instrument**.

**What a voice is:** a preset shipped with an engine (Kokoro's 54, Qwen3
CustomVoice's 9 — Sohee is one), a clone, a blend, a trained LoRA, an import, or
a derived variant (2.5).

**The rule the old design never stated:** which of those exist depends entirely
on the engine.

| Engine | Presets | Cloning |
|---|---|---|
| Kokoro | 54 | ✗ |
| Qwen3 CustomVoice | 9 | ✗ |
| Qwen3 Base | 0 | ✓ |
| Chatterbox | 0 | ✓ |

**Choosing a voice is choosing an engine, and therefore choosing what that
character can do for the rest of the book.** Cast June to Sohee → she performs
written direction, and can never be cloned from. Cast her to a Chatterbox clone →
her own timbre, and she ignores every direction you write.

So the cast row is **two steps**: pick the *kind* (radio: from the library /
clone from audio / blend / trained LoRA / design from prose), which fixes the
engine; then the specific voice. And it **states the consequence in place**:

> **Sohee** — Qwen3 CustomVoice · ✓ performs written direction · ✗ can't be
> cloned from · 10 languages

**Cloning happens inline on the cast row** — drop reference audio, Whisper
transcribes, SNR flags a noisy clip, name it, clone-and-cast in one move. No trip
to the library.

**Attribution produces characters, never voices.** "Find speakers" answers *who is
talking*; it has no opinion about timbre. Two separate questions, never blurred
into adjacent dropdowns.

**No per-line voice override, ever.** If a character needs a different voice for a
passage — young Mara in a flashback — that is a **second character**, attributed
to those lines. Cleaner, uses the model as designed, removes a whole class of
confusion.

### 2.4 The voice workbench — a finishing bench, not an inspector

**The user overruled an earlier recommendation here and was right.** I argued the
workbench should lose its knobs to the character. The case that settles it: a
clone comes out quiet. Under knobs-on-the-character, you fix +3 dB once per
character — five characters, five fixes, and they drift. The fix belongs to the
**artifact** and must travel with it.

- **Voice tuning** = *this artifact, correctly set up*. Shared by everyone using it.
- **Character tuning** = *how this person uses that artifact*. Layered on top.

A guitar's setup versus how a player plays it. This does **not** resurrect
presets: a preset was a free-floating bundle applied over whoever was speaking; a
voice tuning is a **property of the voice**, and you cast it like any other voice.

The workbench is where a voice becomes usable before anyone consumes it:

1. **Hear it** — your own text, no character needed; you are judging the instrument.
2. **Tune it** — knobs + effects, saved **onto the voice**. Every knob the engine
   has, none folded under "Advanced".
3. **Save** — including **save as a new voice** (2.5).
4. **Derive** — blend, train.
5. **Samples** — the reference audio it came from (not built; one honest line, no
   dead buttons).

Always visible: the **load-cost line** (one engine resident at a time — a
cross-engine listen is a model swap and the panel says so *before* the click) and
the **resolved-stack line**.

### 2.5 Making a voice — five doors plus one

One **＋ New voice** door replaces the toolbar/fold/inspector-footer/Labs scatter.
Each card states its precondition and shows what is *installable*, not only what
is currently loaded:

1. **Clone from audio** — needs Chatterbox (or Qwen3 Base / LuxTTS / MOSS / TADA).
2. **Import .justvoice.zip** — ready.
3. **Design from prose** — needs the **Qwen3 VoiceDesign** checkpoint. **This is
   NOT dropped** (see §3 decision 11): the whole path is already built and
   switched off pending a download. The card offers **⤓ Install**, like Dia's
   "needs venv" state today.
4. **Blend** — weighted mix, same engine family only.
5. **Train a LoRA** — needs samples.

**Plus a sixth, reachable only from the workbench: the derived voice.** Tune a
voice, then **Save as new voice**. It is a record pointing at a parent plus your
tuning — `{parent_id, name, calibration, effects}`. No audio, no training.

It fixes three things: preset voices become **renameable** (the thing you name is
yours — "Heart (warm)"); the quiet clone is fixed **once** for all five characters
using it; and it derives from anything, not just presets.

**Guardrail, or it becomes the preset we deleted:** a derived voice is a
**correction to an artifact** — calibration and timbre-shaping. It is **not a
mood**. "Marius angry" is direction, per line or per scene, never a saved voice.
What keeps the distinction real is that a derived voice **is a voice** — cast like
any other — whereas a preset floated free.

### 2.6 The layer stack, and the rule that governs it

**The user's question that drove this: "how many places do we define the way
something is spoken?"** Answer today: seven, three of which set the same numbers.

| Layer | Sets | Scope |
|---|---|---|
| Engine | defaults | invisible fallback |
| **Voice** | calibration — delivery + effects | everyone using it |
| **Character** | which voice · base direction · delivery · effects · lexicon | that character |
| **Scene** | an effects chain + appended direction text | that passage |
| **Line** | direction + numeric override | that line |
| Master target | loudness / peak / noise floor | project |

**THE RULE:**

> A scene may apply anything that **composes**. It may never apply anything that
> **replaces**.

| Composes (stacks) | Replaces (cannot stack) |
|---|---|
| gain — dB adds | temperature |
| pitch-shift — semitones add | seed |
| time-stretch — multiplies | top-k / top-p |
| effects — chain concatenates | the voice itself |
| direction — text appends | |

This is *why* scene-level delivery felt wrong: it tried to stack **replace**-type
params. Not because numbers are bad.

**And gain / pitch-shift / time-stretch are physically effects** — pedalboard
operations on rendered audio. Fold them into the effects chain where they belong
and the scene needs **no new entity at all**: it just picks a chain from the
Effects library, which already exists and already stacks correctly in code
(`resolve_chain(persona_effects, preset_effects)`).

Direction composes additively and reads as English:
*"Clipped, world-weary"* + *"Sharp, irritated"* + *"Remembered, distant"*.

### 2.7 What dies

- **Render presets** — see §3 decision 6.
- **Generate** — absorbed into the workbench; its layout is the workbench's
  skeleton, not something thrown away. Capability banner, sliders paired with
  numeric boxes, delivery direction as a first-class box that disables *with its
  reason on it*, seed + randomize, lexicon line, history.
- **Labs** — render lab becomes "Compare settings…" inside Tune; Train moves to
  Voices; Compare + Audio merge into one analyzer bench; the container goes.
- **The voice inspector** — last out, once rename and the derive verbs have homes.
- **Chapters** as a separate view — becomes the chapter surface.

---

## §3 The decisions, with their reasoning

1. **The line is the unit; Chapters + Script + Render merge.** Three windows on
   the same rows; the model has no such split.
2. **Steps become filter states.** A book is not one pass.
3. **Two modes: Script (playhead) and Table (triage).** QC is where the hours go
   and a spreadsheet does not serve it.
4. **Render is a panel, not a place.**
5. **Inline for the line, pages for library objects.** The loop you run hundreds
   of times is tweak → hear; a line is transient, a voice is a thing you own.
6. **Render presets are DELETED, not renamed.** A preset was a character minus the
   identity — a named bundle of delivery + effects, differing only in scope. Its
   delivery **overrode** every character's (set speed 0.9 and June 1.05×, Marius
   0.95× and the Narrator all flatten). Its `voice_id` and `lexicons_json` are
   read by nothing; its `master` duplicates the project's. The tell is in JV's own
   seeded presets: *"Quiet Reflection — soft, slow, introspective passages"* is
   **direction**, text pretending to be knobs. Replaced by: scene direction text
   (with saved snippets — that is where "Quiet Reflection" / "Dramatic" / "Action"
   go) + an effects chain from the existing library.
   - **Rejected alternative:** keep the scene layer but make delivery *relative*
     (×0.92 rather than =0.92). It fixes the flattening but leaves a third place
     to set speed. **Revisit only if** "everyone 10% slower for this scene" proves
     to be a real need — on engines that take no direction (Kokoro, Chatterbox) a
     scene mood otherwise does nothing, and that is the honest cost.
7. **The composes-vs-replaces rule** (2.6) governs what any scope may apply.
8. **Voice tuning stays** — user ruling, overriding my rethink. The quiet-clone
   case proves it.
9. **The derived voice** — the sixth way in. User: *"a fifth way to make a voice
   yes i like that"*.
10. **No per-line voice override.** A different voice is a different character.
11. **Voice Designer is KEPT.** My "we don't ship the checkpoint" was backwards:
    the feature is **already built and switched off** — `POST /v1/voices/design`,
    `design_prompt` on the voice record, the capability flag plumbed through
    `capability_details.py:177-180`, `models.py:884`, `engines_api.py:47` and
    every manifest, all `voice_design: False` pending one download.
    `qwen3/manifest.py:38-42` says so: *"flips back with the VoiceDesign
    variant."* The door card offers **Install**, not a dead ✗.
    - JV-specific improvement over Alexandria's designer: **design from a
      character sheet** — pre-fill the description from the character
      ("gravel-voiced harbor-master, 70s"), editable, never a silent conversion.
      The sheet is *who they are*; a voice description is *how they sound*.
    - Candidates before saving (reuse the clone flow's 10-minute LRU) rather than
      saving every attempt.
12. **The voice on a line is read-only context**, never an editable field.

---

## §4 Open — needs the user's word

1. **Does "Studio" survive as a container?** If the chapter is the workspace, the
   shape is *project → chapters → chapter surface*, with Cast project-scoped and
   the library global. But that undoes **ruling 12** (Script before Cast), which
   is built and shipped. Raised, not recommended.
2. **Does Chapters die outright?** Instinct yes, but its take-versioning UI works
   today; verify the exact overlap in code before deleting.
3. **Is the row-expands-into-everything model right, or too clever?** The boring
   alternative: the row *links* to the right place. Less magic, more navigation.
4. **Which bundled engines actually support description-to-voice?** Qwen3
   VoiceDesign is confirmed in our own record. Every other manifest says
   `voice_design: False`, including **Hume TADA** — Hume's cloud Octave does
   description-based voices; whether the local TADA weights do is **unverified and
   must be checked on the web**, per CLAUDE.md.
5. **The real VoiceDesign download size** — our record says UNVERIFIED.
6. **Samples API** — build it, or keep the honest line.
7. **Is there any undo for an Analyze pass?** Re-running overwrites `persona_id`.
   Alexandria's saved scripts give you "go back to the good one". Unverified.

---

## §5 The Alexandria decision — made once, in writing

Source: 12 screenshots in `C:\Users\danel\OneDrive\Pictures\Screenshots 1\alexandria`,
read in full 2026-08-15. Research record: `2026-08-15-pipeline-truth-and-first-run.md` §2.
Their app: Qwen3-only, five steps (Setup → Script → Voices → Editor → Result) +
Designer / Preparer / Dataset / Training.

### TAKE

| From Alexandria | Why |
|---|---|
| **Subtitles under every bulk verb** (*"Regenerate All / re-render everything from scratch"*) | Cheapest win. JV's destructive buttons are bare labels. |
| **Speaker-change pause 500 ms · same-speaker pause 250 ms** — two settings | Real craft. JV has one gap value; a beat between two people is not a beat inside one person's speech. |
| **"Merge consecutive narrator lines"** toggle with its honest note *"disable for better per-line voice direction control"* | JV's attribution will over-split narration; this is the decision with its tradeoff stated. |
| **Banned tokens** (e.g. `<think>`) | JV runs local models that leak reasoning into output. |
| **"Alias of"** — map "Mara" / "the detective" to one canonical character | JV has an aliases field nothing wires; this is its UI. |
| **Confidence + Min SNR gates** on dataset prep | JV should refuse bad clone/training audio the same way. |
| **Final Loss** column on the adapters table | You cannot choose a checkpoint without it. |
| **"How Settings Affect LoRA Voice Quality"** inline collapsible | JV ships knobs with no guidance anywhere. |
| **Explicit "No audio"** rather than an empty cell | Says what is true. |
| **Per-line preview / regenerate** in dataset building | Matches JV's take model. |

### SKIP — JV already has better, or it does not fit

- **LLM settings + prompt-customization textareas.** Theirs is one base URL, one
  model, raw prompts in a config page. JV has the shared runner (multi-provider,
  per-feature pinning) and the **AI Lab** with real test data. Copying theirs is a
  regression.
- **Generate Personas / Voice Designer as they built it** — depends on
  VoiceDesign; JV's honest equivalent is smart-assign over the library you have.
  (The *feature* is kept — see §3 decision 11 — the auto-design-everyone button is
  what is skipped.)
- **Preparer + Dataset + Training as three pages.** Three pages for one job; their
  own Training page has a "Build New Dataset" button that throws you to another
  page. JV: **one** Train surface with dataset building inside it.
- **Parallel workers / sub-batching / compile codec / batch order.** JV has the
  synth scheduler. If throughput knobs ever surface they belong in engine
  settings, not the book workflow.
- **Console log panels on every page.** Dev tooling; JV has the task strip.
- **Saved Scripts.** They save scripts to files because they have no database. JV's
  blocks live in SQLite with speaker, confidence and provenance — there is no
  artifact to save. (Corrected: a script is **per chapter** = per `Scene`, and the
  Script step exists only for prose kinds — `studioSteps.js` gives prose
  `[script, cast, render, export]`, game `[cast, render, export]`.) The one bit
  worth keeping is the *go back to a better pass* idea — see §4 open question 7.

### WHERE JV IS ALREADY AHEAD — do not regress copying them

Takes with lineage (they have one audio per line, and *Regenerate All* destroys
it) · cross-project characters (theirs are per-run) · multi-engine with capability
gating (theirs is Qwen3-only, so it never has to say "this engine ignores
direction") · effects, lexicons, master targets, ACX check — they have none.

### Their weaknesses, named so we do not inherit them

Truncated speaker names ("MAR", "NAR") · only one state ("pending"), no stale /
blocked / confidence · no filtering (nine rows fit; JV has 214+) · nothing says
whether the engine performs Emotion/Style · Play Sequence with no follow-along.

---

## §6 Code-verified findings that constrain this design

All verified 2026-08-15 by reading the code. Each is also filed in
`docs/dev/TASKS.md`. **None is fixed.**

1. **`Block.direction` is stored, editable and never rendered.**
   `database/models.py:238` — *"Emotion/style hint passed through to the engine's
   instruct field."* Written at `projects_api.py:498` and `:536-537`, returned at
   `:140`, exported at `project_export_api.py:104`, preserved across splits at
   `extraction_api.py:406`. **`render_chapter_api.py` and `render_core.py` contain
   zero references to it.** The "+ direction" button in Chapters writes a column no
   render reads. Per-line direction is not a future feature — it is built and
   disconnected.
2. **Engine-private knobs never reach an engine.** Every engine reads its own
   knobs from the `delivery.engine` subdict (`qwen3/engine.py:154`,
   `chatterbox/engine.py:185-206`, `moss_tts/engine.py:114`), but
   `VoiceParamsModal.vue` saves the capability schema's keys **flat**,
   `merge_delivery` merges them flat, and nothing nests them. exaggeration,
   cfg_weight, repetition_penalty, talker_temperature, top-k/top-p have never
   done anything at render. `render_chapter_api` additionally filters to
   `Delivery.model_fields`, dropping them a second time.
3. **Kokoro speaks English whatever the voice claims.** `kokoro/engine.py:107`
   sets `lang = "en-us" if lexicon else ""` once at load, into the model config;
   `synth()` never touches language. Sara (Italian), Nicola (Italian) and every
   ja/zh/es/fr/hi/pt preset are phonemized as English. Separately the catalog is
   **variant-blind**: `STATIC_VOICES` is the full 54 unconditionally
   (`kokoro/manifest.py:66`) and `voices_api.py:51-62` never checks which variant
   is installed.
4. **Four of the Voices table's eleven columns are wired to nothing.**
   `GET /v1/voices` returns id · engine · source · name · language · gender ·
   sample_url (`models.py:464-471`). Effects (`default_effects`), Channel
   (`channel_id`), Samples (`sample_count` — dropped by `_stored_to_dto`,
   `voices_api.py:32-40`) and Gens (`generation_count` — no such field anywhere)
   render "—", "Default" and "0" forever. Effects and channel routing belong to
   the **character**.
5. **`RenderPreset` has two dead fields and a live lock.** `voice_id` and
   `lexicons_json` are read by nothing at render. `voice_id` is
   `ondelete="RESTRICT"` — a dead field that can **block deleting a persona** for
   a reason no screen can explain.
6. **The synth scheduler has no UI.** `synth_scheduler.py` (shipped `3a5a23d`) is
   one worker + one pending pool, draining **engine-major** with interactive
   singles jumping the queue at line boundaries — the mechanism that stops a
   model swap per line. Seven callers. **Nothing in `src/` references it and no
   endpoint exposes queue depth or the current engine.** When a render waits
   behind another engine's batch the app shows nothing. The chapter render panel
   is where *"waiting — Chatterbox is finishing 40 lines"* belongs.
7. **The analyze prompt gets id + name only.** `_resolve_cast`
   (`extraction_api.py:145-167`) hardcodes role/gender/pronouns=None, aliases=[];
   `format_characters` (`extraction/prompts.py:82-97`) reads those empty fields.
   Production attribution has never seen a description or an alias.
8. **Chapters offers "Generate first take" on speaker-less blocks** and prints raw
   block UUIDs (`b0e22b69`) at the user — the render path refuses a block with no
   character, so the button cannot work.

---

## §7 Session state (2026-08-15)

**Built and pushed this session** (from the voice-workbench plan, before the
redesign superseded its unbuilt half):

- **Slice A** — `f54c4ea`. Persona split: `voice_instruct` (the only text that
  reaches the synth) vs `personality` (the character sheet). Third description
  field and the dead `MCPBinding.default_personality` deleted. JW imports fill the
  sheet only. **Required a data reset.** 37 files.
- **Slice B** — `df0299f`. Row preview takes `{text, delivery}`; rendered-audition
  cache (sha1 of voice+text+canonical delivery, 32 entries, 10-min TTL, cleared
  per test by an autouse fixture); `VoiceAudition.vue` on a voice-row click;
  `services/audition.js`. **Under reconsideration** — it is a step toward the
  workbench, not the workbench, and the user has rejected its shape.
- **Docs** — `56568b3` (the recovered design), `a4854e2` (header fix).

**Unpushed at time of writing:** none — all four pushed. Verify with
`git log --oneline origin/main..main`.

**Gates last run green:** 574 server tests · ruff · biome · 69 vitest · vite
build · smoke (16 views, zero JS errors).

**Frozen:** voice-workbench Slices C, D and E. Do not build them; they predate
this design.

**The mock:** `https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`
— 14 screens, Inline-first / Page-first toggle. Source file lives in the session
scratchpad, not the repo.
