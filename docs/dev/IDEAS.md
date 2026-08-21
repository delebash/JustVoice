# IDEAS — the backlog (JustVoice)

The holding pen for unscheduled JustVoice ideas — same charter as JW's
`docs/dev/IDEAS.md`. Adding an idea is never starting it. Committed work lives in
`docs/dev/TASKS.md`. Newest at the top; date each one.

---

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
- **2026-08-08 · Single-quoted manuscripts segment to zero dialogue** — the
  segmenter matches double quotes only, deliberately, to avoid apostrophe false
  positives (`extraction/segmentation.py:8-10, 20-25`). A UK-punctuated book
  (`'Where is he?'`) therefore reads entirely as narration and NO amount of
  re-analyzing fixes it. Biggest attribution failure mode in the system.
  Out of scope for `docs/plans/2026-08-08-script-tab-restore.md`; needs either a
  segmenter option or manual split (itself deferred there).
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
