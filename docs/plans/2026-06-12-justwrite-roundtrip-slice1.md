# Plan: JustWrite → JustVoice round-trip — slice 1 (export handshake)

> ⚠️ **STATUS UNKNOWN (docs campaign 2026-08-04)** — "JV side DONE, JW side MISSING"; the JW half lives in the other repo and no status was ever written back. Verify-or-close is tracked in `docs/dev/TASKS.md`.

<!-- SPDX-License-Identifier: MIT -->

Next-horizon item #1 (archive/IMPLEMENTATION_PLAN.md, recorded per user
request). Audit findings (2026-06-12, file-verified per
`feedback_upstream_audit_hard_rule`):

- **JustVoice side is DONE**: `imports/adapters/justwrite.py` accepts
  the `justwrite/v1` document; `POST /v1/projects/import?source=justwrite`
  supports the legacy raw-JSON body + `dry_run`; CORS is open; personas
  created-or-reused per character; blocks carry `source_ref`.
- **JustWrite side is MISSING**: `services/voicebox.js` targets
  *upstream* voicebox (port 17493, async-poll API) — nothing in
  justwrite-app builds the justwrite/v1 document or POSTs it. The
  CONTRACT.md consumer half doesn't exist.

## Slice 1 — JustWrite export (this container, both repos in scope)

A. **`justwrite-app: services/export/justvoice.js`**
   - `buildJustVoiceDoc(project, studio)` → justwrite/v1 JSON:
     book {title, author, language, description=subtitle∥null};
     characters = roster (+ synthetic `narrator`) with
     voice_hint derived from gender/age/role, notes from oneLiner;
     chapters in `project.allChapters` order — lines from
     `studio.scripts[chapterId]` when analyzed (speaker→character_id,
     scene markers → pause_after_ms 1200 on the previous line),
     else `buildManuscript` paragraph blocks as narrator lines.
   - `sendToJustVoice({ doc, baseUrl, dryRun })` → POST
     `${base}/v1/projects/import?source=justwrite[&dry_run=true]`.
B. **`justwrite-app: ExportView`** — fifth format card "JustVoice"
   (precedent: the existing FORMATS radiogroup + per-format panes).
   Pane: server URL JwInput (default `http://127.0.0.1:17494`,
   persisted at localStorage `jw.justvoice.url`), script-coverage
   stat, primary "Send to JustVoice" JwButton, success summary /
   error card reusing the view's existing patterns.
C. **Live verification (Playwright)** — JustWrite browser-mode vite
   dev (port 1420) against the running JustVoice server (17494):
   seed the Tutorial Project, dry-run then real send; assert
   JustVoice `GET /v1/projects` shows the book with correct
   scene/block/persona counts; zero JS errors.

## Out of scope (machine-dependent follow-ups)

- Render leg (`/v1/render_chapter`) — needs TTS models on disk.
- Webhook notify-back into JustWrite.
- JustWrite spawning JustVoice as a sidecar (`justvoice_install`).
