# IDEAS — the backlog (JustVoice)

The holding pen for unscheduled JustVoice ideas — same charter as JW's
`docs/dev/IDEAS.md`. Adding an idea is never starting it. Committed work lives in
`docs/dev/TASKS.md`. Newest at the top; date each one.

---

**Back after the release (2026-11-10).** The release review's five "later" ideas and the global
dictation hotkey and paste, re-added as decided on 2026-11-06 (TASKS "The finish run's nine decisions", item 5:
removed for now, "to come back after the release"), their text as it was (`git show 69e00a8d:docs/dev/IDEAS.md`).
The game pipeline is three entries here (the string-table import, the design residue, Unreal Engine
integration) and the timeline two (the timeline, the podcast episode spec): the review kept each group as one
idea. Each was checked against the code on 2026-11-05: `docs/dev/ideas-release-review.md`. The other 28 stay
removed (git keeps them).

- **2026-10-16 · Pocket TTS and Qwen3 repeat on the graphics card** — on the card their take
  follows the longest line since the model loaded: their graphs are sized by it, and ggml's CUDA
  flash attention splits its sum by that size (`fattn-common.cuh:1057`), so the additions run in
  another order. The words stay the same; a VoiceDesign take was one 80 ms frame longer, a Pocket
  take drifted after 2.5 s. The fix in the models: size those graphs to a fixed capacity from the
  load (Qwen3's talker step graph, `talker.cpp:1862-1892`; Pocket's capacity controller,
  `session.cpp:325-370`) — a small speed cost on Qwen3. Not ggml's shared kernels, which would
  change every model's output. The user chose to leave it and document it for now, this fix after
  the one-click plan (TASKS "The run's last questions" 3; RESEARCH §1.2).
  *Checked 2026-11-05 (`docs/dev/ideas-release-review.md`):* still open; the line numbers above are stale after the
  merges. Pocket already has a load option that may fix its half — `offline_graph_capacity_mode` `fixed` with
  `prompt_graph_capacity` / `generation_graph_capacity` — unmeasured.

- **2026-10-11 · What the research sweep says would make the audiobooks better** — the user
  asked for a broad sweep ("you know our goal is the best audiobook converter possible so any new
  models techniques tools anything lets dig in"), then "write this info to docs update all docs".
  Nothing here is decided or scheduled; each needs its own word. The facts and sources are
  RESEARCH §10.9–10.12. The sweep's ideas, by area:
  - **Acting:** re-test IndexTTS 2.5 the authors' way (emotion vector ~0.6, or an acted take as
    its emotion clip) and Breeze TTS 2 / Higgs v3; an emotion bank per main character (a clip per
    emotion fed as IndexTTS's emotion clip, the frozen voice clip kept calm); best of N takes per
    directed line with an automatic pick; act-then-reference or act-then-convert; a line split
    where its emotion changes inside it.
  - **Checking takes:** a test kit — signal gate, read-back (Parakeet / Qwen3-ASR), same-character
    score, emotion2vec+ and Empathic-Insight and ParaSpeechCLAP for emotion and direction, quality
    outliers — sending near-misses, disagreements and a random share to a person; webMUSHRA or
    Label Studio for bigger listening tests.
  - **The text:** a normalization step (numbers, dates, money, abbreviations) by LLM on
    pattern-found spans; an import that reads EPUB semantics (skip or tag footnotes, front and back
    matter, keep italics) and MOBI/PDF through calibre; one cast for the whole book with aliases
    before Analyze; LLM-proposed pronunciations for names, reviewed before use; heteronyms
    (read/read) by sense; PDNC and LitBank as attribution answer keys, LibriQuote for direction.
  - **Production:** pauses and room tone as settings (a speaker-change pause, after a chapter
    title, 1–5 s head and tail); voice candidates per character previewed on their own lines;
    QuickTime-only M4B chapters, credits, a retail sample, a digital-voice disclosure; read-along
    word timings.
  *Checked 2026-11-05:* done since — the take-check kit, in-app read-back with one automatic re-render, one cast
  with names merged across chapters, direction, the authors'-way re-tests, Breeze TTS 2 tested; partly — pauses,
  head and tail silence in the mastering presets. The open items, each with its code: `docs/dev/ideas-release-review.md`.

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

- **2026-10-05 · Global dictation hotkeys, in-app recording, and paste into any field** —
  the dictation pipeline works on the server (`POST /v1/captures` transcribes and cleans),
  but nothing in the app starts a recording: no global hotkey (the Tauri shell's hotkey
  monitor, which the renderer never called, went with Tauri on 2026-10-08; the Electron shell
  has none), the Captures tab's **Record (soon)** is off, and pasting the result isn't built.
  When the paste is built it must save and restore the clipboard and look the paste key up
  from the keyboard layout — the Tauri code that cleared the clipboard and sent Cmd+V as
  keycode 0x09 (ANSI V, wrong off QWERTY) went with it (TASKS FINDING, closed 2026-11-05). Settings → Capture's fake Hotkeys card, auto-paste
  switch and playback voice were removed 2026-10-05 (TASKS "Five small findings").
  The server keeps `captures.hotkey_enabled` and the two chord lists, which Home's
  hotkey banner reads.
  *2026-11-06:* in-app recording is built (Captures' ● Record). Left: the global hotkey (Electron's
  `globalShortcut` reports no key-up, so hold-to-talk needs a native hook) and the paste (native key injection per
  OS, the clipboard put back) — both need research first (ROADMAP "Dictation").

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
  `scene_id`. The inherited timeline arranges one-off Generate clips — but a
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

- **2026-08-04 · Unreal Engine integration** — option locked:
  `docs/dev/ue-integration-design.md`. Larger than "post-v1" implies
  (re-verified 2026-08-06): per-line WAV export shipped, but Phase 1's actual
  deliverable — the per-line JSON sidecar (18-field schema in the doc) — is
  still unbuilt; the aggregate `manifest.json` carries 7 fields. The `.uplugin`
  (Phase 2) is post-v1.
