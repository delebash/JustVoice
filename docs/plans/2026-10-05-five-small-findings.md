<!-- SPDX-License-Identifier: MIT -->
# Five small findings, fixed as recommended (2026-10-05)

**The decision is TASKS "Five small findings, fixed as recommended" (verbatim — "your rec on all
go").** The findings were re-checked against the code the same day (a read-only review, the key
facts re-read by hand); this doc is the build, its blast radius and what the live checks found.

## 1. What was built

1. **The title bar.** The page name keeps about 16 characters (`min-width: 12ch` — `ch` is the
   width of a "0", so 16ch at 24 px was 253 px, wider than 16 real characters); the two model
   pills shrink first (`flex-shrink: 100`, 68–260 px, the name in `.jv-topbar__engine-name` ending
   in "…", the full name already in their tooltips). Measured (`#/mock/personas/p_june`,
   `#/studio`): 1440 px — "Personas › June" whole, Studio's name cut at 190 px, pills 68 px, no
   overflow; 1920 px — all whole. Then (the user: "why isnt it flex to grow snd shrink as
   needed", "your rec go") everything gives way in order — the URL first (`flex-shrink: 10000`,
   margins not side padding, so squeezed to nothing it shows nothing), the project chip second
   (`.jv-topbar__switcher`, 1000, floor 120 px: "PROJECT T… ▾"), the pills (100), the page name
   last (1); the status group is `display: contents` so "Operational" keeps its width and the auto
   margin. Measured: 1280 and 1440 px — URL 0, project chip 120, pills 68–172, page name ≥ 190,
   no overflow; 1920 px — URL 145, chip 183, all whole.
2. **Settings → Capture.** One **Dictation** card: Speech recognition and the cleanup model (links,
   as before), **Cleanup** — `RefineSectionToggles` (given an `intro` prop; the Lab keeps its line),
   **Capture language** — PATCH `captures.language` on change. Gone: the localStorage mock
   (`justvoice:capture_settings`, read, never written), Refinement mode, Allow auto-paste, Default
   playback voice, the Hotkeys card (fixed ⌥⌘V / ⌥⌘D, dead Edit/Clear), the tab's Save button;
   `CapturesSettings.allow_auto_paste` / `default_playback_voice` (no reader; MCP's default voice
   is `mcp.default_voice`). Kept: `hotkey_enabled` and the chord lists — Home's banner reads them,
   and the shell's monitor (`src-tauri/src/hotkey_monitor.rs`) takes chord strings, though the
   renderer never arms it (`services/native.js:19`). Docs dictation (rewritten to say what works:
   the server side only — no in-app recording, hotkey or paste yet) and getting-started; IDEAS
   "Global dictation hotkeys…".
3. **IPA.** `lexiconMatches(text, entries, { ipa })` — off, an IPA-only entry isn't counted and a
   both-entry counts as its respelling; the persona page passes its model's
   `supports_phoneme_input`. Lexicons: the Kind column says *IPA · Kokoro only* and a line under
   the preview *「/…/」 is IPA — Kokoro only.*, from the installed capabilities (`engines_api.py:252`
   turns the flag off when the build lacks inline IPA). Docs lexicons (three lines), personas.
4. **The project export** saves as `<name>.justvoice.zip` (and the server's own name
   `<slug>-<ts>.justvoice.zip`); docs say where it is and that nothing imports it; IDEAS "Import a
   .justvoice.zip project"; a false comment in `studioLexicon.js` gone.
5. **Voice files.** The bundle carries `model` and `xvector_only` (import restores both; an unknown
   model is kept by name, as for any stored voice). Voices: **⋯ → ⤓ Export…** on any voice but a
   built-in, **⤒ Import voice…** in the toolbar (a hidden file input, the clone maker's and
   Lexicons' pattern). Docs voices.

## 2. Blast radius (greps run 2026-10-05)

| Change | Callers / readers | Already on the path |
|---|---|---|
| `.jv-topbar .lu-titlebar-title` floor, pill shrink | `App.vue:567-586` (the two pills, now with `.jv-topbar__engine-name`); the kit TitleBar's title span — every page, the mocks included | the pills' `title` tooltips (`App.vue:569,580`) |
| Capture tab rebuilt | `SettingsView.vue` only (`CAPTURE_KEY` had no other reader); `RefineSectionToggles`: `main.js:108` (AI Settings' Dictation cleanup card) + `SettingsView.vue:1604` | PATCH deep-merges (`settings_store.patch`), so one field never wipes the rest |
| `CapturesSettings` loses two fields | no reader in `src/`, `server/justvoice`, `src-tauri` (grep); stored settings with the keys load (BaseModel ignores extras) | — |
| `lexiconMatches` gains `{ ipa }` | `PersonaEditorView.vue:653`; `lexiconPreview.test.js` | `previewLexiconText` unchanged (Lexicons' preview) |
| Export file names | `StudioOverview.vue:208`; `project_export_api.py:231` | no test pins either |
| Bundle carries the model | `voice_bundle_api.py:30,60`; `VoicesView.vue:482,500`; `test_c_features.py` (+1 test) | `voice_model.model_for_stored` resolves an unknown model |

## 3. Checked

Biome, ruff, build; vitest `lexiconPreview.test.js` (2); pytest `test_c_features.py -k bundle`
(6), `test_captures.py` + `test_refine_lab.py` (8), four settings-reading files (9). Live on the
dev app after a restart (the throwaway lexicon and voice deleted, the capture language put back):
Capture — the card, no Hotkeys / auto-paste / playback / mode / Save, English saved and shown after
a reload; IPA — *IPA · Kokoro only*, the preview's line, Nettle (KittenTTS) 1 replacement and Cael
Ferren (Kokoro) 2 for the same line; voice files — imported as `qwen3-vd`, on the list, Export
offers `Bundle check _temporary_.jvvoice.zip`, the file carries `qwen3-vd`, a built-in has no
Export.

**Found, then fixed ("your rec go"): the project export crashed on The Ninth Facet** —
`project_export_api.py:146` calls `persona.default_delivery.model_dump()`, and the seven personas
Cast's batch made have none (`None`): `GET /v1/projects/{id}/export` → 500 *'NoneType' object has
no attribute 'model_dump'*, so Overview's button showed *Export failed*. Fixed with one guard
(`… if persona.default_delivery else {}`); `server/tests/test_project_export.py` pins it and the
archive's name (failed without the guard, passes with it).

## 4. Personas sorts by every column (2026-10-05, "fix it go")

The Personas list is the kit's `UiTable` (`PersonasView.vue:423`); it sorts a column by an
`accessorKey` on the row (no sort-function hook — `UiTable.vue:12`), and only Persona and Model
had one. `personaRows` adds what each other column shows — `_built` (the voice's name), `_directed`
(the tag's label), `_speaks` (the language's name), `_shaped` (the summary, or "as the voice"),
`_used` (the *speaker — book* text) — and the five columns are `sortable`. The page and its mock.

| Change | Callers / readers | Already on the path |
|---|---|---|
| `:data` is `personaRows` (filteredPersonas + sort values) | `PersonasView.vue:423`, `MockPersonasView.vue:300` | `filteredPersonas` still feeds tick-all, bulk delete and the empty state; row clicks use `data.id` |
| five columns `sortable` + `accessorKey` | the two column lists | the cell slots unchanged |

Checked live (page and mock): every header but ▶/⋯ is sortable, and Built on, Can be directed,
Speaks and Used by sort by what they show; page errors 0.
