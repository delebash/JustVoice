# Verdicts — platform.md findings 1–21 (A Hono, B Electron, C sync)

Tally: CONFIRMED 10 (1, 3, 5, 7, 8, 9, 10, 15, 16, 18) · PARTLY 10 (2, 4, 6, 11, 12, 14, 17, 19, 20, 21) · REFUTED 1 (13).
Severity: DATA 1 (16) · VISIBLE 7 (6, 7, 8, 11, 12, 18, 20) · INTERNAL 12 (1, 2, 3, 4, 5, 9, 10, 14, 15, 17, 19, 21).

Note on the review itself: the summary at the top of platform.md cites the wrong numbers. The Port setting is #6 (not #7), the docs toggle is #7 (not #8), the restore risk is #16 (not #18), and the sync gaps are #12–#20 (not #14–#21).

Records read: the kit TASKS "The family's servers move to Hono" (:169-222); the Hono plan §3/§5/§9; JV TASKS "The family moves to Electron…" (:3087-3661, including the step-3/4/5 recs and the 2026-10-08 standing go at :3619-3631); the clean-room record (:3430-3535); "JustVoice's sync" (:989-1013); "The server moves to Hono" (:971-984); "The work's eight questions" (:861-887); the 2026-10-05 three findings (:2418-2460) and five findings (:2530-2565); JW TASKS sync decision 8 (:507-514); the Electron study §9 rulings; the Electron plan §1.1; and `git log` for each of these.

---

## 1. CORS is a hand-written Starlette port; the plan named `hono/cors`
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- The kit's `server/src/platform/cors.js:2-5` is "Starlette's CORSMiddleware … as a Hono middleware". It is used by JV `server/src/app.js:310-321`, JW `app.js:181-194`, docgen, the template and kit `tests/cors.test.js`.
- Nothing imports `hono/cors`.
- The Hono plan §3 says "CORS | `hono/cors`". §9 lists `cors.js (starletteCors)` and does not flag the departure. The kit's TASKS Hono item says nothing about CORS.

**Refutation tried:**
- The port is older than the Hono decision. It was applied 2026-10-08 as step-4 rec 2 under the user's standing go: "a question that would normally be asked gets its recommendation APPLIED and recorded" (JV TASKS :3250, :3619-3627).
- The Hono plan was written the next day, knowing the port existed, and still named `hono/cors`. It was approved with "your rec lets do it … make hono the standard".
- The global standard-first rule (added 2026-10-09) requires the user's word, by name, for our own code where a standard exists. No such word exists after 2026-10-09.

**Surviving claim:** the family's CORS is our own 132-line Starlette port where the approved Hono plan named `hono/cors`, and the user was never asked by name.

**FIX**
1. Recommended: put to the user by name:
   - (a) `hono/cors`, as the plan named;
   - (b) keep the Starlette port as a NOT STANDARD piece.
2. Attack:
   - Standard: `hono/cors` (hono.dev/docs/middleware/builtin/cors; installed 4.13.13 source read).
   - Wire differences: it answers every OPTIONS with 204 and an empty body (Starlette: 200 "OK"). A refused preflight gets 204 without Allow-Origin (Starlette: 400 "Disallowed CORS origin…"). Browsers end up the same, but the plan's §6 "byte-identical wire contract" breaks, and kit `tests/cors.test.js` ("answers measured on Python") must be rewritten.
   - The Python-style `origin_regex` setting needs an `origin` function. `pyFullMatcher` would survive as a few lines of our own.
   - New values: Max-Age. Starlette's default is 600, Hono's is none. Open question: keep 600?
   - Blast radius: kit `server/src/platform/cors.js`, `platform/index.js`, `tests/cors.test.js`, `template/server/src/app.js`; JV `server/src/app.js:306-321`; JW `server/src/app.js:181-194`; docgen `server/src/app.js`.
   - Simpler alternative: none. (b) is zero code but leaves a NOT STANDARD piece.
3. Surviving fix: ask (a) vs (b) by name, giving these differences. Nothing is coded until the user answers.

## 2. The body-size limit is hand-checked, with a 1 GiB number
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- The kit's `platform/server.js:48` has `BODY_LIMIT = 1024*1024*1024 // 1 GiB — "none" in practice, as FastAPI`, checked by hand in `readBody` (:144-151).
- `hono/body-limit` is not used anywhere.
- The Hono plan §3/§4 say "Body size limits | `hono/body-limit`".
- The same hand-check is copied in `just-sqlite-sync/src/transports/hono.js:28-31`.

**What is weak:**
- The number dates from 2026-10-07 (kit 332014a).
- The approved Electron plan said "raised body limits" (:363, :423).
- The step-2 build sheet says "no body limit" (kit `docs/plans/2026-10-07-kit-in-javascript.md:52`), and 1 GiB is its stand-in for FastAPI's none.
- No JSON body reaches 1 GiB, so there is no user effect.

**Surviving claim:** the plan's named `hono/body-limit` was replaced by a hand check (in two places) without asking. The number itself is FastAPI's "no limit" in practice.

**FIX**
1. Recommended: `hono/body-limit` on the JSON-reading path in place of the hand checks, with `onError` throwing the family's 413 envelope.
2. Attack:
   - Standard: hono.dev/docs/middleware/builtin/body-limit.
   - The trap: it rejects on `Content-Length` before any route runs. Mounted app-wide, it would refuse backup restores over the limit. Those are unlimited on purpose (kit `data_api.js:171-172`: "a backup with audio is easily over 1 GiB").
   - So it must not cover the busboy upload routes: kit `data_api.js` restore, JV `api/captures_api.js` and the align, voice-bundle and import uploads.
   - New values: the limit itself. Open question: keep 1 GiB, or what?
   - Blast radius: kit `server/src/platform/server.js` (`BODY_LIMIT`, `readBody`, `familyMiddleware`, `createServer({bodyLimit})`, `installPyFloatBodies`), `platform/data_api.js`, `just-sqlite-sync/src/transports/hono.js:28-31`, JV upload routes, the kit's tests.
   - Simpler alternative: keep the hand check and record it as NOT STANDARD (about 6 lines).
3. Surviving fix: ask. Either (a) `hono/body-limit` scoped to the JSON routes, with the limit number the user's, or (b) keep the hand check, named NOT STANDARD.

## 3. Request validation is not the approved `validator()` + 20–30 lines
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- What the user approved (kit TASKS :210-218): "3. Validation: a — Hono's own validator() with ajv … about 20–30 lines of joining code, which is NOT STANDARD … The user: 'your rec on all go' — so … 3 a."
- What was built (kit `platform/server.js:213-250`): `input()` calls `c.req.addValidatedData` itself and never uses `validator()`.
- The plan §9 says: "not Hono's `validator()` … (~100 lines …)".
- RESEARCH §2 (kit :984-987) gives the measured reason: `validator("json")` ignores bodies without a JSON content type and answers bad JSON with 400.
- No later reply from the user covers this.

**Surviving claim:** a different and larger NOT STANDARD piece was built in place of the one the user approved by name, and it was never taken back to the user.

**FIX**
1. Recommended: show `input()` to the user by name, with the measured reason. No code change unless the user rules otherwise.
2. Attack:
   - The approved (a) cannot keep the FastAPI 422 contract the plan required, as measured.
   - Option (b), `@hono/typebox-validator`, was already shown to change coercion and defaults (plan §5).
   - So there is no standard that keeps the contract.
   - Blast radius if ever changed: 185 `input({…})` calls (kit 65 in 20 files, JV 90/32, JW 16/11, docgen 14/3), plus `readJson` and kit `platform/errors.js`.
   - Nothing new: no numbers or wording.
3. Surviving fix: ask by name: "keep the kit's `input()` (NOT STANDARD, about 100 lines carried from the Fastify era), because `validator()` changes the 422 contract?"

## 4. MCP doesn't go through `@hono/mcp`
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- JV `server/src/mcp/server.js:27-29,65-88` uses the SDK's `WebStandardStreamableHTTPServerTransport` directly, with the SDK's session-map and `isInitializeRequest` pattern.
- The plan §3 named "`webStandardStreamableHttp.js` … through `@hono/mcp`". The departure is recorded only in BUILT notes (JV TASKS :980; plan §9).

**What is weak:** this is not hand-rolling. The official SDK's own web-standard transport is the standard. `@hono/mcp` is a wrapper around that same class.

**Surviving claim:** a recorded departure from the approved table that was never asked. It carries no risk.

**FIX**
1. Recommended: one line to the user. No code change.
2. Attack:
   - Switching to `@hono/mcp` (github.com/honojs/middleware/tree/main/packages/mcp) would add a dependency layer around the same SDK class.
   - Blast radius: JV `server/src/mcp/server.js`, `server/package.json`, `server/tests/mcp_rulings.test.js`.
   - Nothing new.
3. Surviving fix: tell the user that the SDK's own web-standard transport is used, not `@hono/mcp`, and ask whether that is OK.

## 5. The server rewrites audio samples itself, against ruling 1
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- JV `server/src/engines/audiocpp/slot.js:192-218`: `fillDigitalSilence` writes Int16 samples. `:128` has `cfg = { … REFERENCES_KEPT: 200, SILENCE_RUN_S: 0.01, SILENCE_FILL_LSB: 2 }`.
- Ruling 1, decided 2026-10-05 (study §9:647, :693): "no sample math left in the server" and "The server does no sample math at all."
- The approval (JV TASKS :941-945): "the app quietly fills any stretch of pure digital silence with that inaudible noise … Go?" — "go". It says nothing about where the fill runs.
- Precedent: the 2026-10-07 `as_16k_mono` ruling ported that math into `audiocpp_dsp` (dsp_client `alignerInput`, :304-306) to keep ruling 1.
- It is the only sample-writing code left in `server/src` (grep of `writeInt16LE`/`readInt16LE`).
- ±2 LSB was shown. 10 ms and 200 were not shown. 10 ms also narrows "any stretch".

**Surviving claim:** the guard puts sample math in the JavaScript server, against ruling 1. Its run length (10 ms) and cache size (200) were never shown.

**FIX**
1. Recommended: move the fill into the fork's `dsp/` as an `audiocpp_dsp` op, the `alignerInput` way.
2. Attack:
   - This follows the ruling's own standard (the separate dsp module, the 2026-10-07 precedent).
   - A packaged app runs the pinned release's `audiocpp_dsp`, so a new op needs a new fork release (a tag — the user's word).
   - New values (open questions): the 10 ms run, the 200 files kept, and whether "any stretch" may be narrowed at all.
   - Blast radius: `server/src/engines/audiocpp/slot.js` (`fillDigitalSilence`, `guardedReference`, `cfg`); its caller on the Qwen3 Base path of `toSpeechRequest`; `server/src/audio/dsp_client.js`; `../audio.cpp` `dsp/` and its tests; `server/tests/qwen3_reference_silence.test.js`; `scripts/audiocpp-dsp-package.js` (the pinned dsp build).
   - Simpler alternative, which removes the guard altogether: find and fix the runaway in our audio.cpp copy. That is the item's OPEN line, "the cause in our audio.cpp copy (the user's word)".
3. Surviving fix: ask. Either (a) a dsp op, with a release/tag later, or (b) fix the root cause in the fork and delete the guard. In both cases, show the 10 ms and 200 numbers.

## 6. The desktop app ignores the Port setting and force-kills whatever holds 17494
**Verdict:** PARTLY · **Severity:** VISIBLE
**Evidence:**
- JV `src-electron/electron-main.js:22` has `port: 17494`.
- The kit's `server/src/shell/main.js:197-198` always passes `--port`, so `serve.js`'s settings default (:47) never applies on the desktop.
- `:166-192` `evictStaleListener` runs `taskkill /F` or `kill -9` on any listener on the port.
- `SettingsPage.vue:1203-1213` offers Port ("Restart required after changing").
- The renderer's `src/boot/jv.js:56` `fallbackBase` is also hardcoded to 17494.

**What is weak:** neither behavior is new. The Tauri shell had `const SERVER_PORT: u16 = 17494` and the same eviction (`git show a605a7c^:src-tauri/src/lib.rs` :54, :279-292). The eviction has been documented since v1.0 (`docs/plans/archive/FEATURES.md:870`). The Electron move kept "the same app" (ruling 5).

**Surviving claim:**
- On the desktop, a changed Port does nothing, and the screen implies it does.
- Opening the window hard-kills any program on 17494, including the user's own headless server.
- Both are older defects the move carried, not new choices.

**FIX**
1. Recommended: put both to the user.
   - Port: start the desktop server without `--port`, so it takes `settings.server.port`. The shell already reads the real port from the server's `ready` message (`main.js:206-209`).
   - Eviction: only stop a listener that answers as this app's own server (`GET /v1/health`). Otherwise, say the port is taken.
2. Attack:
   - No framework covers this. Electron's `app.requestSingleInstanceLock()` (electronjs.org/docs/latest/api/app) guards a second window, not a foreign listener.
   - Eviction needs the port before the server starts, so the shell would have to read the setting from the database itself, or stop evicting by number.
   - The renderer's `fallbackBase` (`src/boot/jv.js:56`) also hardcodes 17494.
   - New wording (open questions): any "port taken" message. Alternatively, the cheaper fix of re-wording the Port hint to "headless only".
   - Blast radius: kit `server/src/shell/main.js:160-219`, `:408` (copy-url); `src-electron/electron-main.js` in JV, JW, docgen and the template; JV `src/boot/jv.js:56`; `src/pages/SettingsPage.vue:1203-1213`; `server/src/serve.js:47,71-118`.
   - Simpler alternative: hide or relabel Port on the desktop (wording open).
3. Surviving fix: ask.
   - (a) The desktop honors Port, or (b) Port is marked headless-only.
   - Eviction: keep it, or limit it to this app's own server.

## 7. Settings → Server's "Interactive API docs" toggle does nothing
**Verdict:** CONFIRMED · **Severity:** VISIBLE
**Evidence:**
- `SettingsPage.vue:1214-1227` has the toggle for "Enable Swagger UI at /docs and ReDoc at /redoc".
- `:984` has a live link: "The full OpenAPI spec is at {serverUrl}/docs". It is a 404, and the review missed it.
- `server/src/app.js:260-261` says none exists. `models.js:266` keeps `docs_enabled`. `settings_store.js:188` still flags it "restart required". `docs/settings-reference.md:32` lists it.
- The loss is recorded only as "Not matched" (RESEARCH :1261).
- No TASKS line asks the user about it.

**Surviving claim:** the port dropped the OpenAPI docs without the user's word. A toggle and a link still promise them.

**FIX**
1. Recommended: ask, with a lean toward (b).
   - (a) Rebuild them.
   - (b) Remove the toggle, the `:984` sentence, `server.docs_enabled` and its doc line.
2. Attack:
   - (a) `@hono/swagger-ui` (github.com/honojs/middleware/tree/main/packages/swagger-ui) only serves the UI. The document needs `hono-openapi` or `@hono/zod-openapi`, and both expect routes declared through their own validators, not the kit's `input()`. That means rewriting about 340 routes, or a NOT STANDARD generator from the TypeBox schemas.
   - (b) is pure removal (the user's removed-everywhere rule).
   - New wording: the API-reference card's text without its second sentence (open question).
   - Blast radius: `src/pages/SettingsPage.vue:175, 984, 1205, 1214-1227`; `server/src/models.js:266`; `server/src/storage/settings_store.js:188`; `docs/settings-reference.md:32`; `server/src/cli.js:8`.
3. Surviving fix: ask (a) vs (b), with the lean (b) and the cost of (a) stated.

## 8. Two tray items do nothing
**Verdict:** CONFIRMED · **Severity:** VISIBLE
**Evidence:**
- `src-electron/electron-main.js:47-52` adds "🎙️ Start dictation (⌥⌘V)" and "🎚️ MCP server: toggle".
- Only `tray:open-settings`, `tray:about` and `tray:copy-url` are handled (`MainLayout.vue:454-456`).
- No MCP on/off setting exists in the server.

**Stronger than the review says:** fixing these was approved.
- On 2026-10-05 the user said "your rec on 1 and 2 and 3 go" on "3. Small, real fixes … the tray items and 'Open log file' do nothing" (JV TASKS :2418-2433).
- BUILT wired only three tray items (:2456-2460) and closed with "OPEN: none".
- No IDEAS or TASKS line parks the other two. `docs/system-tray.md:26-27` says "not wired yet".

**Surviving claim:** an approved fix was left half done. Two dead tray items remain, one with a Mac shortcut label on Windows.

**FIX**
1. Recommended: delete the two `trayExtras` entries and their two rows in `docs/system-tray.md`. The kit's `trayExtras` hook stays for when dictation (Q7's C++ addon) and an MCP switch exist.
2. Attack:
   - This uses the kit shell's own documented `trayExtras` option (Electron Menu). No new code.
   - The alternative, greyed-out items (Electron MenuItem `enabled: false`), keeps a dead entry and the ⌥⌘V label.
   - Nothing new is added (pure removal). Open question: remove now, or keep them hidden until wired?
   - Blast radius: `src-electron/electron-main.js:47-52`, `docs/system-tray.md:26-27`. The kit's `shell/main.js` trayExtras handling is unchanged.
3. Surviving fix: ask one line: "remove the two dead tray items until dictation and an MCP switch exist?"

## 9. The shell's stop timeout is a number the user never saw
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- The kit's `shell/main.js:82` has `STOP_WAIT_MS = 8000`.
- The approved Electron plan §1.1 (:115-118) says "waits, then kills — what JustVoice's shell does today".
- That shell waited up to 10 s for the shutdown reply plus 5 s for the exit (`git show a605a7c^:src-tauri/src/lib.rs` :60-61, :237-258).
- No ruling sets 8 s.

**Surviving claim:** the stop window dropped from Tauri's up-to-15 s to an unshown 8 s. After that, the server and its engines are hard-killed.

**FIX**
1. Recommended: ask. Either match the replaced shell (10 s + 5 s), as the plan's "what the shell does today" implies, or confirm 8 s.
2. Attack:
   - Electron documents no stop timeout (`utilityProcess` `child.kill()`), so the number is ours either way.
   - Making it a setting would add a new label (open question). It is not a user tunable in practice.
   - Blast radius: kit `server/src/shell/main.js:82` and every `stopServer` caller there (quit, tray Stop/Restart, relocate). It affects all four apps (JV, JW, docgen, template).
3. Surviving fix: show the number with the Tauri comparison and let the user pick. No setting.

## 10. The default CORS list still holds Tauri origins, and the window's CORS depends on the list
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- `server/src/models.js:318-330` lists `tauri://localhost` and `http(s)://tauri.localhost`, and the regex includes them.
- `app.js:310` installs CORS, including `DESKTOP_ORIGIN`, only `if (corsOrigins.length || corsRegex)`.
- Step-5 rec 4 (JV TASKS :3323): "`app://justvoice` is allowed by CORS and CSRF". CSRF always allows it (`APP_ORIGINS`, `app.js:109`). CORS does not.
- No screen edits CORS (the only `cors` in `SettingsPage.vue` is `:179 cors: {}`), so emptying it takes the API.
- Also: the kit's `platform/csrf.js:28-31,68` still adds `TAURI_ORIGINS` for every app.

**Surviving claim:** the default CORS list still holds dead Tauri origins, and the rec 4 promise ("allowed by CORS") holds only while the CORS list is non-empty.

**FIX**
1. Recommended:
   - Drop the three Tauri origins and the regex's Tauri part from the `CorsSettings` seeds.
   - Install `starletteCors` with `DESKTOP_ORIGIN` even when both settings are empty.
2. Attack:
   - This is a seeds-only change (the user's no-migrations rule): a saved settings row keeps the old list until a reset.
   - The kit's `TAURI_ORIGINS` is family-wide (JW, docgen, the template). Removing it there is a separate ask.
   - Nothing new: no numbers or wording.
   - Blast radius: JV `server/src/models.js:315-331`, `server/src/app.js:282-321`; kit `server/src/platform/csrf.js:28-31,68`, `tests/auth_middleware.test.js`, `tests/install_llm.test.js` (both mention tauri).
3. Surviving fix: JV seeds plus the CORS always-on for `DESKTOP_ORIGIN` in one change (this follows rec 4). Ask separately about the kit's `TAURI_ORIGINS`.

## 11. The clean-room rewrite's 21 gap rulings were never shown
**Verdict:** PARTLY · **Severity:** VISIBLE (low)
**Evidence:**
- JV TASKS :3469-3501 records 21 rulings "under 'your rec you can do it all without me'". That reply was given to two other questions (:3459-3465).

**What is weak:**
- The phrase is the user's own blanket delegation ("you can do it all without me").
- The same Electron item records the user's standing 2026-10-08 instruction: questions get the recommendation "APPLIED and recorded here" (:3619-3627). The 21 were recorded verbatim.
- ChordPicker: the approved words were "rewrite … chord picker" (:3446). But its only caller, the Hotkeys card, had been removed by the user's own 2026-10-05 go: "Remove auto-paste, playback voice and the Hotkeys card, since nothing stands behind them" (:2538-2544; commit 1d8a6ed). It was dead code when it was deleted.

**Surviving claim:**
- 21 behavior rulings exist only as a TASKS record.
- One approved piece (ChordPicker) was deleted instead of rewritten.
- The splitter rules (`server/src/audio/chunked.js:1-17`) and `/mcp` behind the bearer token changed without being shown.
- RESEARCH :1251 calls the `/mcp` change "the user's ruling", which overstates it.

**FIX**
1. Recommended: show the 21 as a list, ChordPicker first, with the fact that the Hotkeys card was removed on 2026-10-05. No code change.
2. Attack: nothing new is introduced. Correcting RESEARCH :1251's "the user's ruling" is a records fix.
3. Surviving fix: show the list and fix the RESEARCH wording.

## 12. The `.jvsync` extension was chosen without the user
**Verdict:** PARTLY · **Severity:** VISIBLE (low)
**Evidence:**
- `server/src/sync.js:171` has `extension: "jvsync"`; also `SettingsPage.vue:1193` and `docs/sync.md:109`.
- It is listed under JV's unconfirmed "Choices made under 'your rec'" (JV TASKS :1002-1003).

**What is weak:** for JW the user confirmed the same pattern. JW TASKS decision 8 (:507-514): "7. Confirm my choices … The .jwsync file extension … — the four choices stand."

**Surviving claim:** JV's extension follows the user-confirmed `.jwsync` pattern, but JV's own was never shown.

**FIX**
1. Recommended: one line to the user: "`.jvsync`, like JustWrite's `.jwsync` — OK?" No code.
2. Attack: nothing new. If the user renames it, the blast radius is `server/src/sync.js:171`, `src/pages/SettingsPage.vue:1193`, `docs/sync.md:109`.
3. Surviving fix: ask the one line.

## 13. Speakers and corrections count as "the script"
**Verdict:** REFUTED · **Severity:** —
**Evidence:**
- Both are project rows: `speakers.project_id NOT NULL … REFERENCES projects ON DELETE CASCADE`, and the same for `speaker_corrections` (`server/src/database/models_schema.js:406, :646`).
- Every script line points at a speaker: `blocks.speaker_id REFERENCES speakers ON DELETE SET NULL` (:600).
- The approved words, "projects, scripts, personas and lexicons, but not the audio, voice files or generated takes", cover a project's own rows and exclude only the named ones.
- Leaving speakers out would strip every synced line of its speaker on the other computer.
- There is no gap to fill. The cast (`speakers.persona_id`) joins two approved sides: projects and personas.

**Surviving claim:** none.

## 14. A persona's picture does not sync
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- `server/src/sync.js:37` has `exclude: ["avatar_path"]`, and `docs/sync.md:12` lists "persona pictures" as staying.

**What is weak:**
- No screen sets or shows a persona picture.
- The UI avatar is the name's first letter on a colour (`PersonasPage.vue:451`, `StudioCast.vue:868`).
- `avatar_path` is only passed through: by API bodies (`personas_api.js:296, 326`) and by Duplicate (`PersonasPage.vue:363`).
- The claimed effect ("a synced persona arrives with no picture") cannot be reached through the app.

**Surviving claim:** an API-only field was left out of sync without a word, and the user docs describe "persona pictures" that no screen offers.

**FIX**
1. Recommended: one line to the user. Are persona pictures a feature?
   - If not: remove the field and the doc mention (the removed-everywhere rule).
   - If yes: they are files, and stay per computer like voices.
2. Attack: nothing new. Blast radius if removed: `server/src/models.js`/schema `personas.avatar_path`, `server/src/storage/personas.js:68,146,186,199,244`, `server/src/api/personas_api.js:296,326`, `src/pages/PersonasPage.vue:363`, `server/src/sync.js:37`, `docs/sync.md:12`.
3. Surviving fix: ask. No code until answered.

## 15. An imported voice bundle now keeps its id
**Verdict:** CONFIRMED · **Severity:** INTERNAL
**Evidence:**
- `server/src/voice_bundle.js:137-138`: `ownId = … voicesStore.get(m.id) == null ? m.id : ""`.
- It is listed only in the unconfirmed BUILT choices (JV TASKS :1004-1005; commit ca75306).

**Refutation tried:** it is what lets a synced persona find its voice when the voice is carried by hand. But other designs exist (re-pick, match by name), and the user saw none of them.

**Surviving claim:** voice import behavior changed to serve sync. It was never shown. The effect is invisible and benign.

**FIX**
1. Recommended: one line to the user. Keep it unless they object.
2. Attack: nothing new. If reverted, the blast radius is `server/src/voice_bundle.js:137-138` and `server/tests/c_features.test.js` (the voice-id test).
3. Surviving fix: tell the user.

## 16. A backup restore and a factory reset act on sync
**Verdict:** CONFIRMED · **Severity:** DATA
**Evidence:**
- `server/src/data_admin.js:211-218`: `onReplaced` calls `flushSync()`, so "the restored projects sync as this device's change". `:198-200`: a reset calls `resetSync` (a new library).
- Mechanism:
  - The kit's restore (`platform/data_api.js:236-250`) deletes every row and then inserts the backup's rows.
  - The sync triggers fire: delete notes, then insert notes for every column (`just-sqlite-sync/src/schema.js:76-104`).
  - The sync tables are not restored, since they are not in `models_schema.js`.
  - `flush()` gives every restored field a fresh stamp from this device (`engine.js:149-171`).
  - Rows created after the backup get fresh deletions.
- The rule (`engine.js:5-7`): "per field, the newer stamp wins; a delete beats older edits".
- So every edit made on a paired or cloud-folder computer between the backup and the restore is overwritten there, and any project or line created in that window is deleted there.
- `docs/sync.md:139-140` mentions it ("counts as an edit"). No user decision covers it.
- JW does the same: JW `server/src/data_admin.js:86-91`, recorded only in BUILT, "restore's writes are stamped" (JW TASKS :547).

**Surviving claim:**
- Restoring an old backup on a synced computer rolls every paired computer back to the backup and deletes newer projects and lines there.
- A factory reset unpairs this computer.
- The user decided neither.

**FIX**
1. Recommended: put the policy to the user. After a restore on a synced computer, which wins?
   - (a) The backup, everywhere (today's behavior), with a warning in the restore confirmation when sync is on.
   - (b) The other computers' newer work: restore the engine's own tables with the data, so restored rows keep their old stamps.
   - (c) The restore starts a new library, like reset.
2. Attack:
   - There is no outside standard. This is our own sync product's policy (CRDT/HLC last-writer-wins by field).
   - (b) needs a restore that also copies the `sync_*` tables. They are in the backup file, but `data_api` copies only the declared metadata. The engine's device-id handling for a copied database (`engine.js:50-60`) has to be checked.
   - (c) only delays the overwrite: joining back merges, and `adoptExisting` stamps rows fresh (`engine.js:177-195`).
   - New wording (open question): the restore warning's text in the kit's `ui/src/components/DataManagement.vue`.
   - The factory-reset unpairing likewise needs a line in the reset confirmation (wording open).
   - Blast radius: JV `server/src/data_admin.js:198-219`; JW `server/src/data_admin.js:78-92`; kit `server/src/platform/data_api.js:218-271`, `ui/src/components/DataManagement.vue`; `just-sqlite-sync/src/app.js` (reset/open), `src/engine.js`; `docs/sync.md` in JV (:137-140) and JW (:151-154).
3. Surviving fix: ask (a)/(b)/(c) first. Until then, the smallest safe step is (a)'s warning, after the user approves its words. It is family-wide (JV and JW).

## 17. A JustVoice-only deletion log sits beside the sync product
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- `server/src/sync.js:61-89`: its own `jv_sync_deleted` table and `BEFORE DELETE` triggers on 6 tables. `:100-137`: `projectScope`.
- It is never pruned (no `DELETE FROM jv_sync_deleted` anywhere).
- It was recorded only in BUILT (JV TASKS :1007-1009).

**What is weak:** the gap is JV's alone.
- The product's `units.scope(table, pk)` gets only the primary key.
- JW's synced tables lead their keys with `project_id` (`justwrite-app/server/src/database/models_schema.js:244, 271, 332`), so JW never needs it.
- JV's single-`id` keys do need it.
- The family rule ("a gap is filled in the kit") is about shared controls and services, and no other app has this gap today.

**Surviving claim:** about 60 lines of our own sync code (a table plus triggers, growing forever) were added without being shown.

**FIX**
1. Recommended: ask by name.
   - (a) Keep the JV-local log as NOT STANDARD, adding a prune rule.
   - (b) Have `@delebash/sqlite-sync`'s delete trigger record the row's parent columns, so every app gets scoped deletions.
2. Attack:
   - No outside standard. Both are our code.
   - (b) changes the product's schema (`src/schema.js` triggers) and its `changesSince` scope (`engine.js:247-290`).
   - Simpler alternative: let a by-hand file carry every deletion, unscoped. That drops the log, but a project's file would then delete rows in other projects. That is a behavior question.
   - New rule (open question): when to prune the log.
   - Blast radius: JV `server/src/sync.js:61-137`, `server/tests/sync.test.js`; for (b), `just-sqlite-sync/src/schema.js`, `src/engine.js`, `src/app.js`.
3. Surviving fix: ask (a)/(b) by name, with a prune rule for (a).

## 18. The sync notice offers Reload, with its own wording, in a copied watcher
**Verdict:** CONFIRMED · **Severity:** VISIBLE
**Evidence:**
- `src/services/syncWatch.js:10-31` is a line-for-line copy of JW `src/services/projectApi.js:170-190`, including the `let wait = 5` fallback.
- `:33-39` shows "Changes from another device arrived." / "Reload to see them." with `duration: 30000`.
- JW reloads by itself (`justwrite-app/src/boot/jw.js:224`).
- JW's user confirmed "The Sync screen's wording" (`SyncPanel`), not this notice.
- JV's notice is only in the unconfirmed BUILT choices (JV TASKS :1010).

**Surviving claim:** a copied watcher (the family rule: "Copies drift"), and a notice whose words, 30 s duration and ask-first behavior were never shown.

**FIX**
1. Recommended: one `watchSync(onChange)` in the kit UI, next to its `SyncPanel`. Each app passes its own `onChange`. Put the notice's words, its duration and ask-first vs reload-by-itself to the user.
2. Attack:
   - There is no outside standard for polling `GET /v1/sync/rev` (our product's route, `just-sqlite-sync/src/app.js:309`).
   - The loop itself could use VueUse's `useTimeoutPoll` (vueuse.org/core/useTimeoutPoll; `@vueuse/core` is already a kit dependency) instead of a hand `setTimeout` loop.
   - The toast is already Quasar Notify through the kit's `pushToast`.
   - Open questions: the two sentences, 30 s, the 5 s fallback, and ask vs auto.
   - Blast radius: JV `src/services/syncWatch.js`, `src/boot/jv.js:29,189`; JW `src/services/projectApi.js:170-190`, `src/boot/jw.js:20,224`; the kit `ui/src/common/index.js` exports.
3. Surviving fix: move it to the kit only after the user rules on the words and the behavior. The move itself needs no new wording.

## 19. Sync stays an app-only Settings section
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- `src/services/settingsSections.js:11`: "app section (not yet the family canon — docgen has no sync)".

**What is weak:**
- For JW the user confirmed the same choice and its reason. JW TASKS :511-514: "Sync as a JustWrite-only Settings section for now (adding it to the family list would fail JustVoice's and docgen's tests)" — "the four choices stand".
- The reason still holds for docgen.

**Surviving claim:** JV's instance was never shown, but it applies a rule the user confirmed. Negligible.

**FIX**
1. Recommended: no change. Mention it in the one-line sync-choices list (12, 15, 18, 20).
2. Attack: nothing new. No blast radius.
3. Surviving fix: include it in the list.

## 20. A podcast's Stories timeline doesn't sync
**Verdict:** PARTLY · **Severity:** VISIBLE (docs)
**Evidence:**
- `sync.js:31` omits `stories` and `story_items`.
- But `story_items.generation_id REFERENCES generations ON DELETE CASCADE` (`models_schema.js:882`). Generations are the audio the user excluded ("not the audio … or generated takes").
- Synced items would be deleted on arrival (the engine deletes a row whose parent is missing). A `stories` row alone would be an empty shell.
- So the exclusion follows from the approved words.
- `docs/sync.md:11-14` does not list Stories under what stays.

**Surviving claim:** the user docs don't tell podcasters that Stories stay on each computer.

**FIX**
1. Recommended: add Stories to `docs/sync.md`'s "What stays on each computer", and tell the user in one line.
2. Attack: the doc words are new (open question: "the Stories timelines" in that sentence?). Blast radius: `docs/sync.md:11-14` only.
3. Surviving fix: ask the one line with the proposed words, then edit the doc.

## 21. The kit's re-load-while-loading fix adds three behaviours of its own
**Verdict:** PARTLY · **Severity:** INTERNAL
**Evidence:**
- Approved (JV TASKS :866-868, :881-882): "run it when the load finishes — the user asked for it" — "your rec all go".
- Kit `runner/lifecycle.js:1819` keeps the newest ask; `:1864-1869` runs it "also after a failed load"; `:2044` "a stop wins over a re-tune".
- Commit 1347b49.

**What is weak:**
- "After a failed load" is a literal reading of "when the load finishes".
- "Newest wins" is the only way to run what the user last asked.

**Surviving claim:** one behavior was not in the approved words: a stop drops a kept re-tune. It follows the user's own later Stop.

**FIX**
1. Recommended: one line to the user. No code.
2. Attack: nothing new. If changed, the blast radius is kit `server/src/runner/lifecycle.js:1026-1029, 1814-1869, 2044, 2107` and its lifecycle tests.
3. Surviving fix: tell the user.
