<!-- SPDX-License-Identifier: MIT -->
# The engine-lifetime leftovers — clean exit codes, shutdown with a token, the splash's server half, the solo MTP error

**Decided 2026-09-30** — the user: "ok … the small left overs can you do them test them complete
them on your own?"; the plan below was presented; then "you have a go and on 4 i dont understnad
what you are waiting for there is no other session so check and commit and do 4 as well  go and
push". So: items 1–4, the kit's uncommitted edits checked and committed first, and a push of both
repos. The tracker item is `docs/dev/TASKS.md` "Engine processes never outlive their server…"
(its OPEN list); item 4 is also the kit's (`../just-llm-runner/docs/dev/TASKS.md`).

## 1. The plan as presented (verbatim)

Yes: three of the four I can do, test and finish myself. The fourth is blocked. Here's the plan for each; nothing has started.

**1. Engines log exit code 1 when stopped cleanly** (the cause is found)
- The engine's `/shutdown` kills itself before its reply goes out. The manager then force-kills the launcher that is still winding down, and on Windows a forced kill always records exit code 1.
- **Fix:**
  - The engine answers `/shutdown`, then exits with 0.
  - The manager waits up to 2 s for it to leave on its own, and forces only if it doesn't.
  - The plugin goes to 0.3.1, so each engine gets the fix the next time it starts.
- **Test:**
  - Unit tests for the route and for the manager's wait.
  - Live: load an engine in your app, stop it, and check the log says exit code 0.

**2. Closing the app is refused (401) when "Require a token even on localhost" is on**
- The kit already lets two things through from this machine even when a token is required: the health check and the token settings door. Its stated reason is that anyone at the machine could edit the database anyway. Shutdown fits the same reason, since any program on the machine can already end the server process.
- **Fix:** the kit's auth takes a per-app list of paths that stay open from this machine. JustVoice passes `/v1/shutdown`; JustWrite and docgen pass nothing, so nothing changes for them.
- **Test:**
  - A kit test, plus a JustVoice test: allowed from this machine, refused from elsewhere.
  - Live: turn the setting on in your app, close the app, check the shell log says "server shut down cleanly", then put your settings back exactly as they were. The app's UI may be locked out while the setting is on; the settings door stays open from this machine, so I can always restore them.

**3. The splash's "Stop them and retry" button**
- A real failed model load can't be staged without breaking your model setup, so the page half stays unit-tested.
- **Live test of the server half:** start a stray engine by hand, with no server watching it. Check the app lists it (engine, pid, GPU memory), check "stop" removes it, then restart the app and confirm the startup sweep catches another one.

**4. Kit: the solo MTP error still runs both retry stages — blocked**
- The other kit session still has uncommitted edits in the same files (`lifecycle.py`, `process.py`, `config.py`, `test_lifecycle.py`). **Rec: leave it until they commit.**

**What each change touches (pasted greps)**

| Item | Hit | Effect |
|---|---|---|
| 1 | `justvoice_plugin/server.py:303: @app.post("/shutdown")` | the only engine shutdown route: answers, then exits 0 |
| 1 | `manager.py:1440: self.client.post("/shutdown", timeout=2.0)` | its only caller, inside `terminate`; now waits before forcing |
| 1 | `manager.py:1379, 1384, 1414: self.terminate()` | unload, a failed start, stop — all get the short wait |
| 1 | `manager.py:571: PLUGIN_VERSION = "0.3.0"` | → 0.3.1, refreshed into each engine at its next start |
| 2 | `llm_runner/platform/auth.py:76` (health and server-auth open from this machine) | gains the per-app list |
| 2 | `justvoice/app.py:178` · `justwrite_server/app.py:112` · `just_ai_i18n_docgen/app.py:413` | the three apps that build the middleware; only JustVoice passes a path |
| 2 | `src-tauri/src/lib.rs:372` (the shell's `POST /v1/shutdown`) | unchanged; it gets 200 instead of 401 |
| 2 | `system_api.py:39` (`/v1/shutdown`'s own this-machine-only check) | unchanged; still 403 from elsewhere |

**What a go would cover:**
- Items 1–3 with their tests and docs.
- The live checks in your app, with every setting restored.
- One commit each in JustVoice and the kit, touching only my files.

Pushing is a separate word; say "go and push" if you want both. Item 4 waits.

## 2. Built (2026-09-30)

**Before anything: the kit's uncommitted work.** It was the 2026-09-28 session's: the llama.cpp
pin moved b10750 → b11239 (kit TASKS, "do 1") and `update_check` offering the newer of the tested
build and the stable channel's (`latestKind`, "your rec go"), with three new tests and the
records. Reviewed diff by diff; the kit suite passed (1009) once the GPU was idle — ten tests read
real VRAM and failed while the app held the AI model — and JustWrite's code touches none of it.
Committed as kit `ec3633b`.

| Item | Where |
|---|---|
| 1 — a clean stop exits 0 | `justvoice_plugin/server.py` `/shutdown` answers, then `threading.Timer(EXIT_AFTER_REPLY_S, os._exit, (0,))`; `manager.EngineProcess.terminate` waits `SHUTDOWN_EXIT_WAIT_S` (2 s) after an answered `/shutdown` before forcing; `PLUGIN_VERSION` and `justvoice_plugin/pyproject.toml` → 0.3.1 |
| 2 — the close works with a token required | kit `llm_runner/platform/auth.py`: `BearerAuthMiddleware(..., loopback_open_paths=())`; JustVoice `app.py` passes `("/v1/shutdown",)`; JustWrite and docgen pass nothing |
| 3 — the splash's server half | no code: tested live (below) |
| Docs | `settings-reference.md` (`auth`), `run-modes.md`, `whats-new.md`, `code-map.md` §3e |

**Tests.** JustVoice `test_engine_lifetime.py` +5: a real plugin engine answers `/shutdown` and
exits 0; the manager leaves an engine that answered to exit, still terminates one that stays,
and terminates one that never answered at once; `/v1/shutdown` needs no token from this machine
with the setting on (and gets 401 from elsewhere). Kit `tests/test_auth_middleware.py` (new, 6):
the whole policy — no tokens, loopback, the lockout escape, an app's own open paths from this
machine only, and an app that names none is unchanged.

**Live, in the real app (one window each time; your data dir):**
- 1: Kokoro loaded and unloaded — the plugin refreshed to 0.3.1 at spawn, and the log says
  `engine kokoro stopped: pid 5556, server pid 4448, exit code 0`. Its GPU memory was released
  (the whole-machine numbers on that line moved with the AI model loading at the same moment;
  per process, only llama-server and desktop programs held memory afterwards).
- 3: a stray Kokoro engine started by hand with no server watching it — `GET
  /v1/engines/leftovers` listed it (Kokoro, its pid, 0 MB — it loaded nothing), `POST …/stop`
  removed it, no engine processes left. A second stray was left running across a restart: the
  startup sweep logged `stopped 1 leftover engine process tree(s) whose server is gone — kokoro
  pid 15036`.
- 2: "Require a token even on localhost" turned on with a test token (confirmed: 401 without it,
  200 with), the window closed — the shell logged `server shut down cleanly`, not the kill.
  Then your setting was put back exactly (`tokens: [], require_for_loopback: false`) and the
  token file deleted.

**Not done — item 4.** Reading the code: for a failure with nothing else loaded, stage 1 (unload
the co-residents) never runs — it needs co-residents — so a solo "invalid vector subscript" runs
stage 2 alone: a full engine restart, then a retry that fails the same way when the cause is
memory held by another program. The kit tracker leaves the fix open between two behaviours, so
it went back to the user with a recommendation.
