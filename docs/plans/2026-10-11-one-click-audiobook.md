# One-click audiobook (plan, 2026-10-11)

The decisions this plan carries, verbatim in TASKS: *"One-click audiobook: one pipeline in JV, run
by its own AI or by Claude Code"* and *"Frontier models get their own recipe, not the small-model
one"* (both decided 2026-10-10). The user's goal, in their words: *"an opensource ebook to
audiobook converter that does an oustanding job with local ai automatically and even better job
with frontier models but not suing too much tokens so it is very cheap"*, and *"its not for me it
will be a production app for anyone"*. The user's go for this plan: *"your rec go"* (2026-10-11),
on "the one-click plan doc … each piece names its standard, and the blast-radius greps come before
any code."

Facts it rests on: RESEARCH §10 (what exists, the measurements, Anthropic's terms, prices, the
commercial tools). Where each step lives in the code: `docs/dev/code-map.md` §7a. **Nothing here is
built; every slice needs its own go, and a NOT STANDARD piece its own word by name.**

---

## 1 · What it is

**One button that turns a book into a finished audiobook with a cast of voices and emotion on
the lines — unattended — and leaves every decision where you can hear it and change it.**

- You import a book (EPUB, DOCX, Markdown, text) and press one button. The run finds the
  characters, decides who says every line, gives each main character a voice made from how the
  book describes them, writes how each line should be said where the text says so, renders every
  line, masters the chapters and exports the M4B.
- It never stops to ask. Where it isn't sure it **flags** — the same flags Script already shows
  ("To check") — and carries on. You review afterwards on the screens that exist: Script (who
  speaks), Cast (who plays whom), Render (each line, its direction, its takes).
- **Two kinds of brain, the same run.** By default the built-in local model does every AI step:
  free, offline, for everyone. Anyone with an API key can route the same steps to a frontier
  model (Claude, GPT, Gemini — the kit's providers) and get a better pass for a few dollars a
  book (RESEARCH §10.2: the whole text side of a 100,000-word book, about $2.60 on Sonnet 5.5 or
  $5 on Opus 5.5 — arithmetic, unmeasured).
- **Every result says who made it** — which model, which recipe — so two runs can be compared
  line by line, and a frontier pass can redo what a local pass did.
- **What it is not:** it does not replace listening. It produces a directed first draft; your
  ears decide (RESEARCH §10, the first answer of this program). It does not publish anywhere,
  and an AI-narrated book cannot go to Audible through ACX (`docs/studio.md` §The ACX check).

What the measurements say so far (RESEARCH §10.4–10.5, Alice VII–VIII, local gemma 26B-A4B on an
8 GB card): who-speaks **240/240**; Discover found every speaker; direction caught **60 %** of the
lines whose text says how they are spoken, **88 %** with a carry (below), and marked 5 % of the
rest; voice descriptions came back in seconds. Still owed: whether direction is *audible* on the
engines, and whether a voice designed from words stays the same person once frozen (§7, slice 0).

## 2 · The steps — what each one reads and writes

One contract per step: what it must produce is the same for every model, so results compare and
the screens don't care who made them.

| # | Step | Exists? | Reads | Writes (existing storage) |
|---|---|---|---|---|
| 1 | Import | yes — `POST /v1/projects/import` | the book file | project, chapters, lines |
| 2 | Discover + merge names | Discover yes; **merge new** | each chapter's text | candidates per chapter → one list, name variants merged ("Queen of Hearts" / "the Queen", RESEARCH §10.4), left out where Discover counts no lines for them (Time, Elsie, the Duchess) |
| 3 | Add speakers | yes — `…/speakers/promote` | the merged list | speakers (+ aliases) |
| 4 | Who speaks (Analyze) | yes | chapter text, cast | each line's speaker, source, confidence |
| 5 | **Voices for the cast** | **new** (pieces exist) | the book's text per speaker | per main speaker: a description → a designed voice → its audition frozen into a clone (the freeze bridge) → a persona; minor speakers matched from the library (Smart-assign, applied server-side) |
| 6 | **Direction** | **new** | chapter text, each line's speaker and its model's vocabulary | each line's `direction` and/or `line_models[model].emotion` / register tag — the fields Render's "This line only" already edits |
| 7 | Render | yes — render jobs | the cast, the lines | takes |
| 8 | **Check the takes** | **new** (later slice) | each take, its text | re-render once where the transcript misses the text or the take runs away; flag the rest |
| 9 | Master + export | yes | takes | M4B with chapter marks |

**Step 5 in detail — voices from the book.** The model writes a voice description from how the
book shows the speaker (measured: one or two sentences with gender, age, pitch, pace and manner,
5–12 s on gemma). A voice drawn from words changes person from line to line (RESEARCH §1.3, by
ear), so the run designs it once, renders an audition, and keeps that audition as the voice's
clip — the existing freeze bridge (`POST /v1/voices/preview` → `/save`, code-map §7a). The clone
model must still take direction: **VoxCPM2** (written direction, any of its languages) or
**Chatterbox Turbo** (emotion tags, English) — not Qwen3 Base, which drops direction (RESEARCH
§10.1). Which one is Q2.

**Step 6 in detail — direction.** For each chapter the model reads the text with its lines marked
and answers, per line, one of the nine emotions and a few words of direction, only where the text
gives a reason (measured: 4–5 % of lines with no cue get marked). Then a **carry**: a speaker's
direction goes to their other lines in the same paragraph that got none — measured 60 % → 88 %
(RESEARCH §10.5). The answer is shaped to the line's model: words go to `direction` on a
written-direction model; the emotion becomes Turbo's tag on a tag model (`render_core.js:323`, the
existing `value_map`); a sliders-only model gets nothing. Lines you set yourself are never
overwritten (the same rule Analyze keeps for `source: "corrected"`).

## 3 · Two recipes per step (decided)

From the decision: *"Two recipes per step: Local … Frontier … Pick the recipe by kind of model, not
size … a recipe setting on each model's preset: frontier by default for cloud providers, local for
the built-in engine, and editable … Never tune one at the other's expense."*

| Step | Local recipe (small model, 8 GB) | Frontier recipe |
|---|---|---|
| Discover + merge | per chapter, as today; merge by name containment, then one short model call to confirm | the whole book's candidates in one call |
| Who speaks | today's: chapter pieces, the fixed "said X" rule (240/240 on Alice), Guided/Direct by size | the whole chapter (or book) in one call, the cast with descriptions, thinking on, a fixed JSON schema; the "said X" rule only flags where it disagrees |
| Voices | one call per speaker, that speaker's lines and the narration around them | one call for the whole cast, the whole book in context |
| Direction | per chapter, JSON mode, then the carry | per chapter with the book's earlier chapters in context, thinking on; the carry still applies |

- **The setting:** a `recipe` field on the kit's engine presets — `""` (from the provider: the
  built-in engine and Ollama → local, a cloud provider → frontier), `local` or `frontier`. A kit
  change, so JustWrite's features can use it too (family rule: a gap is filled in the kit).
- **It replaces** speaker attribution's size-only Auto for cloud models, which reads every cloud
  model as 0 B and gives it the small-model route today (RESEARCH §10.1). Inside the local
  recipe, Guided/Direct by size stays.
- **The target for the frontier recipe** is a free-form run by Claude Code on the same chapters
  (decision point 4): the gap between the two is what the recipe still loses.

## 4 · The run

- **Server-side, like render jobs.** The server owns the data, and a run must survive leaving the
  page, a headless server, and a restart. So the run is a persistent job — a `book_runs` table
  (project, scope, step, chapter, status, the recipe and model per step, counts) driven by the
  kit's `background()` and swept to "paused" at start-up, resumable — the pattern `render_jobs.js`
  already uses (`createJob` :151, `startJob` :173, the boot sweep at `app.js:246`).
- **Each step is a function the run calls directly** — not HTTP, not the renderer's chapter run
  (`src/services/chapterRun.js` stays as it is for Script and Discover). Analyze's persistence
  (`_persistAttribution`, `extraction_api.js:374`), Discover (`identify.identifySpeakers`), the
  promote insert (`ensureSpeaker`), Smart-assign's call, the freeze bridge and render jobs are
  reused from server code; where a route holds the logic inline, it moves into a function both
  the route and the run call.
- **Idempotent.** A step already done for a chapter is skipped unless you ask to redo it; a line
  you set is never overwritten; re-running Analyze on a chapter with takes is refused today
  (`extraction_api.js:473`) and stays refused.
- **Batched by kind, not by speaker.** The AI model and the speech models share one 8 GB card and
  load one at a time (RESEARCH §2 — loading a speech model evicts the AI model). So the run does
  all of a kind together: every voice description, then every voice designed and frozen, then
  every chapter's direction, then the render — a few swaps per book, not one per character. A
  frozen audition is held 10 minutes (`voice_preview_api.js`), so each is saved as soon as it is
  rendered.
- **Lines with no single speaker** — a group's "No room!", a line Analyze left blank — can't
  render today (render refuses a line with no speaker, code-map §7a). What the run does with them
  is Q7.
- **Progress:** the job's status route, polled like a render job's; the page shows each step and
  chapter and mirrors the run into the AI tasks panel (a renderer-side store, code-map §7a).
- **Price, for a frontier route:** the run estimates its tokens before it starts and shows the
  price from the kit's pricing table. Whether it then asks before spending is Q8.
- **Not synced:** the run's own table stays on the device; what it writes (lines, speakers,
  voices, personas) syncs as those do today (`server/src/sync.js`).

## 5 · What each result records

- **Lines:** `source` already says rule / propagated / model; the model id and recipe are added to
  the line's attribution metadata, beside the existing `llm_speaker` / `llm_confidence`.
- **Direction:** the line's metadata records which model wrote it, so a later pass knows what is
  the model's and what is yours.
- **Voices and personas:** a designed-from-the-book voice keeps its description (`design_prompt`)
  and the model that wrote it in the persona's note.
- **The run:** per step, the model, the recipe, tokens in and out, seconds — the numbers the
  comparison tests need.

## 6 · The screen

Drawn first as a mock in the app (`src/pages/mock/`, the 2026-10-04 rule), screenshotted beside the
real page, then built. Its place (Overview, by the import?), its button's words, what the progress
and the "what to check" list say — **the user's to approve; nothing here is chosen.** What it must
show is fixed by §1: one start, the model each step will use (from routing), the estimated price for
a frontier route, progress per step and chapter, and afterwards the flags with a link to each.

## 7 · Tests that take minutes

- **Answer keys:** Alice VII–VIII (`server/samples/alice-in-wonderland/`: speakers, and `cues` for
  direction) and the three existing books.
- **Who speaks:** `npm run eval:attribution` (exists).
- **Direction:** an `eval:direction` beside it — the measurement already run by hand (RESEARCH
  §10.5): cue lines caught, emotion matches, lines marked with no cue; with and without the carry.
- **A run on one chapter** with a chosen model, writing its numbers — the arm for each comparison:
  local, Opus 5.5 and GPT-6.1 Sol by API, and Claude Code driving JV's routes from the terminal.
- **Ears:** a listening page for the audio slices (the other session's for voice training is the
  pattern), blind.
- **The rule from the decision:** every prompt change runs the scored tests on gemma and on one
  frontier model, on the same chapters — so neither recipe is tuned at the other's expense. Until
  there is an API key, gemma alone, and the frontier side is run when the key arrives.

## 8 · Standards — each piece

| Piece | Follows | Link |
|---|---|---|
| Each AI step (merge, voices, direction) | the kit's feature catalog, seeded prompts and routing — existing code | `server/src/feature_catalog.js`, `server/src/seed_feature_prompts.js`, `server/src/seed_presets.js`; `docs/ai-features.md` |
| JSON answers | the kit's `jsonMode`; on Claude, structured outputs (`output_config.format`) | [platform.claude.com — structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| The `recipe` preset field | the kit's engine presets and its column list | `../just-llm-runner/server/src/llm/presets_api.js:37`, `llm/db.js:32` |
| The run | JV's persistent render-job pattern on the kit's `background()` | `server/src/render_jobs.js:151, 173`; `app.js:246` |
| Voices: design → freeze → clone | the existing freeze bridge and voice routes | `api/voice_preview_api.js:637, 674`; `api/voices_api.js:324, 355` |
| Writing many lines' direction | the existing line override merge (`PATCH /v1/blocks/:id` semantics), applied in one transaction | `line_takes.js:203` |
| The carry | the attribution propagation pattern (same paragraph, same speaker) — existing code | `extraction/anchors.js` pass 2 |
| The screen | a mock in the app first, the kit's `Ui*` controls, `docs/dev/design-law.md` | CLAUDE.md, the mock rule |
| Tests | the eval script and answer-key pattern | `server/scripts/eval_attribution.js` |
| Take check: comparing a transcript with the text | **to choose in slice 6** — a widely used word-diff package, named then with its link | — |
| Claude Code plugin (later) | MCP and Claude Code skills | [modelcontextprotocol.io/specification](https://modelcontextprotocol.io/specification), [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |

**No NOT STANDARD piece in slices 0–5.** Slice 6's diff package is named when that slice is
planned.

## 9 · Blast radius — what the build touches (greps, 2026-10-11)

**The recipe field and the route choice** — every user of the size rule and of the preset row:

```
JustVioce/server/src/extraction/pipeline.js:326:export function modelSizeB(modelId) {
JustVioce/server/src/extraction/pipeline.js:370:export function autoRoute(directMinB, modelOverride = "") {
JustVioce/server/src/extraction/pipeline.js:385:export function pickRoute(routeOverride, settings, modelOverride = "") {
JustVioce/server/src/extraction/pipeline.js:654:  const pick = pickRoute(request.route, settings, request.model || "");
JustVioce/server/src/api/extraction_api.js:1154:    const floor = pipeline.pickRoute(null, settings).floor;
JustVioce/server/src/api/extraction_api.js:1297:    const [picked, checks] = pipeline.autoRoute(settings.extraction.direct_min_b);
JustVioce/src/components/lab/AttributionAutoPanel.vue:28/61  (direct_min_b)
JustVioce/src/components/StudioScript.vue:136:const autoRoute = computed(() => config.value?.auto_picked || "");
just-llm-runner/server/src/llm/presets_api.js:37:export const EnginePresetRow = T.Object({
just-llm-runner/server/src/llm/db.js:32:  ["engine_presets", "think", "BOOLEAN NOT NULL DEFAULT 0"],
just-llm-runner/server/src/llm/db_schema.js:991:    "name": "engine_presets",
just-llm-runner/server/src/llm/seed.js:922–982  (engine_presets reads/writes)
just-llm-runner/server/src/llm/preset_resolve.js:8
just-llm-runner/ui/src: CompareStrip.vue, ConfigColumn.vue, FeatureLab.vue, LuFeatureChip.vue,
  LuModelCatalog.vue, TuneMeasureModal.vue, composables/useResolvedRoute.js,
  services/aiFeature.js, services/modelApply.js, thinkingControl.js  (preset fields)
```

**Code the run reuses** — every current caller, so moving logic into a function keeps them working:

```
server/src/api/extraction_api.js:956, 1058   _persistAttribution(...)          (Analyze, Analyze stream)
server/src/api/extraction_api.js:1432, 1509  identify.identifySpeakers(...)    (Discover, the Lab door)
server/src/api/extraction_api.js:1537        ensureSpeaker(... unique: true)   (promote)
server/src/api/projects_api.js:443, 577 · speakers_api.js:131, 249           ensureSpeaker(...)
server/src/api/smart_assign_api.js:112       POST /v1/llm/smart-assign
src/components/StudioCast.vue:481, 585       its two callers (apply matches; New personas)
server/src/api/voice_preview_api.js:637, 674 POST /v1/voices/preview, …/:preview_id/save
src/components/PersonaDesignMaker.vue:154 · src/services/projects.js:175, 178  their callers
server/src/api/render_jobs_api.js:86, 91 · render_lines_api.js:129, 134     createJob/startJob
server/src/api/export_jobs_api.js:143, 175, 182  _start (export M4B, chapters zip)
server/src/api/projects_api.js:1026          lineTakes.mergeOverride (the only caller)
```

**Left as it is** — the renderer's chapter run and its users (the one-click run doesn't go
through it):

```
src/services/chapterRun.js — StudioDiscover.vue:58, StudioRunBanner.vue:22, StudioScript.vue:44,
StudioScriptChapter.vue:38, pages/StudioPage.vue:31
```

**Data written or overwritten:** lines' `speaker_id`/`source` (Analyze's own rules, `corrected`
lines skipped); lines' `direction` and `line_models` (only where empty or written by a model
before, never yours); new speakers, voices and personas (added, never replacing one you made;
a name already in the book is reused, as promote does today). Nothing is deleted.

## 10 · Slices, in order — each with how it's accepted

0. **The owed audio measurements.** (a) The same Alice lines with and without direction, on the
   same frozen voice: VoxCPM2 (written direction), Chatterbox Turbo (tags) and Qwen3 CustomVoice
   (written direction on a preset speaker), and on **dots.tts** and **FireRedTTS3** once they run
   in the app (§11 Q2) — is the difference audible, and which reads it best? (b) The Hatter's
   voice designed from gemma's description, frozen, ten of his lines — the same person
   throughout? A blind listening page. Installed engines need no app code; dots.tts and
   FireRedTTS3 each need a catalog entry and their request settings, the way VoxCPM2 went in
   (`server/src/engines/voxcpm2/manifest.js`, `engines/audiocpp/slot.js`), on what our pinned
   audio.cpp build carries. *Accepted by your ears.*
1. **The recipe setting** (kit + JV route choice). *Accepted:* gemma's Alice and the three books
   score as now; a cloud model is read as frontier.
2. **Direction** (both recipes, the carry, writing many lines at once, `eval:direction`).
   *Accepted:* on gemma, Alice VII cue lines caught ≥ 88 % with no-cue marks ≤ 5 % (today's
   measured numbers), and you hear it on Render.
3. **Voices for the cast and the narrator** (both recipes, design → freeze → persona for every
   speaker with at least N lines in the book, the narrator designed from the book's genre and
   tone, Smart-assign applied server-side for the rest). *Accepted:* Alice VII–VIII cast made in
   one call per step; you listen to each voice.
4. **Discover + merge names** across chapters, and group lines given to one member of the group
   (§11 Q7). *Accepted:* Alice VII–VIII give one Queen, no one with 0 lines becomes a speaker, and
   "No room!" goes to the Hatter or the March Hare, flagged.
5. **The run and its screen** (mock first). *Accepted:* Alice VII from one press to an M4B, the
   time and the token count written down; resumes after a restart.
6. **Check the takes** — before the comparison (§11 Q4). *Accepted:* a runaway take is
   re-rendered once and flagged.

Each slice that changes what you see or what Analyze does updates the user docs (`docs/studio.md`,
`docs/ai-features.md`) in the same change, and its facts land in RESEARCH §10.

## 11 · Questions — answered 2026-10-11

The user, on the answers below: *"yes your rec on all"* (TASKS "The one-click plan's questions,
answered"). The answers, as they now stand:

1. **Who gets a voice made from the book:** every speaker with at least **N** lines in the
   **whole book** — N a setting, default **3**; the rest are matched from the library. You can give
   anyone a voice of their own later on Cast. (On Alice VII–VIII alone, 3 lines covers every
   speaker; a whole book is what decides it.)
2. **Engines for character voices:** settled by slice 0's listening across VoxCPM2, Chatterbox
   Turbo, dots.tts and FireRedTTS3. VoxCPM2 is the pick on paper — the only one already in the app
   that clones *and* takes written direction on the clone; Turbo's seven emotion tags can't say
   sad, mournful or sulky, Alice's commonest cues; Qwen3 VoiceDesign re-makes the voice on every
   line and its cloning sibling drops direction. **FireRedTTS3** is in the listening test; whether
   it could ship (its README calls cloning "intended solely for academic research purposes") is a
   separate licence question, asked only if it wins.
3. **The narrator:** the AI designs it from the book's genre and tone; you review it on Cast.
4. **Checking takes:** built before the comparison (slice 6) — a take that runs on past its text is
   what a listener marks down first.
5. **Slice 0 first:** yes, widened as in Q2.
6. **The feature-name mismatch:** fixed in slice 4.
7. **Lines with no single speaker:** the AI gives a group line to one member of the group the text
   names ("they" = the Hatter and the March Hare → one of them), or to the narrator when it's
   unclear, and flags it.
8. **A frontier run's price:** shown before it starts, and the run asks once.

## 12 · Then: how good is it — local, frontier, and the professional tools

Confirmed by the user as part of the plan: *"we are doing this then we are comparing with
production to see how good ours is and what we can change … we just need to determine how much
better a frontier designed audiobook is agians our local and agains profression products, this is
all part of the complete plan"*.

- **What is compared:** the same Alice excerpt (chapter VII, cut to about 10 minutes so
  ElevenLabs' free tier can make it too) made five ways — JV with the local model; JV with Opus
  5.5 by API; JV with GPT-6.1 Sol by API; Claude Code driving JV's routes from the terminal (the
  free-form target of §3); ElevenLabs Studio, made by hand on its website (multi-voice tools only,
  decided 2026-10-10).
- **Scored without ears:** who speaks (the answer key), direction (the `cues`), word errors read
  back by speech recognition, ACX limits, time, clicks, and price per book.
- **Scored by ears:** a blind page — you rate each version without knowing which it is.
- **What it decides:** where we lose. If it's the decisions (who speaks, emotion, casting), the
  recipes change and the frontier recipe is tuned toward Claude Code's free-form result; if it's
  the voices, an engine audio.cpp supports is added or swapped (RESEARCH §10, the 2026-10-01 scan);
  if frontier is clearly better for a few dollars a book, the app recommends it.
- **Then:** the MCP tools and the Claude Code skill (decided second, 2026-10-10).

## 13 · What the 2026-10-11 checks and research found that bear on this plan (not decided)

Facts in RESEARCH §10.8–10.12; the ideas, unscheduled, in IDEAS (2026-10-11). Step by step:

- **Voices (step 5):** the frozen character clip should be calm — its delivery carries into every
  line (Audiobook-CC). VoxCPM2 ignores or speaks direction when the clip comes with its transcript
  (decided 2026-10-11: drop the transcript on directed lines).
- **Direction (step 6):** several engines were given direction the wrong way in slice 0 (§10.8):
  Chatterbox Multilingual got none, Turbo got undocumented tags, CosyVoice3 free prose outside its
  fixed list, IndexTTS 2.5 its experimental text mode. Slice 0's engine choice is open again until a
  round done the authors' way. Structured direction ("emotion | scene | manner") and a line split
  where its emotion changes are measured gains elsewhere (Deep Dubbing, Dopamine).
- **Take check (step 8):** automatic scores agree with people on model averages but weakly on a
  single take (§10.11) — the check can reject broken takes and rank engines; choosing between good
  takes stays with a person, or with best-of-N audited against a random pick.
- **Import (step 1):** no text normalization and no EPUB semantics today (§10.12) — numbers,
  footnotes and front matter reach the voice as written.
- **Export (step 9):** ACX refuses AI narration (§10.3); pauses and room tone could become
  settings (§10.10).
