# Docs coverage worklist — code-first audit results (JV, 2026-08-04)

LIVE plan: the executable worklist from the code-first coverage audit (all cites
code-verified by the audit agent; merge-order + nav facts re-verified in this
session). Method: think-passes until dry → surgical edits → commit. Items check
off by deletion.

## A · False claims — ALL FIXED 2026-08-04 (mcp-server.md rewritten from code; export/getting-started/ai-features corrected; journeys bannered; design-decisions MCP + tier rows corrected)

1. **`docs/mcp-server.md` — REWRITE from code** (most of the page is wrong):
   4 tools, prefixed — `justvoice.speak` (returns an `audio_url`, does NOT play),
   `justvoice.list_voices`, `justvoice.transcribe` (audio_path loopback-only),
   `justvoice.list_personas` (`mcp/tools.py:32-236`). Mounted into the SAME app at
   `/mcp` on **17494** (`app.py:265-280`) — no separate port, no `mcp-shim.exe`,
   no Enabled toggle (mounts unless fastmcp is missing), no per-client
   network/bearer panel. Real client config:
   `claude mcp add justvoice --transport http --url http://127.0.0.1:17494/mcp
   --header "X-JustVoice-Client-Id: <id>"`. Bindings shape:
   `client_id / label / persona_id` (`api/mcp_bindings_api.py:53-85`).
   `MCPSettings` has exactly one field: `default_voice`.
2. `docs/export.md`: `GET /v1/takes/{id}/export` does not exist (real take routes:
   by_block, set_default, recent, lineage, favorite, blocks/{id}/render); no
   viseme sidecars anywhere; project export options are ONLY
   `include_audio`/`include_masters` (no "Default takes only").
3. `docs/getting-started.md`: podcasters do NOT land on a working Stories
   timeline (it's an inert placeholder; podcast kind shows Projects/Chapters/
   Studio — `App.vue:40-44`); "Books" tab is **Projects** (3×); Studio SHIPPED
   (drop "when it lands"); game devs land on **Lines**, not Voices.
4. `docs/ai-features.md`: "five LLM-driven features" — catalog has SIX (incl.
   `show_notes`, undocumented) + two pinnable Settings rows (`refine`,
   `voice_gender`) = 8 pinned rows. Fix the count, add the show_notes row.
5. `docs/dev/design-decisions.md` (my own distilled doc): §2 MCP row "6 tools,
   off by default" → 4 tools, mounts unconditionally; §2 three-tier delivery row →
   code-verbatim (`delivery_merge.py`): T1 engine defaults < T2
   `VoiceProfile.default_delivery` < T3 `RenderPreset.delivery_overlay` OR
   `request.delivery` (one shared top tier).
6. Journeys: `journeys/podcast.md` → loud "DESIGN TARGET — much of this is not
   built" banner (timeline auto-lay, music ducking, ad markers, stems, ID3 art:
   none exist). `journeys/game.md` → banner + not-yet marks: CSV import uses
   FIXED headers `scene,character,text,delivery,pause_after_ms` (no column
   mapping, no per-project persistence); no export naming pattern; no
   changed-only export. `journeys/audiobook.md` → near-accurate; verify the
   per-chapter status columns + QC column against `ProjectsView.vue` before
   touching.

## B · New user pages — WRITTEN 2026-08-04 (studio · projects · lines · labs · presets · backup-restore · settings-reference · run-modes+admin · troubleshooting + the import-review section + show_notes row; all in toc)

1. `studio.md` — Cast (add character, VoiceParamsModal, Smart-assign, Test line) ·
   Script (Analyze → attribution rows with confidence + `floored_from`;
   corrections feed back as worked examples; discover-speakers banner → promote) ·
   Render (per-scene render preset, Suggest, batch progress, cache hits) ·
   `useCopy()` terminology per use case.
2. `projects.md` — kind picker and what each kind changes (nav, default
   mastering, export surface), detail pane, cast, action row (Render all / Export
   M4B / QC / ZIP / Delete), bulk bar, demo projects (`POST /v1/projects/demo`),
   the active-project concept.
3. `lines.md` — stable line ids; derived `none/rendered/stale`; re-import merges
   by id and stales only text-changed lines; "re-render N changed"; per-line WAV
   export (`sNN_lNNN` or `metadata.source_ref` naming).
4. `labs.md` — Compare (A/B analyzer verdicts) · Train (LoRA queue → voice
   library) · Speaker Lab · Render Lab (≤16-cell matrix, 2 concurrent) · Audio
   Tools; the legacy hash redirects (`/compare /train /speakerlab /renderlab
   /audio → labs`; `/cache /channels /webhooks → settings`).
5. `presets.md` — render presets: the bundle (voice + delivery + effects chain +
   master target + lexicons + seed + cache_scope); merge precedence (persona/
   profile default = tier 2, preset overlay OR request = tier 3); copy-not-FK
   semantics; vs effect presets vs mastering presets.
6. `backup-restore.md` — `GET /v1/backup?include_generations`, `POST /v1/restore`,
   schema version 1, what's inside (DB incl. settings, audio blobs, embeddings,
   adapters), `restart_required: true` contract, in-memory-ZIP >4 GB limitation,
   backup vs project export.
7. `settings-reference.md` — the 14 sections at purpose level with the fields the
   audit named (server/logging/cors/auth/limits/models.url_overrides/
   training.validation/app.primary_use_case), the restart-required set
   (`settings_store.py:220-243`), and the `/v1/prefs` (renderer prefs) vs
   `/v1/settings` (operator config) split. No invented defaults.
8. `run-modes.md` — desktop vs `justvoice-server serve --host/--port/--data-dir/
   --log-level/--no-docs`; `JUSTVOICE_*` env; `python -m justvoice`;
   `default-settings`/`open-api`/`self-test`; the `/ui/` mount + bearer token +
   remote-GPU pattern; admin ops (logs tail/download, factory reset, bulk-delete
   generations dry-run-first, cache clear scopes).
9. `troubleshooting.md` — consolidate the eight scattered tails + 501
   LLM-not-configured, 503 ffmpeg, engine load cancel, restore-restart, MCP
   absent (fastmcp missing).
10. Import review section in `import-formats.md` — the dry-run review page:
    split strategy re-runs the dry run, per-chapter include, speakers-found
    banner, commit.
11. `show_notes` — row in ai-features.md + a podcast note in export.md
    (`POST /v1/projects/{id}/show-notes`, 501 contract).

## C · Tracker/dev items — TRACKED 2026-08-04 (Stories-lede ruling + the dev-doc gaps list are TASKS lines)

- TASKS: the **Stories nav lede sells an inert view** ("Multi-track timeline
  editor…", `App.vue:44`) — reword or gate the tab; code change, user's ruling.
- design-decisions §5 add the Stories/Timeline gating why (from
  `StoriesView.vue:4-14`); backup design record (>4 GB limit, schema-v1 policy);
  settings→SQLite fold → a `docs/decisions/` record (distill
  `settings_store.py:31-64`); engine-source-overrides law; corrections-as-few-shot
  decision; feature-pin catalog governance divergence
  (`SettingsView.vue:570-574` adds rows outside the catalog).

## D · Thin upgrades recorded (action when capacity allows)

voices.md (design/blend/preview-then-save), dictation.md (retranscribe,
refine-on-demand, captures table), extraction flow (discover → promote),
engine capabilities vocabulary + `/v1/engines/capabilities`, cache-stats,
active_tasks, overview dashboard, importreview thinness, prefs/admin routes.
