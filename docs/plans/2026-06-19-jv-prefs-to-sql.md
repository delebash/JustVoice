# JustVoice: renderer prefs + settings.json → SQL (no client-side persistence)

**2026-06-19, approved by the user** ("go with your recommendation"). Continues
the cross-app storage rewrite (JustWrite finished; JV `idb-keyval` already
removed). Goal: the renderer holds no durable state — a thin client (phone)
reads everything from the server. JV's real client persistence is **direct
`localStorage`** (the IndexedDB `storage.js` was dead and is gone).

## What moves to the server (pure renderer *content* prefs)

A new **`prefs`** table + **`/v1/prefs`** — a key/value JSON store, distinct from
JV's typed operator `settings` (settings.json). PATCH does a **wholesale
per-key** upsert, NOT a deep merge: these prefs include maps/lists that need
key *deletions* (gender overrides, hidden voices), which JV's settings deep-merge
can't express.

Migrated keys (localStorage → prefs):

| pref key | was (localStorage) | owner views |
|---|---|---|
| `appearance` | `justvoice:appearance` | SettingsView |
| `studioVoiceEngineFilter` | `jv.studio.cast.engineFilter` | StudioView |
| `voiceGenderOverrides` | `jv.studio.voiceGenderOverrides` | StudioView |
| `hiddenVoices` | `jv.voices.hidden` (shared) | VoicesView (write), StudioView (read) |
| `autoLoadEngine` | `jv.voices.autoLoadEngine` (shared) | VoicesView, StudioView |
| `presetGenderOverrides` | `justvoice.presetGenderOverrides` | VoicesView |
| `speakerLabPresets` | `jv.splab.presets` | SpeakerLabView |

Renderer: `services/prefs.js` — a **reactive** cache (JV reads prefs inside
computeds across views, so the cache must be reactive, unlike JW's per-store
init). `bootPrefs()` GETs `/v1/prefs` before `app.mount()`; `readPref`/`writePref`
back the views (debounced PATCH).

## What stays client-side (NOT in the Python server DB) — and why

These are native/shell/updater config a thin client doesn't own; some gate the
server itself (bootstrap circular). They need a Tauri-store solution, a separate
concern — not this batch:

- `justvoice:keep_server_running` — Tauri sidecar lifecycle; stored in-memory in
  Rust (`SidecarState`), re-pushed by the renderer via `set_keep_server_running`.
- `justvoice:allow_network_access` — already mirrored into the server's
  `settings.server.host` (`0.0.0.0` vs `127.0.0.1`); the localStorage copy is
  redundant.
- `justvoice:updater_channel` — updater config.
- `justvoice:capture_settings` — dictation chord keys fed to the Rust hotkey monitor.

`sessionStorage` (`jv.*`) keys are ephemeral cross-view nav handoff (prefills,
"open this tab") — they die with the session and stay.

## settings.json → SQLite (one backend)

JV's `SettingsStore` (operator/server config: host, engines, logging…) moves from
the atomic `settings.json` to a SQLite singleton row. Verified safe: **no Rust
code reads `settings.json`** (the "Rust core SettingsStore" the comment cites was
replaced by the Python server). Keep the typed `Settings` model + `/v1/settings`
GET/PUT/PATCH + deep-merge + restart-required logic unchanged; only swap the
persistence, seeding once from an existing `settings.json` so installs don't lose
config.

## Staging

1. Server `prefs` table + `/v1/prefs` + test → renderer `prefs.js` + `bootPrefs`
   → migrate the 4 views. (Verify: pytest + ruff + build:vite.)
2. `SettingsStore` persistence: settings.json → SQLite singleton (+ seed). Test.

## Status: COMPLETE

- **Slice 1 ✓** — `prefs` table + `/v1/prefs`; `services/prefs.js` (reactive,
  booted before mount); 7 prefs migrated across SettingsView / StudioView /
  VoicesView / SpeakerLabView (incl. a `voicesEngineFilter` the survey missed).
- **Slice 2 ✓** — `SettingsRow` singleton; `SettingsStore` reads/writes SQLite,
  imports + retires a legacy `settings.json` on first load. Verified safe: no
  Rust reads it; `backup_api` (dead `settings.json` zip removed — DB carries
  settings; old backups still restore via the legacy-seed path), `admin_api`
  factory-reset (`settings.set()`), and `cli` need no behavior change. CLAUDE.md
  storage lines + module docstrings updated. 275 pytest, ruff, build:vite green.
