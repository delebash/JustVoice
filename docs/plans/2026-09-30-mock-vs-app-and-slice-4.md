<!-- SPDX-License-Identifier: MIT -->
# The mock against the app, screen by screen — and Slice 4 (Render), ready to plan

**Written 2026-09-30 so a new session picks up here without re-deriving anything.** The user:
"lets move to the next slice", then "the mock has persona redesign check the mock for all
redesign", then "lets update all docs i want to restart session so save waht we need tot to pick
up here" and "make sure you save in enough detail". **Nothing here is decided or built.** It is
research: §1 is every mock screen compared with the app; §2 a defect it found (verified); §3 what
Slice 4 is, what exists, and the decisions it needs before a plan; §4 exactly where to resume.

How §1 was made: a read-only agent extracted each route's text from
`docs/plans/mock/workbench-mock.html` (routes in `docs/plans/mock/build_mock.py` ROUTES, :225-245)
and read the app's view against it. Spot-verified by hand: the Render step (§3.2) and the persona
defect (§2). The rest is the agent's reading — re-check a row before acting on it.

## 1. Every mock screen against the app

**Overall:** Studio's front half matches the mock — Overview, Discover, Script, Cast. Render and
Scene are the old design or absent. The library screens (Personas + its editor, Voices, Lexicons,
Effects, Engines) and New project are pre-redesign with partial overlap.

**Frozen, never to be built** (redesign doc §7; TASKS "THE VOICE-WORKFLOW REDESIGN", 2026-08-22):
voice-workbench Slices C (persona editor gets a delivery editor + audition panel), D (Generate
absorbed), E (one "New voice" door, Labs collapsed, the voice inspector removed) — "Slices A and B
shipped, C and D never will, and E landed piecemeal". The one E piece still undone: Labs keeps
three subs (compare, renderlab, audio) where E wanted one "Audio tools".

| Route | Mock file | App file | Verdict | Missing (short) | Tracker / doc |
|---|---|---|---|---|---|
| home | `_new_home` | `views/HomeView.vue` | PARTIAL | next-work banner; the five-state bar + chips | §8.16: "Only its `miniSteps` and next-step banner change" — not done |
| projects | `_new_projects` | `views/ProjectsView.vue:211` | PARTIAL | Cast, Rendered, Master columns; ⋯ menu | Slices 1+2 (plain list) BUILT `df15ecf` |
| new | `_s1` | `components/NewProjectModal.vue` + `views/ImportModal.vue` | NOT BUILT | the two-step page | none |
| overview | `_new_overview` | `components/StudioOverview.vue` | BUILT | the "Pronunciation lexicon" row; "Imported from X" line | lexicon: TASKS "A project's pronunciation lexicon reaches the audio" (decided, GO needed) |
| discover | `_new_discover` | `components/StudioDiscover.vue` | BUILT (more than the mock) | — | Slices 1+2 |
| chapters (Script grid) | `_new_chapters` | `components/StudioScript.vue` | BUILT | add/rename/reorder/delete a chapter (a gap in the mock too) | Slice 3 `86eb21d` |
| lines (game) | `_new_lines` | `views/LinesView.vue` (Studio "1 · Lines") | PARTIAL | Direction column, row ticks + bulk actions, speaker filter, "⚡ Render N" | Slices 1+2 decision 4; "Game '1 · Lines' is unverified in the real app" |
| chapter (Script page) | `_s2` | `components/StudioScriptChapter.vue` | BUILT | "Put him back in the cast" not found | Slice 3 + leftovers `e323997` |
| cast | `_s3` | `components/StudioCast.vue` | BUILT | — | "Speakers and personas become two things" BUILT `fd593f8` |
| render | `_s4` | `views/StudioView.vue:1083-1237` | NOT BUILT | the whole line table (§3) | TASKS "Build the mock's Studio…" OPEN: Slice 4 |
| export | `_s5` | `components/ExportPanel.vue` | PARTIAL | format/layout/filename choices, metadata card, two ACX checks, "Also from here" | none |
| personas | `_s9` | `views/PersonasView.vue:517` | PARTIAL | four index columns, ▶, engine filter, ⋯ menu | TASKS "Voice gender in every voice dropdown, and speaker pronouns" (to-do, with the Personas redesign) |
| workbench (persona editor) | `_s7` | `PersonasView.vue:559` (an AppModal) | NOT BUILT | hear, sliders, sampling, capability panel | §8.21 item 8 "argued, not ruled"; Slices C/D frozen |
| newvoice | `_s8` | Voices tabs + `views/lora/` | PARTIAL | door cards with preconditions; per-clip SNR table | Slice E "landed piecemeal" |
| lexicons | `_s10` | `views/LexiconsView.vue` | PARTIAL | ▶ per word, "Try a word", affected-lines count, IPA note | none |
| effects | `_s11` | `views/EffectsView.vue` + `components/EffectsChainEditorModal.vue` | PARTIAL | A/B dry/wet, "From" column, "Order matters" | none |
| scene | `_s12` | none (`views/RenderPresetsView.vue` is what it replaces) | NOT BUILT | everything | §3 decision 6; Slice 5 "presets excision — ruled, needs go" |
| engines | `_s13` | `components/SpeechEnginesTab.vue` (`/engines` → `/ai`) | PARTIAL | "what you give up" table, per-variant direction column | none |

### What is missing, per screen (the agent's reading)

- **personas + workbench** — the persona redesign is two screens: the index (`_s9`) and the
  persona editor (route `workbench`, `_s7`); every "✎" and "Edit their persona →" in the mock
  goes to `workbench`.
  - Index: mock columns ▶ · Persona · Built on (voice + preset/clone) · Engine (variant) · Can be
    directed · Shaped (e.g. "1.05× · −1.0 dB · 2 effects") · Used by · ⋯ (Rename · Merge into… ·
    Delete, "refuses while she still has lines"); an "All engines (n)" filter. The app: tick ·
    Persona (+note) · Voice · Used by · Edit/Delete; chips All/Used/Unused/By project.
  - Editor: the mock's is a page ("Personas › June"); the app's is a modal (`PersonasView.vue:559`).
    Missing: the voice picker by kind (Built-in / Clone / Design / Blend / LoRA, "▶ Raw"); the
    stale-lines warning ("makes June's 61 lines stale…"); Hear it (Listen / Stock line / WAV /
    player); "How it speaks" sliders (Pace, Pitch, Gain, Pause before→after); Sampling
    (Temperature, Top k/p, Repetition penalty, Seed 🎲); "Compare settings…", "Save as new",
    Blend, Train a LoRA; the summary card and the "This engine" capability list (the app shows
    only the `instructStatus` line).
  - **The defect in §2.**
- **render** — §3.
- **scene** — not in the app. Missing: scene direction with saved snippets, a scene effects chain,
  the Apply scope (Ch. only / list / whole book), the "What this scene sounds like" rollup, ▶
  Without / ▶ With. Render presets, which the scene replaces, are live: `/presets` in the rail,
  Render's "Render preset" column (`StudioView.vue:1128`), and ExportPanel's text points to
  "Render Presets". No TASKS item schedules the scene layer. §8.22's "can a persona vary by scene"
  is still OPEN ("i dont know yet").
- **cast** — matches the mock (narrator card, speaker cards with "also called" and the blocked
  count, Name / Also called / Who they are, "Edit their persona →", persona list with engine
  filter, direction tag, ▶ and ✎). The app adds a Narrator tick box and a game table.
- **voices** — the app has ▶, Gender, Type, Engine, Language, filters and "Guess unknown
  genders". Missing: "Can be directed" and "Used by 🎭" columns, the "⏳ swap" marker, "✗ reads as
  English", a ⋯ menu (only ✕ delete). "Show hidden" was killed on purpose 2026-08-21.
- **newvoice** — everything works as Voices tabs (Clone, Design, Import, Blend, LoRA). Missing:
  the one-page "five doors" with a precondition and state on each card; the per-clip
  Len/SNR/Transcript table (candidates and LoRA rank/alpha/final loss do exist).
- **lexicons** — the app has list, scope, entries (Word / Pronunciation / Format), TSV paste,
  import/export, "Scan the book", a text-only preview (`LexiconsView.vue:411`). Missing: ▶ per
  entry; "Try a word as June/Narrator" with Before/After audio; "37 lines contain these words →
  stale"; the note that IPA works on Kokoro but not Chatterbox.
- **effects** — the app has a preset library + chain editor modal (↑/↓ reorder, load/save preset).
  Missing: A/B Dry/Wet on a real take; the "From" column with scene rows tinted; drag reorder; the
  "Order matters" card.
- **export** — the app is fixed to M4B + a WAV zip, master read-only, ACX checks RMS and peak only.
  Missing: Format and Layout choice, Filename and Folder, a Metadata card ("set on Overview" link,
  Narrator credit, Cover), measured Noise floor and Head/tail, the other exports (.justvoice.zip,
  script as text, per-line stems, Audacity labels).
- **home** — missing: the next-work banner ("Cast Harbek and Renn — 40 lines…"; the app's
  `nextStep`, `HomeView.vue:342`, covers only no engine / no projects); the five-state bar and the
  "need a voice / ready / rendered / stale" chips (the app still has "1 Import / 2 Cast / 3 Render"
  mini-steps, :205); "All projects" and "New persona" buttons. The app has extras the mock lacks
  (six stat cards, a hotkey banner).
- **projects** — the app has Project · Kind · Structure · Last opened. Missing: the source line
  ("from JustWrite"), Cast n/m, Rendered n/m, Master, counts on the kind chips, the ⋯ menu (Rename ·
  Duplicate · Re-import · Export · Delete — only Duplicate is absent everywhere; the rest are on
  Overview).
- **new** — the mock is one page: kind + Name + Language, then "Bring the words in" (drop zone and a
  Source / What lands / Speakers? table), Master target, "What you get". The app is a kind-card
  modal plus a separate Import modal with a format dropdown; no Language field. The master target
  on create was superseded (a new project gets its kind's target, 2026-09-29).
- **overview** — deliberate differences: "Continue" removed and "This kind's default" dropped
  (both ruled 2026-09-29; the mock still shows them), Webhook left off (decision 1). Actually
  missing: "Imported from X" and the Pronunciation lexicon row.
- **lines** — the app has search, all/rendered/stale/none chips, ↻ per line, stale re-render, VO
  zip. Missing: the uncast state, a speaker filter, "⚡ Render 123", the Direction column, ▶ audio,
  row ticks, "Cast selected…" / "Write directions for selected".
- **engines** — the app's catalog has install/load, capability chips, the loaded-now rail.
  Missing: the "Picking an engine…" table (If you want… / Use / What you give up), a per-variant
  "Per-line direction" column, "✗ reads as English", Whisper's "What for?". Not checked: Size and
  Languages per variant.

**The tracker's redesign item was stale:** "THE VOICE-WORKFLOW REDESIGN — the resume surface" said
"BEING DESIGNED IN THE MOCK. NOTHING BUILT IN APP CODE." — corrected 2026-09-30 to point here.

## 2. FINDING (verified 2026-09-30) — a persona's pace, pitch and gain can't be edited anywhere

- The persona editor's "+ Edit" beside the delivery chips only shows a toast:
  `PersonasView.vue:436-441` — *"Edit delivery in Generate · Tune Speed / Pitch / Pause-after on
  the Generate tab, then save as the persona default."*
- Generate has no path that saves to a persona: `grep -rn "save.*persona\|persona.*default"
  src/views/GenerateView.vue` → nothing; `default_delivery` appears in `src/` only in
  `PersonasView.vue` (display) and `components/VoiceParamsModal.vue`.
- `components/VoiceParamsModal.vue` is imported nowhere (`grep -rn VoiceParamsModal src` → only
  itself) — orphaned, apparently by the speakers split.
- Yet Cast says *"Pace, pitch, gain, delivery, effects — all of it lives there."*
  (`StudioCast.vue:599`).
So the persona layer §8.3 and §8.22 rely on (the host-side tuning that survives a recast) has no
editor in the app today. Not fixed — needs the user's word; it belongs with the persona editor
(mock `workbench`, `_s7`) and interacts with Slice 4's per-line override.

## 3. Slice 4 — Render owns direction, takes, Gen and Compare

### 3.1 What is already decided (quote before planning; never re-decide)

- TASKS "Build the mock's Studio in the app — Slices 1 + 2" (its OPEN/Slice-4 lines):
  - "Slice 4 (Render owns direction/takes/Gen/Compare)".
  - "Slice 4 ALSO moves 'rewrite in character' off Script: it stays on Script as today's
    right-click until then (decided 2026-09-29) … Slice 4 builds it in Render's line panel and
    DELETES the Script right-click (`rewriteRow`, its modal, the `@contextmenu` on the Script
    row)."
  - "Slice 4 ALSO DELETES the old Chapters page (`views/ChapterView.vue`, route `/chapter`) —
    decided 2026-09-30 … Where its features go: takes, Generate/Regenerate, compare, direction and
    'Fix pronunciation' → Render's line panel (mock `_s4.html`); paste text → Script's '＋ Add
    text' (mock `_new_chapters.html`); Words / Est. audio columns → dropped. GAP, not in the mock:
    add / rename / reorder / delete a chapter. Rec (not decided): Script's chapter grid — '＋ Add
    chapter', and Rename · Move · Delete per row; mock first." Verbatim record:
    `docs/plans/2026-09-30-script-leftovers.md` §1 "Changed".
- Redesign doc §8.2 (inline chosen), §8.3 (tuning in two places: the line gets **no sliders** —
  direction is words; numbers hide behind a closed "⚙ Override the numbers for this line — not
  set" hatch that puts a dot on the row when set; Kokoro and Chatterbox take no written direction,
  so the hatch is their only per-line control), §2.2 (row contents, "only what differs from the
  default", cells become inputs on focus; "the voice is a read-only chip with a link to Cast"),
  §8.16 (the five states: needs a speaker · needs a voice · ready · rendered · stale), §8.18 (the
  Render row: "Who speaks is read-only here, with `Change in Script →`").
- "Presets die" (TASKS "Redesign: Studio stays a container…", decision 3) — the excision in code
  has no go (Slice 5).
- The project lexicon is decided "to be wired" (TASKS "A project's pronunciation lexicon reaches the
  audio", `docs/plans/2026-09-30-project-lexicon.md`), rec: build it **before** Slice 4 because
  Slice 4 rebuilds Render on the same resolver (`render_chapter_api._resolve_scene_to_lines`).

### 3.2 The app today (verified 2026-09-30)

- Render is chapter-level only: `StudioView.vue:1083-1237` — a hand-rolled `<table>` (the reuse
  law says `UiTable`) with tick · # · Chapter · Lines · Cached · Render preset (UiSelect +
  "💡 Suggest") · Check · "▶ Render"; a per-chapter progress row (kit task, Cancel/Retry/▶ Play/⬇
  Download/✕); "Select unrendered" / "Select all" / "🎧 Run ACX QC" / "▶ Render selected (N)"; a
  cache banner. Nothing per line.
- Line-level pieces that exist today:
  - Takes API (`api/takes_api.py`): `GET /v1/takes/by_block/{id}` (:49), `POST
    /v1/takes/{id}/set_default` (:61), `PATCH /v1/takes/{id}` (:76), `DELETE /v1/takes/{id}` (:88),
    `POST /v1/blocks/{id}/render` → a new default take (:281; `render_jobs.persist_block_take`).
  - `Block.direction` (per-line performance note, appended to the persona's instruct at render —
    `render_chapter_api.py` ~:197-228) and `metadata.pause_after_ms` (per-line pause).
  - The old Chapters page has the UI to borrow from, not keep: direction chip (`ChapterView.vue`
    ~:945), Fix pronunciation → `jv.lexicon.prefill` (~:959), Regenerate (~:988 — it renders and
    DISCARDS the audio, never saving a take), take select (~:1019), Compare (~:1054), lineage
    viewer, `takesStore` (used only there).
  - Staleness is derived, not stored: `GET /v1/projects/{id}/lines` compares the latest take's
    `Generation.text` with `Block.text` (`projects_api.py` ~:1180-1208); only LinesView uses it.
  - Rewrite in character: `StudioView.rewriteRow` / `acceptRewrite` + its modal (~:89-145,
    ~:1287-1333), `POST /v1/speakers/{id}/rewrite`.
- **Chapter audio does NOT use takes.** `render_chapter` goes through the text-keyed render cache
  (`render_core` cache key: engine+version, voice, effective text, language, seed, delivery JSON,
  lexicon ids, effects hash) and never reads `Take`. A "★ live" take in the mock implies the
  chapter plays the chosen take — that is a design decision (D4 below), not a wiring detail.

### 3.3 What the mock's Render shows (`docs/plans/mock/_s4.html`, text read 2026-09-30)

"Stillwater › Ch. 1 › Render · 214 lines · 27 rendered · Scene: a flashback · Qwen3" · buttons "⚡
Render pending 187", "▶ Play chapter", "↻ Re-render all" · chips All 214 / Pending 187 / Stale 9 /
Done 27 / Blocked 4 · banner "4 lines can't render. 3 have no speaker → fix in Script. Harbek has
no persona → fix in Cast." · table Speaker · Text · How it's said · Status · Audio, with "▶ Gen" on
pending rows, "Cast him" / "Fix in Script" on blocked rows · an expanded row: **Spoken by** (a
select: "June — as the cast says" / "Mara (old) · clone · chatterbox Turbo" / "Gruff dockhand ·
Fenrir · kokoro"), **Override for this line only** (Pace 1.05×, Pitch 0 st, Gain −1.0 dB, Pause
after ms), 📕 Pronunciation, ✏️ Rewrite in June's voice, **Takes 3 · nothing is overwritten** (★
live 0:02 "direction v2" · take 2 0:02 "no direction" · take 1 0:03 "seed 4471", each ▶ ★ 🗑),
⚖️ Compare two, Close · inline tags on a line ("[sigh] [fear] [dramatic]") · footer **Gap between
lines ms** and **On speaker change ms** · "⏳ 34 lines wait on Chatterbox — one engine runs at a
time." The scene screen (`_s12`): scene direction, a scene effects chain applied over everyone in
it, Apply to (this chapter / a list / whole book), a rollup, ▶ Without / ▶ With.

### 3.4 The decisions Slice 4 needs from the user BEFORE a plan (none asked yet)

- **D1 · Pauses.** The mock's footer has "Gap between lines" and "On speaker change". The user ruled
  2026-09-29 one **Pause between lines** in Settings → Generation (600 ms), the same in Render,
  export and ACX QC (TASKS "FINDING — the chapter you audition is paced differently", `031b338`).
  Keep the single global pause (mock loses the footer), or add per-project gaps including a
  speaker-change pause?
- **D2 · "Spoken by" per line.** The mock lets one line use another persona. The data has only
  `Block.speaker_id` → speaker → `persona_id`; a per-line persona needs a new field, §2.2 said "the
  voice is a read-only chip with a link to Cast", and §8.22's "can a persona vary by scene" is
  OPEN. Build it, or keep the chip read-only?
- **D3 · The per-line number override** (Pace/Pitch/Gain/Pause after, behind §8.3's closed hatch).
  Where is it stored (no per-block delivery field today — `pause_after_ms` lives in metadata), and
  does it land in Slice 4? It is the only per-line control on Kokoro/Chatterbox.
- **D4 · Takes vs chapter audio.** Does "★ live" (the default take) become what the chapter plays
  and exports, with unrendered lines rendered through the cache as now — or do takes stay a per-line
  audition history while the chapter keeps rendering from the cache? This changes export, ACX QC,
  captions and the cache-stats probe.
- **D5 · The Render step's shape.** A chapter grid that opens one chapter's line page (as Script
  does), keeping today's chapter table as the grid? What stays of today's columns (Cached, Check,
  ▶ Render, ACX QC)?
- **D6 · The scene layer and presets.** Is the scene (`_s12`) part of Slice 4, Slice 5 (presets
  die), or later? Until presets are excised, what does Render's "Render preset" column do?
- **D7 · Chapter add/rename/reorder/delete** (the gap) — the mock needs it first; rec Script's grid.
- **D8 · Order** — the project lexicon before Slice 4 (the rec already recorded), and whether the
  persona tuning defect (§2) is fixed before Slice 4's per-line override lands on top of it.
- Also carry (decided): Rewrite moves to Render's panel and the Script right-click is deleted; the
  old Chapters page is deleted; states use §8.16's words.

## 4. Where to resume (a new session starts here)

1. Read this doc, then `docs/dev/TASKS.md` items "Build the mock's Studio in the app — Slices 1 +
   2" (Slice 4 lines), "A project's pronunciation lexicon reaches the audio", "Voice gender in every
   voice dropdown…", "Redesign: Studio stays a container…"; the redesign doc §2.2, §8.3, §8.16,
   §8.18, §8.22; the mock `_s4.html` and `_s12.html` (build + open `workbench-mock.html` or the
   published artifact `https://claude.ai/code/artifact/534a16a2-af40-438b-a64d-34baaf31f838`).
2. Present D1–D8 to the user (short lines, a rec on each), chat only.
3. With the answers: update the mock where the answers change it (and fill the chapter-management
   gap, D7), then write the Slice 4 build plan into a plan doc — pieces, files, the blast-radius
   table with pasted greps — for a go. Model it on Slice 3's plan (redesign doc §8.24).
4. Nothing is running: no gate server; the app was last launched from the previous session and has
   exited. Memory: `jv-2026-09-30-script-leftovers-lexicon-lifetime`.
