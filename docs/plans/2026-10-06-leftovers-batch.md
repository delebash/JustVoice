<!-- SPDX-License-Identifier: MIT -->
# 2026-10-06 · The demo again, the small wrong things, five decisions, Lexicons and Compare

The user, 2026-10-06: "go on all and the fixes you noted in session notes your rec" — then
"go on 1 and 2 from before recreate demo and the small things that are wrong". The text each
go covers is pasted in TASKS ("The demo again, the small wrong things, five decisions…").
This page is the build record: what each change touches, proved by grep before the edit.

## 1 · What each change touches (the blast radius)

Every row is a grep run on 2026-10-06 before the edit, pasted as it came back (trimmed to
the matching lines).

| Change | Callers / producers / exceptions on the path |
|---|---|
| **Kokoro mean blend sums in `voices.json` order** — `_kokoro_pack` returns a list, not a set | `blending.py:231 pack, names = _kokoro_pack(data_dir)` (the mean) · `:253 pack, names = _kokoro_pack(data_dir)` + `:263 elif vid in names:` (membership — a list answers the same) · `:216 _kokoro_pack_shape(pack, names)` (first name only) · `tests/test_kokoro_blends.py:79 assert names == {"af_heart", "am_adam"}` (a set — becomes the list in the fixture's order) |
| **`requests` and `rich` leave `server/pyproject.toml`** | `grep -rn "import requests\|from requests\|import rich\|from rich" server/justvoice server/tests scripts` → nothing. Both still ship through the kit (`requests`) and typer (`rich`), so NOTICE.md / LICENSES.md keep their rows (TASKS finding). |
| **YouTube is MP3 everywhere** | `master_api.py:68 "youtube": "audio/aac"` · `render_chapter_api.py:540 "youtube": "audio/aac"` · the two `responses=` lists naming `audio/aac` (`master_api.py:30`, `render_chapter_api.py:454`) · `AudioToolsView.vue:30 { id: "youtube", label: "YouTube (AAC/M4A)" }` · `:35 masterExt … "youtube" ? "m4a" : "mp3"` · `:209 YouTube outputs AAC.` · `docs/studio.md:1143 (ACX's MP3, YouTube's M4A)`. Producer: `models.py:214 youtube: MasterPreset(…format="mp3")` → `mastering.py` encodes the preset's format. Exception: `mastering.py:213 "-codec:a", "aac"` is the m4a branch, which no preset reaches; `export_audiobook.py:250` is the M4B mux — real AAC, untouched. |
| **The Effects page's help line** | `App.vue:59 lede: "Pedalboard-backed effects chain. Apply non-destructively — creates a new generation version…"` — the only copy; `docs/effects.md:29 ## Non-destructive` is the source. |
| **The Stories tab goes; its tables stay** | `App.vue:49` (the tab) · `:93-100` (the per-kind label map, `stories: "Timeline"`) · `:140 stories: "stories"` (help slug) · `:259`, `:272` (comments) · `router/index.js:22` · `views/StoriesView.vue` · `scripts/e2e.js:30` (its view list) · docs `use-cases.md:38`, `projects.md:46`, `getting-started.md:19`, `dev/code-map.md:918,950`, `dev/ROADMAP.md:36`, `dev/RESEARCH.md:499-501`. Kept by the 2026-08-15 ruling: `database/models.py:417-440` (`stories`, `story_items`). Not this change: `NewProjectModal.vue:47` sells "Timeline assembly, music & SFX" for a podcast — a finding (§3). |
| **The `screenshots` script** | `package.json:18 "screenshots": "node scripts/smoke_gui.js"` — its only caller. `smoke_gui.js:5 BASE = process.env.BASE \|\| "…:17497"`, `:6 OUT = … "E:/Dev/Web/justvoice-new/scripts/_shots"` (a folder that doesn't exist), `:20 getByRole("button", { name: "Engines" })` (the tab left 2026-08-06). `.gitignore:57 scripts/_shots/`. |
| **Pause at a scene break** — a setting; the render adds it after a line that ends one of the book's scenes | Producer of the scene label: `imports/adapters/justwrite.py:212 source_ref=f"chapter:{chapter_id}#scene:{scene_id}#block:{index}"` → `projects_api.py:916 meta["source_ref"] = line.source_ref` (the saved line keeps it — **my rec said it didn't; it does**, so no new import field: the import's existing label is the mark). Every writer of a line's metadata: `projects_api.py:612-620` (split: the new second half drops `source_ref` → it runs on in its scene) · `:655-660` (merge: the first line's metadata stays) · `:782 Block(… source="manual")` (✎ Edit text: a new paragraph has no label → runs on) · `extraction_api.py:539 metadata_json=with_audit(parent_meta, row)` (Analyze: every line cut from one paragraph inherits its label — so a scene's end is found by the label CHANGING, never by a flag a paragraph's pieces would all copy). Consumers of the join: `render_chapter_api.py:494 combined = concat_lines(rendered, silence_ms=gap)` (Render's chapter) · `:567 combined = concat_lines(…)` (M4B, ACX check, captions). Exception on the path: the pause must NOT go into the line's delivery — `render_core.py:621 _inputs_key(… delivery …)` hashes it, so a delivery pause would make the line stale and render it again; it is set on the rendered line at the join only. A line's own pause (`line_takes.py:38 "pause_after_ms": "pause_after"`) wins. Render's page: `StudioRenderChapter.vue:375 return d.pause_after ?? PAUSE_SETTING_MS.value` (the line's shown pause) · `:556`, `:790` (the gap in words). Settings: `SettingsView.vue:171` (defaults) · `:1333-1354` (the slider beside it). |
| **Script reorder → IDEAS; ElevenLabs dropped** | Tracker and docs only: `TASKS.md:180`, `:3786`; `dev/external-import-formats.md:14,21-28,106,116`. No code: `ls server/justvoice/imports/adapters/` has no `elevenlabs.py`. |
| **QuickSetup's size from the catalog** | `QuickSetup.vue:69 estimatedDownloadGb: 0.8` · `:76 estimatedDownloadGb: 5.4` · `:297 about <strong>{{ recipe.estimatedDownloadGb }} GB</strong>`. Source: `GET /v1/engines` → `default_variant_id` (`models.py:949`); `GET /v1/engines/{id}/models` → `variants[].size_mb` (`models.py:1265`, "the sum of the manifest's pinned real file sizes"), as `SpeechEnginesTab.vue:173` reads it. |
| **The Lexicons editor** | `LexiconsView.vue:214 canSave = !!draft.name.trim()` (all Save checks) · `:216 saveDialog` (its one caller: `:657` the footer's Save) · `:316 saveEntry` (`+ Add entry`, Enter in the three boxes) · `:644` (`+ Add entry` disabled without a word and a pronunciation). The words: `docs/lexicons.md`. Precedent for a refused Save: `PersonaEditorView.vue:1220 :title="draft.name.trim() ? '' : 'A persona needs a name'"`. |
| **Compare: two equal columns** | `StudioRenderChapter.vue:804-823` (the dialog) · `:870 .studio-render-ch__compare { display: flex; gap: 24px; flex-wrap: wrap; … }` (the only rule). The mock's own copy: `MockRenderChapterView.vue:574-575`. |

## 2 · Built

All of §1, 2026-10-06 — the record with what was checked live is TASKS "The demo again, the
small wrong things, five decisions, Lexicons and Compare". One correction to the decision
text: it said "The import marks the last line of each scene" because I believed the saved line
lost its scene label. It doesn't — `source_ref` is saved (`projects_api.py:916`) — so the
import's existing label is the mark, the render finds a scene's end where the label changes, and
no import field was added. The behaviour is the one decided: a setting, 2 s by default, never on
the line itself, reaching books already imported.

## 3 · Found while building, not changed

Both filed in TASKS under "Waiting on your decision":

- `NewProjectModal.vue:47` — the podcast kind's bullets promise "Timeline assembly, music &
  SFX". Nothing assembles a timeline (the Stories tab was a placeholder and is gone).
- `scripts/smoke.js` — ``text=${tab}`` matches AI SETTINGS for SETTINGS, so the gate never
  opens Settings. The screenshots script was fixed; the gate needs its own word.
