# IDEAS — the backlog (JustVoice)

The holding pen for unscheduled JustVoice ideas — same charter as JW's
`docs/dev/IDEAS.md`. Adding an idea is never starting it. Committed work lives in
`docs/dev/TASKS.md`. Newest at the top; date each one.

---

- **2026-08-08 · Measured TTS VRAM footprints** — cut from the VRAM plan
  (`docs/plans/2026-08-08-vram-think.md` Q5) as overengineering for admission:
  the manifest's `vram_min_mb` is enough because the spawn OOM back-off is the
  real net. The idea: NVML per-PID measurement after an engine load, recorded
  the way the kit records model measurements, so the budget strip's numbers
  improve with use. Worth it only if the declared minimums prove badly wrong.
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
