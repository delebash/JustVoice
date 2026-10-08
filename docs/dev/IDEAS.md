# IDEAS — the backlog (JustVoice)

The holding pen for unscheduled JustVoice ideas — same charter as JW's
`docs/dev/IDEAS.md`. Adding an idea is never starting it. Committed work lives in
`docs/dev/TASKS.md`. Newest at the top; date each one.

---

- **2026-10-08 · Rewrite every family app on the Quasar framework** — the user, mid-conversion:
  *"add it to notes that i think we should rewrite all apps using the quasar framework,
  starting with creating a new default quasar app and building the new apps, this makes it so
  all apps are the same as we have had so many problmens with you rolling your own in each app
  this enforcese a framework conformity you cant break easily"*. The user's direction, recorded;
  not scheduled, nothing built. It follows the Electron move (decided the same day, "ok your rec
  continue": the conversion finishes with today's GUI — TASKS "The family moves to Electron…",
  the 2026-10-08 GUI entry). The shape the user named: a new default Quasar app first, then each
  app built on it — framework conformity instead of each app's own hand-rolled surfaces.
  What it would touch, for when it's planned (not decided):
  - the kit UI `@delebash/llm-ui` (its Ui* controls, UiTable, the task strip, the settings shells,
    `tokens.css`) would give way to Quasar's components, or wrap them — the family rule
    "nothing gets hand-rolled that the kit ships" becomes "nothing that Quasar ships";
  - Quasar's Electron mode generates its own main/preload (`src-electron/`) — the kit's shared
    shell (`@delebash/llm-runner/shell`, `runDesktopApp`) would run inside it; its Capacitor mode
    is the phone app (JustWrite, ruling 8);
  - the servers don't change: the Node server kit and each app's routes stay as the move leaves
    them.

- **2026-10-07 · Character voice controls: formants, texture, creature sounds** — the user,
  after the list: *"record this, also we will be removing pyton nad going to electron and node
  eventually, but these types of features i want to add"*. Wanted, not scheduled; nothing
  decided or built. The record — the list as presented, the C++/Node library survey and the
  local-AI survey the user asked for the same day, sources and the open calls — is
  `docs/plans/2026-10-07-character-voice-controls.md`; the facts are RESEARCH §8. In short:
  - **The controls:** Size (formant shift) and a pitch that keeps the voice; texture effects
    (growl, ring mod, breath/whisper, vibrato/tremolo, layers, bitcrush, vocoder, a "talking
    beast"); pitch-track controls (intonation range, jitter, fry, pitch lock); timbre transfer
    by voice conversion; monster noises (generated, a sound bank, voice-to-beast); character
    sliders, creature presets, "make 8 siblings", per-line intensity.
  - **Libraries (the rec, not decided):** Signalsmith Stretch and Signalsmith DSP as the core,
    Airwindows Consolidated for the effects, WORLD for the speech controls — MIT or BSD C++,
    built into our audio.cpp fork's DSP module per the 2026-10-05 ruling, so Node only calls
    the fork. Nothing covers everything; our own code is the glue.
  - **AI (the rec, not decided):** the app's own local AI model turning a description into
    settings; dots.tts Edit and the voice-conversion models already in the speech runtime;
    Stable Audio SFX only if its licence is accepted.

- **2026-10-06 · Script: move a line up or down** — deferred by the restore's decision 6
  ("Defer split, merge and reorder"); split and merge were built 2026-09-30, reorder was
  moved here 2026-10-06 ("your rec", on "don't build it. Move it to IDEAS"). Why it waits:
  lines come out in the order of the text, so a line is out of order only when the text is,
  and ✎ Edit text on the chapter's row fixes that — though the moved paragraph becomes a new
  line, so its speaker and takes don't follow it. Open if it is ever picked up: where it
  lives, and whether a moved line keeps its `paragraph_idx`.

- **2026-10-05 · Global dictation hotkeys, in-app recording, and paste into any field** —
  the dictation pipeline works on the server (`POST /v1/captures` transcribes and cleans),
  but nothing in the app starts a recording: the desktop shell has a hotkey monitor
  (`src-tauri/src/hotkey_monitor.rs`, with `enable_hotkey` / `update_chord_bindings`)
  that the renderer never calls, the Captures tab's **Record (soon)** is off, and
  pasting the result isn't built. Settings → Capture's fake Hotkeys card, auto-paste
  switch and playback voice were removed 2026-10-05 (TASKS "Five small findings").
  The server keeps `captures.hotkey_enabled` and the two chord lists, which Home's
  hotkey banner reads.

- **2026-10-05 · Import a `.justvoice.zip` project** — Studio → Overview exports a
  project archive (`project_export_api.py`: the chapters' WAVs, every take, the SQLite
  snapshot, speakers, personas, lexicons), but no import adapter reads it
  (`imports/adapters/justvoice_standard.py` takes JSON only). Kept as a backup on
  2026-10-05; the docs stopped promising an import.

- **2026-10-01 · New TTS engines: IndexTTS 2.5, FireRedTTS3, FireRedAudio and the
  2026 field** — researched 2026-09-30 at the user's ask; nothing started, nothing
  decided, nothing measured here. The full record, with sources, is
  `docs/plans/2026-10-01-tts-engine-scan.md`; its §12 lists six rulings that are
  the user's to make. In short:
  - **IndexTTS 2.5 — not now.** A custom Bilibili licence (Apache-2.0 until
    2025-09-09) forbids using its outputs to improve another AI model, which
    collides with the Dataset Builder and LoRA training; Python <3.12 and torch 2.8
    pins; English is its weakest language and collapses at the default segment
    length. Its draw is real: the best open emotion control on a cloned voice.
  - **FireRedTTS3 — test before adopting.** Best self-reported English speaker
    similarity, 24 cloning languages, Apache-2.0 metadata, ungated — but an
    "intended solely for academic research purposes" disclaimer needs a ruling,
    flash-attn is hard-coded, torch 2.8, 20.8 GB fp32 (INT8 runs in 8.3 GiB).
  - **FireRedAudio — no.** A 9B sibling with lower English similarity, zh/en
    only, Python <3.11, no Windows report anywhere.
  - **Worth testing:** VoxCPM2 and Step-Audio-EditX for emotion or style on a
    cloned voice; MOSS-TTS-Nano or Sopro for the CPU cloning slot.
  - **audio.cpp already ships Q8 builds of all of these**, which makes the entry
    below the cheapest way to try them; Q8 is the safe quantisation, 4-bit is
    fragile in diffusion decoders.

- **2026-09-30 · audio.cpp as a second speech runtime, and two engines looked at**
  (none started; all facts read from the upstream repos and model cards on
  2026-09-30, nothing measured on this machine):
  - **audio.cpp beside PyTorch, not instead of it.**
    [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp) is a native
    (ggml, Apache-2.0) server for audio models — the same shape as the kit's
    llama.cpp: a pinned binary plus GGUF files, Windows builds split CUDA 12.4 /
    CUDA 13.3 / Vulkan / CPU like the kit's cuda12/cuda13 tiers. CUDA 12.4 build
    439 MB + 579 MB runtime, Vulkan 57 MB, against ~4.4 GB of torch. Vulkan, Metal
    and ROCm backends would serve the "all acceleration on every platform" ruling
    where torch leaves AMD-on-Windows on CPU. Its own numbers (RTX 5090): Qwen3-TTS
    1.83× faster than Python one-shot, 3.06× long-form; Q8 weights cut Qwen3 peak
    VRAM ~25%. The server takes an inline reference clip and per-request options on
    `/v1/audio/speech` and has explicit unload, idle-unload and a loaded-model cap.
    **Why it can't replace the engines today:** Chatterbox Turbo is "testing" with
    its built-in voice only (a reference clip is rejected — no cloning); Chatterbox
    Multilingual has 19 of our 23 languages (no he/ja/ru/zh); LoRA adapters load
    only for VibeVoice and YuE2, so every trained Qwen3/Chatterbox voice is lost,
    and training stays PyTorch regardless; Qwen3 CustomVoice 0.6B isn't packaged;
    LuxTTS and Whisper aren't supported; Kokoro's English needs eSpeak-ng (GPL-3),
    which the release workflow doesn't bundle. The project is 99 days old (created
    2026-06-23), one author wrote 473 of ~780 commits, 12 releases between 13 Aug
    and 25 Sep; output is not bit-identical to PyTorch, so cached renders would
    re-render and voices tuned by ear would shift. **If picked up:** a second
    runtime behind the manifest seam, binary managed in the kit next to
    llama.cpp's; first test Qwen3 1.7B against our PyTorch engine — same lines,
    same seeds, time, VRAM, and by ear. Revisit replacement when Turbo clones, LoRA
    loads for Qwen3 and Chatterbox, and the release pace settles.
  - **Breeze TTS 2 — not added: non-commercial weights.**
    [`BreezeBlue/Breeze-TTS-2`](https://huggingface.co/BreezeBlue/Breeze-TTS-2)
    clones, takes written direction and inline vocal events in one model (today
    that costs a LoRA run), on our Qwen3 stack (`qwen-tts==0.1.1`,
    `transformers==4.57.3`, `torch==2.9.1`). Its licence: "No Commercial Purpose is
    permitted… Any Commercial Purpose involving the Model Materials, a Derivative
    Model, or an Output requires a separate written commercial license", with no
    creator or small-business exception — the Higgs case, against the roster rule
    that output must permit commercial use. Also en + zh only, 7.68 GB, ~7.7 GiB
    VRAM on a 12 GB-minimum card, officially Linux-only. Comes back only if the
    licence or the roster rule changes.
  - **MiMo-V2.5-TTS — not an engine: no weights.** Xiaomi offers it only through
    its API and MiMo Studio (their Hugging Face org has MiMo-V2.5-ASR, no TTS
    repo). It could only be a cloud provider in `engines/tts_providers/`, with its
    own adapter — chat-completions with an `audio` block, not `/v1/audio/speech`.
    "Free for a limited time"; no stated terms on commercial use of the output;
    the text and any cloning clip go to Xiaomi's servers.

- **2026-09-30 · "Cut again from the text" for an edited chapter** — since
  2026-09-30 a chapter whose lines were edited (a word changed, a split, a merge)
  is re-analyzed as its lines stand, so a new Speech marks setting can't re-cut
  it: a single-quoted book analyzed as double, with one line fixed by hand, stays
  "no dialogue found" whatever the setting. An explicit action on the chapter
  would re-join its lines by paragraph and cut them again with the current marks,
  losing the hand cuts (refused, as any re-cut is, once takes exist). The hint
  under Speech marks and the grid's advice say so meanwhile. Needs its own
  decision (`docs/plans/2026-09-30-script-leftovers.md` §3, item 2).

- **2026-09-29 · From the full walkthrough** (none started; the evidence is in TASKS's
  fresh-install RESULT and the FINDINGs of the same day):
  - **Smart-assign re-writes every cast.** On a partly cast book it re-applied the six
    existing casts and toasted "applied 8 assignments" when 2 changed; it can overwrite a
    hand-picked cast. Only uncast speakers by default, and count what changed.
  - **Smart-assign left Old Sedge uncast** though "Gravel old man" (note: "seventies") fits
    "an old road-warden, a pensioner" — a reason for "suggest, don't apply" (Fable's offer).
  - **Discover proposes descriptive labels** — "a Concern clerk", "the courier" — which its
    prompt says never to list; they arrive as New and need Ignore by hand.
  - **"the Warden" is Ophra Kell**, but her Who they are says "Warden" only in the imported
    voice-hint lines Discover doesn't read, and Also called was empty. An import could seed
    Also called from the book's role/title, or Discover's known list could carry it.
  - **Discover's evidence can start mid-quote** (`" Haldane Threll had come down …`).
  - **"Assigned Narrator to Narrator."** — the Cast toast when a persona and speaker share a
    name; "Narrator now plays Narrator." or naming it once reads better.
  - **Toasts show HTTP status codes** — "Save failed 409 Conflict: A persona called …";
    the words after the colon are the message, the code is noise.
  - **Remove with no lines** asks "Remove Old Sedge from the cast?" with an empty body; "They
    have no lines yet." would read less like a missing message.
  - **The shared-cache question is asked only in AI Settings** (the kit's Quick Setup band);
    a model downloaded before visiting it fills the app's own cache — what made the 29 GB on
    2026-09-19. Ask at the first download whenever a family cache exists. (Kit: the
    `cache_api.py` module docstring still says the choice waits for a restart; the code
    applies it at once.)

- **2026-09-29 · "Read by you" per chapter in Script** — a mark, with its date, on
  each chapter you have read through on Script's chapter page. Reading is the real
  review (the flags catch only some misses), so it may be worth tracking. Parked by
  the user's "not now": decide after using the new Script on a real book. It adds
  saved state, and it touches the ruling that the Script grid shows no completion
  state (redesign doc §8.8, §8.25).

- **2026-08-22 · Feature-horizon candidates live in `ROADMAP.md`** — the voicebox
  parity gaps (dictation hotkey epic, capture→voice promote, timeline) and the
  candidates inherited from voicebox's own roadmap (STT expansion, streaming
  transcription, pipeline sinks, long-form dual-stream capture, …) are tracked
  there with code receipts. Same charter as this file: listed ≠ started.

- **2026-08-15 · THE TIMELINE, designed properly (replaces the inherited Stories
  surface)** — parked here by your word after the ruling-15 discussion: retract
  the tab, design the real thing here, build it later. Nothing below is started.

  **What exists today, verified in code 2026-08-15.** Two tables and nothing
  else. `database/models.py:382-412`: `stories` (name, optional `project_id`)
  and `story_items` — one clip placement each, carrying `track`,
  `start_time_ms`, `trim_start_ms`, `trim_end_ms`, `volume`, a denormalised
  `duration`, and FKs to `generations` / `generation_versions`. There is **no
  `/v1/stories*` route anywhere in `server/`**, no mixer (the audio package is
  `analyzer` · `wav` · `effects` · `chunked` — nothing sums N clips at
  offsets), and `StoriesView.vue` is 44 inert lines that say so on the page
  (gated 2026-06-13, your decision, after the previous mock called endpoints
  that never existed). The DSP that DID ship is per-clip: `audio/effects.py`'s
  chain + `mastering.py`'s ffmpeg loudness pass, both wired into renders by the
  2026-08-15 render-truth work. Clip PROCESSING is done; clip ARRANGEMENT was
  never begun.

  **Why the inherited shape cannot be built on.** `story_items` points at
  `generation_id` / `version_id` and carries no `take_id`, `block_id` or
  `scene_id`. Voicebox's timeline arranges one-off Generate clips — but a
  JustVoice episode is Project → Scene → Block → **Take**, so as inherited the
  timeline cannot arrange the audio the production pipeline actually makes. It
  also points at the entity plan item 6 dissolves. Any build starts with a
  schema decision, not with a UI.

  **Which project kinds — podcast only, for v1.** *Podcast:* the real case —
  segments from several speakers, breathing room, music beds, stings. *Game
  voicelines:* NO. The deliverable is per-line WAVs + a manifest the game engine
  triggers; there is no assembled programme to arrange, and the current lede's
  "game-dialogue assembly" is aspiration, not a use case anyone named. *Audiobook:*
  not for v1 — a chapter is continuous narration, ACX wants no beds, and
  pacing is better served by the Pauses group (plan item 10) than by dragging
  clips. Revisit only if full-cast audiobooks need per-character pacing that
  pauses cannot express. *Custom/text:* no.

  **What it should DO.** (1) **Arrive populated, never empty**: open an episode
  and its blocks are already laid out in order, on lanes grouped by persona,
  using each block's default take with its real duration. The 90% case —
  "the order is right, I need breathing room and levels" — needs no dragging at
  all. (2) **Edits**: move a clip, trim head/tail, per-clip gain, swap which
  take a clip uses, mute/solo a lane, lane gain, insert a gap, drop in an ad-hoc
  clip (uploaded WAV or a one-off render) for a bed or a sting. (3) **Survive a
  re-render**: a clip stays anchored to its block, and block-to-block offsets
  are RELATIVE to the previous clip's end, so re-rendering one line ripples the
  arrangement instead of corrupting it — with an explicit "pin to absolute time"
  for beds and stings that must land on the clock. (4) **Mix down** by summing
  lanes with offset/trim/gain, then hand the result to the existing mastering
  chain (podcast target) and the existing export path. The only genuinely new
  audio code is the summing. (5) **Stay non-destructive and cacheable**: the
  arrangement is data; the mixdown is an artifact keyed by arrangement hash +
  take ids + effects hash, alongside today's render cache.

  **What it should LOOK like.** Lane headers down the left — persona name, its
  voice, mute/solo, lane gain. A horizontal ruler with clips as blocks labelled
  by the line's first words (waveform only if it is cheap; a flat block is fine
  and reads better at episode length). Trim handles on the selected clip.
  Transport + zoom along the bottom. A right-hand inspector for the selected
  clip: which take (with the take carousel's own vocabulary), gain, trim in
  ms, and a read-only line naming the effects chain it inherits from its
  persona. Empty state for an unrendered episode: say so and link to Studio,
  the same lede-card precedent the current placeholder already uses.

  **Sequencing.** After plan item 6 (Generate dissolution) settles what a clip
  references. Then the schema ruling, THEN the API, then the mixdown, then the
  editor — in that order, because every layer above is wrong if the anchor is.

  **Open questions that need your ruling before any build.** (a) Extend
  `story_items` with `take_id`/`scene_id`, or delete both tables and let a
  scene own its arrangement? Lean: **scene-owned** — an episode already IS a
  scene, and "freestanding stories tied to nothing" is a second organising
  concept nobody has asked for. (b) Do pauses (item 10) become timeline data,
  or stay the audiobook answer while the timeline is the podcast answer?
  (c) Per-clip effects overrides, or effects stay at persona/preset only?
  Lean: persona/preset only, or the "which chain applied" question gets a
  fourth answer. (d) Does game ever get a read-only preview of a dialogue
  exchange? Lean: no.

- **2026-08-14 · AMD-Linux per-process GPU memory via KFD sysfs** — recorded
  by the amended measured redesign (plan doc §10): ROCm tooling exposes only
  device-wide use, so AMD-Linux boxes ride the device-delta fallback
  (`source="computed"`). The kernel's KFD sysfs
  (`/sys/class/kfd/kfd/proc/<pid>/`) exposes per-process VRAM on amdgpu and
  could become a real per-PID arm in kit `hardware.py` when an AMD box exists
  to verify against. Until verified on real hardware this stays an idea.
- **2026-08-08 · Unreal / Unity string-table import for game dialogue** — moved
  here by the user's word ("move unreal stuff to ideas") during the import-picker
  sweep. The gap is real and currently advertised: `NewProjectModal.vue` sells
  Game dialogue as "CSV / JSON / string-table import" and `docs/dev/CONCEPTS.md`
  (lines 22 and 79) names "Unreal string table" as a game import surface with a
  speaker column discovered at import — but no adapter reads one; game devs get
  `csv_lines` or JustVoice standard JSON. The false half of that promise was
  struck from the New Project card in the same sweep, so the app no longer claims
  it; CONCEPTS keeps it as the intended model. Note `docs/dev/ue-integration-design.md`
  is the EXPORT side (WAV-per-line + JSON sidecar, UE plugin phase 2) — a
  different direction of travel, not this.
- **2026-08-07 · A TTS Lab** — moved here off the tracker by the user's word.
  The name was parked in the shared AI-stack ledger on 2026-07-06 and held
  behind the JustVoice convergence work; that work finished 2026-08-05/06 and
  nobody went back to it. **No scope was ever written for it** — the ledger
  recorded the name only, explicitly so it wouldn't be lost. What a TTS Lab
  would be (a per-engine equivalent of the LLM feature Lab? a voice A/B bench?)
  is undecided and unwritten. It needs a real discussion before it is anything.
  Three sibling names were parked with it and were dropped rather than moved: a
  capture/dictation fix, a prompt-editor view, and catalog drift rows.
- **2026-08-06 · Audiobook competitor-research ideas (unbuilt, previously
  untracked)** — from `docs/dev/2026-06-24-audiobook-nlp-competitor-research.md`
  (code-verified 2026-08-06: only 4 of its 21 ideas ever got built). The top two:
  a second attribution **review/QC pass** (JV is strictly one-pass today) and
  **Whisper+VAD render QC with auto-regenerate** (JV already owns the Whisper
  engine and the per-block re-render actuator; only the detector+diff is
  missing). Also live there: automatic alias/name-variant clustering ·
  attribution chunking with roster + last-N context (whole scenes go in one
  prompt today) · length-sorted sub-batching + parallel TTS · the
  persona-generation loop (LLM writes the description → `/v1/voices/design` →
  auto-cast) · dialogue-only narrator-split mode · LLM emotion-tag insertion ·
  non-verbal sounds as pronounceable text · BookNLP deterministic cross-check
  (the disagreement-badge seam in `extraction/pipeline.py` is already built).
- **2026-08-06 · Game pipeline design residue** — the seven design-target items
  that lived only in the retired game journey (now
  `docs/plans/archive/journey-game.md`): CSV column-mapping UI with per-project
  mapping memory · duplicate-ID pre-check at import · selectable export naming
  pattern · "Export changed only" · manifest `voice` + `rendered_at` fields ·
  folder-per-quest naming (`Q01_Ashfall_Village/Q01_HALE_001.wav`) · the
  500-line scale criteria (virtualized Lines grid, streaming batch progress,
  per-line failure isolation — `rerenderChanged` currently aborts on first
  error).
- **2026-08-06 · The podcast Timeline / episode-export spec** — auto-lay onto
  per-speaker tracks via a pause profile, music-bed auto-ducking, draggable
  SFX/ad blocks, the non-destructive rule ("Timeline edits never re-render
  audio"), ID3 show art + chapters-from-markers, in-app marker authoring:
  `docs/dev/journey-podcast.md`, kept whole as the spec (user's call
  2026-08-06).
- **2026-08-06 · Multi-use design soft residue** — the still-open leftovers of
  the ~90%-executed persona/voiceprofile design (now
  `docs/plans/archive/persona-voiceprofile-multiuse-design.md`): batch "Rewrite
  N selected blocks in character" (only per-block exists) · "Compose into
  Script" as a new-Block action · library-tab explainer headers · the topbar
  "🧭 What now?" slide-out · on-blur validation with inline field errors (the
  `.jv-form-row__error` CSS hook exists and is dead) · the shared-repo revisit
  triggers (third app / shared JS >3000 LOC / v2 convergence) · the Q6 per-view
  width-class sweeps (slices 2–6; slice 1's global default absorbed most of it).
- **2026-08-04 · Unreal Engine integration** — option locked:
  `docs/dev/ue-integration-design.md`. Larger than "post-v1" implies
  (re-verified 2026-08-06): per-line WAV export shipped, but Phase 1's actual
  deliverable — the per-line JSON sidecar (18-field schema in the doc) — is
  still unbuilt; the aggregate `manifest.json` carries 7 fields. The `.uplugin`
  (Phase 2) is post-v1.
- **2026-08-04 · External importer formats** — the six-tool survey with the
  recommended importer shape, unbuilt (re-verified 2026-08-06: zero of six
  built; `elevenlabs.py` is a deliberate 501 stub pointing at this research):
  `docs/dev/external-import-formats.md`.
- **2026-08-09 · The analyze stream pins a thread per run** — scoped OUT of
  the Script-tab restore as a design change, not a defect, and recorded here
  rather than fixed inside a bug-fix batch. `analyze_scene_stream_endpoint`
  runs the blocking pipeline on its own `Thread` and drains its queue with
  `await asyncio.to_thread(q.get)`, so every concurrent analyze holds TWO
  threads — the worker plus a blocked pool thread — against a default pool of
  ~`min(32, cpu+4)`. Invisible on the desktop app (one user, one run); the
  wrong shape for `justvoice-server serve`, the headless mode JustVoice also
  ships. The fix is an `asyncio.Queue` fed by `loop.call_soon_threadsafe`, so
  the drain never blocks. Same pattern would apply to any future
  stream-a-blocking-pipeline endpoint.
- **2026-08-09 · Blank blocks render as Script rows** — cosmetic residue of
  the restore. `isSpeakable` (`src/services/attribution.js`) keeps a
  whitespace-only block out of every count and out of the render, but
  `rowsFromBlocks` still emits a table row for it, showing a `—` speaker and
  no dropdown. Harmless, slightly baffling. Either filter them from the table
  or give them the treatment markers get.
- **2026-08-08 · Anchor-vs-LLM disagreement is computed, sent, and dropped** —
  every anchor-won row carries `llm_speaker` + `llm_confidence`, and
  `extraction/pipeline.py:57-60` says they exist "so the Speaker Lab can render
  disagreement badges". **Zero references in `src/`** (exhaustive grep) — neither
  Studio nor the Lab renders them. It is the best "check this row" signal in the
  payload and costs one predicate. The Lab already has the visual idiom (a wavy
  underline, `components/lab/AttributionResult.vue:216`) pointed at a different
  comparison.
- **2026-08-04 · The deferred-to-v1.1+ list (extracted from the archived
  DESIGN_FREEZE):** Apple notarization + Linux AppImage signing · audio-channels
  MultiSelect UI (backend ships) · per-character external provider override ·
  Unreal `.uplugin` (separate repo) · cross-character voice-embedding drift
  detection · audiobook publishing assistant (cover art, ACX validator, retail
  sample) · per-engine GPU memory budgets · voice-profile multi-engine fallback ·
  community engine plugin system · SQLite FTS5 full-text search (trigger: >2000
  generations + first complaint) · append-only activity log (trigger: first
  webhook-replay incident) · `POST /v1/projects/import` for non-JustWrite sources.
  NEVER ships: multi-user accounts (a v2 SaaS pivot) · voice analytics (vanity).

## Parked 2026-08-21 (the C5 group — user's rec-approved parking)

- **Kokoro group-vector math** (kokovoicelab-style): direction vectors from
  voice groups (gender/language), interpolation ranges, .pt/voices.bin
  export. The 2-voice strategies shipped 2026-08-20; group math stays here.
- **Extra output formats** per request (opus / flac / raw pcm) — mastering
  ships mp3/aac; add only when someone actually needs another container.
- **SSML / phonemize / dialogue endpoints** (Kokoro-FastAPI parity items) —
  inline tags + lexicons cover the real cases.
- **Timeline design** (ruling 15, 2026-08-15) — already recorded above;
  stays parked.
