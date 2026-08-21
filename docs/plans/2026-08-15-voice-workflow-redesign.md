# 2026-08-15 — The voice-workflow redesign

> ## ⚠ THE VOICE MODEL MOVED OUT OF THIS DOC — 2026-08-17
>
> **How sound is organised — voices, personas, casting, per-line delivery, where
> every knob lives — is now `2026-08-17-voice-model.md`. Read that first, and
> where it disagrees with anything below, it wins.**
>
> It was pulled out because the answer to *"where do the knobs live"* was spread
> across §2.4, §2.6, §8.3, §8.22, §9.6 and §10 here, and got re-derived with
> different words every time it was asked.
>
> **What this doc still owns:** the five steps (§8.5), Script doing one job
> (§8.6), the scope grid (§8.7–8.8), manual Review (§8.9), the attribution
> sources and suspicion checks (§8.12–8.15), the state vocabulary (§8.16), the
> mock's build mechanics (§8.1) and the Alexandria take/skip record (§5).

**THIS IS THE RESUME SURFACE** for the workflow steps. It supersedes the unbuilt half of
`2026-08-15-voice-workbench.md` (whose Slices A and B are built and stay as the
record) and the `2026-08-15-pipeline-truth-and-first-run.md` item 6.

**Status: DESIGN, nothing built from it in app code. No go given for any of it.**
Navigable mock (17 routes, 123 controls, no server):
`https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`

> # ⚠ READ §8 FIRST — THE MOCK IS THE DESIGN
>
> The redesign is being designed **in the mock**, not in this prose. **§8 is the
> live record**: every ruling the user has made while walking the mock, why it was
> made, what state the mock is in, and how to build it without breaking it.
>
> **§1–§7 are the prior thinking.** They got us here and are kept as the record,
> but they are superseded wherever they disagree — and several places are marked
> in place where they do. **Where §8 and §1–§7 disagree, §8 wins.**
>
> **To resume mock work: §8.1 (mechanics) then §8.18 (exact state).**
>
> **For the voice/persona/tuning argument: §8.22.**

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

### 2.0 What JustVoice is — and what that costs this design

**JV is not an audiobook app.** It is a voice-production app with **project
kinds** — `"audiobook" | "game_voicelines" | "podcast" | "custom"`
(`database/models.py:174`), plus dictation and accessibility users who never open
a project at all. Audiobook is the primary differentiator, not the only shape.
User, 2026-08-15: *"jv is not just pipeline for book yes that is main feature but
it can be anything that is why we have project types"*.

The rest of §2 was drafted audiobook-first. Every surface below must hold for all
four kinds, and this is what that changes:

| Surface | audiobook | game_voicelines | podcast | dictation |
|---|---|---|---|---|
| Scene = | chapter | quest / dialogue tree | episode segment | — |
| Block = | paragraph | one NPC line | take / segment | — |
| Attribution | LLM pass over prose | **none** — the sheet names speakers | labels (`SARAH:`) | — |
| Chapter surface default mode | **Script** | **Table** | Script | n/a |
| Cast scale | ~5–15 characters | **50–500 NPCs** | 2–6 hosts | n/a |
| Continuous QC listening | central | rare — lines are independent assets | central | n/a |
| Export | M4B / MP3, ACX check | per-line WAV + JSON sidecar | episode + stems | — |

**Three consequences the design has to absorb:**

1. **The two modes are not a preference — they have a default per kind.**
   Script mode (screenplay + playhead) is for prose kinds, where the chapter is a
   continuous read and QC means listening. Game projects default to **Table**:
   500 barks are independent assets, not a performance, and nobody plays them
   end to end. Both modes stay available to both; only the default differs.

2. **The cast surface must scale from 5 to 500, and as drawn it does not.**
   §2.3's per-character cards are right at audiobook scale and collapse at game
   scale — 50 NPCs of stacked cards is a scroll of death. The cast surface is a
   **table** with the card as a row expansion: name · voice · engine · line count
   · state, expanding to the full controls. At audiobook scale the table is short
   enough that rows can start expanded; at game scale they start collapsed, and
   bulk selection ("cast these 30 guards to X") becomes the primary action.
   **This is a correction to §2.3, not an option.**

3. **Attribution is prose-only.** Game and podcast projects arrive with speakers
   already attached, so the "unattributed" filter state is empty by construction
   and the Find-speakers verb does not exist for them —
   `studioSteps.js` already encodes this (game gets
   `[cast, render, export]`, no Script step). The filter chips must be derived
   from the kind, not hardcoded.

**What does not change:** the line is still the unit; steps are still states;
render is still a panel; casting is still pick-the-kind-then-the-voice; the layer
stack and the composes-vs-replaces rule are kind-independent. Dictation and
accessibility users never touch the chapter surface, but they do use the voice
library — and captures are a legitimate clone source, which is one reason the
Prep Audio candidate (§5) earns its place beyond audiobooks.

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

> **⚠ PARTLY SUPERSEDED BY §8.1–§8.4 (2026-08-16).** The diagnosis below stands —
> the three screens do hide each other's prerequisites. The **remedy** does not:
> the user ruled that Script must do *one* thing (who says what), so the merge
> is rejected and direction/pause/take/Gen/voice move to **Render**, which is a
> step, not a panel. The chip strip below is the one they called *"way to
> bussy"*. Read §8 before building anything from this section.

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

**The cast surface is a table, not a stack of cards** (see §2.0 consequence 2).
Row: name · voice · engine · line count · state. The card above is the row's
**expansion**. At audiobook scale (~5–15) rows can open by default; at game scale
(50–500 NPCs) they start collapsed and **bulk selection is the primary action** —
"cast these 30 guards to X", "give every merchant this base delivery". A stack of
full cards is unusable past about fifteen characters.

**Attribution produces personas, never voices.** "Find speakers" answers *who is
talking*; it has no opinion about timbre. Two separate questions, never blurred
into adjacent dropdowns.

**No per-line voice override, ever.** If a persona needs a different voice for a
passage — young Mara in a flashback — that is a **second persona**, attributed
to those lines. Cleaner, uses the model as designed, removes a whole class of
confusion.

> **Wording note:** §2.3 was written using "character" throughout. Per §8.1 the
> word is **persona** — code-verified, "character" appears nowhere in the
> codebase. The two paragraphs above are corrected; the rest of §2.3 is not yet
> swept.

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

1. ~~**The line is the unit; Chapters + Script + Render merge.**~~
   **OVERTURNED 2026-08-16 — see §8.2/§8.3.** The line stays the unit; the merge
   does not happen. Script is attribution only.
2. ~~**Steps become filter states.**~~ **OVERTURNED 2026-08-16 — see §8.3.** The
   steps stay steps (five of them), and each step's filters cover only that
   step's question.
3. ~~**Two modes: Script (playhead) and Table (triage).**~~ **NARROWED
   2026-08-16 — see §8.7.** Read-as-script survives as Script's *only* layout and
   for attribution, not QC listening; the playhead was never ruled and QC belongs
   to Render.
4. ~~**Render is a panel, not a place.**~~ **OVERTURNED 2026-08-16 — see §8.3.**
   Render is a step and it owns direction, pause, state, take and Gen.
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
4. ~~Which bundled engines support description-to-voice?~~ **CLOSED 2026-08-15.**
   Qwen3 VoiceDesign only. User: *"i think qwen is the only one for voice
   designer"*, corroborated by Voice-Clone-Studio
   (github.com/FranckyB/Voice-Clone-Studio), which supports six TTS engines —
   Qwen3-TTS, VibeVoice, LuxTTS, Chatterbox, Fish Speech S2 Pro, MMAudio — and
   routes Voice Design to *"Qwen3-TTS's dedicated model"* alone. The TADA
   question is dropped.
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

### Voice-Clone-Studio (github.com/FranckyB/Voice-Clone-Studio) — read 2026-08-15

A Gradio **bench** for making clips, not a production pipeline: six TTS engines
(Qwen3-TTS, VibeVoice, LuxTTS, Chatterbox, Fish Speech S2 Pro, MMAudio) + three
ASR, behind modular tabs. No project, chapter, character, lexicon, master-target
or take-versioning concept at all, so most of it is out of scope.

**Nothing for attribution.** Its "Conversation" tab is manual `[1]:` / `[2]:`
prefixes typed by the user, and indices past the speaker limit *wrap around*. No
LLM pass, no prose parsing. Alexandria remains the only prior art we have there.

**TAKE — one thing, and it's real:** a **Prep Audio** workspace. Trim on a
waveform · normalize · mono · **DeepFilterNet denoise** · extract audio from
video · auto sentence-split via ASR · batch transcribe · dataset folder
management. JV accepts a clone upload and flags SNR *after the fact*; a clone
inherits room tone, so cleaning **before** is worth more than warning after — and
the same workspace is what a training dataset needs. Not ruled.

**Two smaller notes:** they cache the voice prompt on first generation so later
clones are instant (check whether JV caches clone conditioning or recomputes);
and their 40+ emotion presets with intensity are the same shape as our saved
direction snippets, arrived at independently.

**Confirms:** Voice Design is Qwen3-only (§4 open question 4, now closed).

**Out of scope, noted:** Voice Changer (Chatterbox speech-to-speech re-voicing),
Sound Effects (MMAudio text/video→audio), 90-minute continuous VibeVoice
generation, Fish Speech inline expression tags (`[whisper]`, `[laughing]` — the
same idea as our `inline_tags` capability).

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

## §8 THE MOCK IS THE DESIGN — every decision, and why

**This is the live section. Read it before touching the mock.**

The redesign is being designed *in the mock*, not in prose — §1–§7 below are the
prior thinking that got us here and are superseded wherever they disagree. What
matters for continuing the work is in §8: **what was decided, why it was decided,
what state the mock is in, and how to build it without breaking it.**

**Recovered 2026-08-16 by reading the session JSONL**, after an autocompact ate
the design a second time. Two of these rulings (**8.2** and **8.3**) were recorded
**nowhere** before today — not in this doc, not in `docs/dev/TASKS.md`. They were
minutes from being lost.

**Reading order:** 8.1 is how to build the mock · 8.2–8.11 are the user's rulings
and their reasoning · 8.12–8.17 is the evidence those rulings rest on · 8.18–8.20
is the mock's current state · 8.21–8.22 is what was rejected and what is open.

---

### 8.1 How to work on the mock — mechanics, so continuing does not break it

> **WHERE THE MOCK LIVES**
> ~~Everything lives in a session scratchpad.~~ **MOVED 2026-08-17 — the mock
> now lives at `docs/plans/mock/`**, with a README covering the
> edit → `build_mock.py` → `validate.py` → republish loop. It had existed only
> in the session temp dir and would have died with the session. Porting it to
> real Vue routes is still open, and still waits on the shape being ruled.

**Why HTML and not the real app** — my choice, allowed by the user (*"You coulde
even do the mock in the real app … your choice"*). Reasoning: almost nothing
structural is ruled, so putting redesign screens into the repo means unwired views
sitting beside working ones while the design still moves; and the port cost is low
because the markup maps onto the kit primitives and the tokens are already
byte-identical to `tokens.css`. **The moment the shape is ruled, build it in the
app for real rather than mock it twice.**

**The build:**

| File | Role |
|---|---|
| `build_mock.py` | assembles everything → `workbench-mock.html`. Run it after **any** screen edit. |
| `_head.html` | `<title>` + the whole `<style>` block (tokens copied from `tokens.css`) |
| `_s1`–`_s13.html` | the original screen stashes (`stash(n)`) |
| `_new_*.html` | the newer route screens (`new(name)`) — home, projects, chapters, lines, discover |
| `_interactions.py` | `CSS` (modal/toast/scope/statebar) · `MODALS` (m-scope, m-compare, m-effect, m-word) · `JS` (`openModal`, `closeModal`, `toast`, `pickRadio`, `pickChip`, `openScope`, `setScope`, `recalcScope`, `runScope`) |
| `wire.py`, `wire2.py`, `wire3.py` | the three wiring sweeps that got it to 123 controls / 0 dead. `wire3.py` is the final backstop — it gives any remaining `<button>` without `onclick`/`disabled` a real action. |

**Key functions in `build_mock.py`:**
- `ROUTES` — the ordered `(id, body)` list. **A new screen is not reachable until
  it is added here**; each becomes `<div class="route" id="r-<id>">`.
- `steps(active)` — the Studio step strip. **Still four steps** (Script · Cast ·
  Render · Export) with `k-book` / `k-pod` / `k-game` variants of step 1. Needs
  the five of §8.5.
- `inject_steps(body, active)` — splices the strip into a screen. It uses
  `re.search`, not an exact string match, because the body div can carry content
  on the same line.
- `linkify(body)` — rewrites known labels into `nav()` calls at build time.
- `RAIL` — the persistent sidebar. Carries `sv-container` / `sv-flat` classes for
  the Studio toggle (§8.20) and `k-book` / `k-game` / `k-pod` for project kind.
- `MODEBAR` — the Studio-model switcher above the shell.
- `SCRIPT` — `nav()`, `openProject()`, `setStudio()`, with `IX.JS` injected.

**The loop that works:**
1. Edit a `_s*.html` / `_new_*.html` file.
2. `python build_mock.py` (prints route count + line count).
3. Validate structure — unclosed/mismatched tags, every `nav('x')` target exists
   in `ROUTES`, every route reachable.
4. Sweep for dead buttons; run `wire3.py` if any remain.
5. Publish to the **existing** artifact URL
   `https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`
   by passing it as `url` — a new file path would create a second artifact.

**Traps that have already cost time:**
- **cp1252 print trap** — printing an emoji from Python crashes *after* the file
  writes have succeeded, so a script can half-run and look like it failed. Use
  `.encode('ascii','replace').decode()` in every `print`.
- **Heredoc quoting** — apostrophes in Python passed through a shell heredoc break
  it. Write script files with the Write tool instead.
- **Regex edits eat tags** — a `re.sub` removing a card once swallowed a closing
  `</div>` in `_s5.html`. Always re-validate structure after a regex edit.
- **Publishing without rebuilding** — editing a `_new_*.html` and publishing does
  nothing; `build_mock.py` must run first. **This is currently true of
  `_new_chapters.html`** (§8.20).

---

### 8.2 Inline is CHOSEN. Page-first is deleted. — RULED

User: *"yes and i choose your rec inline so drop the othe mock"*.

This closes the *"we still have a couple of different designs mocks, the inline
vs not, correct?"* question. **There is one interaction model now: inline.** A
row expands in place; there is no page-first variant, no toggle between them, and
no comparison screen.

Every trace was removed from the mock — the toggle, its CSS, the `mode()`
function and the comparison card.

**The cost was stated and accepted when the choice was made:** rows get tall when
open. Two mitigations are part of the ruling, not optional polish —

- a **collapsed row shows only what differs from the default** (blank direction
  means "as the persona", blank pause means "as the project"), so the eye lands
  on exceptions instead of a wall of repeated values;
- **cells render as text and become inputs on focus**, rather than 214 live
  textareas in the DOM.

> **Do not confuse this with the Studio toggle in §8.19.** That is a *different*
> and *still-open* comparison (container vs dissolved), added later. Inline vs
> page-first is settled and gone.

---

### 8.3 Tuning lives in TWO places, not four — RULED

User: *"again i am confused we have tunning on 4 different places chapter cast
workbench persona, why"* → then *"yes"* to the fix.

**It was never a four-layer design. It was a three-layer design drawn on four
screens, with one of them a duplicate.** Verified in code:

| Screen (before) | Knobs it showed | The layer it actually is |
|---|---|---|
| Workbench | 9, incl. top-k, top-p, repetition penalty | **the voice** — calibrating the artifact |
| Cast | speed · pitch · gain · temp · pause · seed | **the persona** |
| Personas | speed · pitch · gain | **the persona — again** ← the duplicate |
| Chapter line | speed · pitch · gain | the line — but drawn to *look* identical to the other two |

**A cast row IS a persona.** `ProjectPersona` merely links a project to a
`Persona`, and the cast endpoint ships `persona_name` off that same row
(`4c284a0`). So the Personas screen was the Cast editor drawn twice, and its
knobs were a strict subset. And the line's three sliders are a genuinely
*different* layer — a per-line override — that looked identical to the persona's,
so it read as a fourth copy of the same thing.

**The ruling, in two parts:**

**(a) Cast and Personas are ONE editor with TWO doors.** The same component,
drawn identically, with the relationship stated on both: *"the same persona
editor — editing here edits them everywhere."* **Cast** is the door when you are
inside a project. **Personas** is the door when you are not, and it becomes a
**library index** — list, usage, search — that opens that same editor rather than
a second one. In the mock, Personas was deliberately **not** redrawn with
controls, and the screen says why: reproducing the same controls on two screens is
exactly what read as two systems.

**(b) The line stops looking like a knob panel.** **Direction (text) is the
per-line tool.** The numeric override collapses to a closed
`⚙ Override the numbers for this line — not set` affordance, which opens to three
plain fields showing the persona's values as the fallback, and puts **a dot on
the row** when it is set.

**Why the hatch cannot simply be deleted** — the honest caveat that is part of the
ruling: **Kokoro and Chatterbox take no written direction at all.** On those
engines the numeric override is the *only* per-line control that exists. Delete it
and half the engine catalogue loses per-line control entirely.

**Where it lands:**

| Surface | Sliders | Layer |
|---|---|---|
| **Workbench** | 7 | the **voice** — calibrating the artifact |
| **Cast** | 4 | the **persona** — one editor, two doors |
| **Chapter line** | 0 | direction is **words**; numbers hide in a closed hatch |
| **Personas** | 0 | index only |

This is consistent with §2.4's approved guitar analogy (a guitar's *setup* versus
how the *player* plays it) — it removes the duplicate, it does not add a layer.

---

### 8.4 The vocabulary — persona · cast · speaker. Never "character" — RULED

User: *"be consistant you have words cast character persona which is which"*.

I had been using all three interchangeably. Verified against the code: it has
**two entity words and one attribution word**.

| Word | What it is | Where it is real in the code |
|---|---|---|
| **Persona** | **The entity.** A named speaker: a voice, how they sound, who they are. Library-level, crosses projects. | `class Persona`, `/v1/personas/*`, `PersonaStore`, the sidebar label **"Personas"** |
| **Cast** | **The set** of personas linked to *this project* — and the **verb**. | `class ProjectPersona`, `get_cast` → `CastEntry`, the Studio step |
| **Speaker** | **The persona a given line is attributed to.** Attribution vocabulary only. | `discover-speakers`, `SpeakerCandidate`, `speaker_attribution` |
| ~~Character~~ | — | **Nowhere in the codebase.** I introduced it. |

> A **persona** is the entity. The **cast** is the personas in this project. A
> line's **speaker** is which persona says it. **Never "character".**

It is also right for JV specifically: personas cover podcast **hosts**, game
**NPCs** and dictation, where "character" reads oddly. That is likely why the word
was chosen in the first place.

*"needs a speaker"* and *"Find speakers"* stay exactly as they are — that is the
attribution question, and `speaker` is the right word for it.

**The sweep was offered and has NOT been given a go.** What it would cover:
- the mock — **25 instances** of character/characters against 82 of cast/persona.
  Concretely: Cast says *"5 characters · 3 cast"* and *"Cast rows ARE
  characters"*; the workbench says *"Used by 3 characters"*; Personas says *"14
  characters"*; the chapter list says *"5 characters"*; the per-kind matrix
  measures cast scale in characters.
- **this doc** — §2.3 is written in "character" throughout, and §2.2 / §2.5 / §3
  use it too. Only the two paragraphs corrected in §2.3 have been changed.
- `docs/dev/TASKS.md` entries.

---

### 8.5 Five steps: Discover → Script → Cast → Render → Export — RULED

User: *"i would say discover speakers hould be its owne thing script should have
anaylize and review"*.

> **Discover → Script → Cast → Render → Export**

**Discover is its own step because it is a different verb.** It attributes
nothing. It reads the prose, proposes names *not yet in the cast*, and on
confirmation **creates personas**. Attribution cannot run without that list,
because Analyze can only choose from personas that already exist. That is why it
runs first. See §8.11 — they are two separate endpoints, not one feature.

**The history matters, because I got it wrong once and must not repeat it.** The
user said *"studio workflow at least in part seems write you run script you get
speakers, you assing speakers persona, you render, so that basic flow is correct"*
— I turned that into a design premise and started rebuilding, and was stopped:
*"no i didnt say script cast render is correct, i dont know how you have it
desinged now i wanted your thougths"*. **Thinking out loud is not a ruling.** The
five-step sequence is approved now because the user proposed it themselves and
then said `go` — not because of that earlier half-sentence.

---

### 8.6 Script does exactly one thing — RULED

User, on the screenshot of the combined page: *"i think you combined too much in
one page … you have spoken with direction all this stuff on the page with script,
way to busy, we purposely sepeate script it is for 1 thinkg only determining who
says what and what they say, that is it, no the direction they say it in not the
voice just 1 simple task"*.

**Script answers: who says this, and what do they say. Nothing else.**

| Stays on Script | Moves to Render |
|---|---|
| speaker | direction |
| line text | pause |
| how it was decided (source + confidence) | state |
| | take / take count |
| | Gen |
| | the voice chip |
| | *"what this line will sound like"* |
| | the takes panel |

None of the right-hand column is an attribution question, and Render is where you
are already thinking about how it sounds.

**This fixes the chip strip by itself.** The strip the user photographed —
`All 214 · 9 below the floor · 3 no answer · 40 uncast · 187 not rendered ·
9 stale · 27 done` — mixes three steps' concerns on one page. Split by step:

- **Script:** All · Guessed · Flagged · Below the floor · Unattributed (§8.15)
- **Cast:** uncast
- **Render:** not rendered · stale · done

**Consequence for §2/§3:** the "merge Chapters + Script + Render into one surface"
decision is dead, and "Render is a panel, not a place" with it. **Render is a step
that owns the performance layer.**

---

### 8.7 Scoping a run — an inline grid, never a modal — RULED

User: *"this popu for chapters, no one has three tags that say all none this
chapter only, we just have a checkbox for select/unselect all and individual
checkboxes check you desing program it is horrlbe no one desgns stuff like that.
i say drop the popu have the grid above the results"*.

They are right twice: the three radios (**This chapter / Selected / All 14**) were
**presets for the checkboxes underneath them** — redundant furniture — and the
decision never needed to interrupt anything, so it should not have been modal.

**The design:** one inline grid above the results. A **select-all checkbox in the
header**, one checkbox per row — the standard pattern, nothing else. Select what
you want, the estimate updates in place, **Analyze** sits above it, results appear
below. No popup, nothing modal.

**Scope exists as a control for a reason the user gave explicitly:** *"the reason
we can find the speakers 1 chapter at a time is becuase that process can be long
so we want to be able to do both find by 1 chapter or multiple chapters"*.

---

### 8.8 Multi-chapter results — the same grid fills in — RULED

The user's proposal: *"you select what chapters you want to analyexe in grid, it
runs and completes and shows list of chapters it ran on and the results, then user
can click on each chapter they want to manually review and make review or the can
again do a second pass on the results, maybe somethink like that, think onit
again, dont just take my idea as the correct one"*.

**Their core move is right** — batch the slow thing, review the interactive thing
separately — and it preserves what already works: reading one chapter in order.
**Three changes**, agreed with the `go`:

**Change 1 — no separate results list; the same grid fills in.** A results screen
means two surfaces showing the same 14 chapters, and once you are on it you have
lost the selection you would need to re-run. One persistent grid: select rows, hit
Analyze, and *those same rows* gain their outcome. Click a row → that chapter's
lines. No transition, no second screen, selection still live.

**Change 2 — stream it; do not wait for the batch.** If analysis is slow, waiting
for six chapters before touching any of them wastes the time you would have spent
reviewing chapter 1. Each chapter completes → its row fills in → it is immediately
reviewable while the rest run. This also matches how the synth scheduler already
batches work.

**Change 3 — the summary must not imply correctness.** The one that matters, and
where I pushed back hardest: a results view naturally reads as a report card, and
*"Chapter 2: 0 unattributed ✓"* invites you to tick it off — which is **exactly
the row a confidently-wrong model produces**.

**So the columns report how each line was decided, never how well it went:**

| ☑ | Chapter | Lines | Analyzed | Anchored | Guessed | Flagged | No speaker |
|---|---|---|---|---|---|---|---|
| ☑ | 1 · The Ninth Door | 214 | 2 min ago | 168 | **41** | **6** | **5** |
| ☐ | 2 · Salt and Ledger | 188 | 3 days ago | 181 | 7 | 0 | 0 |
| ☑ | 4 · Nine Doors Down | 176 | *running…* | — | — | — | — |

- **Anchored** — the prose named the speaker. Trustworthy.
- **Guessed** — the model chose. *This is the number that deserves your eyes*, and
  **it does not shrink because the model felt sure.**
- **Flagged** — the deterministic checks of §8.14.
- **No speaker** — it declined, or fell below the floor. These block rendering.

**No completion state. No green tick. No confidence column.** A chapter with 181
anchored and 7 guessed is genuinely low-risk; one with 41 guessed needs reading
regardless of what the model claimed.

---

### 8.9 Review — the second LLM pass — is manual, and scoped — RULED

User: *"review second llm pass should be manaul"*.

It is a **second opinion you spend tokens on deliberately**, not a tax on every
Analyze. Auto-running it would cost tokens on every pass; leaving it manual means
the review queue is longer than it needs to be, and the user chose the longer
queue knowingly.

**Scoped to what is suspicious**, not to whole chapters: run Review on the
**guessed and flagged** lines in the selection. Cheaper, and it targets the
population that can actually be wrong.

---

### 8.10 Analyzing inside a chapter must not bounce you out — RULED

One chapter → **stay where you are**, results appear in the lines. The grid is for
multi-chapter work. Losing your place mid-review to a summary screen is a
regression on the flow that already works today.

---

### 8.11 Analyze and Discover are two endpoints — VERIFIED

| Step | Endpoint | What it does |
|---|---|---|
| **Discover** | `POST /v1/scenes/{id}/discover-speakers` | finds names the prose mentions that are **not** in the cast; `promote` turns a candidate into a persona |
| **Script** | `POST /v1/scenes/{id}/analyze` | attributes lines to personas **already in the cast** |

The mock previously drew **one** button — *"Find speakers"*, subtitled *"reads the
prose and says who is talking"* — which is really **Analyze**. The discovery half,
the thing that builds your cast in the first place, **was missing from the mock
entirely**.

---

### 8.12 How attribution actually works — the five sources — VERIFIED

Read from `extraction/pipeline.py`. `analyze_scene` runs five stages:

1. **Segment** — `split_into_paragraphs` → `segment_paragraphs`, tagging each
   segment `dialogue` or `narration`.
2. **Deterministic anchors, before any LLM** — `find_anchors(segments,
   characters)` catches *"said Mara"*-style attributions and propagates them.
   Skipped when `propagate` is off.
3. **Route pick** — `pick_route` resolves Auto by model size and carries a
   **confidence floor** per route.
4. **The LLM call — dialogue only.** Narration never goes to the model. The
   feature action is `speaker_attribution.{route}` with three variables:
   `characters`, `corrections`, `paragraphs`. It can stream, so a long chapter
   shows live tok/s.
5. **Assemble** — where the real logic lives:

| Case | Result |
|---|---|
| Narration | `narrator`, confidence **1.0**, source `narration` — the model is never asked |
| Dialogue **with** an anchor | **the anchor wins**, confidence 1.0, source `tag` or `propagated`. The LLM's pick is kept as `llm_speaker` so the Lab can show disagreement |
| Dialogue, no anchor, above floor | the LLM's pick, source `llm` |
| Dialogue, no anchor, **below floor** | demoted to `unknown`, source `floored`, with `floored_from` recording what it wanted to say |
| LLM returned fewer rows than lines | padded with `unknown` @ 0.4 |

**A line can be unattributed for two different reasons** — the model was unsure,
or it never answered — and those have different fixes. That is why the mock's flat
*"12 unattributed"* was split into **below the floor** and **no answer**.

**How much to trust each source** — the table that replaces confidence as the
triage axis:

| Source | Trust |
|---|---|
| `narration` | structural — never a question |
| `tag` | the prose literally says *"said Marius"* — near-certain |
| `propagated` | carried from a nearby anchor — good, but **it can drift past a speaker change** |
| `llm` | **a guess, regardless of the number attached to it** |
| `floored` | a guess it doubted |

---

### 8.13 The constraint that drives the whole review design

User, from their own testing: *"model can and has said with 100% confidence that
it is correct when it is clearly wrong"*.

> **Therefore confidence cannot be what decides what you look at.**

That single sentence killed my previous proposal (§8.30 rejected #1) and set three
rules:

1. **Trust source, not self-report.** A page of 214 lines should show instantly
   *which ones are guesses* — ~40 rows, not 214 — and that does not depend on the
   model being honest about itself.
2. **No summary may imply correctness.** No green ticks, no score, no "confidence"
   column anywhere. A confidently-wrong model produces exactly the row that looks
   finished.
3. **The user must always be able to see every line, by chapter, in order.**
   Filters are lenses over that, never a replacement for it. User: *"user should
   be able to see and review all lines … still need to be able to see all lines by
   chapter"*.

---

### 8.14 Compute suspicion instead of asking the model — **NEW WORK, NOT IN CODE**

Don't ask the model how sure it is; check the text for the patterns that actually
indicate a bad attribution. All cheap, all deterministic, none of them trusting
the model:

- **Three or more consecutive dialogue lines by the same persona** — the single
  most common failure; the model loses the alternation.
- **A persona with exactly one line in the whole chapter** — almost always a
  misattribution.
- **A speaker who has not appeared in this scene yet.**
- **Dialogue attributed to the Narrator**, or narration attributed to a persona.
- **`propagated` immediately after a paragraph containing another persona's
  name** — the anchor probably went stale.

These become the **Flagged** filter, and they catch confident-but-wrong lines,
which confidence never will.

> **⚠ None of these checks exists in the code.** They would be a new deterministic
> pass over the blocks after attribution. Cheap, no model involved — but it is
> **new work**, not the surfacing of something already there.

---

### 8.15 The chapter review surface — read it as a script

The reason the current one-chapter flow works is that you can **read** it.
Alternation errors are visible to a human at a glance and invisible to a filter.
So the default view is the chapter as a screenplay — speaker label left, line
right, in order — with weight carrying the risk:

| Line kind | Treatment |
|---|---|
| narration | **recedes** — grey, lighter. Never in question. |
| anchored | normal weight, small `tag` marker |
| guessed (`llm`) | **marked** — a left rule or tint — so ~40 guesses stand out of 214 **without anything being hidden** |
| flagged | louder still, **with the reason on the row**: *"3rd June in a row"* |
| unattributed | loudest |

**Filters are lenses, never the view.** Default is **all lines, this chapter, in
order**. The filter set: `All · Guessed · Flagged · Below the floor ·
Unattributed`.

**Correcting has to be fast, because that is the actual work:**
- **j / k** to move, **1–9** to assign a persona, **Enter** to accept — no mouse
  for a long chapter.
- **Select a run and reassign together.** When alternation breaks, several
  consecutive lines are wrong at once; fixing them one at a time is the tedium.
- **Reassigning re-flags the neighbours** — fixing line 47 usually means 48 was
  wrong too.
- **Context on demand:** expanding a row shows the two lines either side, because
  attribution is almost always decided by what surrounds it.

**Multi-chapter changes nothing about this.** Chapters become sticky collapsible
groups with per-chapter counts, defaulting to expanded for the one you came from.
You never lose *"see everything in order"*, which is the thing that works today.

---

### 8.16 One state vocabulary, rolled up — and what it justifies

The problem found while auditing: **four surfaces already answer "where is this
project"** — Home's continue card, Projects' detail expansion, ChapterView's
workflow strip, and Studio's step tabs — and each invents its own words for the
same facts.

> **One state vocabulary, defined at the line, rolled up at every zoom level.**

> ● needs a speaker · ● needs a voice · ● ready · ● rendered · ● stale

| Zoom | Shows |
|---|---|
| **Line** | the state itself |
| **Chapter** | the rollup — *214 lines · 12 need a speaker · 40 need a voice · 27 rendered · 9 stale* |
| **Project** | the rollup of chapters |
| **Home** | the rollup of projects, and what to do next |

Same words, same colours, same order, everywhere. In the mock it is a segmented
bar on Home's Continue card, the chapter-list header and every chapter row.

**This is what justifies redesigning the chapter list** — not taste. Today a
chapter shows two coarse tags, **Script** and **Render**, and two tags cannot say
*which* of the five states is blocking. The list **keeps** what `ChapterView`
already does well and that I nearly threw away — **Words**, **Est. audio**, the
filter chips, move/rename/delete — and replaces only the two tags with the bar
plus a **Blocking** column naming the single next thing to fix (*"12 need a
speaker"*, *"Harbek has no voice"*, *"9 stale"*).

**Home is adjusted, not rebuilt.** I had redesigned it with no reason and it was a
straight regression. `HomeView.vue` (561 lines) already has the empty-state hero
*"What are you making?"*, a Continue card with per-project mini-steps, live tasks
with progress, engine status **with VRAM**, and recent generations with one-click
inline replay. Only its `miniSteps` and next-step banner change, because they
speak the old step vocabulary. The user's instruction that produced this: *"you
can redesign parts we have like homepage if you think of a better desgin but you
need to justify it not just becuase you feel like it verify what we have in code
first"*.

**Three of the four screens I had "added" already existed** — `ChapterView.vue`
(1,481 lines) has the chapter list, and better than my version; `LinesView.vue`
(292) is the game voicelines grid; `HomeView.vue` as above. Only the per-chapter
editor genuinely needed the work.

---

### 8.17 The mock standard, and the audit it forced

> *"when a user asks for a mock this is what they expect to see in production not
> sorta of, the reason a mock is easier is becuae the plubming is not needed but
> the expecataition is the ui would look exactly the same and mock buttons and nav
> work the same … your mocks have always been lazy and half a job"*

> *"if we dont get it all correct in the mock we waste hourse of coding the mock is
> the app without the full plubming"*

> *"on voices what does open do, you need to be thourough only put what is going to
> be on the page dont leave stuff there becuase it was before"*

> *"so look at the whole damn mock i want it accurate to the T not just sort of"*

> *"when i click each button on the script page what does it do wherre does it go,
> same with other pages, stop half mocking do it right do it all even pages we may
> not be touching"*

Recorded as an invariant in `CLAUDE.md` and in memory. The audit it forced found
**16 defects and ~18 commentary blocks**, all since fixed:

**Factual errors, verified against code:**
1. **Master targets were invented.** The mock offered *ACX · Podcast · Game asset
   · None*; the real list is `acx · inaudio · podcast · youtube`
   (`mastering.py:38`). **"Game asset" does not exist**; `inaudio` and `youtube`
   were missing.
2. **The sidebar rail was invented** — it showed a made-up "Cast" library item and
   silently dropped Personas, Presets, Captures, Lines, Studio, Stories, Import
   and Settings.
3. **Three names for one thing** — ribbon "Characters", rail "Cast", app
   "Personas". (§8.4.)

**Internal contradictions:** the ribbon listed Chapter and Render as separate
steps while the chapter screen declared *"this one screen replaces three"* ·
persona counts disagreed across screens (4 / 5 / 14) · Cast showed a table plus
three stacked expansion cards · take 1 claimed a Kokoro origin for a Qwen3-cast
persona · Export duplicated stems and showed the **Game export card inside an
audiobook project**.

**Leftovers:** the `INLINE MODE` comment from the deleted two-mode version, and
the **`Open` button on Voices** — which contradicted its own screen, since the
hint underneath said *"row click opens the workbench"*. Two affordances for one
action, from two drafts.

**Recorded but missing:** the scheduler queue state — now on Render as *"⏳ 34
lines waiting on Chatterbox. One speech engine runs at a time…"* — which is the
entire point of §6 finding 6.

**~18 commentary blocks stripped**, because they are me talking to the user, not
the app talking to a user: *"This one screen replaces three… still a proposal"*,
*"Why Chapters as it stands can't work"*, *"5 characters, so rows can open by
default"*, the `same editor as…` tags, *"You almost never come here on purpose"*,
the preset obituary, *"The alternative I rejected"*, and **the whole arguments
screen (s14), now deleted** — the design rationale lives in this doc, not on the
canvas.

**What stayed, because it IS production copy:** the load-cost warning, the render
refusal list, *"Cloning needs Chatterbox"*, *"clones inherit room tone"*, the
IPA-engine caveat.

**Also found on Voices and fixed:** the type chips listed only *Preset* and
*Cloned* though the door offers seven kinds (Derived, Designed, Blended, Trained,
Imported were missing) · rows said nothing about **load cost**, so previewing a
Qwen3 voice while Kokoro is resident looked free · and two real features the mock
had dropped — the **hidden** filter (presets cannot be deleted, only hidden) and
**✨ Guess unknown genders**.

---

### 8.18 EXACTLY WHERE THE MOCK WORK STANDS — resume here

Build mechanics are in §8.1. This is the state, verified against the files on
2026-08-16, not remembered.

**Published and working today** —
`https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`:

- A real shell: persistent sidebar, **17 routes** (`home · projects · new ·
  chapters · lines · chapter · cast · render · export · voices · workbench ·
  newvoice · personas · lexicons · effects · scene · engines`), breadcrumbs, and
  **123 controls with 0 dead** — 119 wired, 4 deliberately disabled with the
  reason on them.
- **Both Studio models behind a top toggle** (§8.19).
- **Per-kind branching:** opening Ninefold turns "Chapters" into "Voice lines",
  drops the Find-speakers verb (a game sheet already names its speakers) and
  relabels step 1 to *"Lines"*. The Long Quay opens as a podcast with Episodes.
- **Analyze and Discover as two buttons**, both scope-able, with the run's
  settings on screen (`Route Auto → direct` · `gemma-3-12b` · `floor 0.55`).
- **Every line says how it was decided** — the five source badges of §8.12.
- Filter chips that filter; a real A/B take-compare modal; an effect picker; the
  pronunciation modal with its *"37 lines become stale, not re-rendered"*
  consequence.
- **Home is the real `HomeView` shape**, not an invention (§8.16).
- Tuning on two surfaces only (§8.3); Personas is an index.

**The Script / Discover / Render restructure — BUILT AND PUBLISHED 2026-08-16:**

| Screen | What it is now |
|---|---|
| **Discover** (`_new_discover.html`, route `discover`) | Its own step. Chapter-selection grid with a live estimate, a **Proposed speakers** table (Tom Harlan / the harbour-master / a woman at the rail) with line counts, first-appearance quotes and ＋Add / Merge… / Ignore, and an *"Already in the cast"* card: *"attribution can only choose from these — that's why this step runs first."* |
| **Script — the grid** (`_new_chapters.html`, route `chapters`) | §8.8 exactly. Select-all + per-row checkboxes, columns **Chapter · Lines · Analyzed · Anchored · Guessed · Flagged · No speaker**, a streaming *running…* row with its own progress, a "what these columns mean" card. **No tick, no score, no confidence column.** |
| **Script — the chapter** (`_s2.html`, route `chapter`) | Attribution only, read as a screenplay. Narration recedes; anchored is normal with a `tag` mark; guesses carry a gold left rule *at every confidence*; flags are red with the reason on the row (*"3rd Marius in a row"*, *"Harbek's only line"*); unattributed is loudest and says it blocks rendering. Filters `All · Guessed · Flagged · Below the floor · No answer`, the j/k · 1–9 · Enter hint, **Select a run → Reassign** with the re-flag note, and a "how to read the marks" card. Four verbs only: Analyze this chapter · Review the guesses · Analyze several chapters · A speaker is missing. |
| **Render** (`_s4.html`, route `render`) | Now owns the performance layer: the batch card and scheduler queue as before, **plus** the line-by-line table with Direction · Pause · State · Take · Gen, the row expansion with the voice chip, the direction box, the override hatch (with the Kokoro/Chatterbox reason), *"what this line will sound like"*, the takes panel and Compare. Who speaks is **read-only here**, with `Change in Script →`. |
| `steps()` | **Five** — Discover · Script · Cast · Render · Export, with the game variant keeping four (a sheet already names its speakers). |

**Also done in the same pass, because the rulings required it:**
- **The scope modal is deleted** — markup and all four JS functions. It was the
  rejected three-radio popup (§8.7) and had become unreachable, which is exactly
  the leftover the mock standard forbids. Its one good behaviour, the **live
  estimate**, moved inline: ticking chapters relabels the button (*"✨ Analyze 3
  chapters"*) and recomputes lines and time in place, on **both** Discover and
  Script, scoped per route.
- `pickChip` now filters the script view as well as tables, so Script's chips work.
- The rail gained **Discover** in the dissolved model; `_new_lines.html` lost its
  hardcoded four-step strip and takes the shared one.
- Home's running task said *"Find speakers"* — the operation is **Analyze**.

**Verified after the build:** tag structure clean · 18 routes, **no dangling nav
targets and no unreachable route** · **126 controls, 0 dead**, 6 deliberately
disabled · the JS parses. The 6 `.lnk` spans without their own `onclick` sit
inside clickable rows and are not dead.

**Not started:**
- The remaining app screens the user asked for — **Captures, Stories, Presets,
  Import review, Cache, Webhooks, Channels, Train, Compare, Audio tools**. Their
  words: *"i want everything in the mockup besides the areas we already identified
  like settings ai settings, i want every link navidatable to what it actaully
  sees and does"*. Some are screens the redesign proposes to kill, which is a
  judgment to show rather than make silently.
- The terminology sweep of §8.4.

---

### 8.19 Studio: container vs dissolved — BOTH BUILT, STILL OPEN

The user would not pick when asked: *"i need both views on studieo container nad
chapters i need to see it"*. Both are in the mock behind a toggle that switches
the whole app (`setStudio('container')` / `setStudio('flat')`).

| | **Container** | **Dissolved** |
|---|---|---|
| Rail | Home · Projects · **Studio** · Library… | Home · Projects · **Chapters · Cast · Render · Export** · Library… |
| Steps | four tabs inside Studio; the chapter list lives in its Script step | no step strip anywhere; each is its own destination |
| Breadcrumb | `Projects › Stillwater › Studio › Ch. 1` | `Projects › Stillwater › Ch. 1` |
| Routes | `/chapter` and `/lines` stop being standalone | they are the standalone routes |

The difference is **navigation depth versus rail width**. Kind still branches
underneath in both. **§4 open question 1 remains open** — this is now something to
look at rather than imagine, which was the point.

---

### 8.20 Rejected alternatives, and why

1. **The review queue** *(mine — rejected by §8.13)*. After a run, Script would
   default to **Needs review**: only lines in question, across everything
   analyzed, in book order, one keystroke each, *"18 of 61 reviewed"*, empty when
   done. Good interaction, **false premise** — that confidence can pick the rows
   worth showing you. The user's testing disproved exactly that, and it hides
   lines, violating *"see all lines by chapter"*. Its good parts survive in §8.14
   as the keyboard model and context-on-demand.
2. **The scope modal with three radios** *(mine — rejected, §8.7)*.
3. **A separate results screen after a run** *(the user's first shape — replaced
   by the filling-in grid, §8.8, with their agreement)*.
4. **Auto-running Review before you see results** *(mine — rejected, §8.9)*.
5. **Page-first as a second interaction model** *(deleted, §8.1)*.
6. **Redesigning Home** *(mine — withdrawn; it was a regression, §8.16)*.

---

### 8.21 Open after this session

1. **Does Studio survive as a container?** Both built (§8.19). Unruled. This is
   §4 open question 1.
2. **Do the deterministic suspicion checks get built?** (§8.14) New work.
3. **Does the terminology sweep run**, and does it cover the docs as well as the
   mock? (§8.4) Offered, no go.
4. **Do the remaining screens go into the mock?** (§8.18) Asked for, not started.
5. ~~**Does the mock move into the repo?**~~ **DONE 2026-08-17** — it lives at
   `docs/plans/mock/` with a README; `build_mock.py` + `validate.py` run from
   there. Porting it to real Vue routes is still open, and still waits on the
   shape being ruled.
6. **Are the stress-test counts built?** Every screen in the mock is still
   populated at whatever count flatters the layout — the gap the user found with
   *"in your mock you have game and podcast, what would user see if i just have an
   audiobook a bunch of blank space?"*:

   | Screen | Mock shows | Real range |
   |---|---|---|
   | Projects | 3, one of each kind | often **1** |
   | Cast | 5 personas | 1–2 solo narration, **500** for a game |
   | Chapters | 6 of 14 | 1 to 60+ |
   | Voices | 5 of 64 | 64 fresh, 65+ after one clone |
   | Lines | 4 of 342 | 200–3,000 per chapter |

   Plus the genuine empty states — no projects, no voices cloned yet, a chapter
   with nothing rendered. **Not fixed.**
7. **Can a character's persona vary by scene, or is it one per character?**
   (§8.22) User 2026-08-17: *"i dont know yet."* Nothing may assume either way.
8. **Does the workbench lose its knob panel** for make · hear · calibrate ·
   derive, leaving one set of live sliders on the persona? (§8.22) Argued, not
   ruled — and the mock still shows 7 workbench sliders + 4 on Cast.
7. **Is the starved analyze prompt why gemma-MoE attributes worse than
   gemma-3-12b?** §6 finding 7: `_resolve_cast` (`extraction_api.py:145-167`)
   hardcodes role/gender/pronouns to `None` and aliases to `[]`, and
   `format_characters` (`extraction/prompts.py:82-97`) reads those empty fields.
   **The prompt receives a bare list of `id` and `name`** — no descriptions, no
   aliases, no pronouns. A smaller model has nothing to reason from, which would
   widen exactly that gap. **Cheap to test before blaming the model.**

---

---

### 8.22 The voice layer — what tuning is for, and where it lives

**Discussed 2026-08-17. One ruling still open (bottom of this section).**
Nothing here was built; it is the reasoning that has to survive, because it
took a long conversation to reach and the answer is not obvious from the code.

**The question that started it**, and it is the right question to keep asking:

> *"if one voice backs many personas then what is the purpose of persona … if
> persona doesnt really modify a voice than what is the purpose why not just
> have a place to make a voice and assing that voice to a cast"*

#### The premise is wrong — a persona modifies the voice substantially

Every persona field that reaches a render:

| Field | Effect |
|---|---|
| `default_delivery` | speed, pitch, gain — merged into `Delivery` |
| `effects_chain` | applied — `resolve_chain(persona_effects, preset_effects)` |
| `voice_instruct` | the **only** text that reaches the synth, as `delivery.instruct` |
| `lexicon_id` | pronunciation substitution before synth |
| `engine_override` | forces an engine regardless of the voice |

A persona is not a label on a voice. It is a full re-interpretation of one.

#### But a VOICE carries no tuning at all — so there is only ONE tuning place

`VoiceRecord` (`models.py:446`) is pure artifact metadata: `id · engine ·
source · name · language · gender · design_prompt · transcript · sample_count ·
blend_recipe · embedding · adapter_path · training_job_id · created_at ·
updated_at`. **No speed, no pitch, no gain, no effects, no instruct.**

So the "two places doing the same thing" the user spotted was **in my
proposal, not in the app**. Today: the persona, and only the persona.

#### Why the persona layer earns its place: it survives a recast

**A voice is bound to an engine. A character is not.** Bake the delivery,
effects and instruct into the voice, and the moment you recast Marius from
Kokoro to a Chatterbox clone, all his tuning dies with the old instrument —
it was attached to the artifact. Keep the persona layer and you swap
`voice_id` while his speed, gain, effects, lexicon and sheet survive.

Check it against the fields and it is not a coincidence: **every persona field
is exactly what you would want to keep when the instrument changes.** That is
the layer's job.

> **Voice tuning fixes the instrument. Persona tuning is the performance, and
> it follows the character when the instrument changes.**

#### The limit — and this is the half I got wrong first

Only the **host-side** part actually survives. From the delivery matrix in
`docs/dev/code-map.md` §5:

- **Survives any recast** (JustVoice applies it after synthesis): `gain_db`,
  the effects chain, lexicon substitution, and `pitch` since 2026-08-17.
- **Evaporates silently** (engine-specific): `speed` (kokoro, luxtts only),
  `instruct` (qwen3 **CustomVoice** only — Base drops it), `temperature`
  (chatterbox, qwen3).
- **Crosses one boundary, since 2026-08-17**: `emotion`. Prose cannot compile
  down to a token set, but a nine-value enum compiles both ways — into the
  instruct string for qwen3, into `[fear]`-style tokens for Chatterbox Turbo.
  It is the only part of a persona's *performance* that survives a recast onto
  a different engine family, which makes it the one to lean on in the design.
  `style_prompt` was deleted the same day: a second prose field that the qwen3
  adapter concatenated into `instruct` before sending, so the split it claimed
  never existed downstream.

So "the persona survives the instrument swap" is **half true**, and the UI has
to say which half: **the persona editor must show, per field, whether the
currently cast voice's engine honours it.** The machinery exists —
`GET /v1/engines/{id}/capabilities`.

#### Why a voice-level correction has to exist anyway

I proposed deleting voice tuning entirely and normalising loudness at clone
time instead, so the quiet-clone case would need no knob. The user: **"no it
cant"** — and that is right. A clone's artifact is a **conditioning input**
(embedding / audio prompt), not output audio. Normalising the reference does
not determine how loud the synth comes out, so the correction can only be
applied **at render**, which means **the voice has to store it**.

That is the reasoning behind the earlier approved constraint — *"i do want a
voice tuning page this is part of creating a new voice for a persona to
consume"* — and it survives the audit intact.

**How to keep it from becoming a second knob panel:** make it a *measurement*,
not a slider. Render a probe line, measure it, store the offset — **Calibrate**,
with the number overridable. You cannot know a clone is quiet without
synthesising anyway, so the app is better placed to measure it than the user is
to guess. That leaves **one set of live sliders in the app — on the persona** —
and a measured constant on the voice.

#### What follows for the workbench

After the delivery audit there is **no legitimate voice-level slider left**:
pitch is post-process on every engine, speed and temperature are
engine-specific *performance* settings that belong to the character, effects
are host-side. So the workbench is:

> **make · hear · calibrate · derive**

a creation flow plus one measured correction — **not** a second knob panel.
The user's own wording set this and I read it too loosely the first time:
tuning is *"part of creating a new voice"* — a **creation step**, not a
permanent second control surface.

**Consequence for the mock:** it currently shows **seven** live sliders on the
workbench and **four** on Cast, which is exactly the two-places problem. Not
fixed.

#### OPEN — needs a ruling

> **Can a character's persona vary by scene, or is it one per character for
> the whole book?**

One-per-character keeps §2.3's rule intact — a different voice for a passage
is a different character. Allowing it to vary is the honest way to do a
flashback, a possession or an age change, but it re-opens the door render
presets came through (§3 decision 6).

User, 2026-08-17: **"3 i dont know yet"** — so it stays open, and nothing in
the design may assume either answer.


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

**The mock:** ~~14 screens, Inline-first / Page-first toggle~~ — **STALE, see
§8.18.** It is now 17 routes with a Container/Dissolved toggle and 123 wired
controls; page-first was deleted when the user chose inline (§8.2). Source still
lives in the session scratchpad, not the repo.

**Unpushed, corrected 2026-08-16:** the "none — all four pushed" line above was
true when written and is not now. `git log --oneline origin/main..main` shows
**seven** doc commits waiting: `2fc878b · 3860fac · 7877889 · bcf8a34 · fef74a1 ·
a4854e2 · 56568b3`. Nothing in app code changed after Slice B.

---

## §9 The engine truth, and what voice design actually costs

**Researched 2026-08-17 on the user's *"we dont have the model but we need to
add it, qwen does"*, plus the Alexandria Voice Designer / Audio Editor
screenshots.** Written down because it was all verified once, at some cost, and
every fact here decides part of the design.

The per-engine grids themselves live in `docs/dev/code-map.md` §3a–3c (what
each model is · the honest ✓ grid of what each adapter reads · the inline-tag
syntaxes). This section is the part that is a *design input* rather than a
lookup table.

### 9.1 Qwen3 VoiceDesign is real, and it is one variant row away

| | |
|---|---|
| Repo | `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` |
| Call | `generate_voice_design(text, instruct, language=None, non_streaming_mode=True, **kwargs)` |
| Gate | `qwen3_tts_model.py:686` — `if self.model.tts_model_type != "voice_design"` |
| Size | 11-file load set, same layout as the CustomVoice rows, **≈ 4.52 GB** |
| Deps | **none new** |

**The call is already in the package we ship.** It sits in the installed
`qwen_tts` in `engines/.shared-venv`, beside `generate_custom_voice` and
`generate_voice_clone`. What is missing is a variant row in
`qwen3/manifest.py`, the checkpoint download, and one branch in the adapter.
`voice_design: False` and the "flips back with the VoiceDesign variant" note in
that manifest are therefore accurate and small.

> Byte count needs one re-pull before it goes in a manifest. Summing the file
> list the HF API returned gives 4,520,159,099; the API's own total disagrees by
> ~3 MB. Facts-only means neither gets typed until they agree.

### 9.2 A designed voice is NOT a voice — it is audio you then clone

This is the architectural fact, and it is easy to get wrong.
`generate_voice_design` is **per-call synthesis**. It takes a description and
returns *audio*. There is no embedding, no speaker id, nothing to store and
reuse. Alexandria hit this and solved it the only way it can be solved — their
wiki, verbatim:

> "The VoiceDesign model synthesizes reference audio from each description.
> Each speaker is assigned as a **Clone Voice** using the generated reference
> audio."

> "The generated reference audio is saved in `designed_voices/` and can be
> reused."

Which is exactly what their Voice Designer screen says on its face: *"Generated
voices can be saved and used as clone sources in the Voices tab."*

**So `POST /v1/voices/design → Voice` is a four-step pipeline, not a call:**

```
description → synthesize a probe → save the WAV → clone from it → Voice
```

And the resulting voice **is a clone**, which means it lands on whichever
cloning engine it is pointed at, and inherits that engine's abilities — not
Qwen's. Designing a voice does not keep you on the design model.

### 9.3 Alexandria's five voice types — and the one we have not used

Confirmed engine: the repo describes itself as *"…per-line style control…
**Built on Qwen3-TTS**"*, bundled, ~3.5 GB auto-download. So the **Emotion /
Style** column in its Audio Editor screenshot is Qwen's `instruct`, per line,
written by their LLM annotation pass — *"Each chunk has an `instruct` field set
by the LLM (e.g. 'Excited, bright energy'). If you set a character style, it's
appended."* That is the same two-layer composition JustVoice reached
independently (persona standing instruction + this line's direction).

Their five types:

1. **Custom Voice** — 9 presets + instruct
2. **Voice Clone** — from reference audio
3. **LoRA Voice** — a fine-tuned adapter **that still follows instruct**
4. **Voice Design** — from a description
5. **Speaker Aliases** — one speaker mapped to another's configuration

And their own statement of the trap we found in our code independently:

> "Instruct directions are **ignored** for clone voices — the voice identity
> comes entirely from the reference."

**#3 is the escape hatch and we already own the machinery** — `POST /v1/train`
and `TrainView`. Train a LoRA on an instruct-capable checkpoint and you get a
custom voice identity that still takes prose direction. Nothing else does.

### 9.4 The consequence for this redesign

**There are three ways to get a directable custom voice, and they are not
equivalent.** The app should say which one the user is on, at cast time:

| Route | Identity | Direction |
|---|---|---|
| VoiceDesign → clone | designed | **lost** — it is a clone now |
| Chatterbox Turbo clone | cloned | **categorical only** (19 tokens) |
| LoRA on an instruct checkpoint | trained | **kept**, costs a training run |

Today, choosing "I want to direct performances in prose" means choosing Qwen3
CustomVoice, which means giving up cloning. Either the app states that trade-off
where the choice is made, or direction stops being a first-class control.

**The design should lean on `emotion`, not on prose.** Prose reaches one
checkpoint. The nine-value enum compiles into prose for Qwen *and* into a token
for Turbo, so it is the only piece of a performance that survives a recast
across engine families. Built 2026-08-17 — see the TASKS item.

### 9.5 The field sprawl this replaced, kept as the record

Five prose fields fed **one** Qwen `instruct=` argument, across three screens
and two tables. It is why "what is instruct vs style prompt vs emotion" had no
good answer:

| On screen | Where | Field | Fate |
|---|---|---|---|
| **Spoken delivery** | Personas | `persona.voice_instruct` | kept — the standing layer |
| **Delivery direction** | Generate | `delivery.instruct` | kept — same field, one-off scope |
| **+ direction** | Chapters, per line | `block.direction` | kept — the line layer |
| **Style prompt** | Generate, Qwen only | `delivery.style_prompt` | **deleted** |
| — | nowhere | `delivery.emotion` | **given a UI and two compilers** |

`style_prompt` claimed to be "the consistent voice character" against
`instruct`'s "this line" — but Qwen has one slot and the adapter concatenated
the pair before sending, so the distinction died one line before the model.
That axis is persona-vs-line, and the app already had it.

### 9.6 Three consequences for the design — argued, not ruled, not started

These came out of the same conversation and each one changes the design rather
than adding a feature. None has a go. They belong here, not in `IDEAS.md`,
which is for new features rather than for working out a redesign.

**1. Move `speed` host-side, and the persona layer gets much stronger.**
This is the biggest lever the engine audit turned up. `speed` reaches **two of
nine models** (kokoro, luxtts) and every other engine ignores it — for a
narration app that is the most-wanted knob, and it is mostly inert. Unlike
`instruct` or the sampling knobs, **nothing forces it to be engine-side**: a
post-render time-stretch would sit exactly where `pitch`, `gain_db` and the
effects chain already do (`render_core`), and `speed` would join the set that
works on every engine.

Why it matters *here* rather than as a feature: §8.22 rests on the claim that a
persona survives a recast, and the honest version of that claim is "only the
host-side half does". Pacing is the most character-defining thing in that half
and it currently falls off. Moving `speed` makes the persona layer's promise
substantially more true, which is a design argument, not an optimisation.

Costs to weigh before any go: a pitch-preserving time-stretch is real DSP, and
it changes the cache key, so everything re-renders once.

**2. The direction-vs-identity trade-off has to be said where the choice is
made.** Prose direction reaches Qwen3 CustomVoice alone, and CustomVoice cannot
clone (§9.4). So picking "this character's cloned voice" silently costs you
written direction — and you find out later, when the direction you wrote does
nothing. `PersonasView.vue:96-107` already has the right *pattern*: a live
verdict that reads the engine's real capability instead of a hardcoded list.
Two problems with it as it stands — it fires **after** the cast decision, and
it is **engine-level**, so a persona on Qwen3 **Base** shows a green ✓ and is
then ignored. The design needs that verdict variant-aware and moved to the
moment of casting.

**3. One word for one thing.** The persona says **Spoken delivery**, Generate
says **Delivery direction**, and the Chapters button writes `block.direction`
as **+ direction** — three names for one instruction string. Deleting
`style_prompt` removed the worst of the confusion; this is the rest of it. It
belongs with §8.21's terminology sweep, not as separate work: pick the word
once and sweep three views and four docs together.


---

## §10 Where the knobs live — the three-layer answer (2026-08-17)

**This section exists because the question was asked plainly and the app had no
plain answer.** User, verbatim, 2026-08-17:

> *"i still dont understand how we handle voices the knobs the persona. What a
> user has is a speaker and what they spoke, now how do we assing the way it
> sounds, for each line do we have the engine model knobs, the selection like
> alexandira cloned builtin emotion sytle of couse this depends on model. This
> is what i am confused about does persona get all the knobs and settings and
> you test it there then assign that persona, the knobs settings ect depend on
> engine, can the same persona speak in different voices like one sentence is
> cheerful next same person but angry, that is what chatterbox and qwen could
> handle, i just dont know how to desing this. the Generate page doesnt really
> save anything so not even sure what that is for"*

Every claim below was verified in the code the same day.

### 10.1 The confusion has a name: there are three layers, not one

The input is exactly what the user said — **a speaker, and what they spoke**.
Everything after that is three different questions, and each owns a different
kind of knob.

| | What it is | Owns | Changing it affects |
|---|---|---|---|
| **Voice** | the instrument | how it sounds at rest | every character using it, in every project |
| **Persona** | the character | how they always speak | this character, everywhere |
| **Line** | the moment | how they say *this* | one line |

**The rule that decides where any knob goes — when you change it, who else
should change with it?**

- Fix once and everyone using that voice should be fixed → **Voice**. (The
  quiet clone shared by five characters. The fix belongs to the artifact.)
- True of the character in every scene → **Persona**.
- True only right here → **Line**.

Three layers, each composing over the one before. **Not "the persona gets all
the knobs".**

### 10.2 Cheerful-then-angry is not a different voice

The user asked whether a persona can *"speak in different voices, one sentence
cheerful next same person but angry"* — and then described **emotions**, not
voices. That distinction is the crux, and it is why there is no per-line voice
picker:

- A different **voice** = a different actor = **a different character** → cast
  once, per character.
- A different **emotion** = the same actor having a moment → **per line**.

That is exactly what `delivery.emotion` is (nine values, `models.py:1064-1074`
as of `87077e7` — the enum shifted when `EngineInfo` gained two fields),
and why it compiles two ways — prose for Qwen, `[angry]` for Chatterbox Turbo.

**The honest gap:** `Block` has a `direction` column
(`database/models.py:238`) but **no `emotion` column**. Per-line emotion has no
home in the database. Today per-line direction is prose, and prose reaches Qwen
only. So cheerful-then-angry works on Qwen right now; making it work on
Chatterbox too is **one column**.

### 10.3 Why "the persona gets all the knobs" cannot work

**The engine is not a property of the character. It is a property of the
voice** — `Voice.engine`, `models.py:466`, a required field on the artifact.

Cast June to Sohee → June is on Qwen3 → June takes prose direction. Recast June
to a Chatterbox clone → she does not, and nothing tells her.

A persona panel showing "all the knobs" would be a lie waiting to happen: the
panel mutates under you on recast, and carefully-tuned settings silently stop
reaching anything. Not hypothetical — that is finding #2 (knobs saved flat,
read nested; `exaggeration` and `cfg_weight` had **never** reached an engine).

### 10.4 The split that does work

Delivery fields fall into two piles by **who applies them** (`code-map.md` §3b):

- **Host-side — JustVoice applies them itself, so they work on every engine:**
  `gain_db` · `pitch` · `pause_before` / `pause_after` · effects chain · lexicon
- **Engine-side — they exist only if that engine takes them:**
  `speed` · `temperature` · `seed` · `instruct` · per-engine knobs

**The persona should hold only what survives a recast** — the host-side pile,
plus `emotion`, which straddles honestly (an enum compiles to whatever the
engine understands, or to nothing, and never lies). **Engine-specific knobs
belong to the casting, not the character.**

This is why §9.6's host-side `speed` matters more than it looks: pacing is the
most character-defining thing there is, and today it is engine-side, so it
falls off on recast. Moving it makes "the persona survives a recast"
substantially true instead of half-true.

> **Flagged:** `Persona.engine_override` (`models.py:551`) lets a character
> override the engine its voice belongs to — a character reaching past its
> instrument. It predates the cast layer and fights this model.

### 10.5 So where things are actually set — four places, one job each

1. **Voice workbench** — tuning the *instrument*. Hear · tune · save-as. Fixes
   travel to everyone using it.
2. **Cast row** — binding character to instrument. **This is where the engine
   becomes known**, so engine-specific knobs and the audition button belong
   here — and this is where the app should state the trade just made
   (*Qwen3 CustomVoice: prose direction ✓, cloning ✗*).
3. **Persona page** — who they are. `personality` (feeds the LLM, never reaches
   an engine) · `voice_instruct` (standing delivery) · host-side defaults.
4. **The line** — direction and/or emotion, inline.

You test at 1 for the instrument and at 2 for the character-on-this-instrument.
**Not "test on the persona then assign"** — you cannot test what you have not
cast, because until you cast there is no engine and therefore no knobs.

### 10.6 Generate saves nothing — verified

`GenerateView.vue:492-505` POSTs `/v1/generate` with **`cache: false`** and gets
a WAV blob back. **Nothing is written anywhere** — no row, no take, no
take-versioning. The user was right.

It is the pre-persona knob laboratory: where you went to try a voice with knobs
before personas and a cast existed. Every job it does now has a better home —
try a voice → the workbench; try a character on a line → the cast-row audition;
say one thing and hand me a WAV → real, but that is the **dictation/game** job,
not the book job.

**Already ruled**, 2026-08-15, verbatim: *"i aggree with A dissolbe it your rec
on it"*. **But TASKS records an unresolved contradiction underneath it:**
pipeline item 6 says *delete GenerateView, no new surface*; the design says
**absorbed**, and the workbench is that surface. Item 6's spec predates the
design and must be rewritten, not executed.

### 10.7 The two calls that are the user's

1. **Does a `blocks.emotion` column land?** Without it, cheerful-then-angry is
   Qwen-only forever, and the cross-engine emotion built on 2026-08-17 has no
   per-line writer.
2. **Absorbed or deleted for Generate** — the contradiction above. It blocks the
   workbench slice either way.

Everything else in §10 follows from decisions already on the record.
