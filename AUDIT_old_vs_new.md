# JustVoice — Deep Audit: Old GUI vs New GUI vs Server

> Generated 2026-06-08 from a 4-way parallel audit (old GUI, new GUI, new server API, legacy server API).
> Old GUI = single-file `legacy-gui/index.html` (also at `E:\Dev\Web\justvoice\gui\index.html`), now served at **`/legacy/`** for side-by-side comparison.

## STATUS — REMEDIATED 2026-06-08

The full §7 remediation list was executed:
- ✅ Toast `kind`/`duration` bug fixed; Overview/Engines error-swallow removed.
- ✅ Engines: inline per-engine install progress row restored (+ indeterminate bar for sidecar engines) + model-variant picker with recommended/won't-fit tags.
- ✅ 4 missing views built: **Cache, Personas, Lexicons, Train** (all wired to existing endpoints).
- ✅ Voices: clone / design / import / blend modal added. Settings: training + external-servers + URL-overrides sections added.
- ✅ Restyled to the legacy crisp "Mercury" system (cream paper, sharp corners, oxblood accent, uppercase labels) — see `reference_gui_styling` memory.
- App now has all **11 views**; `verify_all.js` confirms every tab renders with **zero console errors**; persona create verified end-to-end through the GUI; `vite build` ✓.

Sections below are the original audit (kept as the historical gap record).

---

## TL;DR

- **The server is NOT the bottleneck.** The new FastAPI server implements **43 endpoints** — a superset of everything the old GUI used. Every missing feature below is a *frontend* gap, not a backend gap.
- **The new Vue SPA built 7 of the old GUI's 11 views.** Missing entirely: **Personas, Lexicons, Train, Cache.**
- **3 of the 7 ported views are partial:** Voices (no create actions at all), Engines (no variant picker / no inline progress / no recommendations), Settings (missing training, external servers, URL overrides).
- **The new GUI calls only 16 of the 43 endpoints.** 27 endpoints have no UI.
- **Two real bugs:** toast `kind`/`duration` silently ignored (all toasts look identical, errors aren't red); silent `catch(_){}` swallows in Overview/Engines hide server errors.

---

## 1. View-by-view gap

| View | Old GUI | New GUI | Status |
|---|---|---|---|
| Overview | stats dashboard | stats dashboard | ✅ parity (new swallows fetch errors silently) |
| Generate | voice, text, speed/pitch/gain, emotion, **pause before/after**, instruct, **engine-knobs JSON**, **inline tag help**, cancel | voice, text, speed/pitch/gain, emotion, instruct, cancel | 🟡 missing pause fields, engine-knobs JSON, tag-syntax help, cache toggle |
| Chapter | voice, script, silence, mastering preset | same | ✅ parity (both single-voice only) |
| Voices | table **+ Clone / Design / Import / Blend modal** + delete | **table + delete ONLY** | 🔴 lede promises 4 create actions that don't exist — dead-end view |
| Compare | 2 WAVs → report | same | ✅ parity |
| **Train** | full fine-tune form + jobs table + cancel | **— absent —** | 🔴 view missing |
| **Personas** | bind name→voice, table, release | **— absent —** | 🔴 view missing |
| **Lexicons** | create, select, append IPA/alias entries | **— absent —** | 🔴 view missing |
| Engines | machine info, table, install **w/ inline progress bar**, **model-variant picker**, **recommended-for-hardware**, load/unload/uninstall | machine info, table, install (progress only in global TaskStrip), load/unload/uninstall | 🟡 no inline progress row, no variant picker, no recommendations, no device choice |
| **Cache** | total + per-scope table, purge all / per-scope | **— absent —** (Overview shows total only) | 🔴 view missing |
| Settings | server, cache, limits, **training block**, **external TTS servers (probe/add/remove)**, **model URL overrides**, model paths | server, cache, limits, model paths | 🟡 missing training, external servers, URL overrides |

---

## 2. Endpoints the new GUI never calls (server supports all of them)

**Missing-view endpoints**
```
GET/POST/DELETE /v1/personas , GET/PUT /v1/personas/{id}
GET/POST/DELETE /v1/lexicons , PUT /v1/lexicons/{id} , POST /v1/lexicons/{id}/entries
GET/POST/DELETE /v1/train , GET /v1/train/{job_id}
POST /v1/cache/clear            (Cache view)
```
**Voice-creation endpoints (Voices view stubs)**
```
POST /v1/voices/clone , /v1/voices/design , /v1/voices/import , /v1/voices/blend
```
**Engines depth**
```
GET /v1/engines/{id}/models , GET /v1/engines/{id}/models/recommended , GET /v1/engines/current
```
**Settings depth (external engines + tuning)**
```
POST /v1/engines/external/probe , POST /v1/engines/external , DELETE /v1/engines/external/{id}
PATCH /v1/settings
```
**Utility endpoints neither GUI surfaces**
```
POST /v1/analyze   (standalone WAV analyzer)
POST /v1/master    (standalone upload-and-master)
```

---

## 3. Engine install — the "no progress bar" finding

The new EnginesView **does** implement the correct flow (`EnginesView.vue:50-98`): `POST /v1/engines/{id}/install` → 202 `{job_id}` → poll `GET /v1/jobs/{job_id}` every 800ms → push `percent` into the renderTasks store. Server side is fully implemented (`JobStatus{phase, bytes_downloaded, bytes_total, current_file, error}`).

**Why it feels broken:**
1. Progress shows only in the **global TaskStrip**, which `_retire()`s a task to history the instant it completes/fails — so it flashes and vanishes. The old GUI rendered an **inline per-engine progress row** (phase label + bytes + bar + error/Dismiss) that stayed visible.
2. **Sidecar engines (Qwen3/Chatterbox/etc.) report no byte progress** — per the legacy installer, they just write a marker and the real download happens lazily on first `load()` via HuggingFace `from_pretrained()`. So `bytes_total` is 0 and the bar can't fill. Only Kokoro (real file download) shows real bytes.
3. Toast `kind`/`duration` are ignored (see bugs) so the failure toast isn't visually distinct.

**Fix:** restore the old GUI's inline `.progress-row` (phase + bytes + bar + error/Dismiss) in EnginesView; for sidecar engines show an indeterminate "installing…" state instead of a 0/0 bar. Verify a real Kokoro install end-to-end.

---

## 4. Real bugs (not just missing features)

1. **`toastBridge.js` drops `kind` + `duration`** — every view calls `pushToast({message, kind:"error", duration:6000})` but the bridge only reads `{message, action}`. Result: error toasts render identical to success toasts; no red. App-wide.
2. **Silent error swallow** — `OverviewView.vue:19` and `EnginesView.vue:46` use `catch(_){}`; a down server yields blank panels with zero feedback.
3. **VoicesView lede lies** — "Clone, design, import, or blend" with no buttons to do any of it.

---

## 5. Style delta (old looks "better" — why)

Same fonts both (Inter / Newsreader / JetBrains Mono). The look difference is the *system*:

| | Old GUI | New GUI |
|---|---|---|
| Corners | **sharp** (`border-radius: 0`) | rounded (9–14px) |
| Surface | warm **cream** `#FAF8F3` / `#FFFEFA` | white `--surface` |
| Accent | **forest green** `#1F3A2E` | oxblood |
| Labels | uppercase, `letter-spacing: 0.13em`, 11px | smaller, lighter |
| Inputs | full-width, generous `10–14px` padding, longer | tighter |
| Buttons | 1px ink border, hover inverts (ink fill, paper text); `.primary` = accent fill | ink fill primary, rounded |
| Feel | editorial "Mercury", crisp, roomy | softer, more generic |

The old GUI's CSS lives at the top of `legacy-gui/index.html` (`:root` vars + element resets, lines 12–123) — the authoritative reference for matching it.

---

## 6. Legacy-only endpoints (won't / needn't port)

`GET /v1/ws/generate` (WebSocket streaming), `GET /v1/ffmpeg/status`, `POST /v1/render_scene` (multi-speaker dialogue — note: this is the real "multi-character casting" path, absent from both GUIs), `/sidecar/*` (internal), `POST /internal/training/callback` (now in-process). The new server folds external-probe server-side already.

---

## 7. Suggested remediation order

1. **Fix the 2 app-wide bugs** (toast kind/duration; un-swallow errors) — small, high leverage.
2. **Restore Engines inline progress** + variant picker + recommendations; verify a real install.
3. **Build the 4 missing views**: Cache (smallest), Personas, Lexicons, Train (largest). All endpoints exist.
4. **Complete Voices** (clone/design/import/blend modal) and **Settings** (training, external servers, URL overrides).
5. **Restyle** to the old GUI's crisp system (sharp corners, cream, label treatment, input sizing) — keep whichever accent you choose (old green vs current oxblood).
6. Optional: surface `/v1/analyze` + `/v1/master` as a small "Audio tools" utility (✅ 2026-06-08 — `AudioToolsView.vue` added as 12th tab); consider `render_scene` for true multi-voice chapters.
