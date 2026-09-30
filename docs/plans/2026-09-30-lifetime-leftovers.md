<!-- SPDX-License-Identifier: MIT -->
# The engine-lifetime leftovers — clean exit codes, shutdown with a token, the splash's server half, the solo MTP error

**Decided 2026-09-30** — the user: "ok … the small left overs can you do them test them complete
them on your own?"; the plan below was presented; then "you have a go and on 4 i dont understnad
what you are waiting for there is no other session so check and commit and do 4 as well  go and
push". So: items 1–4, the kit's uncommitted edits checked and committed first, and a push of both
repos. These were the OPEN list of the tracker item "Engine processes never outlive their
server…"; with them done the item closed, and its full text — the 2026-09-29 decision verbatim,
what was built then, and the OPEN list — is kept as §3 below (close = delete from the tracker).

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

**Item 4.** Reading the code: for a failure with nothing else loaded, stage 1 (unload the
co-residents) never runs — it needs co-residents — so a solo "invalid vector subscript" runs
stage 2 alone: a full engine restart, then a retry that fails the same way when the cause is
memory held by another program. The kit tracker left the fix open between two behaviours; it went
back to the user with a recommendation, and the answer was **"b go"**. Presented, verbatim:

"When nothing else is loaded, the first retry stage (unload the other models) can't run, so a
solo "invalid vector subscript" goes straight to the second: a full engine restart and one more
try. When the cause is memory held by another program, which is what we measured on 09-29, the
retry fails the same way and the restart only adds time. **A.** Never restart on a solo failure;
fail at once with the message that names what's holding the GPU. **B (my rec).** Check first. If
other programs hold GPU memory (200 MB or more, the same check the message uses), fail at once
and name them, because a restart can't free their memory. Otherwise restart and retry once, as
now. B skips the restart only where it can't help, and keeps the one retry for causes we can't
see from outside, like a crashed engine that a restart clears."

The kit's tracker item ("The MTP solo-crash message blames causes the log contradicts") was
deleted when this closed it — close = delete; git keeps it.
Built: kit `lifecycle.py` — before stage 2's restart, `_other_gpu_holders()` (the one
whole-machine query, ≥ 200 MB, not the engine's own processes); any holder → fail now with
`_draft_failed_alone` naming them; none, unmeasurable or a failing probe → restart as before. The
terminal message moved into `_draft_failed_alone` (one builder for both), and `_gpu_holders_note`
takes the rows already measured so the query runs once. The check sits before the restart
whichever way the load became solo — nothing loaded from the start, or after stage 1 unloaded the
co-residents: either way the next step was a restart that can't free another program's memory.
Tests: `test_load_failure_message.py` +4 (holders skip the restart; none → one restart; a probe
that fails, or can't measure → one restart); `test_draft_crash_escalates_to_restart_keeping_mtp`
now fixes the probe to "nobody", since the real one reads this machine's card. Docs: `gpu.md`
(the MTP bullet), `whats-new.md`.

## 3. The tracker item this closed (moved here verbatim, 2026-09-30)

### Engine processes never outlive their server, and a GPU-memory failure says who holds it
STATE:  DECIDED 2026-09-29 — "your rec go", then "go on all", on the user's "is there a fix we
        can add in app to make sure all process close when app closes and better logging?"
        after the app's model failed to load ("could not load its speculative-decoding (MTP)
        draft"). FINDING that evening: five engine pairs (Kokoro ×3, Whisper ×2) orphaned by
        hard-killed servers survived four restarts, Whisper holding 1.6 GB of the 8 GB card, and
        the model's fixed GPU split left no room for its draft; stopping them fixed it. The
        rec as given:
        1 "Each engine watches the server that started it. The server passes its own process ID
          to every engine it starts. The engine checks every couple of seconds and exits if that
          server is gone, however it died (closed, crashed or killed). This works the same on
          Windows, Mac and Linux, and it's the piece that actually closes the gap."
        2 "A startup sweep. When the server starts, it finds engine processes from this install
          whose server no longer exists, stops them, and logs what it stopped and how much GPU
          memory that freed."
        3 "A graceful close. On window close the shell asks the server to shut down and waits a
          few seconds, so engines stop cleanly and release the GPU at once. Only if that doesn't
          happen does it hard-kill, as today."
        4 "Better logging and errors. Log every engine start and exit with its process ID, its
          server's ID, and the GPU memory before and after. When a model fails to load for
          memory reasons, name what's holding the GPU, e.g. '1.6 GB is held by 2 Whisper
          processes from an earlier session', with a button to stop them. The error you saw sent
          you the wrong way ('raise n_cpu_moe… re-download the draft'). That wording comes from
          the shared kit, where it's already a known open item; fixing it there helps JustWrite
          too."
WHY:    `child.kill()` in `src-tauri/src/lib.rs` is TerminateProcess on Windows; the server's
        engine cleanup is an `atexit` hook, which a hard kill skips (`engines/manager.get_manager`
        docstring: "a hard-killed host still orphans engines").
GO:     given 2026-09-29
BUILT:  2026-09-29, all four parts. 1 `justvoice_plugin/lifetime.py` (plugin 0.3.0, refreshed
        into each venv at spawn): the engine watches JUSTVOICE_SERVER_PID and exits when that
        server is gone. 2 `engines/leftovers.py`, run by `serve.py` before uvicorn starts, plus
        GET/POST /v1/engines/leftovers[/stop]. 3 POST /v1/shutdown (this machine only) and
        `stop_child()` in `src-tauri/src/lib.rs` on every close/stop/restart; hard kill only as
        the fallback. 4 start/load/stop log lines with pid, server pid, memory before -> after;
        the kit's failed-load message leads with other GPU holders and llama.cpp's own error
        line (kit TASKS item updated; its escalation half stays open); the splash says e.g.
        "1.5 GB of GPU memory is held by 2 Whisper STT processes from an earlier session" with
        Stop them and retry (`LeftoverEnginesHelp.vue`, kit `BootModelLoad` #failed slot).
        VERIFIED live in the desktop app: window close -> engines gone 1.1 s, server 1.2 s,
        window 1.9 s, VRAM 2379 -> 576 MiB ("server shut down cleanly"); server hard-killed ->
        both engines exited on their own in 2.3 s; startup sweep stopped a planted orphan and
        logged it; serverless window close fell back to the kill. Suites: JV 880 passed, kit
        1009 passed, unit 110, gate passed (every view, zero JS errors), JV + JW vite builds, cargo check.
        NOT verified live: the splash button under a real failed load (unit-tested only).
        Committed and pushed: JV `24149e5`, kit `eb83043` (the kit's own hunks only — the kit
        working tree held another session's uncommitted edits in lifecycle.py, TASKS.md and
        test_lifecycle.py, staged around by hunk and tested alone: 1006 passed).
OPEN:   (not decided, surfaced 2026-09-29)
        · The kit still reads a SOLO draft "invalid vector subscript" as the co-load race and
          runs both escalation stages (stage 2 restarts the engine) before failing — kit TASKS
          "The MTP solo-crash message blames causes the log contradicts", its open half.
        · With "Require a token even on localhost" on (Settings → Access tokens), the shell's
          POST /v1/shutdown gets 401 and the close falls back to the hard kill (engines still
          exit on their own within ~2 s). Exempting /v1/shutdown on loopback would be a change
          to the kit's auth policy (`llm_runner/platform/auth.py`).
        · On a clean stop each engine logs exit code 1 (`EngineProcess.terminate`: POST
          /shutdown, then TerminateProcess if still alive). Memory is released at once either
          way; whether the plugin's /shutdown ends the process on its own was not checked.
DECIDED 2026-09-30 — "you have a go and on 4 … there is no other session so check and commit and
        do 4 as well  go and push", on the plan for all three plus the splash's live test. The
        plan, verbatim, with its blast radius: `docs/plans/2026-09-30-lifetime-leftovers.md` §1 —
        READ IT. 1 · the engine answers /shutdown then exits 0; the manager waits ≤2 s before
        forcing; plugin 0.3.1 · 2 · the kit's auth takes a per-app list of paths open from this
        machine, JustVoice passes /v1/shutdown · 3 · the splash's server half tested live with a
        staged stray engine · 4 · the kit's uncommitted edits checked and committed, then the solo
        MTP escalation fixed · push both repos.
BUILT:  2026-09-30 — 1, 2, 3 (what, where, the live checks: the plan doc §2). The kit's pending
        work (the b11239 pin, Update offering the tested build) reviewed and committed as kit
        `ec3633b`. 4 — DECIDED "b go" (verbatim: the plan doc §2): before the engine
        restart the kit looks for other programs holding GPU memory and, if any, fails at once
        naming them; otherwise it restarts once as before. BUILT the same day (plan doc §2).
