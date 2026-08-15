# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-llm-runner/docs/dev/TASKS.md`; JustWrite work in
> `../justwrite-app/docs/dev/TASKS.md`. Unscheduled ideas go in `IDEAS.md`;
> adding an idea is never starting it.
>
> **THE FORMAT (user ruling, 2026-08-08).** Twice this file has failed: once as
> long prose that restated code and went stale, once as stubs that dropped the
> decision and made a later session re-derive it from a transcript. The rule that
> fixes both: **an item holds what code cannot tell you; everything else is a
> cite.** If the code can answer it, cite `file:line` — never retype it. If only
> the conversation can answer it, it is written here, verbatim, in the same reply
> the decision is made. Six fields, 25 lines max; longer means either code
> restatement (cut it) or a real plan (one line here, pointing at the plan doc):
>
> ```
> ### <the outcome, one line>
> STATE:  DECIDED <date> — "<your words>"  |  OPEN — your call  |  FINDING — code-verified <date>
> WHY:    <why this beat the alternative — 1-2 lines>
> NOT:    <what was rejected, one line each, so it stays rejected>
> BUILT:  <file:line>        OPEN: <the exact remaining change, one sentence>
> GO:     given <date> | needed
> ```
>
> **Never record a decision anywhere but here.** The session task tool is scratch
> and dies with the session — that is how the dictation-cleanup proposal was lost
> and had to be excavated from a 30 MB transcript on 2026-08-08.
>
> **A line here is a claim, not evidence — verify against the code before acting
> on it.** Every item below was re-verified against the code on 2026-08-08 **with
> two exceptions, each of which says so on its own line**: the contract-doc rows
> (they live under `docs/plans/archive/`, out of scope by the no-archives ruling)
> and whether `design-decisions.md` already covers the five rationales. The sweep
> deleted the lint-gate item (fixed), the ratified Lab-tunables item, the
> duplicate cleanup-card item, and one false claim about a missing npm script.
>
> **Nothing points into an archive.** If an item needs detail, that detail is
> either written here or lives in a live doc named on the item's own line.
>
> **The order of work (the user's ruling, 2026-07-26):** *"completely finish JW
> and all AI stuff, then we will work on JV."* Everything here is parked behind
> that unless the user says otherwise, and every item needs its own go.
>
> **GitHub Actions stay off (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote. That is a repo setting (`gh workflow disable <file>`), not a file
> edit, and it is reversible with `gh workflow enable <file>`. It was ignored
> once and three pushes each triggered failing runs. **Before pushing JustVoice,
> confirm `gh workflow list --all` still shows all three disabled.** The workflow
> YAML is deliberately left untouched so turning CI back on is one command.

## Waiting on your decision

### Settings → Capture is a localStorage mock — its controls never reach the server

STATE: FINDING — code-verified 2026-08-08 (found wiring the cleanup redesign's
live toggles).
WHY it matters: `SettingsView.vue:585-599` says it itself — "Persisted via
PATCH /v1/settings when wired; for now uses localStorage"
(`justvoice:capture_settings`). Every control on the card (STT model,
refinement mode, language, auto-paste, playback voice) writes only
localStorage; the SERVER's `captures.*` settings — the ones production reads —
never change. Worse, "Refinement mode" is a single-choice select over what the
server stores as THREE independent booleans (`smart_cleanup` /
`self_correction` / `preserve_technical`) — the control cannot even express
the real state. The cleanup card's pane toggles (2026-08-08) write the real
flags, so the two surfaces can now visibly disagree. Violates the
no-renderer-store law (the 2026-06-19 storage rewrite).
NOT: fixed as a rider on the redesign build — un-go'd scope, recorded instead.
OPEN: wire the card to PATCH `/v1/settings` (deep-merge proven), replace the
mode select with the three real toggles, delete the localStorage shim — or
strip the card to what's real.
GO: needed.

### Seed a pronunciation lexicon from the imported book's proper nouns

STATE: OPEN — your call. Raised and deliberately PULLED OUT of the 2026-08-08
JustWrite-zip build ("outside what you asked for, plus one unverified risk").
WHY: a book's proper nouns are the pronunciation problem, and "pronunciation
discipline" is a named audiobook differentiator (CLAUDE.md). JW hands over every
character, location and object name for free in `book.json`; import could
create the project lexicon pre-filled with them, pronunciation blank, as a
worklist.
NOT: folded into the zip build as a rider — un-go'd scope.
OPEN: first verify what an empty-pronunciation entry does at RENDER time —
`_materialize_lexicon` writes `pronunciation=""` (`projects_api.py:750-758`), and
if the render path applies that literally it would blank the word instead of
leaving it alone. If it is inert, seed the roster; if not, seed only entries the
user has filled.
GO: needed.

### A scene break could carry a real pause instead of a glyph

STATE: OPEN — your call. Noted 2026-08-08 during the JustWrite-zip build.
WHY: JW's `* * *` is display-only, but the boundary it marks is real structured
data (scene rows). In audio the equivalent is a longer silence, and
`StandardLine.pause_after_ms` already exists (`standard_schema.py:51`).
NOT: hardcoded in the adapter — that is exactly the "no hardcoded
operator-tunable values" law.
OPEN: add a settings knob (default scene-break pause, ms) and have the importer
stamp it on each scene's last line.
GO: needed.

### Script tab: two project kinds can never finish a chapter

STATE: OPEN — your call. Surfaced 2026-08-09 by the post-build sweeps of
`docs/plans/2026-08-08-script-tab-restore.md` (§12); the build itself is done
and committed in `3a5a23d`.
WHY: narration binds to the project's Narrator (restore decision 4), and a
block with no persona now REFUSES to render (decision 5) instead of being
dropped in silence. Two kinds have no Narrator to bind to, so their narration
is permanently unplaceable and the bulk "assign to Narrator" button has no
target: **custom projects** (`_NARRATOR_KINDS` is audiobook+podcast, but
`visibleTabs` gives Script to every non-game kind) and **any project imported
before 2026-08-09**, because `_ensure_narrator` runs at create/import only and
never backfills. The button now disables itself and says why rather than
failing on click — that is the whole mitigation.
NOT: adding "custom" to `_NARRATOR_KINDS` on my own — `test_builtin_narrator`
pins the opposite as a deliberate decision ("no single prose voice"), and
reversing it is not mine to do.
OPEN: pick one — give custom projects a Narrator · hide Script from them ·
let the bulk action target any cast persona. Separately: whether an
already-imported project should get a Narrator on demand, or whether your data
reset covers it.
GO: needed.

### Script tab: split / merge / reorder a block was deferred, not dropped

STATE: DEFERRED by your ruling in the restore's decision 6 ("Defer split,
merge and reorder"), and then lost — the tracker item was deleted whole when
the build closed, so the deferral survived only inside the plan doc.
WHY it still matters: it is the only way to fix a mis-cut line, and §8 names
manual split as the workaround for the biggest attribution failure there is —
a UK-punctuated manuscript segments to ZERO dialogue
(`extraction/segmentation.py:8-10`, also in IDEAS).
NOT: built in the first pass — all three change the block count, which is
exactly the operation that destroys takes through `Take.block_id`'s CASCADE
(`database/models.py:305`). They need their own confirm-before-destroying
design.
OPEN: that design, then the build.
GO: needed.

## The next build

### THE STRUCTURAL RULINGS 12–16 — DECIDED 2026-08-15, specs in the plan doc §6

Your words, in order: **"12 your rec, 13 your rec, 14, your rec, 15 what do you
think and is stories only for podcast? 16 your rec"** → **"ok you rec add this
to ideas so we can design the proper timeline"** (15) → **"your rec for the
others go and code"** (12, 13, 14, 16). Each recommendation, as accepted:

- **12 — Studio steps reorder to Script → Cast → Render → Export for PROSE
  kinds; game keeps `[cast, render, export]`.** WHY: the Script step is what
  *creates* the cast — `runDiscoverSpeakers` → `promoteDiscovered`
  (`StudioView.vue:1303-1351`) makes the personas and links them to the
  project. Cast-first means opening a cast holding only the Narrator, leaving
  to find the speakers, and coming back: a loop presented as a line. Game
  lines arrive with characters attached, so there is nothing to discover.
  NOT: a signpost from Cast's empty state to Script — rejected as an admission
  the rooms are ordered wrong.
- **13 — Train becomes the fourth way to acquire a voice, inside Voices** —
  beside clone / design / import (`VoicesView.vue:513-525`), NOT a moved tab.
  You meet it when you want a voice, not as a separate destination. Labs keeps
  Compare / Render lab / Audio. The long-running job keeps reporting through
  the shared AI task strip.
- **14 — REJECTED as posed: Lines does NOT fold into Studio's Render step.**
  Lines is a structure view, not a render surface: stable line ids, derived
  take status, and a CSV re-import that merges the writers' next sheet by line
  id so only changed lines go stale (`LinesView.vue:218-225`). The real
  duplication is **Chapters ↔ Lines** — two structure views answering one
  question for different kinds. That comparison is the design pass worth doing;
  it is NOT a build and has no go.
- **16 — Effects + Presets consolidate near Render, resolution-first.** Item 2
  made a render preset carry format + master target + effects chain, all three
  live, so they are one decision wearing three tabs. NOT a tab merge: the
  RESOLVED answer belongs at the point of render (Studio's Render step already
  shows the master pill item 2 built), with Effects and Presets demoted to
  library pages beneath it. Merging tabs without surfacing the resolution just
  moves the guesswork.

Specs: `docs/plans/2026-08-15-pipeline-truth-and-first-run.md` §6, rewritten
from questions into build items in the same reply the rulings were given.
Ruling 12 BUILT same day (`bb4366b`); 13's build and 16's surface half are
SUPERSEDED into the voice-workbench plan below.

### THE VOICE-WORKFLOW REDESIGN — the resume surface

STATE: DESIGNED, NOTHING BUILT, NO GO GIVEN.
**`docs/plans/2026-08-15-voice-workflow-redesign.md`** is THE doc. It supersedes
the unbuilt half of the voice-workbench plan (Slices C/D/E are FROZEN) and
pipeline item 6. Mock (unwired, both interaction models):
`https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`.

WHY IT EXISTS: the workbench plan was 416 lines of implementation with no design
section; the design died in a compact and two slices were built against nothing,
passing every gate and producing the wrong thing. The user: *"i think we really
are doing a full redesing of the app from a voice workflow standpoint whihc is
most of the app"*.

THE SHAPE (full reasoning in §2 of the doc): identity → hear → make · **the line
is the unit** — Chapters + Studio·Script + Studio·Render merge into one chapter
surface with two modes (Script-with-playhead for QC listening, Table for triage)
and the old steps as **filter states**, not tabs · render is a **panel**, not a
place · inline for the line, pages for library objects · casting is **pick the
kind, then the voice** (the kind fixes the engine and therefore what the
character can do) with cloning inline on the cast row · **no per-line voice
override** — a different voice is a different character · the workbench is a
**finishing bench** (hear · tune · save-as · derive · samples).

**NOTHING WAS APPROVED TO BUILD THIS SESSION.** The user's own summary:
*"i really dont think i decided anything on this session as we where doing
mockups and testing a redesing"* — correct. The session produced a design, a
mock, eight code-verified findings, and the constraints below. An earlier
version of this entry listed seven "rulings"; that was me converting
conversation into decisions because a tracker wants decisions. Do not repeat it.

**CONSTRAINTS — binding on the design.** Both are rejections of a proposal I
made; if a future session proposes either again, this record stops it:

1. *"but i do want a voice tuning page this is part of creating a new voice for
   a persona to consume"* → **do not remove voice tuning from the voice.** Kills
   my rethink that moved the knobs to the character. The case behind it: a clone
   that comes out quiet must be fixed once on the artifact, not five times across
   five characters. This constrains the design; it does not approve the workbench
   as drawn.
2. *"damint we want a voice designer we have qwen and other tts that do that why
   would you drop it"* → **do not drop the Voice Designer.** My "we don't ship
   the checkpoint" was backwards — the path is built and gated
   (`voice_design: False` in every manifest pending one download).

**ENDORSED IDEA — kept in the design, not approved to build:**

3. *"a fifth way to make a voice yes i like that"* → the **derived voice** (tune
   a voice, Save as new voice; `{parent_id, name, calibration, effects}`; also
   makes preset voices renameable). Guardrail in the doc: a correction to an
   artifact, never a mood.

**VERIFIED FACTS — not decisions; recorded with their source:**

4. Qwen3 VoiceDesign is the only description-to-voice engine. The user's *"i
   **think** qwen is the only one"* was a belief; verified 2026-08-15 against
   Voice-Clone-Studio (github.com/FranckyB/Voice-Clone-Studio), which supports
   six TTS engines and routes design to Qwen3-TTS's dedicated model alone. TADA
   question dropped.
5. **JV is not an audiobook app** — *"jv is not just pipeline for book yes that is
   main feature but it can be anything that is why we have project types"*. A
   correction of my error, not a decision. `project_type` is
   `audiobook | game_voicelines | podcast | custom`
   (`database/models.py:174`). Forced one correction and two refinements to the
   design (redesign doc §2.0): the **cast surface must be a table with the card
   as a row expansion** (a stack of cards dies at 50–500 game NPCs, where bulk
   selection is the primary action); Script/Table modes have a **default per
   kind**; and the filter chips derive from the kind, since game and podcast
   arrive with speakers already attached.

**WORKING INSTRUCTIONS TO ME** — not product decisions, recorded so they survive
a compact: don't overengineer · don't adopt from Alexandria for symmetry · no
code without an explicit go · save the design in detail *before* compacting.

PROPOSED BY ME, NOT YET RULED — all of §2/§3 of the redesign doc. Do NOT record
these as decisions and do NOT build them:
the line is the unit and Chapters+Script+Render merge · two modes
(Script-with-playhead / Table) · steps become filter states · render as a panel ·
inline-for-the-line vs pages-for-library-objects · casting as
pick-the-kind-then-the-voice · no per-line voice override · **render presets
deleted** (the user's words were *"i think presets die… i am not saying get rid
of it… give me your rec"* — a lean plus a request for a recommendation, NOT a
ruling) · the composes-vs-replaces rule · gain/pitch/tempo folded into the
effects chain.

OPEN (§4 of the doc): does "Studio" survive as a container (undoing ruling 12)? ·
does Chapters die outright? · row-expands vs row-links? · the real VoiceDesign
download size · samples API · is there any undo for an Analyze pass?

CANDIDATE FROM VOICE-CLONE-STUDIO (2026-08-15, not ruled): a **Prep Audio**
workspace — trim on a waveform, normalize, mono, DeepFilterNet denoise, extract
from video, ASR sentence-split, batch transcribe. JV accepts a clone upload and
flags SNR *after*; cleaning *before* is worth more, since clones inherit room
tone, and the same workspace feeds training-dataset prep. That app has **no
speaker attribution at all** (manual `[1]:`/`[2]:` prefixes), so there is nothing
in it for the attribution work.

GO: needed, per phase. Slices C/D/E of the workbench plan are frozen.

### FINDING — Block.direction is stored, editable, and never rendered

STATE: FINDING — code-verified 2026-08-15. `database/models.py:238` documents it
as *"Emotion/style hint passed through to the engine's instruct field."* It is
written (`projects_api.py:498`, `:536-537`), returned (`:140`), exported
(`project_export_api.py:104`) and preserved across splits
(`extraction_api.py:406`) — and `render_chapter_api.py` and `render_core.py`
contain **zero** references to it. The "+ direction" button on the Chapters
screen writes a column no render reads. Per-line direction is not a future
feature; it is built and disconnected.
GO: needed. Bears directly on the redesign — per-line direction is load-bearing
in the new chapter surface.

### FINDING — the synth scheduler has no UI at all

STATE: FINDING — code-verified 2026-08-15 on the user's *"synth scheduler what is
this, i dont see it"*. `synth_scheduler.py` (shipped `3a5a23d`) is real: one
worker thread, one pending pool, draining **engine-major** — stay on the loaded
engine while anything needs it, then jump to the engine of the oldest pending
line; interactive singles jump the queue at line boundaries. Seven callers
(`generate_api:304`, `takes_api:313`, `voice_preview_api:221`,
`render_chapter_api:398`, `projects_api:1031/1143/1165`, `render_jobs.py`).
Tested in `test_synth_scheduler.py`.
BUT: **nothing in `src/` references it**, and no endpoint exposes queue depth or
the current engine. `/v1/render_jobs/{id}` reports a job's progress, not the
pool. So when a render waits behind another engine's batch, the app shows
nothing and the user cannot know why.
OPEN: surface it in the chapter render panel — *"waiting — Chatterbox is
finishing 40 lines"*.
GO: needed.

### THE VOICE WORKBENCH — SUPERSEDED for its unbuilt half

STATE: DECIDED 2026-08-15 — *"your rec make detailed plan for opus to execute
without thinking too much i will switch to opus and have him execute the
plan"*. THE PLAN: `docs/plans/2026-08-15-voice-workbench.md` — execution
rules, five slices (A: the voice_instruct/personality split, DATA RESET
REQUIRED after it lands; B: audition panel on the voice row, absorbs pipeline
item 5; C: persona form split + delivery editor, kills the openDeliveryHint
toast; D: Generate dissolution = pipeline item 6, after B+C; E: one ＋New-voice
door + Labs collapse + Train's roomy Voices surface + inspector
removal-by-replacement), plus §8 OPEN items that need his word (samples API,
attribution-prompt enrichment, MCP instruct).
SLICE A IS BUILT — 2026-08-15, on the go *"build slice A go"*. The persona now
carries `voice_instruct` (the only text that reaches the synth) and
`personality` (the character sheet: Compose/Rewrite, casting, export sidecar).
The third description field and the dead MCP flag are gone, the JW import
fills the sheet only, and `test_voice_instruct.py` holds the line. Gates:
567 server tests, ruff, biome, 53 vitest, build, smoke — all green.
SLICE B IS BUILT AND IS NOT THE DESIGN — 2026-08-15, on the go *"slice B
go"*. What shipped: the row preview takes an optional `{text, delivery}` body
with a rendered-audition cache; `VoiceAudition.vue` mounts inline on a
voice-row click with the load-cost line and the resolved-stack line;
`services/audition.js` holds the pure parts. The user's verdict on seeing it:
*"stop putting stuff under advanced, this is crap nothing like a nice design
nothing like a nice workflow, no mixing no direction like the render tab, you
where supposed to combine features … having it under voices is terrible"*.
He is right, and the cause is this plan, not the code.

THE DESIGN WAS MISSING AND IS NOW RECOVERED. The plan was written as five
slices of implementation with NO statement of what was being built or why;
the design agreed in the same session was never written down and died in the
compact. Recovered 2026-08-15 from the session transcript
(`~/.claude/projects/E--Dev-Web-JustVioce/364ef093-….jsonl`, messages
1219–1245) and written into the plan as its new FIRST section, **THE DESIGN**.
Load-bearing content: identity → hear → make; **the voice page is a workbench,
not a profile** (Hear it · Tune it · Feed it · Derive from it); **Generate is
ABSORBED, not deleted**; the render lab becomes axes on the Tune panel; one
audition component at voice/persona/preset resolution with the resolved-stack
line; Labs collapses to one analyzer bench; one ＋New-voice door with honest
preconditions; slot-coupled synth must be stated, not discovered.

CONTRADICTION TO RESOLVE BEFORE SLICE D: pipeline item 6 says delete
GenerateView and *"no new surface"*. The design says absorbed, and the
workbench IS the surface. Item 6's spec predates the design and must be
rewritten, not executed.

OPEN, blocking the rest: does the workbench own PER-LINE work (the Alexandria
audio-editor shape the user showed: speaker · text · emotion/style · Gen per
row) or does per-line stay in Studio's Script/Render? That answer sets the
page's scope. Also open: samples API build-vs-remove; where the merged
analyzer bench lives.
GO: needed — C–E do not proceed until the per-line question is answered and
Slice B's row-drawer mount is reconsidered against the design.

### FINDING — 4 of the Voices table's 11 columns are wired to nothing

STATE: FINDING — code-verified 2026-08-15 on the user's report *"the voices
table today is wrong it has things like effects cast as even langauge like
italian dont actually work"*. `GET /v1/voices` returns the `Voice` shape
(`models.py:464-471`) — id · engine · source · name · language · gender ·
sample_url. That is ALL of it. The table reads four fields that are not on
that payload and do not exist server-side:

- **Samples** → `v.sample_count`. Real on the STORED record
  (`VoiceRecord.sample_count`, written by `storage/voices.py:94-96`) but
  `_stored_to_dto` (`voices_api.py:32-40`) drops it. Renders `—` for presets
  and `0` for everything else, permanently.
- **Gens** → `v.generation_count`. No such field anywhere in
  `server/justvoice`. Always `0`.
- **Effects** → `v.default_effects`. Zero hits in the entire server. Always
  `—`. Effects chains live on the PERSONA (`Persona.effects_chain`), never on
  a voice.
- **Channel** → `v.channel_id`. Voices have no channel. Audio-channel routing
  is per-PERSONA (`PersonaChannel`, `database/models.py:67-77`). Always
  `Default`.

Real columns: Name, Gender (incl. the override paths), Type, Engine, Cast as
(computed client-side from personas' `voice_id`), and the ▶ preview.

### FINDING — every Kokoro voice speaks English, whatever language it claims

STATE: FINDING — code-verified 2026-08-15, same report. Two separate causes,
both provable:

1. **The engine hardcodes the language.** `kokoro/engine.py:107` sets
   `lang = "en-us" if lexicon else ""`, once, at LOAD, into
   `OfflineTtsKokoroModelConfig(lang=…)`. `synth()` never touches language.
   So Sara (Italian), Nicola (Italian) and every Japanese / Mandarin /
   Spanish / French / Hindi / Portuguese preset is phonemized with English
   rules on the multilingual model. The voice's own `language` tag
   (`kokoro/voices.py`) is decoration.
2. **The catalog is variant-blind.** `STATIC_VOICES` is the full 54-voice
   multilingual list unconditionally (`kokoro/manifest.py:66`), and
   `list_voices` (`voices_api.py:51-62`) iterates `manifest.static_voices`
   with no check on which variant is installed. Install the English-only
   `kokoro-en-v0_19` and the table still offers eight languages of voices.

OPEN: (a) pass the voice's language per-synth (sherpa-onnx takes `lang` on
the model config, so this may need a reload-per-language or a config rebuild —
verify against sherpa-onnx before speccing); (b) filter the catalog by
installed variant; (c) meanwhile say so in the UI rather than listing voices
that cannot work.
GO: needed. Bears directly on the workbench design — the new Voices index
must not carry the four dead columns forward, and the workbench's "what this
engine can do" panel is where the language truth belongs.

### FINDING — engine-private knobs are saved flat and reach no engine

STATE: FINDING — code-verified 2026-08-15 while building workbench Slice B.
Every engine reads its own knobs from the `delivery.engine` SUBDICT
(`qwen3/engine.py:154`, `chatterbox/engine.py:185-206`,
`moss_tts/engine.py:114`). But `VoiceParamsModal.vue` saves the capability
schema's keys FLAT into `persona.default_delivery`, `merge_delivery` merges
them flat, and nothing anywhere nests them. So every engine-private override
— exaggeration, cfg_weight, repetition_penalty, talker_temperature, top_k,
top_p — has been silently doing nothing at render. Only the cross-engine
Delivery fields (speed, pitch, gain_db, temperature, instruct, style_prompt)
ever worked. `render_chapter_api` additionally filters merged keys to
`Delivery.model_fields`, which would drop them a second time.
The audition panel routes them correctly (`services/audition.js
canonicalDelivery`), so a knob turned there is heard — which means the panel
and the render currently disagree for those knobs.
OPEN: route on the way IN (nest at save time in the persona editor) or on the
way OUT (nest in `merge_delivery`). Either changes rendered audio for anyone
who set one, and the cache keys with it.
GO: needed.

### FINDING — the analyze prompt gets id + name and nothing else

STATE: FINDING — code-verified 2026-08-15. `_resolve_cast`
(`extraction_api.py:145-167`) hardcodes role/gender/pronouns=None, aliases=[];
`format_characters` (`extraction/prompts.py:82-97`) reads those empty fields.
So production attribution has NEVER seen a character description or alias —
the fields exist for the Lab's typed cast only. Aliases squashed into prose
by the JW import (`justwrite.py:129-139`) are invisible to attribution too.
(The dead description key `_resolve_cast` used to ship went out with workbench
Slice A; the hardcoded Nones are untouched — wiring them IS this item.)
OPEN: wire `personality[:200]` + real aliases into the prompt — changes every
analyze run's tokens and behavior, so it is a product call, not a cleanup.
GO: needed.

### THE 2026-08-15 PLAN — pipeline truth + first-run speech + Alexandria adoptions

STATE: PLANNED IN FULL — the executable plan (design decisions MADE, per-item
implementation specs, verified research) is
**`docs/plans/2026-08-15-pipeline-truth-and-first-run.md`**. The user is
switching models to code from that doc; read it FIRST, build items in order,
per-batch go. Items 12–16 in it are OPEN RULINGS — never build without the
user's word.
RULINGS (user, verbatim, 2026-08-15): Generate tab — *"i aggree with A
dissolbe it your rec on it"* · setup sample playback — *"3 no"* ·
kokoro-as-universal-first — *"accepted rule 1 is wrong kokoro does not do
cloning"* (goal-first lanes; Kokoro = ready-made lane only; never offer
Kokoro as a cloning fallback) · cloning-lane pick — *"But yeah language
branch might be better"* (en→Turbo, other→Multilingual, Qwen3 Base the named
alternative with "reported strongest on zh/ja/ko" guidance only) · personas —
*"i think i like havibng it as a persona for reuse as a saved persona"* (the
Cast card = INLINE PERSONA EDITING, no new entity — research confirmed cast
rows ARE personas, Profile-kill LD#1) · *"dont take easy way out just becuase
we have something coded"* (hence the structural open rulings).
KEY RESEARCH LOCKED IN THE PLAN DOC (do not redo): web-verified Qwen3-TTS
family (Base clones / CustomVoice = 9 presets NO cloning / VoiceDesign 1.7B;
10 languages — our manifest's 17 and its CV cloning flags are FICTION to fix
in item 1) · Chatterbox Multilingual is at V3 upstream (we pin v2; item 1
decision tree) · Alexandria feature/GUI record (review pass taxonomy,
per-line instruct JSON, per-speaker card, Generate-Personas = auto-cast,
training UI, pauses, exports) · the code seams with line numbers (demo
activation bug, AI-offer trigger, Generate's guards, Studio cast=personas,
render-truth gaps, TrainView shape, preview endpoint).
BUILT 2026-08-15 on your *"build items 0–2 go"* — items 0, 1 and 2 are DONE
(full server suite 549 green, biome, vitest 48, build, renderer smoke).
Decisions taken while building, all recorded here because they extend or
redirect the plan:
- **Multilingual V3 is NOT shipped** — the decision tree's own answer. The
  repo carries `t3_mtl23ls_v3.safetensors`; upstream git master can load it
  (`from_local(..., t3_model=…)`); the LATEST PyPI release is still 0.1.7 —
  our pin — and its `from_local` hardcodes the v2 filename. A v3 row would
  download 2 GB this engine cannot open. Recorded in the manifest with the
  exact conditions for revisiting.
- **Qwen catalog truth**: languages 17 → the real 10; `voice_cloning` is now
  per checkpoint family (CustomVoice False, Base True); CustomVoice + a
  reference clip now REFUSES in the engine instead of calling
  `generate_voice_clone` on weights that cannot honour it; `voice_design`
  turned off everywhere (manifest, engine meta, capability_details) until the
  VoiceDesign checkpoint ships with item 9.
- **Dia's cloning claim excised** — found in the same sweep and verified in
  code: `dia/engine.py synth()` never reads `req.audio_prompt_path`, so every
  cloned voice pointed at Dia rendered in the stock voice, silently, while
  the catalog's Cloning filter listed it. Manifest + docstrings corrected; a
  new test asserts every engine claiming cloning actually reads the clip.
- **Scene renders return WAV, always** — the mastering *processing* applies,
  the encoding does not. The .m4b then carries one lossy generation instead
  of two, and auditioning is not done through an MP3. The encoded deliverable
  stays with Export and with direct-mode `/v1/render_chapter` (`lines[]`
  passed literally — byte-identical behavior, the JustWrite adapter path).
- **`"none"`, not null, means raw.** Omitting `master` in scene mode now
  means "server decides"; `"none"` at any level is a real answer that stops
  the search.
- **The render preset's `master` field is honored** — it was stored and never
  read. Precedence: request → preset → project → kind default (audiobook
  acx · podcast podcast · game_voicelines none · custom none).
- **Effects also apply to the game voiceline export** (`export_voicelines`) —
  a character's chain is part of how that character sounds; mastering is the
  part game exports skip.
- **The render cache key gained the chain hash**, so every existing cache
  entry is cold once. One full re-render after this lands; that is the cost
  of the key finally describing the audio.
- QC now measures the MASTERED chapter and reports `master_preset` /
  `mastered` / `note`; without ffmpeg it still runs and says the numbers are
  raw. New read-only endpoint `GET /v1/render/master-target` feeds the Studio
  pill, which no longer hard-codes ACX numbers.
NEXT: items 3–6 (demo activation → setup lanes → Voices audition + TTS
ensure-load → Generate dissolution), per-batch go. Items 12–16 stay OPEN
RULINGS.
FLAKE seen once, not reproduced: `test_prefetch_cancel_via_http_endpoint`
failed in one full-suite run and passed alone, as a file, and in a clean
full re-run. Untouched by this work; noted in case it recurs.
DOCS PASS 2026-08-15 (after the three commits): `mastering.md` (the preset
numbers were wrong for iAudio, the chain "trimmed" silence it actually PADS,
a noise gate was described that does not exist, and the page said mastering
happens at export and never on a chapter render) · `chapter.md` (both dead
links — `stories.md`, `profiles.md` — the real render flow, the global player
that no longer exists) · `effects.md` (the four-layer cascade was fiction:
chains live on personas and render presets, they STACK, and voices carry none
at all) · `render-presets.md` (the preset's master target and effects chain,
both now real) · `import-and-export.md` (ACX numbers, the resolution, WAV vs
encoded, the global player) · `generate.md` (dead `profiles.md` /
`stories.md` links). Two findings the pass could not fix are filed below.


**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

### VRAM: STOP AND THINK before any arbiter wiring

STATE: the 2026-07-04 decision stands (one shared VRAM budget family-wide; an
LLM **or** a TTS engine on the GPU, never both) — but the user ORDERED A STOP
first, 2026-08-08: *"once done with those tasks we need to stop and think about
vram, has that already been planned? some tts engines can run direclyt on cpu
and dont need vram, same with some of our modles so we need to take that into
consideration as well as the fact that we dont autoload the lmm model so how
does a user know what they can and cannot load if llm model is not even
selected or loaded, as we have it load on demand"*.
WHY: the old item assumed the wiring was the remaining work; the user names two
unplanned dimensions — CPU-resident engines/models that need NO budget, and the
load-on-demand LLM meaning the budget's biggest consumer is invisible until it
runs.
BUILT: the arbiter itself, in the runner (`runner/arbiter.py`); JustVoice's
`EngineManager.load()` neither reserves nor releases ("arbiter" appears nowhere
in `server/`, verified 2026-08-08). The engines are OS subprocesses, not
in-process (design-doc correction rides along).
OPEN: the THINK is DELIVERED, then twice hardened by ordered adversarial
passes — `docs/plans/2026-08-08-vram-think.md`. Pass 2 found the budgeted
policy ALREADY RUNS in JV's process for the LLM (`lifecycle.py:491`), reversing
Q1 to budgeted-from-the-start and cutting two overbuilt pieces. Pass 3 found
the decisive structural fact: naive TTS reservations would CORRUPT the runner's
`_admit` (it would "evict" a foreign key via router_unload no-op + release —
the ledger lies, overcommit returns), so the wiring's PREREQUISITE is the
kit-side eviction-executor seam (reservation kind + evict_fn + a shared
make_room; `_admit` refactored onto it). Pass 3 also disproved pass 2's
self-shrink assumption (the load fits against the FULL card and EVICTS —
`lifecycle.py:1937` + `_admit`) and found the shipped in-runner precedent for
Q2's policy shape (the #274 embed placement). The workflow pass (the user's
"how does the flow work" question) added §4 + two more calls: Q6 — Quick Setup
UNCHANGED (family-canon charter; TTS has no default-model concept, voices are
the unit and engines follow them), but the 2026-08-05 warm-boot stopgap
("TTS owns the GPU until F4's arbiter", main.js:208-214) comes back — rec:
flip LLM warm-boot ON as the wiring's last step; Q7 — mixed-GPU-engine casts
thrash full model loads per engine crossing (one-slot-per-kind +
per-line auto-load, verified) — rec: chapter render synthesizes grouped by
engine. Pass 4 verified the newest pieces in code: Q7's premise holds (the
chapter render is collect-then-assemble, `render_chapter_api.py:250-264`, so
grouping is just iteration order); Q6's mechanics corrected (warm is a per-DB
SETTING — kit default ON, JV's `llm_bootstrap.py:34-36` seeds it 0; the flip
reaches fresh DBs only, seeds-only rule); and Q8 found the deeper limiter —
`synth()` is slot-coupled (`manager.py:1415-1417`), so CPU-kokoro + GPU-engine
can never co-reside; multi-resident engines recorded as the later refactor,
NOT built. make_room's busy protection also closes the pre-existing same-kind
hole (loading LLM B could evict busy LLM A). Pass 5 produced ZERO design
reversals and four wiring corrections (§5 of the doc — convergence): whisper
IS the third kind and AUTO-LOADS today (`captures_api.py:48-60`, stt slot,
1500 MB cuda-only manifest) so dictation's resident set is stt+llm at once;
there are TWO engine-load doors and `render_core.render_line`'s direct
`engine.load` would BYPASS arbitration — door unification onto
`EngineManager.load()` is wiring prerequisite #2; `models_max`'s count cap
must be kind-scoped or a TTS resident eats a llama.cpp child slot; TTS
admission reuses the existing `safety_margin_mb` knob; and the claim line's
two sources are verified (measurements record `vram_total_mb`; `compute_fit`
prices an on-disk gguf). llm-busy lands in the KIT dispatch layer (JW inherits
the protection free); tts/stt-busy at the manager chokes. Your calls on Q1–Q8
are the gate. NO code before those decisions.
DECIDED (2026-08-08, round 1 — user words verbatim: *"q1 your rec, q2 how does
this work are you adding gui it sound good but how does it really work dont
likme stuff that is hidden or hardocded, q3 your rec, q4 your rec, q5 i dont
understnad your rec, q6 your rec, q7 this was suppored to already be done the
grouping so that anything synthized by engine got grouped together, that is not
just chapters but if you runn multople chapters it need to take wahter is being
run or queed to be run and gourp it effectiantly, you need to think on this
again and show me what you find, q8 your rec, no coding yet"*):
**Q1 ✓** budgeted + never-evict-busy · **Q3 ✓** claim line + event-driven
eviction toasts, no predictive warnings · **Q4 ✓** one budget strip on the
Speech-engines tab, one endpoint · **Q6 ✓** warm-boot flip as the wiring's
last step, seeds-only · **Q8 ✓** multi-resident engines recorded, NOT built.
**Q2 OPEN** — mechanics re-explained (engine FACTS in manifests: cpu_adequate
beside vram_min_mb/gpu_runtimes; the operator PREFERENCE is a real setting
`engines.engine_overrides[id].device` auto|cuda|cpu with a Device select on
each Speech-engines card; resolution in the ONE load door; resolved device +
reservation always shown on card/strip/toast; today's hidden torch greedy-cuda
is the thing being REMOVED) — DECIDED round 2, user: *"q2 ok"*.
**Q5 OPEN** — re-explained (the admission's "how much does this engine need"
number comes from the manifest's declared vram_min_mb; it is a first guess —
the spawn OOM back-off is the real safety net; the NVML measure-after-load
subsystem stays cut, parked in IDEAS) — DECIDED round 2, user: *"q5 your rec"*.
**Q7 REOPENED and SWEPT** (go round 2: *"i did not mean to sotp that sweep …
go and finis anwwering quesitns"*) — full findings + design in §7 of the plan
doc. The short truth: NOTHING groups anywhere (all five multi-line producers
verified sequential — scene render, M4B assembly, voiceline ZIP, the Lines
CLIENT loop, singles; every one funnels through per-line
`engine.load("auto")`); the user's "supposed to already be done" memory is
RIGHT twice over — the design freeze shipped `RenderJob`/`RenderJobBlock`
tables (`database/models.py:330-364`, DESIGN_FREEZE §3.7) with NO orchestrator
ever built (exports-only, dead in every DB), and Decision 13 of the 2026-06-20
shared-ai-stack plan promised job-level render/batch settings (parallel
workers, sub-batching, batch seed) that have ZERO code hits; engine-grouping
itself was never planned before this doc. Bonus debt found: Generation's
active-status machine (queued|loading_model|generating) is set by NOBODY —
both creators write "completed" directly, `active_tasks_api.py:51` filters on
states that never occur. REC (awaits the word): Option B in §7 — ONE
synthesis scheduler, engine-major across the whole pending pool; Stage 1 the
in-process scheduler core replacing wiring step 7 (producers submit sets and
wait; interactive singles jump at line boundaries); Stage 2 resurrect
RenderJob as the persistent face (retry-failed, resume, Lines client loop
retires). Sub-batching stays distinct (within-engine perf, IDEAS).
PASS 2 (*"think on the desing again"*, same day — §7b of the plan doc): found
a LIVE defect — the synth endpoints are async-def with sync bodies over sync
httpx (`manager.py:999`), so a chapter render blocks the ENTIRE server (even
accepting an Analyze; §4's mid-render story is impossible today — the
scheduler is what makes it real); found the big simplification — the render
cache is the hand-off (all producers verified `use_cache=True`, disk tier
never auto-evicts, `cache.py:96-135`), so the scheduler is a WARM PASS with
no result plumbing and assembly code unchanged; M4B needs WHOLE-submission
grouping (per-chapter was insufficient even single-producer); drain policy
concretized (oldest-pending-line engine first + pool-wide free-riding +
interactive jumps at line boundaries, no knobs); and the freed loop FORCES
all synthesis through the scheduler (the accidental serialization is the only
thing preventing load-terminates-engine-mid-synth today; previews are a sixth
synth door, `voice_preview_api.py:168`). Shape unchanged: Option B, two
stages. One pass-1 claim corrected: cross-producer line-level interleave
exists only between per-line-request flows; whole-request producers serialize
accidentally by blocking the loop.
PASS 3 (*"think on it again"*, same day — §7c): NO reversals. Three
corrections: Stage 1 is INDEPENDENT of the VRAM wiring and REC'd to ship
FIRST (the wiring's admission/busy plug into the scheduler's switch points
afterward); the Lines re-render stays UNgrouped until Stage 2 (per-line
requests = one-line sets — the named gap that makes Stage 2 debt, not
polish); the synth funnel covers MANAGED engines only (external/remote-API
singles stay direct — nothing to kill, nothing to group). Two alternatives
rejected on record: the `def`-endpoints one-keyword freeze fix (creates the
mid-synth kill race it cannot manage) and a manager synth/load lock (prevents
the kill, buys no cooperation).
PROCESS RULE (2026-08-08, mid-turn, verbatim): *"never do anycoding unless i
give you exact word 'go' never do anyting research unless i give go"* — both
gates are the literal word.
Q7 DECIDED round 3, user verbatim: *"your rec go"* (2026-08-08, after pass 3)
— Option B, scheduler-FIRST order. The go covers STAGE 1: the SynthScheduler
(pool + worker thread + engine-major drain per §7b P2-4 + submit-and-wait +
interactive jump), the managed-synth funnel (§7c P3-3 scope), and the manager
per-kind guard as safety back-stop. Stage 2 (RenderJob resurrection) and the
VRAM wiring each still need their own go.
BUILD-PREP DISCOVERY (§7d of the plan doc): `render_line` has NO local-engine
door — the registry it drives holds ONLY external cloud providers
(`app.py:438`; managed adapters were never re-registered when engines became
plugins), so chapter/M4B/QC/ZIP/Lines/take-re-roll 404 for EVERY local voice
and only ever worked with cloud voices; the new-voice preview door breaks the
same way (`voice_preview_api.py:134`); tests never caught it (fakes occupy
the registry slot production leaves empty). Stage 1 opens with the managed
bridge in render_core (= wiring step 2's render_core half, landing early).
STAGE 1 BUILT 2026-08-08, gates green (ruff clean · 453 pytest, all passing):
the managed bridge — `render_core.py` render_line/probe_line_cached route
managed engines via the manager (registry branch stays first: external
providers + test fakes untouched), tag-strip from manifest CAPABILITIES,
cloned-voice reference WAV via `resolve_audio_prompt_for_stored` (moved to
render_core, generate_api wraps it) · the scheduler — `synth_scheduler.py`
(SynthScheduler + SetHandle + warm_lines/warm_specs, engine-major oldest-first
free-riding drain, interactive jump, abort-on-first-error, cancel-withdraws) ·
the guard — `engines/manager.py` per-kind `_activity` locks around
synth/clone/transcribe and load/unload terminates (`_unload_kind` refactor) ·
the conversions — render_chapter + QC + M4B (`collect_project_line_kwargs`,
strict-mirroring, aborts warm if any scene refuses) + voiceline ZIP
(`collect_block_specs`, [] on first unvoiced block) warm sets;
render_block / generate-managed / managed new-voice preview are interactive
singles through the one synth door; all five endpoints now await instead of
blocking the event loop · tests — `test_synth_scheduler.py` (9),
`test_render_managed_bridge.py` (7), `test_engine_activity_guard.py` (2).
NOTE: built alongside the parallel Script-tab-restore session's work in the
same tree (its strict=True refusal composes with the warm; the book-warm
mirrors it). COMMITTED with Stage 2 + the Script-tab restore in `3a5a23d`
(2026-08-09, user word "commit and push all").
STAGE 2 GO GIVEN 2026-08-08, user verbatim: *"go"* (immediately after the
Stage-1 report listing Stage 2 first among the open gos — the decided
scheduler-first order's next step). Scope per §7 Finding 3 + §7c P3-2:
resurrect `RenderJob`/`RenderJobBlock` as the persistent face — job API
(create/status/cancel/resume), runner submits every block as its OWN
one-item set so the pool groups engine-major while failures isolate
per-block, per-block Generation+Take persistence identical to the single
door, boot sweep marks interrupted jobs paused, resume re-runs
failed+pending only, and the LinesView client loop retires onto one job
POST + poll with real n/m on the kit task.
STAGE 2 BUILT 2026-08-09, gates green (ruff · biome · 48 vitest · vite build ·
smoke 15/15 zero JS errors · pytest FULL SUITE 469 passed, zero failures —
both sessions' work green together): `render_jobs.py` (create_job
scope project|scene|blocks · `persist_block_take` = THE one block-persistence
shape, takes_api refactored onto it · runner submits each block as its own
one-item set — engine-major grouping pool-wide, per-block failure isolation ·
counters recomputed from rows so resume never lies · cancel withdraws pending
at the line boundary via live handles · `sweep_stale_jobs` boot sweep wired in
`app.py` after init) · `api/render_jobs_api.py` (POST create / GET
?include_blocks / cancel / resume) · `LinesView.vue` re-render = one job POST
+ 1s poll with real n/m, Cancel → job cancel, partial-failure toast, button
disabled-not-spinning · `docs/lines.md` updated · `tests/test_render_jobs.py`
(8: complete+persist, failure isolation, resume-only-unfinished,
cancel-withdraws, boot sweep, empty scope, API roundtrip, unknown-ids).
Composed live with the parallel Script-tab session's moving edits: warm
mirrors QC's skip_unrenderable/strict split (collector grew the flag); their
render_scene_to_wav strict= signature landed mid-build (two test stubs
updated to `**kw`, their session then evolved the same tests further).
COMMITTED + PUSHED as `3a5a23d` (2026-08-09, both sessions' work, final
gates green on the settled tree; workflows verified disabled before/after).
GO: Stages 1+2 BUILT · a job-list / resume UI surface beyond the Lines button
was NOT ordered and is not built.
DECIDED + GO 2026-08-13, user words verbatim: *"your rec go and go for the
full vram phase"* — after the ordered re-think ("think on the design again
including the new fit") and its adversarial cross-verification (Fable → Opus →
Fable, every claim run in code). The rec approved, THE ONE-POOL RULING: **on
one-pool boxes the ledger tracks POOL OCCUPANCY, not device placement.** Kit
half: `process.py`'s one-pool booking clamp — whose own comment and whose own
test (`test_arch_arm_one_pool_booking_never_exceeds_ledger`) both said "until
Phase 4 makes the ledger arch-aware", a debt Phase 4 then never collected —
changes ceiling from `max_vram_mb` (the iGPU carve-out: bookings of 0–128 MB,
admission dead, claim line reading 0, `__overhead__` calibration poisoned) to
`budget_total_mb` (the pool), the two carve-out-era test pins re-pinned to
pool truth + a new real-booking pin. JV half: on one-pool boxes a managed
engine load books its declared `vram_min_mb` WHICHEVER device it resolves
(CPU and GPU are the same physical bytes there); discrete keeps
cpu-resolves-books-nothing. "The full vram phase" = wiring steps 3–6 of
`docs/plans/2026-08-08-vram-think.md` §6 as amended by the re-think: step 1
(kit seam) and step 4's llm-busy half verified ALREADY BUILT during the fit
redesign; the claim line comes from the kit's `preview_fit` four-arm resolver,
never hand-rolled (P5-5's ladder is superseded); `declared_claim_fn` is DEAD
plumbing (assigned once, read nowhere, and `preview_fit` can't resolve
non-catalog ids anyway) — NOT used, left untouched, recorded as a gap; JV
prices its engines from its OWN manifests; tts-busy lives at the scheduler
worker (idle→active transitions), stt-busy at the manager's transcribe;
`cpu_adequate: true` lands on kokoro (certain), luxtts stays UNFLAGGED until
its real-time-on-CPU claim is verified, whisper stays cuda-declared (P5-1's
per-variant refinement recorded, not built); warm-boot flip is the LAST step,
seeds-only.
BUILT 2026-08-13, same session as the go — full stamp in
`docs/plans/2026-08-08-vram-think.md` §6 (STATUS STAMP 2). The pieces:
KIT — the one-pool clamp fix (`process.py` ceiling → `budget_total_mb`) +
two re-pins + the physics-equality pin (suite 847; steps 1 + 4-llm were
already built there during the fit redesign). JV server — device policy /
admission / declared reservation / release-on-every-exit in
`engines/manager.py` (`_resolve_device` · `_books_memory` one-pool ruling ·
`_admit_memory` no-locks-held (lock-order inversion avoided; a refused
admission leaves the world untouched) · `_reserve_engine` source="declared"
kind-mapped tts|stt · `_evict_for_arbiter` occupant-checked) + `cpu_adequate`
on kokoro + `EngineOverrides.device` (models.py) + tts-busy at the scheduler
worker's idle↔active transitions (`synth_scheduler.py`) + stt-busy at
`transcribe` + `GET /v1/engines/vram` (`engines_api.py`: snapshot + the
routed-default claim — routing store + production configs, NOT
resolve_feature; preview_fit's four arms do the pricing; claim_reason
distinguishes cloud-routed from not-configured) + `resolved_device` on
EngineInfo. JV UI — the budget strip (VRAM/Memory label off mem_arch,
provenance tooltip, busy chips), eviction-toast poller (4s, primed silently
on mount), Device select per card (read-modify-write PATCH), resolved-device
on the loaded badge, the client-guessed "est. VRAM" total replaced by ledger
truth. Warm-boot: `apply_jv_warm_default` DELETED (seed.py + reseed path),
`test_warm_default.py` re-pinned warm-ON-fresh / stored-choice-survives.
Docs: `docs/gpu.md` "The shared memory budget" (real section) +
`docs/engines.md` loading rewrite. Tests: `test_engine_vram_wiring.py` (17:
device policy · booking both arches · slot-replacement release · honest
refusal · idle-LLM eviction + event feed · never-evict-busy · evictor
occupant check · scheduler/transcribe busy · the endpoint incl. the claim).
GATES: kit ruff+847 · JV ruff+485 + vitest 48 + build + smoke 15 views zero
JS errors · JW 128 + build · check-family 0 violations · verify-model-pick
48. HONEST LIMITS, recorded: eviction toasts surface only while the
Speech-engines tab polls (no app-global poller was ordered); a crashed
engine's reservation lingers until its slot next loads/unloads
(conservative, over-counts); clone singles are protected by the activity
lock, not a busy flag (an evictor waits, then terminates); GPU-less
CPU-only boxes still book 0 (recorded gap, serving-design.md).
GO: BUILT — then SUPERSEDED IN PART the same day: the user's first live
look at the strip (350M turbo showing 4 GB "in use") exposed the declared-
pricing currency as invented scaffold data, and the ordered rethink
replaced it with measured-first pricing + a strip that shows only reality
(the Speech-engines convergence item below + `docs/plans/
2026-08-13-speech-catalog-redesign.md`). The wiring's MACHINERY — device
policy, admission seam, busy flags, eviction executor + toasts, endpoint,
one-pool ruling — stands and is what the redesign builds on. The laptops
walk (kit checkpoint) remains open, user-paced.

### Speech-engines model management converges on the kit's download/load GUI + machinery

STATE: ORDERED 2026-08-08, user words verbatim: *"the model download load
unload for speech engines should be same gui desing and llm runner a download
button thre dot menue, and all the other feature such as model loaded unloaded
ect, can we resues any llm stuff i think that was in plane to resue the
progress downloadeder since llm has download manager, think or resues instead
of rewrite and wwe can consolidate, both speech engines nad llm runner
download load and unload models we should be able to use same mechanisms"*.
Think delivered same day: the 2026-06-20 cutover boundary DECIDED TTS/STT
sections stay native while LLM went to llm-ui
(`docs/plans/archive/2026-06-20-engines-llmui-cutover-boundary.md:234-235`) —
this order revisits that boundary. Reuse has three layers: (1) GUI
vocabulary — the kit card grammar (download button, three-dot overflow menu,
loaded/unloaded state chip, inline progress row) applied to the
Speech-engines cards; pure renderer, highest value, kit pieces that exist:
`LuModelCatalog` (model rows with download/load/unload/state),
`LuModelPicker`, `LuEngineInstallButton`/`LuEngineUpdateButton`,
`LuRunnerBinaries`; (2) client task machinery — ALREADY shared since
2026-08-08 (withAiTask + `setProgress(done,total,text)` + AiTaskStrip + the
`bridgeJobProgress` install bridge in `SpeechEnginesTab.vue`); (3) the server
download manager — a REAL open design question: the kit downloads
ggufs/runner binaries with its own progress machinery, JV downloads HF
snapshots + builds venvs via its own `/v1/engines/*` job system; whether one
download manager can own both needs its own pass, no claim made.
WHY: two model-management surfaces in one app answering the same verbs
(download/load/unload/delete/progress) with different control vocabularies is
exactly the divergence class the family convention exists to kill; reuse
instead of rewrite is the standing law.
NOT: moving TTS engines INTO the kit's runner/catalog (they are not llama.cpp
children — the pool stays JV's); claiming the server halves are one system
today (they are not).
BUILT: nothing — think only.
ORDERED ADDITIONS 2026-08-13 (user words verbatim, during the chatterbox
download failure — WinError 1314, hub's cache-symlink fragility at load
time): *"one of the tasks is to make the speech engine use the same
interface and services of the llm runner, the download progressbar, re
dowload, load unload, the three dot menu, ect."* · *"we should have the
model catalog for each engine and so on"* · *"and the location we have data
directory and ai-cache for llm why not have a tts version in same loacation,
also we should have the same types of clear data directory ect"*. The
failure is the argument for the SERVER half: the LLM never breaks because
the kit downloads models as PLAIN FILES (progress/resume/per-file on-disk
truth) and loads from disk — speech engines fetch through HF's cache
machinery at load time inside the engine subprocess.
THE FAILURE, diagnosed in code (2026-08-13, chatterbox-turbo first load):
hub 0.36.2 has exactly two symlink sites — a per-directory PROBE and the
real pointer creation that runs only when the probe said yes. Proven live
in the shared venv unelevated: the probe honestly answers NO on this box
and hub degrades to copying — which is how ~3.9 GB of turbo files landed
as REAL files (all stamped 22:38, moved not linked; blobs/ held exactly 1
orphan = the failed file's already-downloaded blob). The raise is a HOLE
in hub's fallback: Windows delivers WinError 1314 as plain OSError while
the symlink branch catches only PermissionError — so the one file whose
process believed symlinks were supported crashed instead of degrading. A
FRESH engine process re-probes honestly → RETRY completes the load (the
missing file's blob is already on disk). UI contributor: `modelOnDisk`
treats a non-empty folder as downloaded, so the partial snapshot skipped
the download phase and the ENGINE fetched stragglers itself — per-file
on-disk truth (the catalog's declared file list) kills this class.
REJECTED SOLUTIONS (user, verbatim — so they stay rejected): Developer
Mode ("no way a user needs to set developer mode") and
HF_HUB_DISABLE_SYMLINKS ("no on the hf_hub disable symlinks, we download
from hf all the time with the llm" — the LLM works because the kit
streams plain files, never the hub cache layout; that is the CORRECT
solution's shape, i.e. this item).
FINDING (code-verified 2026-08-13): speech models live INSIDE the installed
package tree — `ENGINES_DIR = Path(__file__).parent`, models at
`engines/<id>/models/`, the shared venv at `engines/.shared-venv/` — while
the LLM's cache correctly lives at `<data_dir>/ai-cache` (app.py:221). An
app upgrade/reinstall strands or nukes gigabytes; factory reset and the
backups page cannot see them; `is_installed`/uninstall/prefetch all route
through `models_dir`, so the relocation has ONE seam.
FINDING 2 (user question + code-verified 2026-08-13): JV's default data dir
is `AppData\Roaming\justvoice\justvoice\data` while JW's is
`AppData\Local\JustWrite\JustWrite` — `paths.py` deliberately mimics the
RETIRED Rust core's `ProjectDirs::from("dev","justvoice","justvoice")` so
the June port found existing data; that rationale is dead (Rust core gone,
pre-release reset rule). Its comment also lies ("Set roaming=False … we use
Local" while the code passes roaming=True). REC: converge on the JW shape —
`platformdirs.user_data_dir("JustVoice")` → Local\JustVoice\JustVoice; one
function; JUSTVOICE_DATA_DIR/--data-dir unaffected; decide together with
the speech-cache location (same resolved dir).
REC (awaits the word): speech models move under the data dir beside
ai-cache (e.g. `<data_dir>/speech-cache/<engine>/<variant>/`, per-variant
pinned revision + declared file list, fetched by the KIT downloader —
network leaves the load path entirely); kokoro's `model_dir_override` is
the per-engine escape precedent; the venvs' location is decided at the
design pass (rebuildable runtime, not user data); the data-management
surface grows per-store clear verbs (LLM cache · speech cache · render
cache) in one grammar. Pre-release no-migrations rule: the path change is
a default change — existing files re-download or the user resets.
DECIDED 2026-08-13 (late — the design pass RAN, triggered by the user
loading 350M chatterbox-turbo and the budget strip showing 4 GB "in use";
full record: `docs/plans/2026-08-13-speech-catalog-redesign.md`). The
diagnosis: `vram_min_mb: 4096` was INVENTED in the 2026-06-08 scaffold
(`de592a7`, git-blamed) — never sourced, never measured, same for every
engine's declared number — and the wiring booked + displayed it. User words
verbatim through the rethink: *"that makes no sense … what is using 4gb if
the model is only 350mb"* · *"from a user perspective this is exptemely
misleading"* · *"i dont like this booked reserver too confusing for user,
we need to think of better way, poor design you did on this manager"* ·
*"rethink this manager process i do not like it at all rethink this
manifest too"* · *"why should this be any diffent then the way we load llm
models and show what vram is used"* (answer verified in code: it
shouldn't — kit `lifecycle.py` measures the before/after pool delta and
reserves THAT, `source="measured"`; the speech wiring ported the declared
arm without the ladder). THE RULINGS: **own catalog** (*"the speech can
have its own catalog just reuse what makes sense to do and desing it so it
feels similiar but taking into account what is different about speach"*) —
grouped engine→variant rows built from kit primitives (DownloadBar, chip
mapping, three-dot menu) with the identical verb set, NOT LuModelCatalog
itself; **no quants / no model-card machinery** (variants are one fixed
artifact each; add-by-link dies — engine code pins the catalog; "View on
Hugging Face" replaces the card); **cloning distinction** (*"i would like
a way to distingush between engines models that can do voice cloning vs
not"*) — per-variant voice_cloning/preset_voices facts, first-class chips,
filter row, consumers repointed (GenerateView.vue:61 reads engine-level
today); **facts-only manifests** — vram_min_mb DELETED from the format,
weight-file sizes verifiable from disk/HF-tree, per-variant languages/
capabilities/license; **measured-first pricing** — probe the engine PID
after load, reserve + display the measured number, estimate only before
first load and LABELED; **admission on measured free**; **strip shows
reality only** (used/free/per-row measured + "other apps"); **slots stay**.
OPUS ADVERSARIAL PASS (user-ordered, both directions): 4 findings adopted —
don't replace invented 4096 with quoted ~1.5 GB (only measurement counts;
engine.py:107 loads the full pipeline, "350M" is the backbone alone);
**raise-only high-water re-probe** at busy→idle (TTS allocates at
generate(), not load — post-load delta alone would over-admit into render
peak; torch's caching allocator makes the lazy probe forgiving);
**per-process attribution** (Fable's amendment over a shared lock:
query-compute-apps on Linux/NVIDIA, per-PID GPU Process Memory counters on
Windows WDDM where nvidia-smi says N/A, RSS on one-pool; fallback
device-delta labeled computed) kills the cross-charging race with
concurrent LLM loads; **file-sizes-not-params** for the estimate;
**TTL-cache the probes** (used_device_mem_mb calls detect() + nvidia-smi —
never raw under a 4 s poll); **sequencing flip** — true-up FIRST (zero
downloader dependency: sizes come from disk for installed engines).
PHASES: ① measured true-up + strip truth + `vram_min_mb` deleted outright
(GO GIVEN 2026-08-13, verbatim: *"save in docs in detail and go for
coding"*; the deletion pulled forward from ② on the user's mid-build check
*"vram_min_mb i thought this was inventied and not going to be used?"* —
zero code readers, grep-receipted) · ② kit downloader
generalization + speech-cache + facts-only manifests + load-from-local-
paths (kills 1314; needs go) · ③ the catalog UI per the plan doc's anatomy
(needs go) · ④ data-dir convergence on JW shape + per-store clear verbs +
venv location (needs go).
PHASE ① BUILT 2026-08-13/14 (same session; full inventory in the plan
doc's §9): kit per-process probes (`process_device_mem_mb` — nvidia
compute-apps arm + the vendor-neutral WDDM `GPU Process Memory` typeperf
arm — and `process_rss_mb`; kit suite 851) · JV estimate ladder + measured-
free admission (+settle loop, honest refusal quoting measured numbers) +
per-PID true-up at the load door + raise-only high-water bumps
(synth/clone/transcribe async + scheduler busy→idle fresh, daemon threads)
+ measurement rows into the kit store (`tts:<engine>:<variant>`) ·
`used_mb`/`other_mb` on the vram endpoint · the strip reworked to measured
truth (used-of-total · Free · per-engine cells · Other apps · busy) ·
`vram_min_mb` deleted from all seven manifests · wiring tests REWRITTEN
(24 green) · gpu.md/engines.md updated.
THEN THE SECOND RETHINK (user: *"rethink the desing if you are screwing
this up mid code then what else in the desing did you nad opus get
wrong??"*) + Opus's EMPIRICAL pass + Fable's live experiments — full
record + the amended design in the plan doc's §10. The short truth: the
estimator priced turbo at 4,455 MB (WORSE than the deleted 4,096 — turbo
never loads `s3gen.safetensors`, 1 GB dead in the file sum); and the live
CUDA-child experiment found THE LAUNCHER-SHIM BUG — uv's venv python.exe
on Windows is a trampoline, the Popen pid is a 4 MB shim, the real
interpreter is its CHILD (probing the child: device 1131 MB via the WDDM
counter arm — the mechanism WORKS aimed right; as built it would book
"computed" forever on discrete Windows and 4 MB on one-pool). ADOPTED:
Opus's cut — the pre-load estimate DIES (first-ever load = no arithmetic,
no number, attempt→measure→book→remember, "not measured yet" on
strip/card; prior-measured loads admit AND book early). Platform answer:
Windows all vendors ✓, Linux NVIDIA ✓, Linux AMD needs the device-delta
fallback (must now be implemented — the estimate it fell back to is
gone), Mac RSS-on-pool ✓ with the MPS-in-RSS caveat on the laptops-walk
list. `recommend_for_vram` is the DOWNLOAD-variant picker
(engines_models_api.py:99) — its invented numbers can't be zeroed without
replacing the picker (manifest default variant, else smallest).
THE AMENDED FIX SET: BUILT 2026-08-14 (as-built record item-by-item in
plan doc §10's BUILT stamp): kit process-TREE probes (pid+descendants —
psutil → wmic/CIM/ps table walk; nvidia set-query + per-pid WDDM counter
arm; suite 858) · the pre-load estimate DELETED (prior-measured admits AND
books EARLY with release-on-failure; first-ever load = no arithmetic,
"not measured yet" on the strip, which now joins loaded engines with
reservations) · device-delta fallback (computed, never persisted, never
overrides an early prior booking) · the second nest DEAD (model_catalog
vram_mb + ModelVariant field + fit dots + est. span + the
/models/recommended endpoint deleted; picker replaced by
default_variant_for over the manager's resolved default; legacy-gui
repaired) · gpu.md "1–1.5 GB" struck · bump occupant re-check + booking
CREATE when measurement first lands (policy-gated) · the kit booking-gap
half (reserve computed at admission, true-up upserts; zero kit test
changes) · junk files deleted · KFD idea recorded. Wiring tests REWRITTEN
(29 green). Gates: kit ruff+858 · JV ruff+pytest+vitest 48+biome+build +
THE RENDERER SMOKE (passed, zero JS errors).
SPEED TABLES: CUT 2026-08-14 per the rec the go adopted (gpu.md CPU
realtime factors + engines.md Speed column + GB→engine tiers — same
invented-number class as vram_min_mb; honest qualitative split kept:
Kokoro is built for CPU, the PyTorch cloning engines want a GPU).
GO: given 2026-08-14, verbatim: *"go on everything your rec"* — covers
THE AMENDED FIX SET (built, above), the speed-tables ruling (cut, above),
and phases ② → ③ → ④ in order, recs governing open sub-decisions;
stop-and-ask only where a genuine new user ruling appears. NEXT: phase ②
IN PROGRESS — the build design + THE VERIFIED WEB FACTS are in plan doc
§12 (read it first on resume): kit `select_repo_files` + JV
`speech_cache.py` (plain files + files.json truth, kit downloader, no
symlinks) are BUILT + TESTED (kit models 28 · JV speech-cache 6); the
web pass verified every ENGINE-map repo real and exposed the old catalog
rows for dia/moss/tada/luxtts as unwired fiction (real: Dia-1.6B-0626 ·
OpenMOSS-Team/MOSS-TTSD-v0 · HumeAI tada-codec+tada-3b-ml ·
YatharthS/LuxTTS); pinned per-variant file sets recorded (§12; raw trees
in the session scratchpad hf-trees/). ②a+②b BUILT: spawn_prefetch + the manager load door acquire through
speech_cache (fetch-before-spawn; `_hf_snapshot_to` + its symlink
machinery DELETED; the old prefetch tests were also writing junk into
the REPO models_dir — the "scaffold junk" mystery solved, pins now
assert the repo tree stays clean) · plugin SDK v0.2.0 (`/load` carries
`model_dir`, signature-aware pass-through, old SDKs ignore it
gracefully; `_ensure_plugin_current` auto-refreshes stale venv installs
at spawn) · ALL 8 engines grew local load doors (chatterbox
from_local · whisper/qwen3/dia/moss from_pretrained(local dir) ·
tada 3-source nested dirs incl. the Llama-tokenizer mirror, hub calls
only on the legacy branch · luxtts model_path · kokoro model_dir
override) · models_api on_disk = speech-cache truth first, then the
PER-ENGINE legacy hub cache (models/hf/hub — the env-based probe was
checking the wrong root) · Delete model handles both worlds ·
docs (gpu.md 1314 entry = structural fix landed; engines.md speech-cache
paragraph). ②c BUILT (PHASE ② COMPLETE): every manifest carries facts-only VARIANTS
rows (languages · per-variant voice_cloning/preset_voices · weights
license · pinned sources with verified files + real summed bytes — from
the scratchpad `pinned-variant-files.txt`, all 16 repos + 2 HEAD-verified
kokoro tarballs); model_catalog is a READER over manifests (the
hand-typed nests + `_hf_placeholder` fakes died — four engines' rows had
pointed at repos that never existed); resolve_source serves the pinned
`files` + full multi-source list (an operator override honestly carries
none — whole fork tree); the wire ModelVariant grew
voice_cloning/preset_voices/weights_license/hf_repo/url;
`disk_space_mb` excised end to end (manifests, wire Prerequisites,
engines_api reader, dormant catalog rows, legacy-gui column); MOSS
renamed to what actually loads (MOSS-TTSD v0 — "v1.5" never existed);
kokoro/engines.md sizes corrected to verified downloads (multilingual is
333 MB, not "~700"; turbo's real download is 3.0 GB, not "350 MB");
variant-wiring pins STRENGTHENED to exact repo equality via hf_repo.
Gates: full pytest 504 · vitest 48 · biome · build. Then ③ the catalog
UI, then ④ locations + verbs.
SESSION 2026-08-14 COMMIT INVENTORY (all pushed, JV workflows verified
disabled_manually before AND after every JV push; both trees clean at
session end): KIT `e173256` (process-TREE probes + the runner's early
booking; suite 858) · KIT `ad5c66e` (select_repo_files + the
hf_download_headers door; models tests 28) · JV `d00bb9c` (the amended
fix set + the speed-tables cut; renderer smoke PASSED) · JV `bba5cc1`
(②-groundwork: speech_cache.py + plan §12 + the verified web facts) ·
JV `82d59fb` (②a wired + ②b: SDK 0.2.0, 8 local load doors, the
fetch-before-spawn door; pytest 504) · JV `8f4463d` (②c facts-only
manifests; pytest 504 · vitest 48). Cross-app kit gate: JW pytest 128
green against the new kit. RESUME SURFACES for ③/④: plan doc §6 (the
decided anatomy) + §13 (the grounded resume brief: what the wire serves,
what SpeechEnginesTab already has, the kit primitives incl. the Reka
DropdownMenu import shape from LuModelCatalog.vue:49, the
GenerateView/voices capability repoint, ④'s scope, and the four carried
open edges — kokoro's load-door tarball path still writes the legacy
location · the dormant known_engines/spawn_install legacy registry is
an excision candidate · is_installed heuristics could become
cache-truth-driven · MPS-in-RSS stays on the laptops walk).
PHASE ③ BUILT 2026-08-14 (the catalog UI, under the standing go — a
RESHAPE of SpeechEnginesTab per §6/§13, not a new view): the variant
rows grew the facts chips read straight off the ②c wire (language chip
`en`/`N langs` with full-list hover · CLONING · PRESETS · N · the
weights-licence chip with the kit's gold use-limited warn pattern
retold honestly for JV — every bundled engine permits commercial
output, so ⚠ means an OBLIGATION rides the licence, TADA's "Built with
Llama" spelled out in the hover) · ONE merged filter row (rec under the
go: §6's All · Cloning · Preset voices JOINED with the pre-existing
TTS/STT kind chips — two side-by-side "All" chips would be worse;
capability filters work on variant facts, auto-expand groups, drop
engines with no matching variant) · the three-dot menu per row
(reka-ui DropdownMenu, the LuModelCatalog import shape; canonical
.ev-kebab/.ev-menu classes in styles.css since the portal escapes
scoping): Re-download (delete + fresh fetch via the same job-channel
task; also the legacy→speech-cache migration verb; disabled while
loaded) · Open folder (desktop-only, the SettingsView log-opener
precedent; the SERVER resolves the folder — ModelVariant grew
`local_dir`, populated by models_api across all four arms speech-cache/
per-engine hub/env hub/tarball, so the cache layout never leaks into
the client) · View on Hugging Face (kit openExternal on v.hf_repo) ·
Delete files (moved in from the old inline button; now honestly gated
on_disk AND not loaded — deleting a resident model's files was always
dubious) · `size · on disk` in the row meta · the per-row measured-
memory hint on the LOADED row ("X GB measured" / "~X GB in memory" /
"not measured yet" — joins the vram reservations exactly like the
strip's speechRows; §13's story, not §6's pre-rethink "needs ~X GB").
THE CAPABILITY REPOINT (the §4 cloning ruling's second half):
GenerateView's lookupCapability now prefers the LOADED VARIANT's row
and walks "-" suffixes off each candidate (manifest ids carry a version
tail the capability map doesn't: chatterbox-turbo-v1 → chatterbox-turbo)
— before this, a loaded Turbo served Multilingual's knob set (wrong
sliders, missing paralinguistic tags). The voices flow's engine-level
`capabilities` read was VERIFIED factually fine (no engine's variants
differ on cloning) and left alone. Docs same change: engines.md "The
catalog rows" section (chips · filters · licence semantics · the ⋯
verbs) + generate.md loaded-variant note. GATES: ruff · full pytest 505
(new pin: models list serves speech-cache local_dir) · biome 113 ·
vitest 48 · build:vite · THE RENDERER SMOKE (all views, zero JS
errors) · PLUS a targeted headless drive of the reshaped tab itself
(smoke.js never clicks the sub-tab): chips render, first group expands
to the §6 row anatomy exactly ("23 langs · CLONING · MIT"), the kebab
menu opens with the honest verb set for a not-downloaded variant, the
Cloning filter fans to 10 rows, zero JS errors, screenshots taken.
Open edges: unchanged (the four above — kokoro tarball path and
is_installed now explicitly ④'s). NEXT: phase ④ locations + verbs.
PHASE ④ BUILT 2026-08-14 (the final phase — the redesign is COMPLETE):
THE LOCATION converged on the JW shape — `default_data_dir()` = env
else `Path(platformdirs.user_data_dir("JustVoice"))` (Windows
%LOCALAPPDATA%\JustVoice\JustVoice · Local never Roaming; macOS
~/Library/Application Support/JustVoice; Linux ~/.local/share/
JustVoice), the Rust shell's `default_data_root` changed in lockstep
(the old pair disagreed with each other); JUSTVOICE_DATA_DIR /
--data-dir / dataroot.txt untouched; NO migration (pre-release rule —
env-var at the old folder, or fresh + backup). THE VERBS: the KIT
`make_disk_router` grew `extra_buckets` ({name: dir} → measured,
served under `extras`, counted into total; JW byte-identical when
unused); JV mounts speechCache + renderCache; Settings → Storage →
Disk usage = AI models cache · Speech models · Render cache · Engine
spawn logs, each Clear in the ONE kit grammar (confirm-with-size,
refuse-while-loaded); new POST /v1/engines/speech-cache/clear
({ok:false, detail:"unload engines first"} while loaded; {ok:true,
bytes}); render clear rides /v1/cache/clear, Labs → Cache stays the
scoped surface. THE VENV RULING (rec under the go): venvs STAY with
the runtime tree (engines/<id>/.venv + shared) — interpreter-bound
rebuildable runtime, never user data; known edge recorded: admin-
located installs can't write venvs (today's behavior, unchanged).
THE KOKORO EDGE CONVERGED: `_ensure_variant_local` URL arm via new
`installer.fetch_url_variant` (same primitives as the prefetch
worker's job twin) → tarballs land in the SPEECH CACHE at the load
door too; load door reordered acquisition-first (legacy
_install_engine_shared model steps only when local_dir None and not
installed); pre-④ engine-dir installs keep serving (legacy guard);
`is_installed` learned cache truth (any_variant_on_disk) — prefetched
shared engines read installed. DEFERRED BY REC: the known_engines/
spawn_install excision — shares paths with the LIVE external-engine
flow; its own verified pass, never a rider. DOCS: backups-and-data.md
"Where your data lives" + "Disk usage" sections (the panel was
undocumented before); engines.md links the whole-store clear.
GATES: kit pytest 862 (extras pin) · JW pytest 128 (JW's repo-root
.venv — bare F:\Python312 lacks the xdist its addopts want; kit-source
resolution verified live in that venv) · JV ruff + full pytest 510
(5 new pins) · biome 113 · vitest 48 · build:vite · cargo check · the
renderer smoke (first run failed ALL views — resource contention with
the concurrent full pytest, nothing rendered within timeouts; the
immediate rerun passed everything, zero JS errors) · headless
Settings drive verified the Disk-usage rows + /v1/disk/usage extras.
REMAINING out of plan: the user's laptops walk (MPS-in-RSS).
THE known_engines EXCISION — DONE 2026-08-14 (user: "go on all of it").
It was a SECOND catalog beside engines/<id>/manifest.py, and every one of
its seven ids had a real manifest — so `_is_managed()` returned first and
NONE of its arms could run. Verified unreachable before cutting, not
assumed: the /install legacy branch, the DELETE-engine legacy branch (which
carried `uninstall_deps` → `pip_uninstall_engine_deps`, the one reader I had
earlier called "live" — it is not, the managed branch returns above it), the
engines list fallback loop, the /engines/current fallback loop, and the
models_api existence guard. EXCISED: `known_engines()` + its 7 EngineInfo
builders; `_enrich_legacy`; installer's `spawn_install`, `_missing_modules`,
`_pip_install`, `_run_install`, `_register_engine_after_install`,
`uninstall_engine`, `_pkg_name`, `_PKG_VERSION_RE`,
`pip_uninstall_engine_deps` (installer.py 851 → 513 lines). KEPT
deliberately: `compute_status` — it serves RUNTIME-registered external
OpenAI-compatible engines, which have no manifest by design. `uninstall_deps`
stays on the DELETE route as an accepted-and-ignored query flag (documented
in the docstring) rather than a breaking signature change. Receipted sweep:
zero references to any excised name in server/, src/, tests/ — only the
tombstone comments and the plan-doc history. Gates: ruff · pytest 521 ·
vitest 48 · build · smoke.
2026-08-14 FOLLOW-UP RULINGS (user, verbatim, after seeing the built
catalog live) + the same-day build:
RULING 1: "i meant i wanted it to be like the llm catalog, meaning i
want a download button not a load button with an arrow, also the
storeage location is that supposed to be the same as jw, check you
work you messed up things". RULING 2: "ai models cache is showing 0,
i want the jv model catalog to feel and work similiarly to the shared
llm runner catalog, do you understand, i undertand there are
differences that need to be but it all should work the same clear
cache for llm models clear cache for tts models ect". RULING 3:
"server logs, database ect all 0 nothing works correctly". RULING 4:
"dataroot.txt this should all be in the database and a seed file".
THE STANDING PRINCIPLE these establish: the JV speech catalog FEELS
AND WORKS like the shared LLM-runner catalog everywhere — verb split,
cache rows, clear verbs — differing only where speech genuinely
differs.
AS BUILT: (1) THE VERB SPLIT — a not-on-disk model shows "Download
(N GB)" (download only, the kit's 'available' shape); "Load model"
appears once files are on disk; the one-step "⬇ Load (N GB)" died
(loadButtonLabel deleted, runLoad is load-only now, downloadOnly is
the download door). (2) THE STORAGE MESS-UP root-caused: the location
CHANGE was correct (both apps double the name — Local\JustWrite\
JustWrite ↔ Local\JustVoice\JustVoice) but the shell's FIRST-RUN
POINTER LOCK (dataroot.txt, docgen §5 shape) had pinned the user's
install to the old Roaming root, silently vetoing the new default —
my ④ report claimed convergence without accounting for it. FIX per
ruling 4's intent: the first-run lock is REMOVED (the default is
computed, never persisted — no scattered state files); dataroot.txt
now exists ONLY as the record of an explicit Change-folder
(storage_relocate writes it); a pointer holding exactly the OLD
default is residue of the removed lock → deleted on resolve, falls to
the new default. The one datum that CANNOT live in the DB is the DB's
own address — recorded as the bootstrap constraint answering ruling
4's letter. (3) THE ALL-ZERO PANEL, two real faults: kit fmtBytes
floored sub-MB to "0 MB" (a 484 KB database read as nothing) → now
shows KB below 1 MB (kit-wide honest display, JW gets it too); and
the Speech models bucket measured ONLY the new speech cache while the
user's real gigabytes sit in the LEGACY per-engine stores → the kit
extras hook grew list-of-roots buckets (summed per name), JV's
speechCache bucket = speech-cache root + every manifest's models_dir,
and /v1/engines/speech-cache/clear deletes across the same roots
(voices/state untouched). AI models cache 0 was verified HONEST on
the current root (post-reset, llama.cpp engine not reinstalled — no
GGUFs on disk anywhere). TEST-SAFETY catch: the widened clear would
have let the existing test rmtree the REPO-TREE engine models (a dev
box's real legacy models) — the test now empties the manifest map,
and the legacy arm is pinned against tmp dirs only.
2026-08-14 THE DATA-LOCATION RULING (user, verbatim): *"none of the
apps should have anything stored in C:\Users\danel\AppData\Local —
absolutely no data for any of these apps should be stored anywhere but
where the user has set the storage directory, which by default will be
the install directory for the app, for now that is the debug directory
for tauri"*, corrected immediately after: *"dont hardcode anything
appdata is not band what is banned is anything that the user has not
decided meaning the user chooses the data directory with default being
same location as app is installed"*; and the standing law behind it:
*"all that can be the same should be, this includes how data is
stored"*.
WHAT I GOT WRONG (recorded because the user has had to say it
repeatedly): phase ④ "converged JV onto JW's shape" by reading an
AppData FOLDER a headless test boot had created and taking it for JW's
real location — JW's desktop shell has always run PORTABLE (`data/`
beside the exe; the user's real JW data is in
src-tauri/target/debug/data). The convergence target was residue, and
"the two apps now match" was mistaken for the real goal: ONE shared
implementation.
AS BUILT (all three repos): the policy lives in the KIT —
`llm_runner/platform/data_paths.py` `resolve_data_dir(app_name,
env_var, source_root)`, ladder = the app's DATA_DIR env var (the
user's choice; also how each shell hands down Change-folder) →
`data/` in the install dir (frozen: beside the exe; source: beside the
checkout root) → the OS app-data dir ONLY when the install dir is
unwritable (read-only-install necessity, never a preference).
`justvoice/paths.py` and `justwrite_server/paths.py` are now
three-line callers (JW's platformdirs default was itself creating
AppData\Local\JustWrite\JustWrite behind the user's back). BOTH Tauri
shells implement the identical ladder in Rust (they resolve before the
server exists) and BOTH lost the first-run pointer lock — writing the
computed default into dataroot.txt is what pinned this install to
Roaming and silently vetoed every later default; the pointer now
records ONLY an explicit Change-folder, and one equal to a
computed/former default is deleted as residue on resolve. `data/`
gitignored in both apps.
NORMATIVE DOC UPDATED: kit `docs/app-structure.md` §6 (the paths.py
contract — it had said "platformdirs", which is what I followed) + §5
(the shell's pointer rule). USER DOCS: JV backups-and-data.md "Where
your data lives" rewritten (you decide; default = beside the app; the
three overrides; the unwritable-install fallback; both apps behave
identically); JW storage.md gained the headless half.
GATES: kit ruff + pytest 872 (9 new data_paths pins: env-wins ·
default-beside-app · blank-env-is-not-a-choice ·
OS-dir-only-when-unwritable · frozen-lands-beside-exe ·
probe-leaves-nothing · per-app-roots) · JV ruff + pytest 511 · JW
pytest 128 + vitest 578 · JV biome + vitest 48 + build:vite · BOTH
shells cargo check · JV renderer smoke (first run failed all views on
contention with JW's concurrent suites; the quiet re-run passed
everything, zero JS errors) · verified LIVE: JV headless default
resolves to the checkout `data/`, an env var overrides it, and a full
gate-server boot + smoke created NO AppData folder.
CLEANUP: deleted `AppData\Local\JustVoice` (my own gate residue,
verified file-empty first). The user's pre-④ Roaming data is untouched
and reachable via JUSTVOICE_DATA_DIR. UNEXPLAINED, reported not
guessed: `AppData\Local\JustWrite` also disappeared during this
session — I ran no command against it, JW's tests all use tmp_path,
and it held no files when first inspected; JW's real data (32 MB db,
projects, ai-cache, book files) is verified intact in
target/debug/data.

## Features the docs promise and the code does not do

### The YouTube master target is labelled AAC and encodes MP3

STATE: FINDING — code-verified 2026-08-15 during the docs pass.
WHY it matters: a caller asking for the YouTube target gets a response typed
`audio/aac` holding an MP3 (`media_map` in `render_chapter_api.py` and
`master_api.py` both map youtube → audio/aac; `MasterPresetSettings.youtube`
has `format="mp3"`, and `master()` encodes the preset's format). A browser
copes; a pipeline that trusts the content type does not.
OPEN: one of the two — either the preset should be m4a/AAC (its
`bitrate_kbps=192` and 48 kHz suggest that was the intent) or both media maps
should say `audio/mpeg`. Docs currently describe the MP3 reality.
GO: needed — it is a one-line change either way, but which line is a product
call.

### `effects.md`'s "apply a chain to a take → new take version" is unverified

STATE: FINDING — noticed 2026-08-15 while correcting that page; NOT checked
against code. The take/generation rows do carry `effects_chain` columns, so it
is plausible, but the page states a whole workflow (bake, `source_take_id`
link, revert by setting the source take default) that nobody has traced. The
rest of the page was corrected: chains live on personas and render presets
only, they stack rather than override, and they now run on every render.
OPEN: trace it, then keep or cut the section.
GO: needed.

## Docs and repo debt

### The Stories tab advertises a feature that isn't built

STATE: **DECIDED 2026-08-15 — *"ok you rec add this to ideas so we can design
the proper timeline"***, on the recommendation to RETRACT rather than build:
hide the tab, keep the tables, design the real thing first. The design is
written in full at the top of `IDEAS.md` (2026-08-15 entry) — what it does,
what it looks like, which kinds, and the four open questions. Two facts that
forced the rec, both code-verified that day: `story_items` points at
`generations`/`generation_versions` and carries no `take_id`/`block_id`/
`scene_id` (`database/models.py:396-412`), so the inherited timeline cannot
arrange what the production pipeline makes; and it anchors to the entity plan
item 6 dissolves. The retraction itself is NOT built — it needs its own go.
WHY it matters: app copy is code. `App.vue:43` sells "Multi-track timeline editor.
For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement."
BUILT: nothing behind it — `StoriesView.vue` has been deliberately inert since
2026-06-13, and the live server's `openapi.json` has **no `/v1/stories*` route at
all** (verified 2026-08-08). The tab's ? button also 404s: `App.vue:143` maps it
to help slug `stories`, and `docs/stories.md` does not exist.
OPEN: the copy decision, then either write `docs/stories.md` + restore its
`toc.json` entry, or remove the tab and leave both out.
GO: needed. (User docs were corrected 2026-08-04 to stop sending podcasters there.)

### Design rationale that exists only as code comments

STATE: FINDING — the comments verified present 2026-08-08; whether
`design-decisions.md` already covers each one is **not** verified.
WHY: a comment does not survive the next refactor of the file it sits in.
OPEN: write these into `design-decisions.md` — why Stories is gated
(`StoriesView.vue:3-15`, belongs in §5) · the backup schema-v1 / 4 GB design ·
why settings folded from JSON into SQLite (`storage/settings_store.py:4-8`) · the
"no hardcoded operator-tunable values" law and how engine source overrides
implement it · corrections used as few-shot examples.
GO: needed.

### The `screenshots` npm script is broken two independent ways

STATE: FINDING — hit live 2026-08-08 (left unfixed: no go was given to edit it).
BUILT: nothing. `scripts/smoke_gui.js` hardcodes `127.0.0.1:17497` and ignores
`JV_BASE` (CLAUDE.md's "JV_BASE overrides the base URL" is true of `smoke.js`
only), and even on the right port it times out waiting for a
`getByRole('button', { name: 'Engines' })` that no longer resolves.
OPEN: fix the port to honor `JV_BASE` and update the stale selectors — or
retire the script into the deferred harness decision (it is browser-driven,
the banned acceptance class).
GO: needed.

### §3 wording tension: "speaker attribution = JW" vs "JV does its own casting"

STATE: OPEN — observed 2026-08-08 during the contract-rows work, **unverified**
which reading is right.
WHY it matters: `design-decisions.md:105` lists speaker attribution under JW's
data ownership, while CLAUDE.md says "JW hands over the prose, JV does its own
casting and narration" and JV's extraction pipeline computes attribution.
Possibly ownership-of-data vs where-computation-runs — but the two sentences
read as contradicting each other and one page should say which.
OPEN: reconcile the §3 wording (one look at what JW actually exports).
GO: needed.

### The JW→JV book-format contract has no lock on the JustWrite side

STATE: OPEN — your call, and the concrete successor to the "book-zip import
format" item §3 records as a future decision. Became real 2026-08-08 when the
`justwrite` adapter started parsing JW's actual `book.json`.
WHY: JV's own fixture test catches JV regressions but cannot catch JW CHANGING
the shape — a rename of `scenes[].body` or a re-nesting of `parts[].chapters[]`
would break JV silently, and the two repos share no code by design (see the
zip-import item's NOT list).
OPEN: a shape-lock test in JW's suite asserting `book_io.assemble()` still emits
the exact key paths JV reads, naming JustVoice in its failure message. Lives in
`../justwrite-app/docs/dev/TASKS.md` once you take it — JW work belongs there.
GO: needed.

### ElevenLabs import: build it or drop it — the research says it is small

STATE: OPEN — your call. Its picker row was removed 2026-08-08 (a 501 in a menu),
but the module's own docstring is WRONG about why it was never built.
WHY: `imports/adapters/elevenlabs.py` claimed the mapping needs "an account-side
voice manifest" or a hand-mapping step and is "out of scope". JustVoice's own
research doc contradicts it — `docs/dev/external-import-formats.md` says the
Studio export is a ZIP of `manifest.json` (name, `voice_assignments`, chapters) +
per-chapter HTML with `<span data-speaker>` turns, maps "directly to Project /
Scene / Block", and rates the importer effort **Small**. The same doc surveys
Resemble, Speechify, Murf, Coqui and OpenVoice the same way.
OPEN: build it from the research doc (it also unlocks the four other tools), or
decide the whole external-tool import family is not wanted and retire the
research doc's claim. Either way the stub is gone — git holds it.
GO: needed.

## Known deviations, recorded so they aren't re-litigated

- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:330`).

## VRAM wiring DEPENDENCY (2026-08-09): the fit redesign lands first

The family fit redesign (`../just-llm-runner/docs/plans/2026-08-09-fit-redesign.md`)
is the wiring's prerequisite: it fixes BOTH of the claim line's verified sources —
the computed arm (compute_fit physics) and the measured arm (which does not exist
today: `model_measurements.vram_total_mb` is the CARD total, not a footprint; the
true-up dies in-memory — the redesign persists it as `vram_model_mb` + adds the
claim resolver the strip consumes). Q1-Q8 rulings STAND untouched; the
eviction-executor seam remains this repo's own prerequisite (disjoint functions,
same lifecycle.py). Resume the wiring after the redesign's Phase 5.
2026-08-13 consensus update (plan §13): claims carry `{vram_mb, ram_mb}` + a
provenance source (measured|declared|computed — a manifest-priced TTS reservation
must never read as live truth on the strip); RAM co-residency on DISCRETE boxes is
priced but unbudgeted — DECIDED (plan §8.18): the strip DISPLAYS the RAM sum,
never enforces it in v1 (mmap'd weights make a summed ledger over-count; enforcement
only on evidence, mlock/no_mmap-keyed), and the display half is THIS repo's wiring
work, not the kit's. CPU-adequate engines confirmed first-class (claim follows the
resolved device → CPU = 0 VRAM).
STATE STAMP 2026-08-13 (late): the redesign's BUILD PHASES ARE COMPLETE —
Phases 0–7 BUILT + pushed (6 = the joint MoE solve + ncmoe-first shed; 7 =
the uncurated-path gate + evidence-keyed ranking + the one-authority dev-doc
story, now standing in the kit's `docs/dev/serving-design.md` fit section —
read THAT for the current fit architecture, the plan for history) — THIS
ITEM IS UNBLOCKED with no kit prerequisite left. What Phase 5 delivered for the wiring (full record in the kit
tracker's fit item): the claim resolver lives in `preview_fit` (four arms:
resident-live with §13.1 provenance on the arbiter snapshot → persisted-
measured median over fingerprint-matched source='load' rows → physics computed
with learned per-backend overhead → declared); claims are {vramMb, ramMb,
source, matches} (RAM display-only §8.18); the arbiter snapshot is arch-aware
(mem_arch, one-pool pools counted once — Phase 4) and each reservation row
carries its source. CORRECTED 2026-08-13 (the re-think's code verification):
`configure_service(declared_claim_fn=…)` is DEAD plumbing — assigned once,
read nowhere, and `preview_fit` resolves catalog ids only, so it can never
answer a foreign kind. JV does NOT register it; JV prices its engines from
its OWN manifests (vram_min_mb · cpu_adequate · gpu_runtimes — Q2's facts)
and the strip reads the resident snapshot + `preview_fit` claims for the LLM.
GO GIVEN 2026-08-13 (see the VRAM item above for the decision record).
