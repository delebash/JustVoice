# 2026-08-15 — Pipeline truth + first-run speech + the Alexandria adoptions

THE EXECUTABLE PLAN. Design decisions are MADE — the implementer (Opus session)
builds from this doc without re-deriving. Research here was verified 2026-08-15
(web + code); do not re-research unless a VERIFY step says so. The user's
rulings are quoted verbatim where they exist.

**STATUS UPDATE (2026-08-15, late).** Items 12–16 were RULED (§6 is now build
items; decisions verbatim in `docs/dev/TASKS.md`). Ruling 12 is **BUILT**
(commit `bb4366b`). And a SECOND plan now exists and takes precedence for its
territory: **`docs/plans/2026-08-15-voice-workbench.md`** — the voice/persona
redesign. It ABSORBS this plan's **item 5** (its Slice B) and **item 6** (its
Slice D), and SUPERSEDES item 13's build (its Slice E) and §6-item-16's
"resolution at the point of render" surface half. Items 3–4 and 7–11 remain
this plan's own. When the user says "execute the plan" in a fresh session, the
voice-workbench plan is the one they mean unless they name this one.

Standing constraints that bind every item (from memory + CLAUDE.md, all still
in force): literal "go" per item batch · JV pushes need `gh workflow list --all`
= disabled_manually before AND after · kit changes gate ALL FOUR suites (kit
pytest via `F:/Python312/python.exe -m pytest`; JW = `../.venv/Scripts/python`
in justwrite-app/server + `npx vitest run` at repo root, branch **master**;
docgen = `server/.venv/Scripts/python -m pytest` + vitest; JV = `cd server &&
ruff check . && python -m pytest` + `npm run test:unit` + `npm run lint` +
`npm run build:vite` + the renderer smoke) · smoke recipe: server via
`JUSTVOICE_DATA_DIR=<scratch> F:/Python312/python.exe -c "import sys;
sys.argv=['justvoice-server','serve','--host','127.0.0.1','--port','8741'];
from justvoice.serve import main; main()"`, then `JV_BASE=http://127.0.0.1:8741/
node scripts/smoke.js`, kill BY PORT · never `git add -A` (stage explicit
paths — the user works in parallel) · docs land in the same change · tracker
carries decisions verbatim · no migrations (seeds-only; user resets) ·
model facts verified on the web, never recalled.

---

## §1 The web-verified model facts (2026-08-15 — the research record)

### Qwen3-TTS (Apache-2.0, released Jan 2026, 12Hz family)

| Repo | Role | Size | Cloning | Presets |
|---|---|---|---|---|
| `Qwen/Qwen3-TTS-12Hz-0.6B-Base` | voice cloning (3–10 s ref) + finetune base | 2,516,100,892 B (our verified sum) | YES | 0 |
| `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | same, larger | 4,544,170,364 B | YES | 0 |
| `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | 9 preset speakers + natural-language style/emotion instruct over those timbres | 2,498,383,610 B | **NO** (HF card explicit: only Base clones) | 9 |
| `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | same, larger | 4,520,159,586 B | **NO** | 9 |
| `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` | NEW voice from a text description (age/accent/pitch/emotion); takes NO reference audio; 1.7B only | UNVERIFIED — verify via HF API tree | NO | 0 |

- Languages, ALL variants, exactly **10**: `zh, en, ja, ko, de, fr, ru, pt, es, it`.
  (Our manifest's 17 was fiction — ar/tr/nl/pl/vi/th/id unsupported, and it's
  `pt` not `pt-BR`.)
- The 9 CustomVoice speakers (our STATIC list already matches): Vivian, Serena,
  Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee.
- Community/marketing quality claims (Qwen "superior likeness", "best on
  zh/ja/ko") are UNMEASURED — never state them as facts in UI; the approved
  phrasing is "reported strongest on Chinese/Japanese/Korean".

### Chatterbox (ResembleAI, all MIT)

- Family: original `chatterbox`, **Multilingual — now V3** (same 0.5B; improved
  speaker similarity, fewer hallucinations; 23 langs: ar, da, de, el, en, es,
  fi, fr, he, hi, it, ja, ko, ms, nl, no, pl, pt, ru, sv, sw, tr, zh), and
  `chatterbox-turbo` (350M, **English-only confirmed**, paralinguistic inline
  tags `[laugh] [sigh] [chuckle]`, lower latency).
- Our catalog pins Multilingual **v2** (`t3_mtl23ls_v2.safetensors`, variant id
  `chatterbox-multilingual-v2`, repo `ResembleAI/chatterbox`, pinned load set
  3,208,951,748 B). Turbo pinned set 2,987,680,596 B (9 files; the repo's
  1,056 MB `s3gen.safetensors` is deliberately NOT in Turbo's set).
- Coverage fact that decided the setup branch: **Multilingual covers zh/ja/ko**;
  the Qwen-for-Asian idea was quality-claim-driven, not coverage-driven.

### Verify method for any file list (the ②c method — reuse, don't invent)

`https://huggingface.co/api/models/{repo}/tree/main?recursive=true` with the
kit's `hf_download_headers()`; take path+size+oid; a variant's `size_bytes` =
sum of its pinned `files`. Kit door: `llm_runner.runner.models.select_repo_files`.

---

## §2 The Alexandria research record (github.com/Finrandojin/alexandria-audiobook + local screenshots E:\Dev\Web\alexandria)

Qwen3-TTS-only pipeline app, five steps (Setup → Script → Voices → Editor →
Result) + Designer/Preparer/Dataset/Training. What we adopt is listed per item
below; the raw facts:

- **Review pass**: second LLM pass over the annotated script; corrects: strips
  attribution tags embedded in dialogue · splits misattributed
  narration/dialogue · merges over-split narrator entries · validates instruct
  fields. "Contextual Review (±N)" reviews each dialog with N entries before and
  after, batched, with a cost estimate shown before running. Prompts live in
  editable files (`review_prompts.txt`, system/user split by `---SEPARATOR---`).
- **Script JSON shape**: `[{"speaker","text","instruct"}]` — the annotation LLM
  writes a per-line voice direction (e.g. `"Quiet, tense narration."`).
- **Per-speaker voice row** (their Voices step): voice-type radio (Custom /
  Built-in / Voice Clone / LoRA / Voice Design) with type-specific inline
  controls · "Alias of" dropdown (map speaker variants to one canonical) ·
  persistent character-style line appended to every instruct · inline preview
  playing that speaker's OWN script line.
- **"Generate Personas"** = one-click auto-cast: analyzes each detected
  speaker's dialogue, designs a fitting voice (VoiceDesign), assigns it. NOT
  the script pass.
- **Voice Designer**: description + sample text → preview → saved; saved
  designs usable as clone sources.
- **Training**: dataset ZIP (24 kHz mono WAVs + metadata.jsonl with
  audio_filepath+text) or a Dataset Builder with per-sample generate / preview /
  regenerate; knobs: epochs, LR (5e-6), batch, LoRA rank 32 / alpha 128,
  grad-accum 8, language; a "How Settings Affect LoRA Voice Quality"
  collapsible; **Trained Adapters table**: name, dataset, epochs, FINAL LOSS,
  sample count, per-adapter Download.
- **Pauses**: speaker-change 500 ms, same-speaker 250 ms (settings).
- **Exports**: MP3 · chaptered M4B (auto chapter markers) · per-speaker WAV
  tracks with Audacity auto-import labels.
- **Throughput** (unverified claim): 3–6× realtime via same-speaker grouping
  (≤500 chars), length-sorted sub-batches, optional torch.compile.
- GUI patterns adopted: inline per-row editing; visible per-operation log panes;
  numbered-step readiness; inline collapsible explainers.

---

## §3 The code seams (verified 2026-08-15 — trust these, re-grep only if a line moved)

- **Demo-activation bug**: `src/views/ProjectsView.vue` — `onCreateDemo`
  (~:410-425) ends at `selectedId.value = r.project_id` and never activates;
  `onCreateProject` (~:398-408) calls
  `landInHomeBase(projects.value.find(p => p.id === created.id))` (:405).
  `landInHomeBase` :323 → `activeProject.open(rec)` :330.
- **AI offer**: `src/App.vue` — `maybeOfferAiSetup` :181-196 (pref
  `aiOfferShown` via kit `readPref/writePref`, server-backed `/v1/prefs`;
  silently marks seen when `currentDefaultProviderId` exists); trigger = `watch
  (() => activeProject.id)` :206-208 (first project open/create);
  `<AiSetupOffer>` rendered ~:617-621, events `@quick-setup` →
  `/ai?quicksetup=1`, `@connect-provider` → `/ai?providers=online`.
  Kit component: `just-llm-runner/ui/src/components/AiSetupOffer.vue`.
- **First-run wizard**: server flag `settings.app.onboarding_shown`;
  `src/stores/onboarding.js`; `App.vue resolveInitialTab` (fires once,
  `initialTabResolved=false` seed; fixed 2026-08-15, commit `36f12c7`);
  "Run welcome again" wired via `@reset-onboarding` on the router-view
  `<component>` (comment must stay OUTSIDE `<KeepAlive>` — it counts children).
- **GenerateView** (`src/views/GenerateView.vue`): voice select disabled when
  `availableVoices.length===0` (:709); ▶ disabled `busy || !voice` (:749);
  no-engine banner :763; `availableVoices` filters `voices` by
  `currentEngine.id` (:50-53) — null engine ⇒ everything inert. Compose =
  `composeLine`; Rewrite = plan Q3/LD3 preview-accept; history =
  `/v1/takes/recent`. Capability lookup prefers `current_variant_id` with
  "-"-suffix walk.
- **Auto-load precedent**: `server/justvoice/api/captures_api.py
  _stt_transcribe` (:48-66) — stt slot empty + whisper `installed` ⇒
  `mgr.load("whisper", device="auto", variant=settings.captures.stt_model)`.
  This is the pattern for TTS ensure-load.
- **Voices preview**: `src/views/VoicesView.vue previewVoice` (:265-280),
  backend LRU-cached, CANNED text.
- **Studio** (`src/views/StudioView.vue`): `tab` ref :60; step keys :265-266 —
  game `[cast,render,export]`, else `[cast,script,render,export]`; cast rows
  ARE personas — `projectPersonas` → `narratorPersona` (castRoles map :370 or
  name-match) → `characterPersonas` :377-379; `selectedCharacter` is a persona;
  per-block right-click Rewrite :108-115; `renderScene` sends
  `{scene_id, preset_id}` and NO master field (~:779-782); the ACX pill
  :841-846 + :1430 claims "Applied on render" — false today.
- **Persona = the one entity**: `server/justvoice/database/models.py` ~:61-64 —
  Profile-kill Slice 4, locked decision #1: VoiceProfile deleted; Persona
  carries `voice_id + delivery + effects + personality + lexicon`;
  `PersonaChannel` for output routing; blocks/takes carry `persona_id` FKs.
- **Render truth gaps** (tracker-verified): `apply_effects_chain` only at
  `generate_api.py:276,296,371,388`; `render_core.py` has ZERO effects code;
  mastering assigned only at audiobook import (`projects_api.py:643`);
  `render_chapter_api.py:259` returns raw WAV; render cache is hash-keyed
  (`/v1/cache/clear` honors scope+age only).
- **Train**: `src/views/TrainView.vue` (460 lines) — name / base engine / base
  voice / method / steps-epochs / SNR threshold / samples `[{file,transcript}]`;
  lede: finished jobs land in the voice library. Labs tabs: Compare · Train ·
  Render · Audio (`LabsView` :25-31).
- **Stories**: `src/views/StoriesView.vue:3` — "placeholder for the multi-track
  timeline editor".
- **Speech catalog wire** (built 2026-08-14): variant rows carry
  `voice_cloning / preset_voices / weights_license / hf_repo / url / size_mb /
  on_disk / local_dir / languages`; manifests' `VARIANTS` are facts-only with
  pinned `sources[{hf_repo,revision,size_bytes,files}]`;
  `model_catalog.models_for/sources_for/default_variant_for`; downloads via
  `spawn_prefetch` (job channel) / `installer.fetch_url_variant` (load door);
  speech cache = `<data>/speech-cache/<engine>/<variant>/` + files.json.
  Catalog UI verbs: Download (N GB) → Load model; ⋯ menu Re-download / Open
  folder / View on HF / Delete. `cpu_adequate` puts kokoro on CPU (books no
  VRAM on discrete). Kokoro: 54 static voices, 333 MB, 8 langs.
- **Qwen manifest defects to fix** (`server/justvoice/engines/qwen3/manifest.py`):
  `_QWEN_LANGS` (:67-70) = 17 langs — wrong; `_qwen_variant()` (:72-80)
  hardcodes `"voice_cloning": True` for every variant — wrong for CustomVoice;
  CV descriptions claim "+ cloning. Full feature set." — wrong; comment :57
  "CustomVoice = … + cloning" — wrong; `DEFAULT_VARIANT_ID = "qwen3-cv-1.7b"`;
  `_QWEN_FILES` = the 11-file lean set (verified for Base/CV; do NOT assume it
  for VoiceDesign).

---

## §4 The rulings (user, verbatim, 2026-08-15)

- Generate tab: **"i aggree with A dissolbe it your rec on it"** (A = dissolve;
  audition → Voices, knobs → persona params, rewrite/compose stay in Studio,
  dictation → Captures/MCP).
- Sample playback at setup end: **"3 no"** (no autoplay/sample line).
- Kokoro-first as universal: **"accepted rule 1 is wrong kokoro does not do
  cloning"** → goal-first lanes; Kokoro is ONLY the ready-made default.
- Cloning-lane no-GPU copy must not point at Kokoro as a cloning fix
  (**"kokoro doesnt do cloning"**).
- Language branch over two-cards: **"But yeah language branch might be better"**.
- Personas stay the reusable entity: **"i think i like havibng it as a persona
  for reuse as a saved persona"** — the Cast card is INLINE PERSONA EDITING,
  never a new entity.
- Don't protect existing code from critique: **"dont take easy way out just
  becuase we have something coded"** — hence items 12–16 exist as open rulings.
- Alexandria: adopt features AND GUI patterns where better (logs: "logs ok").

---

## §5 THE BUILD ITEMS

Each item: scope → files → exact behavior → gates → docs. Build in order.
Items are individually go-gated batches; 0–2 are one batch ("truth"), 3–6 the
second ("first run"), 7–11 the third ("pipeline") unless the user re-slices.

> **STATUS 2026-08-15 (read this first): items 0, 1 and 2 are BUILT and
> PUSHED** — JV `97a0282` (catalog + render truth) and `bc1e13c` (the docs
> pass it exposed). **Resume at item 3.** What the build changed relative to
> the specs below is recorded inside items 1 and 2; the tracker's "next build"
> entry carries the same decisions. Facts a later item now depends on:
>
> - `mastering.resolve_master_target()` is THE master-target door (request →
>   render preset's `master` → project → kind default); `master_to_wav()` runs
>   the preset's processing with WAV out; `GET /v1/render/master-target` feeds
>   the Studio pill; `render_chapter_api._scene_master_target` /
>   `_master_scene_pcm` are the internal seams. Scene renders return WAV;
>   direct mode (`lines[]`) is unchanged.
> - `render_line`/`probe_line_cached` take `effects` and hash it into the
>   cache key, so **every pre-existing cache entry is cold** — the first
>   render after this is a full re-render, by design.
> - `ChapterLine.effects` carries the resolved chain; `_resolve_scene_to_lines`
>   fills it; `collect_project_line_kwargs` and `export_voicelines` pass it.
> - qwen3's `voice_design` capability is now **False** in three places
>   (manifest CAPABILITIES, `engine.py` meta, `capability_details.py`) —
>   **item 9 must flip all three back** when the VoiceDesign checkpoint ships.
> - Chatterbox Multilingual **V3 is blocked on upstream**: PyPI's latest is
>   0.1.7 (our pin) and its `from_local` hardcodes the v2 filename. Conditions
>   for revisiting are in `chatterbox/manifest.py`.
> - **The global audio player no longer exists** (deleted in `afd2185`).
>   Playback is inline, class `.jv-audio-inline`. Item 5's "reuse the preview
>   player plumbing" and any item that plays audio must wire the inline
>   element, NOT `audioPlayer.play(...)`.
> - The parallel session also landed: the one-strip memory console (kit
>   `d063ff9` + JV `2abfd93`, feed at `src/services/vramFeed.js`, kit props
>   `hwCells` / `llmClaim`), one save door + `openPath` (`e307227`), and
>   `legacy_files_engine_visible()` as THE legacy on-disk probe.

### Item 0 — this doc + tracker (DONE when committed)

Tracker entry in `docs/dev/TASKS.md` under "The next build" pointing here with
the §4 rulings verbatim. This plan doc is THE resume surface post-compact.

### Item 1 — Catalog truth — ✅ BUILT (JV `97a0282`)

Shipped as specced, plus three things the spec did not anticipate:
**(a)** qwen3's `voice_design: True` was fiction in three files and is now
False everywhere (item 9 flips it back). **(b)** The engine now REFUSES a
reference clip on a CustomVoice checkpoint instead of calling
`generate_voice_clone` on weights that cannot honour it. **(c)** **Dia** was
found claiming cloning its adapter never wired — `dia/engine.py synth()`
never reads `req.audio_prompt_path`, so cloned voices rendered in the stock
voice silently; flags corrected and a structural test now fails any engine
that claims cloning without reading the clip. Step 4's decision tree
resolved to "do not ship V3" (see the STATUS block). Tests live in
`test_variant_wiring.py`; docs in `engines.md` + `voices.md`.

### Item 1 (original spec, for reference) — Qwen flags/langs + Multilingual V3 + engines.md

**Files**: `server/justvoice/engines/qwen3/manifest.py`,
`server/justvoice/engines/chatterbox/manifest.py`, `docs/engines.md`,
`server/justvoice/engines/capability_details.py` (check only), tests.

1. `_QWEN_LANGS = ["zh","en","ja","ko","de","fr","ru","pt","es","it"]`.
2. `_qwen_variant(...)` gains an explicit `cloning: bool` parameter;
   CV rows pass False, Base rows True. CV descriptions: 1.7B → "9 premium
   preset speakers with natural-language style/emotion control. No voice
   cloning — the Base variant clones."; 0.6B → same + "lower quality ceiling,
   ~3× faster." Base descriptions keep clone-only wording. Fix the :57 comment.
3. Do NOT add VoiceDesign here — it ships with item 9 (needs engine-side
   design support to be honest). Note this in the commit message.
4. **Multilingual V3 — decision tree** (execute, don't ask):
   a. Fetch `ResembleAI/chatterbox` tree (§1 method). Find the V3 weight file
      (expect a `t3_mtl23ls_v3*.safetensors`-shaped name — VERIFY, never
      guess). b. Check whether pinned `chatterbox-tts==0.1.7` can load V3
      (PyPI release notes / repo tags; the multilingual loader's
      allow_patterns name the t3 file). c. If 0.1.7 loads V3 → new variant row
      `chatterbox-multilingual-v3` with verified files+sum, becomes
      `DEFAULT_VARIANT_ID`; keep the v2 row (on-disk installs stay honest).
      If it needs a lib bump → bump `chatterbox-tts` pin in INSTALL only if a
      released version supports V3 AND the CPU-torch-load patch in
      `engines/chatterbox/engine.py _construct()` still applies (read the new
      version's source); otherwise RECORD "V3 blocked on upstream lib" in the
      tracker and ship only 1–3. Never ship an unloadable default.
5. `docs/engines.md`: Qwen row languages 17→10 + CustomVoice/Base/VoiceDesign
   wording; Multilingual row per outcome of (4).
6. Tests: extend `server/tests/test_variant_wiring.py` pins — assert
   `voice_cloning is False` for both CV ids, True for both Base ids; languages
   == the 10-list. Full JV gate + smoke.

### Item 2 — Render truth — ✅ BUILT (JV `97a0282`, docs `bc1e13c`)

Shipped, with these decisions taken against the spec below:
**(1)** The spec's "move `apply_effects_chain` if it lives in generate_api"
was moot — it already lived in `audio/effects.py`; so did
`effects_chain_hash` and `CacheKeyBuilder.with_effects_chain`, both
documented as being in the cache key and both uncalled. Wiring, not
building. **(2)** Mastering resolution gained a level the spec missed: the
**render preset's own `master` field**, stored and never read. Order is
request → preset → project → kind. **(3)** `"none"`, not null, is the
explicit "raw" signal — omitting `master` in scene mode now means "server
decides". **(4)** Scene renders return **WAV with the processing applied**
(the encoded deliverable stays with Export, so the .m4b carries one lossy
generation); direct mode is byte-identical. **(5)** Missing ffmpeg degrades
to a raw render that says so, never a failure. **(6)** The pill reads a new
`GET /v1/render/master-target` rather than the response header, because the
pill must be truthful *before* a render happens. **(7)** Effects were also
wired into the game voiceline export. Tests: `test_render_truth.py` (21).
Docs went far past `studio.md` — see `bc1e13c` and the tracker's DOCS PASS
line for what else was untrue.

### Item 2 (original spec, for reference) — effects + mastering + cache key + QC

**Files**: `server/justvoice/render_core.py`,
`server/justvoice/api/render_chapter_api.py`, `server/justvoice/mastering.py`
(read), wherever `apply_effects_chain` lives (grep; it's called from
`generate_api.py:276…`), `src/views/StudioView.vue`, `server/tests/` new file,
`docs/studio.md`, `docs/engines.md` untouched, `docs/chapter.md` NOT rewritten
here (tracker says it waits on this item — update the tracker note to
"unblocked").

1. **Effects**: in the render path (render_core's per-block synth), after synth
   and before concat, apply the block's persona `effects_chain` through the
   SAME function the single-line path uses (import from its current home; if
   it lives in `generate_api.py`, move it to `server/justvoice/audio/effects.py`
   and repoint both callers — one implementation).
2. **Cache key**: find render_core's cache-key builder; fold in a stable hash
   of the persona's effects_chain JSON (sorted-keys dump → sha1 → first 12
   hex) per block, so editing a chain invalidates exactly its blocks.
3. **Mastering**: per-kind defaults map — audiobook→`acx`,
   podcast→`podcast`, game→none, text→none (the presets already exist in
   `settings.mastering`; game/text deliberately raw). `renderScene` /
   render_chapter request gains `master: <preset-id|null>` defaulting
   server-side from the project's kind (project.mastering already set for
   audiobook imports at `projects_api.py:643` — read project first, kind
   default second, explicit request field wins). Apply mastering post-concat
   per scene/chapter output.
4. **QC over mastered**: the ACX QC column must measure the mastered file —
   find where the QC numbers come from (StudioView render tab / server
   response) and ensure they're computed on the post-master WAV.
5. **UI honesty**: the Studio pill (:841-846) reads the preset the server
   actually applied (from the render response) — never a hardcoded claim.
6. Tests: new `server/tests/test_render_truth.py` — (a) a chain-bearing
   persona's chapter render differs from no-chain render (bytes differ, both
   cached separately); (b) editing the chain re-renders (cache miss); (c)
   audiobook-kind render is mastered (loudness within target window — use the
   mastering module's own measure), game-kind is raw; (d) explicit
   `master: null` yields raw.
7. `docs/studio.md` Render section rewritten to the real behavior.

### Item 3 — Demo activation (one line + pin)

`onCreateDemo` gains `landInHomeBase(projects.value.find(p => p.id ===
r.project_id));` after `refresh()`. Vitest pin if a harness exists for
ProjectsView; otherwise verified in the item-4 offer test flow. Gate: JV
renderer set.

### Item 4 — Setup lanes (kit slot + JV speech lane + dictation entry)

**Kit** (`ui/src/components/AiSetupOffer.vue`): add ONE optional slot
`extra-lanes`, rendered as a second card region under the existing content;
when the slot is present the offer's shell widens to a two-card layout
(reuse its existing classes; no new CSS system). JW/docgen pass nothing —
byte-identical for them. Gate: kit + JW vitest 578 + docgen vitest + JV.

**JV** — new `src/components/SpeechSetupLane.vue`, mounted into the slot from
`App.vue`. Content (exact copy, use verbatim):

- Title: **"Voice"** · lede: "Whose voice reads your work?"
- Three choices (buttons/cards):
  1. **"Ready-made voices"** — sub: "54 voices · 333 MB · runs on your
     processor — no graphics card needed, and it never competes with your AI
     model for memory." Action: kokoro download via
     `makeEngineDownloadTask(api, "kokoro", { model_variant: <default variant
     id from /v1/engines/kokoro/models default resolution> })` rendered in a
     kit `DownloadBar` inside the lane; on done → `POST /v1/engines/kokoro/load
     {device:"auto"}`; end state text: "Kokoro is ready — pick any voice in
     Voices." NO sample playback (ruling).
  2. **"Clone a voice"** — sub: "Yours, or a character's — from a short clean
     sample." One select: "What language will you narrate in?" listing
     Multilingual's 23 + a "something else" row. Resolution: `en` →
     chatterbox Turbo variant; any other of the 23 → the chatterbox
     multilingual default variant; vi/th/id or "something else" → honest text:
     "No cloning engine covers this language yet — Chatterbox Multilingual
     (23 languages) is the closest." with the pick left to the user. Below the
     resolved pick, one guidance line when the language ∈ {zh,ja,ko}:
     "Qwen3-TTS Base is reported strongest on Chinese/Japanese/Korean — 
     [choose it instead →]" linking `/ai?tab=speech-engines`. GPU copy:
     "Runs on your graphics card, sharing it with your AI model — JustVoice
     loads whichever is working and frees it when idle." If `system has no
     GPU` (read the kit hardware strip's source — `/v1/llm-runner/hardware`
     gpus empty): replace with "No graphics card detected — cloning will run
     slowly on your processor. You can still set it up, or start with
     ready-made voices and add cloning later." Action: **Download only** (the
     job-channel prefetch; no load), then: "Downloaded. When you have a 10
     second – 2 minute clean sample, go to Voices → Clone." linking `#voices`.
  3. **"Skip for now"** — closes the lane half only.
- Seen semantics: the EXISTING `aiOfferShown` pref keeps gating the whole
  offer exactly as today (close = seen once ever); the lane needs no second
  flag — completion is visible on disk.
- **Dictation entry**: find the kind picker's "set up dictation" link
  (grep `set up dictation` in `src/`); route it to open the offer with the
  speech lane in dictation mode: downloads **whisper** default variant +
  kokoro (two DownloadBars), then routes `#captures`. Copy: "Dictation needs
  ears and a voice — Whisper transcribes, Kokoro reads back."
- **Home banner**: the "Load your first engine" banner (HomeView) becomes a
  pointer that opens this same lane (or `#voices` once kokoro is on disk).
- Tests: vitest — lane resolution mapping (en→turbo id, de→multilingual id,
  vi→no-coverage text, zh guidance line present); offer fires after demo
  create (item 3 proven here); no-GPU copy branch. Renderer smoke + a headless
  drive of the offer on a fresh data dir (the smoke's first-run dialog
  dismissal already exists — extend the check script pattern from
  scripts/smoke.js's FIRST-RUN block).

### Item 5 — Voices audition-with-own-text + TTS ensure-load

**Server**: extend the existing voice-preview endpoint (find via VoicesView
`previewVoice` — it hits a preview route with LRU cache): accept optional
`text` (POST body or query, cap at `limits.text_max_chars` floor 300 chars for
preview), cache key = (voice id, sha1(text)). Inside the synth path for
preview AND `/v1/generate`: **ensure-load** — if the voice's engine isn't the
loaded TTS engine: `mgr.load(voice.engine, device="auto")` first (mirror
`captures_api._stt_transcribe` :48-66 exactly, including the honest
`bad_request` when the engine isn't installed: "…is not installed — set it up
on the Speech engines tab"). The measured-admission machinery (2026-08-14)
makes this safe; no VRAM checks here.

**Renderer** (`VoicesView.vue`): each voice card gains a collapsible "Try it
with your own words" — one text input (placeholder: the canned preview line)
+ ▶ reusing the preview player plumbing; busy state per card; errors toast.

Tests: server — preview with text caches per (voice,text); ensure-load fires
when tts slot empty (monkeypatched manager records the load call); not-
installed → 400 with the message. Full JV gate + smoke.

### Item 6 — Generate dissolution (after 5 is live)

1. Delete `src/views/GenerateView.vue`; route `/generate` → redirect
   `/voices` (router/index.js — keep a redirect, old deep links exist);
   remove the VIEWS sidebar entry (App.vue VIEWS array) + any `visibleFor`
   references; grep `#generate` links across `src/` and `docs/` and repoint
   (Home cards, use-case docs).
2. Knob home: delivery knobs live on the persona (VoiceParamsModal) — no new
   surface. The AI-console Lab keeps engine capability experimentation.
3. Docs: `docs/generate.md` deleted; its dictation/game/podcast use-case
   pointers move to `docs/voices.md` (audition) / `docs/dictation.md` /
   `docs/take-versioning.md`; sweep `docs/` for generate.md links (grep).
   Receipted sweep per removed-means-removed: zero references to the view,
   route name "generate" (the FEATURE "generate" in the AI catalog is a
   different thing — `feature: "generate"` in withAiTask usages elsewhere must
   NOT be touched; the sweep target is the VIEW/route/tab only).
4. `/v1/generate` API stays (MCP + preview + future surfaces use it).
5. Gates: vitest + biome + build + smoke (smoke's TABS list in
   `scripts/smoke.js` drops GENERATE).

### Item 7 — Script step: review pass + per-line instruct

**Shared-stack law**: both are feature rows through `install_llm` seeds — no
app-local run plumbing (the drop-in memory).

1. **Data**: blocks gain nullable `instruct` (String) — seeds-only schema
   change (no migration; user resets). Takes record the instruct they rendered
   with (nullable column on the generation/take row) for provenance.
2. **Feature rows** (JV `seed_feature_prompts.py` + `feature_catalog.py` +
   preset wiring in `seed_presets.py`): 
   - `script_review` — system prompt implementing the four corrections
     (strip attribution tags embedded in dialogue text; split rows that mix
     narration+dialogue; merge consecutive narrator rows that were over-split;
     validate/normalize instruct fields), JSON-in/JSON-out over a window of
     rows; assigned preset `p_extract`.
   - `line_instruct` — writes a one-line delivery direction per block from
     the surrounding context (their `"instruct"` idea); preset `p_extract`.
3. **Server**: extend the attribution area API (`extraction`/attribution
   modules) with a review run: batches of the chapter's blocks with ±N context
   (N default 4, from the request), cost estimate first (row count → call
   count, reuse the Lab's estimate pattern if present; otherwise calls =
   ceil(rows/batch)), applies corrections by writing blocks (speaker changes
   land as `corrected` in the Decided-by provenance — the existing chip
   vocabulary in docs/studio.md).
4. **Studio UI**: Script tab gains two affordances under Analyze: "Review
   script (optional) — fixes misattributions" with the ±N stepper and the
   estimate line before confirm; "Write delivery directions" (the instruct
   pass) similarly. Per-row: instruct renders as an editable inline field
   (empty = none). Render consumes it: instruct-capable engines
   (capability_details `supports_instruct_freeform`) get it verbatim in the
   synth request's instruct field; others ignore (no knob-mapping in v1 —
   RECORDED simplification).
5. Tests: server — review pass corrects a fixture chapter (tag-in-dialogue
   stripped; over-split narrator merged; corrections marked `corrected`);
   instruct pass writes fields; render passes instruct through to the engine
   request for a capable engine (fake engine records it). Docs: studio.md
   Script section + ai-features.md rows.

### Item 8 — The Cast card (inline persona editing + acquisition + alias)

**No new entity** — the card edits personas (§3: cast rows ARE personas).

1. Replace the Cast row's modal-first flow with inline fields: voice picker
   (from the voice library, grouped by engine) · the persona's personality as
   a one-line editable "style" input (full editor still in Personas) · ▶
   preview: once the chapter has analysis, preview the character's FIRST
   attributed line via the item-5 preview-with-text endpoint (their own words);
   before analysis, the stock line (today's behavior).
2. **Acquisition axis** on the voice slot — a small split-button:
   "Pick from library" (default) · "Clone…" (routes `#voices` clone flow with
   returnTo=studio) · "Design…" (DISABLED with tooltip "coming with
   VoiceDesign" until item 9) · "Train…" (routes Labs→Train prefilled with the
   persona name until ruling 13 moves Train).
3. **Alias-of**: per row, "Alias of…" select listing the project's other
   personas; choosing MARIUS for row "OLD MAN": re-point every block with the
   alias persona_id → target persona_id (server endpoint: POST
   `/v1/projects/{id}/personas/{alias}/merge-into/{target}` — moves blocks,
   deletes or keeps the alias persona per a `keep` flag default delete),
   confirm dialog quoting the block count.
4. Works for the game kind (cast+render only — same card, no script preview).
5. Tests: merge endpoint (blocks re-pointed, counts right, idempotent);
   vitest for the card's own-line preview source selection. Docs: studio.md
   Cast section rewrite.

### Item 9 — VoiceDesign: catalog row + Designer flow + Smart-assign auto-cast

1. **Catalog**: add `qwen3-vd-1.7b` variant row (repo
   `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`) with §1-method-verified files+sum;
   `voice_cloning: False, preset_voices: 0`; description: "Designs a brand-new
   voice from a text description — no reference audio. 1.7B only."
2. **Engine**: qwen3 `engine.py` gains the design mode (the upstream lib's
   design generate call — VERIFY the qwen-tts python API for the VoiceDesign
   checkpoint before writing; if the pinned `qwen-tts` lib lacks it, bump per
   the item-1 decision-tree pattern). Server: POST
   `/v1/voices/design {description, sample_text, name}` → ensure-load the VD
   variant → generate reference audio → save as a LIBRARY VOICE whose source
   is the generated reference (usable as a clone source everywhere —
   Alexandria's shape), LRU the preview.
3. **Voices UI**: "Design a voice" card — description + sample text +
   Generate preview + Save (their Designer, in our Voices).
4. **Smart-assign auto-cast**: Smart-assign gains a checkbox "design voices
   for unmatched characters" — for each character the LLM can't match to the
   library, a second feature row (`voice_design_brief`: dialogue excerpts →
   one-line voice description) feeds `/v1/voices/design`, and the new voice is
   assigned. Cost estimate before running (design renders are slow).
5. Cast card's "Design…" enables. Tests: design endpoint happy-path with a
   faked engine; auto-cast assigns designed voices only to unmatched. Docs:
   voices.md + studio.md + engines.md (VoiceDesign row).

### Item 10 — Pauses group

Settings `generation` (or `mastering`? — DECIDED: `generation`) gains
`pause_speaker_change_ms` (default 500), `pause_same_speaker_ms` (250),
`pause_scene_break_ms` (700). Render concat inserts them (render_core, at
block joins: compare consecutive blocks' persona_id; scene breaks come from
the scene boundary). The importer keeps `* * *` glyphs as display; the
boundary drives the pause (absorbs the tracker's scene-break item — close it
pointing here). Settings UI: Settings → Generation three number fields.
Tests: concat timing (durations grow by the configured silences). Docs:
settings-reference + studio.md.

### Item 11 — Step readiness cues

Studio step headers get honest counts: Cast "N of M voiced" (personas with
voice_id / total), Script "N of M chapters analyzed" (exists — extend the
same source), Render "N of M lines rendered" (takes present / blocks).
HomeView's next-step card points at the first incomplete step of the active
project. No new endpoints if the data is already client-side; else one cheap
summary endpoint. Vitest for the counters' arithmetic.

---

## §6 RULINGS 12–16 — DECIDED 2026-08-15, now build items

All five were ruled in one exchange: *"12 your rec, 13 your rec, 14, your rec,
15 what do you think and is stories only for podcast? 16 your rec"* → *"ok you
rec add this to ideas so we can design the proper timeline"* (15) → *"your rec
for the others go and code"* (12, 13, 14, 16). The decision text lives verbatim
in `docs/dev/TASKS.md`; the builds are specced here.

### Item 12 — Studio's steps follow the data: Script first for prose kinds

WHY (the argument that won): the Script step *creates* the cast.
`runDiscoverSpeakers` (`StudioView.vue:1303-1330`) finds speakers the manuscript
names, `promoteDiscovered` (`:1336-1351`) POSTs them to
`/v1/projects/{id}/personas/promote`, which creates the personas AND links them
to the project. Cast-first therefore opens a cast holding only the auto-created
Narrator, sends you to Script to populate it, and back again. Game projects have
no Script step at all — their lines arrive with characters attached.

BUILD:
1. `StudioView.vue:263` — prose key order becomes
   `["script", "cast", "render", "export"]`; the game branch is untouched.
   Numbering is derived (`:265` `${i + 1} · ${names[key]}`), so it follows.
2. Whatever seeds `tab` on first open must land on the FIRST visible step, not
   the literal `"cast"` — check the Script-tab restore (`docs/plans/
   2026-08-08-script-tab-restore.md`) still restores a remembered tab and only
   the DEFAULT moves.
3. Copy that names the order: `App.vue:40` Studio lede ("Cast → Script →
   Render production environment"), `docs/studio.md`, and any journey doc that
   numbers the steps. Grep `Cast → Script` across `docs/` and `src/`.
4. Tests: a vitest pin that prose kinds start at `script` and game at `cast`;
   renderer smoke.
NOT: a signpost from Cast's empty state into Script — rejected as an admission
the rooms are ordered wrong.

### Item 13 — Train is the way you make a voice, not a lab

WHY: `VoicesView` already owns four acquisition paths — clone, design, import,
blend (`modal` at `:371`, dispatched by `openModal` `:466`, entries at `:748`,
`:753-755`, and the "Other ways to add a voice" fold `:766-769`). Training
produces a voice too, so it belongs with them; Labs keeps the benches (Compare
/ Render lab / Audio, `LabsView.vue:23-40`).

BUILD:
1. `LabsView.vue` — drop the `train` entry from `SUBS`; Labs is three tabs.
2. `VoicesView` — the "Other ways to add a voice" fold gains **"Train from
   samples"**, and its summary line names it. Entry opens the training surface.
3. The training surface itself: `TrainView.vue` (460 lines — name, base engine,
   base voice, method, steps/epochs, SNR threshold, samples) is REUSED as a
   component on a **Voices-owned surface, not a modal** — your ruling
   2026-08-15, *"roomier layout"*: the samples table and the job list need the
   room, and a modal would squeeze both. It must not hand-roll a page header
   (LabsView supplied the lede; the host surface supplies the title).
   ON HOLD — *"dont do those yet"* (2026-08-15), pending the voice-management
   redesign this ruling turns out to be part of.
4. Redirects: anything routing to `#labs?tab=train` — including item 8's
   "Train…" button when that lands — points at Voices instead.
5. Docs: `docs/voices.md` gains training as an acquisition method; whatever
   documents Labs loses the Train tab. `docs/toc.json` if a page moves.
6. Tests: vitest that Labs exposes three subs and none is `train`; smoke.
NOT: moving the tab wholesale into the sidebar — you should meet training when
you want a voice, not as a destination.

### Item 14 — REJECTED as posed; the real seam is Chapters ↔ Lines

Lines is not a render surface. `LinesView.vue` is the game project's structure
view: line id · character · text · derived take status (none/rendered/stale),
grouped by scene, with a CSV re-import that merges the writers' next sheet by
line id so only changed lines go stale, and a bulk "↻ Re-render N changed"
(`:218-225`). Folding it into Studio's Render step would destroy the re-import
workflow to save a tab.

The duplication worth examining is **Chapters ↔ Lines** — two structure views
answering one question ("this project's units of speech, their take status, how
to render one") for different kinds, one a per-block editor with take history,
the other a bulk status grid. That is a DESIGN PASS, not a build: compare the
two surfaces feature by feature, decide whether one view with kind-driven
columns replaces both, and settle it together with the tracker's open item
"Script tab: two project kinds can never finish a chapter". **No go, no code.**

### Item 15 — Stories retracted; the real timeline is designed in IDEAS

Ruled 2026-08-15. The full design — what it does, what it looks like, that it
is **podcast-only for v1** (game excluded: the deliverable is per-line WAVs a
game engine triggers, not an assembled programme; audiobook excluded: pacing
belongs to the Pauses group, item 10) — is written at the top of
`docs/dev/IDEAS.md`, with the four open questions it still needs answered.

Two code facts forced it: `story_items` (`database/models.py:396-412`) points at
`generations`/`generation_versions` and carries no `take_id`/`block_id`/
`scene_id`, so the inherited timeline cannot arrange what the production
pipeline makes; and that anchor is the entity item 6 dissolves. The tables stay;
the tab goes. **The retraction is not built and needs its own go.**

### Item 16 — Effects + Presets consolidate near Render, resolution first

WHY: item 2 made a render preset carry format + master target + effects chain
and made all three actually run, so they are one decision wearing three tabs
(`App.vue:52-53` — Effects and Presets are both top-level library entries).

BUILD:
1. The RESOLVED answer surfaces at the point of render. Studio's Render step
   already shows the master pill (item 2, `GET /v1/render/master-target`); it
   gains the same treatment for the effects chain — what will run, and where it
   came from (persona chain + preset chain, stacked, per `audio/effects.py
   resolve_chain`).
2. Effects and Presets demote from top-level tabs to pages reached from that
   surface; the sidebar keeps one entry near Render rather than two in Library.
3. `docs/render-presets.md`, `docs/effects.md`, `docs/studio.md` follow the
   move; the help slugs in `App.vue`'s `HELP_SLUG_BY_VIEW` follow the routes.
4. Tests: vitest for the resolution line's copy; smoke drives the new route.
NOT: merging the two tabs and leaving the resolution unshown — that moves the
guesswork instead of ending it.

Phase-5 later pile (no rulings needed, just gos): Train quality-feedback row +
explainer + dataset preview loop · M4B promise-vs-code check · per-speaker
Audacity multitrack export · per-operation log panes · render batching
investigation (their 3–6× claim; look at render_core throughput) · advanced
LoRA knobs behind a fold.

---

## §7 Session state at plan time (2026-08-15, for the post-compact reader)

Everything below is BUILT + PUSHED (trees clean, all four repos):

- Measured VRAM admission with foreign usage (kit `f11f228` — NOTE: that
  commit also swept four files of the USER's parallel openPath work; recorded
  in kit tracker; do not "fix" history) · `can_coreside` deleted (`078440a`) ·
  one cached probe door `hardware.used_pool_mb(fresh=)`, JV delegates
  (`68272c9`) · strips measured-first everywhere.
- First-run: gate keys off `settings.app.onboarding_shown`, deep-link seed
  removed, "Run welcome again" wired (JV `36f12c7`); smoke dismisses the
  first-run dialog + waits for real readiness (`a9588aa`) — the first-run
  false-red root cause was the "What are you making?" modal overlay, NOT
  contention.
- Progress bars read the server (`taskFor` falls back to row op state);
  set-vs-load reverted ("Set as default" + row Load/Unload buttons, kit
  `1a433cd`/`791a26f`); catalog progress bar full-width row (`8d1ba0b`).
- Data location: family portable policy (`resolve_data_dir` in kit
  `platform/data_paths.py`; both shells + all three paths.py; no first-run
  pointer lock; media paths stored data-root-relative; venv origin stamps;
  speech cache + facts manifests all per the 2026-08-13/14 plan docs).
- known_engines excised (JV `f700d81`).
- The user's `openPath`/menu-wording work may still be UNCOMMITTED in JV
  (`SpeechEnginesTab.vue`, `SettingsView.vue`, `main.js`, Cargo.toml,
  capabilities, docs) — NEVER stage those files with plan work; explicit
  paths only.

Resume recipe: read THIS doc §5 top-down; the JV tracker's "next build" entry
points here; gates per the header block.

### §7b — session state after the items 0–2 build (2026-08-15, later)

All four repos clean and level with their remotes at hand-off. JV history,
newest first: `bc1e13c` docs pass · `afd2185` inline player (parallel
session) · `2abfd93` one-strip JV half · `a1266af` gate-block wording
(parallel) · `97a0282` items 1+2 · `e307227` one save door (parallel). Kit:
`d063ff9` one-strip kit half.

Gate results at hand-off — JV ruff + **549** server tests, biome, vitest 48,
`build:vite`, renderer smoke 16 views zero JS errors; JustWrite vitest
**578** + build; docgen vitest + build; kit UI biome 122 files. A kit change
gates all four, and the one-strip commit was gated that way.

Working-relationship facts that cost time this session, worth keeping: the
user edits and commits **in parallel** — the tree moved under me three times,
so re-check `git status` immediately before staging, stage explicit paths
only, and disclose any file that mixes both sessions' work (two did:
`models.py` and `docs/engines.md`, both named in `97a0282`'s message).
`test_prefetch_cancel_via_http_endpoint` flaked once in a full run and passed
alone, as a file, and in a clean re-run.
