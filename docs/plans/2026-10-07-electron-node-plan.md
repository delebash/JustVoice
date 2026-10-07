<!-- SPDX-License-Identifier: MIT -->
# The family moves to Electron and a Node server — the plan

**Status:** **approved 2026-10-07** ("your rec on all go", on §10's nine leans — TASKS "The
family moves to Electron and a Node server", word for word). Step 0 is done; step 1 has its go;
steps 2–5 each need their own (§10 Q1).

**Records:** the study, with every ruling as shown —
[`2026-10-05-electron-node-study.md`](2026-10-05-electron-node-study.md) (read §9 before any
step); the decisions of 2026-10-07 — JustVoice `docs/dev/TASKS.md`, the item's `THEN:` block;
the facts — `docs/dev/RESEARCH.md` §6 and the kit's `docs/dev/RESEARCH.md` §2. Pointers to this
plan sit in the kit's, JustWrite's and docgen's TASKS.

**What was decided, in short** (full text in the study §9 and TASKS):

- Electron on desktop, a Node server, plain JavaScript; Tauri, Rust and Python go — all four
  repos (2026-10-05).
- All audio math moves into our audio.cpp copy; plain Electron with Capacitor for phones only;
  the window loads from `app://`; headless is the app's own exe run as Node; the databases keep
  today's schema exactly; the dev data root is `<repo>/data` (2026-10-05, Q1–Q6).
- The order: spikes → audio math into audio.cpp → the kit → docgen → JustWrite → JustVoice. A
  server feature freeze in each app only while it is moving. Electron 45 as the target
  (2026-10-07).
- The spikes ran on both Electron 44.7.0 and 45.0.0-alpha.16, because 45 had no beta yet
  (2026-10-07).

---

## 0 · What the family is after the move

This is the destination. Every step below moves one piece toward it.

**Each app (JustVoice, JustWrite, docgen) is one Electron app:**

- **The main process** is the kit's shared main module plus a short per-app config (name, icon,
  tray items, window size). It owns the window, the tray, dialogs, the data folder and the
  server's life. No business logic lives there — the rule that kept logic out of Rust carries
  over.
- **The window** loads the app's built UI from `app://` (ruling 3). The UI is today's Vue build.
  Its one door to the shell stays `src/services/native.js`, which calls a preload bridge
  instead of Tauri's `invoke`. If the server is down the window still opens and shows the kit's
  connection-error screen, as today.
- **The server** is one JavaScript module (Fastify), started by main in a `utilityProcess`. It
  answers the same routes with the same JSON as today — JustVoice's snake_case, the kit's
  camelCase — and opens the same SQLite file with the same schema (ruling 5).
- **Headless** is the same exe run as Node: `justvoice-server serve` (and the other apps'
  equivalents) is a launcher that runs the app's exe with `ELECTRON_RUN_AS_NODE=1` and the
  server module (ruling 4). It serves the same UI at `/ui/`. The launcher is never named
  `justvoice` — the Windows `CreateProcessW` trap moves to it.
- **One data-folder ladder**, a JavaScript module in the kit, used by main before the window
  opens and by the headless server. The dev root is `<repo>/data` (ruling 6). Chromium's own
  files (`sessionData`) and the window position live under the chosen root, so nothing lands
  where the user didn't choose (the 2026-08-14 ruling Tauri broke).
- **Every program the server starts** — llama-server, audio.cpp, ffmpeg, the hardware probes —
  goes through the kit's one spawn door. On Windows that door puts the program in a
  kill-on-close Job Object (through koffi), so the whole tree dies however the server ends
  (measured, §1.1).
- **All sample math runs in our audio.cpp** (ruling 1). The server passes audio and parameters;
  mastering stays ffmpeg.

**The language is plain JavaScript (ES modules) on Electron's Node — 24 today — with no
TypeScript.** Tests are vitest, with `fastify.inject` for routes. Installers come from
electron-builder.

**What the user sees:** the same app, the same data and the same screens. It starts faster —
today's frozen server spends 7 s unpacking before it can answer (study §1). The installer is
~112 MB before the speech runtime, which is downloaded as today.

**Not part of this plan:**
- auto-update — electron-updater can do it later;
- dictation's C++ addon (Q7) — only when dictation is built;
- the phone app (Q8) — its own plan, after JustWrite moves.

**What goes:**
- all four Python servers — ~73,000 lines and ~44,000 lines of tests (study §3.2);
- the Rust shells — ~4,200 lines;
- PyInstaller, the uv venvs, `scripts/py.js`, ruff and pytest.

---

## 1 · Step 0 — the spikes, and what each settles (done 2026-10-07)

Run on Windows 11 with Electron **44.7.0** (Chromium 152) and **45.0.0-alpha.16** (Chromium
156), both on Node 24.21.0; koffi 3.3.2, better-sqlite3 13.0.3, Kysely 0.29.6. The scripts are
throwaway, kept outside the apps (in the 2026-10-07 session's scratchpad, `spikes/`). **Every
result was the same on both versions** except the boot timing in §1.2.

### 1.1 The server's life — spikes A and B (*measured*)

The test tree: main → the server in a `utilityProcess` → `cmd.exe` (the server's child) →
`PING.EXE` + `conhost.exe` (grandchildren) — the shape of llama-server's router starting
per-model children. "Child job" = the server put its child in a kill-on-close job through koffi
(the JavaScript twin of the kit's `runner/process.py` `_win_job_for_child`). Electron was
started outside any job, as a user's launch is. State read 3 s after the act.

| Act | Child job | Server | Child | Grandchildren |
|---|---|---|---|---|
| A0 · hard-kill main | no | ended | ended | **survived** |
| A1 · hard-kill main | yes | ended | ended | ended |
| A2 · hard-kill main, main also put the server in a job | yes | ended | ended | ended |
| A3 · `app.quit()` | yes | exit code 0 | ended | ended |
| B1 · hard-kill the server | no | — | ended | **survived** |
| B2 · hard-kill the server | yes | — | ended | ended |
| H1 · headless (exe run as Node), hard-kill | yes | — | ended | ended |
| H2 · headless, hard-kill | no | — | ended | **survived** |

What it settles:

- **The server can't orphan.** A `utilityProcess` ends when main dies, even a hard kill (A0).
  No watchdog is needed. Measured on Windows; macOS and Linux are checked in step 2 (§1.6).
- **The kit's spawn door keeps its kill-on-close job.** Without it, grandchildren survive every
  way the server can end (A0, B1, H2) — for llama-server, that's leaked VRAM. With it, the tree
  dies every time (A1, B2, H1). This confirms the study's plain-Node finding inside Electron.
- **Main needs no job of its own** (A2 changes nothing).
- **The graceful stop is ours to write.** `app.quit()` ends the server with exit code 0; whether
  the server's own cleanup ran wasn't tested. Main asks the server to stop over `parentPort`,
  waits, then kills — what JustVoice's shell does today with `POST /v1/shutdown`
  (`src-tauri/src/lib.rs:235-257`), now for all three apps (closes the kit's FINDING "JustWrite
  and docgen hard-kill their servers").
- Electron 46 (stable 2027-01-05, per its schedule) changes `utilityProcess` `child.kill()`: no
  forced kill two seconds later on POSIX. The stop must not lean on that fallback.
- The job flags seen (`0x3c00`) are libuv's own job: a Node process shows them only after its
  first `spawn`, never at start. libuv's job lets grandchildren break away silently — which is
  why it doesn't protect them (B1, H2).

### 1.2 The window and the server — spike A (*measured*)

- **`app://` reaches the server.** With the scheme registered as `standard`, `secure`,
  `supportFetchAPI`, `corsEnabled`, `stream`: `fetch` and `EventSource` (SSE) to
  `http://127.0.0.1:<port>` work; `isSecureContext` is true; requests carry
  `Origin: app://<host>` and are cross-site, so a JSON `POST` sends a CORS preflight. **The
  server's CORS list must allow the `app://` origin.**
- **No Local Network Access block** in either version (turning those Chromium checks off
  changed nothing).
- **The boot race.** Timings measured from main's start: main ready at ~40 ms, the page
  starting to load ~60 ms, the server listening ~170 ms. On 45 the page's first request came
  before the server listened and was refused (`net::ERR_CONNECTION_REFUSED`); on 44 it happened
  to come later. So:
  - the server tells main when it is listening, with its port, over `parentPort`;
  - the kit's boot check keeps retrying, as it already does (`checkServer`, then the
    connection-error screen asking every 2 s — RESEARCH §6).

### 1.3 The database — spike C (*measured*)

On a read-only snapshot of the dev app's real database (`src-tauri/target/debug/data/
justvoice.db`, copied with SQLite's backup API — the original untouched): 49 tables (JustVoice
23 + the kit 26), 1,690 rows, **17,374 cells**, journal mode `delete`.

- **Both drivers read every cell exactly as Python's `sqlite3` does** — better-sqlite3 and
  `node:sqlite`, 0 mismatches. Integers were read as BigInt for the test so rounding couldn't
  hide a difference.
- **No integer is beyond 2^53** (the largest, a `BIGINT`, is 14,249,047,104), so plain
  JavaScript numbers are safe.
- **How the values are stored** (by declared type):
  - `DATETIME` (29 columns) — text `2026-10-06 19:45:42.582131`, six fractional digits.
    JavaScript's `Date` holds milliseconds.
  - `BOOLEAN` (31) — `0`/`1`.
  - JSON lives in `TEXT`/`VARCHAR` columns, written by Python's `json.dumps` with its defaults:
    **347 cells use `", "` and `": "` separators**, and the **4 cells holding non-ASCII text
    escape it as `\uXXXX`**. `JSON.stringify` writes neither.
  - The render-cache key hashes `json.dumps(chain, sort_keys=True, separators=(",", ":"))`
    (`audio/effects.py:196`) — compact, keys sorted, and floats written `1.0` where JavaScript
    writes `1` (study §2.2.4). So Python's text depends on the options each call site passes.
- **Speed**, the largest table (`render_job_blocks`, 336 rows) read 2,000 times:
  better-sqlite3 ~305 ms, `node:sqlite` ~600 ms, Kysely over better-sqlite3 ~540 ms. All are
  fast enough; better-sqlite3 is twice as fast as `node:sqlite`.
- **Kysely works over both drivers** (`node:sqlite` through a 15-line adapter) and returns the
  same rows. It's MIT with no dependencies, and its core is browser-safe (only its migration
  files import `node:fs`/`node:path`).
- **Kysely deadlocks in one pattern.** If code inside an open transaction queries through the
  database handle instead of the transaction, the query waits forever: Kysely holds one
  connection behind a lock. It was measured — after that, every later query waited too, and
  Node exited with the work unfinished.
  - better-sqlite3's own `db.transaction(fn)` is synchronous, so a transaction can't stay open
    across an `await` at all.
  - That makes the study's hardest hazard (§3.3, "a transaction must never stay open across an
    `await`") impossible instead of a rule to remember.
- **Not tested:** Capacitor's SQLite (no phone runtime here). The one Kysely dialect for it on
  npm, `kysely-capacitor-sqlite`, was unpublished on 2023-10-31.

The questions this leaves — driver, query layer, text formats — are §10 Q2–Q4.

### 1.5 Drizzle against plain SQL — the query-layer test (*measured 2026-10-07*)

Asked for after the plan was written (TASKS, the item's `THEN:` block): Prisma and Knex were
skipped on what their docs and source show — Prisma needs its own schema file and code
generation, its default generator writes TypeScript, and it is async only; Knex is async with a
one-connection pool for SQLite (`dialects/sqlite3/index.js:228-229`), so the Kysely hang, ending
in a 60 s timeout (`client.js:253`). Drizzle 0.45.3 on better-sqlite3 runs in "sync" mode — its
transaction is better-sqlite3's own, nested ones are savepoints (`better-sqlite3/session.js:37-54`)
— so it was tested against plain SQL.

**How.** Both approaches use one column map taken from today's models (49 tables: 255 text, 56
integer, 31 boolean, 29 datetime, 16 float columns; the database's columns match the models
exactly). Plain SQL = better-sqlite3 plus a small helper that converts dates and true/false by
that map. Drizzle = tables generated from the same map, with two custom column types using the
same converters. The Python side is the app's own code — its SQLAlchemy models and its real
`LexiconStore` — on scratch copies of the same snapshot, with ids and clocks fixed so all three
outputs can be compared byte for byte. Electron 44.7.0 run as Node (Node 24.21.0).

| Check | Plain SQL | Drizzle |
|---|---|---|
| 1 · every value read, against what SQLAlchemy returns (dates as Python's `isoformat()`, true/false) | 17,374 cells, 0 differ | 17,374 cells, 0 differ |
| 2 · rows written with explicit values, stored bytes against SQLAlchemy's (78 rows, 39 tables: dates with and without microseconds, true/false, floats, non-ASCII text) | 714 cells, 0 differ | 714 cells, 0 differ |
| 3 · a query through the database handle while a transaction is open | finishes at once and sees the transaction's row (one connection, no lock) | the same |
| 3 · an `async` function given as the transaction | refused: "Transaction function cannot return a promise"; a write made before its first `await` is rolled back | refused, the same message |
| 4 · read 336 rows (with dates) 2,000 times, converted | 927 ms | 985 ms |
| 4 · insert 5,000 rows in one transaction | 90 ms | 193 ms |
| 5 · the lexicon store, ten steps (create, get, append, update, list, missing, delete ×2, get, create) | all 10 answers identical to Python's; both tables byte-identical | the same |
| 5 · lines | the port 108 + the helper ~70 | the port 106 + the table builder 20 + the dependency |

**What it shows.**

- **No difference in correctness or safety.** Both read, write and transact exactly like today's
  Python, and in both the deadlock can't happen.
- **Drizzle didn't save the column work.** It needed the same column map and the same two
  converters, as custom types. What it adds is the query-builder syntax (`eq`, `asc`) and table
  objects, whose main payoff is TypeScript types.
- **Drizzle costs** a pre-1.0 dependency (0.45.3; 1.0 is at release candidate 4, with breaking
  changes) and writes about half as fast. Both are fast enough: 18 µs against 39 µs a row.
- **Plain SQL** reads one-to-one against today's queries, and the same SQL text runs over a
  phone's SQLite.
- **The lean stays plain SQL** (§10 Q3).

**Found on the way.**

- **JSON text needs to know which numbers are floats.** `pyJson` reproduced Python's text for
  350 of the 355 JSON cells. All five differences are whole-number floats: Python writes
  `1.0`, JavaScript can't tell `1.0` from `1`.
  - Marking the effect parameters as floats brought it to 354.
  - The last one is `settings.data` (`"loudness_target_lufs": -20.0`).
  - Separators, `\uXXXX` escapes, key order and nesting never differed. The compact, sorted form
    the render-cache key hashes showed the same five, for the same reason.
  - So float-ness has to come from the field types — the validation schema's number-vs-integer
    — which ties §10 Q4 to Q5.
- **Both Node drivers turn foreign keys on by default; Python's `sqlite3` doesn't.**
  - JustVoice and JustWrite turn them on for every connection (`database/session.py:71-73`,
    JustWrite's `:49-51`).
  - **docgen never does** (`app.py:256`), so its step decides on or off deliberately (§5).
  - The restore paths that switch them off (`data_admin.py:162`, the kit's
    `platform/data_api.py:133`) keep doing so.
- **The lexicon store returns two time formats.** `create` answers with zone-aware times
  (`…21:00:01.123456Z`). `get`, `list` and `update` read times back from the database and answer
  without the `Z`. Both ports reproduce it; the route diff will flag any port that "fixes" it.

### 1.6 What step 0 didn't settle

- **Validation library** — zod 4 or TypeBox (study §3.3). That's §10 Q5. Either way it's proved
  on the kit's `Settings` model first: same defaults, coercion and 422 shape as pydantic.
- **macOS and Linux.** The spikes ran on Windows only. The POSIX half of the spawn door (process
  groups) is checked when the kit's door is ported in step 2.

---

## 2 · How every step is checked

Every step uses the same checks:

1. **Ported tests.** Each Python test file becomes a vitest file in the same commit as the code
   it covers. The count is tracked against the Python suite it replaces (2,273 test functions
   at the study).
2. **The route diff** — your rule: "the old and new servers run against the same database and
   each route's answers are compared." It's a kit script, `scripts/route-diff.mjs`: a list of
   requests per app, sent to the Python server and to the Node server, comparing the status and
   the JSON body.
   - **Read routes:** both servers on one copy of the dev data root — the database copied, the
     model caches shared read-only — with engines and warm-on-boot off. Never beside the running
     app on its own root: that's the two-copies-of-gemma trap (`CLAUDE.md`, the renderer gate).
   - **Write routes:** a recorded sequence replayed on two fresh copies. Then the answers, and
     both databases cell by cell (spike C's comparer).
   - **Engine routes** (load, generate, render, transcribe): their ported tests, then checked by
     hand in the real app.
3. **The smoke gate** — the same script, now pointed at the Node server.
4. **The real app.** Each app's step ends with the user's real app on the new build, on its real
   data root.
5. **Python stays runnable until its app's step is approved done.** Deleting it is that step's
   last slice, so the route diff has something to diff against until then.

---

## 3 · Step 1 — the audio math into our audio.cpp

Ruling 1 and its five conditions (study §9): its own module and endpoints in the fork; the
endpoints work with no model loaded; no sample math left in the server; mastering stays ffmpeg;
Python stays the reference until the C++ matches.

**Covers** (the pieces: study §2.1; where they are today: §9 B1):

- A DSP module in the fork (`delebash/audio.cpp`, branch `jv`), with its own files and
  endpoints:
  - the effects chain — gain, high/low-pass, EQ, delay, Freeverb, distortion, chorus,
    compressor;
  - resampling, crossfade joins and the piece joins, the analyzer, Kokoro blends and delivery
    gain;
  - pitch and speed — Signalsmith Stretch compiled in with a fixed seed (study §2.2 option c).
- JustVoice's server calls those endpoints. When the step ends, the §9 B1 grep comes back empty:
  no numpy, scipy or python-stretch in `server/justvoice`.
- The Kokoro "mean" blend sums in `voices.json` order. Today it sums in a per-restart order
  (study §2.2.3).
- `as_16k_mono` is deleted (study §2.2.5).
- **The render-cache key changes exactly for the renders whose audio changes**, and for no
  others. Today:
  - renders with an effects chain carry `DSP_VERSION` in their key (`audio/effects.py:181-197`);
  - renders without effects are keyed `noeffects`;
  - speed goes in through the delivery JSON (`delivery.py` `canonical_json`,
    `render_core.py:641-642`).

  Signalsmith changes pitch and speed output, so both need a new key mark. A plain
  `DSP_VERSION` bump would also re-key every effects render whose audio didn't change.

**Checked:**
- The study's comparison harness (`py_ref.py` against the new endpoints) shows bit-identical
  16-bit output for everything except Signalsmith.
- Signalsmith is deterministic: the same input twice gives the same bytes, at 16, 22.05, 24,
  44.1 and 48 kHz.
- Server pytest and ruff are green, and a chapter renders in the app.

**Release:** packaged builds need a new audio.cpp release, which means a tag. A tag needs your
word — the standing commit-and-push go doesn't cover tags.

---

## 4 · Step 2 — the kit

**Covers:**

- **`llm_runner` in JavaScript**, in the kit repo, mounted by each app as a Fastify plugin with
  today's factory shape: `installLlm(app, { engine, db, … })` (today `install.py:74-373`). Same
  routes, same camelCase JSON.
  - **`llm/`** is written browser-safe — storage, HTTP and files behind adapters — so the phone
    plan can reuse it (study §5.4, ruling 8).
  - **`runner/` and `platform/`** run in Node:
    - the spawn door with the koffi job (§1.1), keeping today's retry on Windows' transient
      "not found / access denied" (`process.py` `_SPAWN_ATTEMPTS`);
    - downloads: `fetch` with undici timeouts raised past JustVoice's 900 s, and
      `NODE_USE_ENV_PROXY` (study §3.3);
    - GGUF parsing, the hardware probes (`execFile` of the same tools), the cache registry and
      calibration.
  - **Shared helpers:**
    - the database helper (§10 Q3);
    - `pyJson` (§10 Q4);
    - Unicode-safe regex helpers (`\p{L}` with `/u`, a `casefold` equivalent) and a
      `SequenceMatcher` port — JavaScript's `\w`/`\b` are ASCII-only (study §3.3);
    - the 422 error shape (kit `errors.py:106-168`) and raised body limits.
  - **The schema** is the DDL Python creates today, captured from a fresh database, so a new
    database comes out identical in shape (§10 Q8).
- **The shared Electron main module:**
  - the data-folder ladder — one module, also used headless; it closes the kit's FINDING "the
    data-dir ladder's four copies disagree";
  - the window, with its position and `sessionData` stored under the root;
  - the tray, from a per-app item list;
  - dialogs: pick a folder or a file, save;
  - the opener;
  - the server's life: `utilityProcess`, the ready message, the graceful stop (§1.1–1.2);
  - the `app://` protocol and a written CSP;
  - the preload bridge — one object, read only by `native.js`.
- **The kit UI's shell switch.** `isTauriShell()` (`ui/src/common/services/external.js:36-37`)
  becomes a test for the bridge. `serverApi.js:51-52` needs no change: an `app:` origin falls
  through like `tauri:`.
- **The family guard and `app-structure.md`.** Updated with the first app that moves (docgen),
  because the guard checks the apps (study §7.2):
  - its Python-layout, Tauri-surface and ruff checks change;
  - the rule "no `window.<app>` global" becomes "one bridge object, read only by `native.js`".

**Checked:**
- The kit's ported tests (1,019 at the study).
- The route diff of the kit's routes. The Python side is docgen's or JustWrite's server mounting
  `llm_runner`; the Node side is a small host mounting the JavaScript kit; both on a copy of
  that app's data root.
- By hand: a llama-server router starts, loads, stops and is hard-killed. VRAM returns to
  baseline every time.

The kit runs both languages from this step until JustVoice moves — §10 Q6.

---

## 5 · Step 3 — docgen

The smallest server: 31 files, 4,975 lines, 32 routes, 1 table (study §3.2).

**Covers:**
- the server in JavaScript, mounting the kit;
- the shell becomes the kit's main module plus docgen's config;
- `native.js` moves to the bridge (four calls, §9 B5), and so do `App.vue`'s tray listener and
  `main.js`'s opener import;
- `package.json`: the Tauri packages and scripts go, Electron's come in (§9 B6);
- the e2e harness moves from tauri-driver to Playwright `_electron`;
- the electron-builder installer;
- user docs (§9 B7) and `CLAUDE.md` (11 lines naming Python or Tauri, §9 B9);
- **foreign keys:** docgen's server never turns them on (`app.py:256`), and both Node drivers
  turn them on by default (§1.5). This step decides on or off and says so;
- last: `server/` and `src-tauri/` are deleted.

**Checked:** ported tests (155), the route diff, docgen's e2e, the dev app on docgen's real
data root, and the installer installing and starting on this machine.

---

## 6 · Step 4 — JustWrite

Server: 33 files, 5,863 lines (2,201 of them seed data), 46 routes, 35 tables (study §3.2).

**Covers:** as docgen, plus:
- the book import posts a base64 zip as JSON — Fastify's body limit (1 MiB by default) is
  raised;
- JustWrite's extra shell calls: `pick_file`, `shell_save_file`, `set_tray_labels` (§9 B5);
- the 400 ms hold on close, so a `pagehide` autosave lands (study §4.2);
- user docs: README 33 lines, `getting-started.md` 6, `headless-access.md` 3 (§9 B7);
- **its dev root holds the family's shared model cache.** JustVoice's and docgen's saved cache
  folder, five saved measurement paths and two cache-registry lines point into it (§9 B8), so
  its rename comes with rewriting them (§10 Q9).

Then the phone app gets its own plan (ruling 8).

**Checked:** ported tests (128), the route diff, JustWrite's e2e, the dev app on JustWrite's
real data root, and the installer installing and starting.

---

## 7 · Step 5 — JustVoice

The largest: 176 files, 36,380 lines, 188 routes, 23 tables, plus the kit's (study §3.2).

**Covers:** as docgen, plus:
- **`native.js`'s six calls**, including `shell_save_file`, which came in after the study, and
  `App.vue`'s tray listener (§9 B5).
- **`DictateWindow.vue`'s two Tauri event imports.** The window is never created today (study
  §7.1), but the package goes, so they go through the bridge too.
- **The speech runtime** starts through the kit's spawn door. That's already the shape today:
  `engines/audiocpp/runtime.py:396` calls the kit's `spawn_child`.
- **`npm run dev`'s build of `../audio.cpp`** (`scripts/tauri.js`, `scripts/audiocpp-dev.js`) and
  the `JUSTVOICE_AUDIOCPP_BUILD` override move into the Electron dev script.
- **The dev data root moves once**, from `src-tauri/target/debug/data` to `<repo>/data` (ruling
  6), with the app closed. It's a rename on the same drive. That root holds the speech models,
  the caches and the database. JustVoice's database holds no absolute path into its own root
  (measured, §9 B8), so nothing inside needs rewriting.
- **The renderer gate recipe** in `CLAUDE.md` loses its `--data-dir` trap, because one ladder
  means one database.
- **The console-script naming rule** becomes the launcher's naming rule.
- **User docs:** eleven files name Python, Tauri or the server command (§9 B7); `CLAUDE.md` 25
  lines (§9 B9).
- **CI and release workflows** are edited only — they stay off by your ruling.

**Checked:** ported tests (971), the route diff, the smoke gate, a chapter rendered and played
in the dev app on the moved real root, and the installer installing and starting.

---

## 8 · The freeze, the version, the cadence

- **The freeze** (decided 2026-10-07): no new server features in an app while it is mid-move;
  page work continues. Bug fixes in that time — §10 Q7.
- **The Electron version.** The target is 45 (decided). The first app moves on the newest stable
  at that moment — 45 if it's out. On 2026-10-07 npm had only alphas of 45, against a schedule
  of stable on 2026-10-20.
  - Each later app moves on the then-current stable.
  - After that, all apps upgrade together on each major, within its ~6-month support window.
  - Electron 46's `utilityProcess` `kill()` change (§1.1) is the first known item for that
    upgrade.
- **No CI runs, no tags, no releases** without your word (standing rulings).

---

## 9 · Blast radius — pasted greps, 2026-10-07

Each table is a change, with its callers or producers and the exceptions already on that path.
The greps were run on `main`/`master` heads at JustVoice `e4d0d12`, kit `782d705`, JustWrite
`0094bd7`, docgen `951d9f9`, audio.cpp `a2601edf`.

### B1 · Step 1 — the server's sample math

`git grep -n -E "^\s*(import numpy|from numpy|import scipy|from scipy|import python_stretch|from python_stretch|…|import soundfile|from soundfile)" -- 'server/justvoice/*.py' ':!server/tests/*'`

```
server/justvoice/api/generate_api.py:15:import numpy as np
server/justvoice/api/voice_preview_api.py:883:    import numpy as np
server/justvoice/audio/analyzer.py:8:import numpy as np
server/justvoice/audio/chunked.py:32:import numpy as np
server/justvoice/audio/dsp/__init__.py:44:import numpy as np
server/justvoice/audio/dsp/__init__.py:81:        import python_stretch as ps
server/justvoice/audio/dsp/__init__.py:126:        import python_stretch as ps
server/justvoice/audio/dsp/_util.py:23:import numpy as np
server/justvoice/audio/dsp/biquad.py:27:import numpy as np
server/justvoice/audio/dsp/biquad.py:28:from scipy.signal import lfilter, sosfilt
server/justvoice/audio/dsp/delays.py:16:import numpy as np
server/justvoice/audio/dsp/dynamics.py:44:import numpy as np
server/justvoice/audio/dsp/dynamics.py:45:from scipy.signal import lfilter
server/justvoice/audio/dsp/freeverb.py:34:import numpy as np
server/justvoice/audio/dsp/freeverb.py:35:from scipy.signal import lfilter
server/justvoice/audio/effects.py:56:import numpy as np
server/justvoice/delivery.py:13:import numpy as np
server/justvoice/engines/audiocpp/slot.py:107:    import numpy as np
server/justvoice/engines/audiocpp/slot.py:559:    import numpy as np
server/justvoice/engines/audiocpp/slot.py:560:    from scipy.signal import resample_poly
server/justvoice/engines/blending.py:196:    import numpy as np
server/justvoice/engines/blending.py:223:    import numpy as np
server/justvoice/engines/blending.py:232:    import numpy as np
server/justvoice/engines/blending.py:254:    import numpy as np
server/justvoice/engines/blending.py:302:    import numpy as np
server/justvoice/engines/blending.py:323:    import numpy as np
server/justvoice/render_core.py:23:import numpy as np
server/justvoice/render_core.py:982:    from scipy.signal import resample_poly
```

The callers of those modules — `git grep -n -E "from (\.|\.\.|justvoice\.)?(audio(\.dsp|\.effects|\.chunked|\.analyzer)?|delivery|engines\.blending|mastering) import|…"`, the `dsp/` package itself dropped:

```
server/justvoice/api/analyzer_api.py:9:from ..audio.analyzer import analyze, compare
server/justvoice/api/generate_api.py:19:from ..audio.chunked import (
server/justvoice/api/generate_api.py:24:from ..audio.effects import apply_effects_chain
server/justvoice/api/master_api.py:13:from ..mastering import have_ffmpeg, master
server/justvoice/api/projects_api.py:41:from ..mastering import kind_master
server/justvoice/api/projects_api.py:1231:    from ..mastering import have_ffmpeg as _have_ffmpeg
server/justvoice/api/render_chapter_api.py:31:from ..mastering import have_ffmpeg, master, master_to_wav, resolve_master_target
server/justvoice/api/voice_preview_api.py:886:    from ..audio.chunked import held_for_next_seam, join_pieces, split_text_into_chunks
server/justvoice/api/voices_api.py:201:    from ..audio.analyzer import noise_margin_db
server/justvoice/audio/effects.py:58:from .dsp import DSP_VERSION, EFFECTS
server/justvoice/engines/manager.py:751:        from ..audio.chunked import DEFAULT_MAX_CHUNK_CHARS
server/justvoice/export_audiobook.py:26:from .audio.analyzer import analyze
server/justvoice/persona_render.py:23:from .audio.effects import chain_entries
server/justvoice/render_core.py:26:from .audio.chunked import (
server/justvoice/render_core.py:31:from .audio.dsp import STRETCH_RANGE, time_stretch
server/justvoice/render_core.py:32:from .audio.effects import apply_effects_chain, effects_chain_hash
server/justvoice/render_core.py:35:from .delivery import apply_gain_db, canonical_json
```

The byte-level WAV code — format plumbing, which moves in step 5 with the server, not into
audio.cpp. `git grep -n -E "^\s*(import wave|import audioop|import array|from array|import struct)\b|struct\.(un)?pack\(.*h|array\(['\"]h" -- 'server/justvoice/*.py'`:

```
server/justvoice/api/voice_preview_api.py:806:    import struct
server/justvoice/audio/effects.py:54:import wave
server/justvoice/audio/wav.py:10:import struct
server/justvoice/audio/wav.py:98:        + struct.pack("<I", chunk_size)
server/justvoice/audio/wav.py:103:        + struct.pack("<H", channels)
server/justvoice/cache.py:13:import struct
server/justvoice/cache.py:212:    return struct.pack("<IH", sample_rate, channels) + pcm
server/justvoice/engines/audiocpp/gguf_files.py:14:import struct
server/justvoice/engines/audiocpp/slot.py:26:import wave
server/justvoice/engines/manager.py:321:    import struct
server/justvoice/engines/tts_providers/elevenlabs.py:13:import wave
server/justvoice/export_audiobook.py:63:    import wave
server/justvoice/export_voicelines.py:51:    import wave
```

| Data overwritten | Producer | Exceptions already on the path |
|---|---|---|
| render-cache entries (their keys) | `effects_chain_hash` `audio/effects.py:181-197` (has `DSP_VERSION`; `"noeffects"` when empty) · `canonical_json` `delivery.py:26` · used at `render_core.py:641-642` | Signalsmith seeds from `std::random_device` at ratio > 2 (study §2.2.1) · Kokoro `set(pack)` order (`engines/blending.py:212`) · `as_16k_mono` works around v0.9.0 (`slot.py:540`) · `slot.py:568` rounds half-to-even |

### B2 · Step 2 — who imports the kit's server

`git grep -E '^\s*(from|import) llm_runner' -- 'server/*.py' ':!server/tests/*'` per app, then
the import roots counted:

```
-- JustVioce: 36 files, 96 lines
     23 from llm_runner.llm
     17 from llm_runner.runner.hardware
     11 from llm_runner.runner.arbiter
      9 from llm_runner.platform
      5 from llm_runner.runner.lifecycle
      4 from llm_runner.runner.download
      4 from llm_runner.llm.stores
      3 from llm_runner.runner.binary
      2 from llm_runner.runner.process
      2 from llm_runner.llm.seed
      2 from llm_runner.llm.preset_resolve
      2 from llm_runner.llm.model_measurements_api
-- justwrite-app: 7 files, 13 lines
      5 from llm_runner.platform
      5 from llm_runner.llm
      1 from llm_runner.runner.lifecycle
      1 from llm_runner.platform.errors
      1 from llm_runner
-- just_ai_i18n_docgen: 2 files, 16 lines
      6 from llm_runner.platform
      5 from llm_runner.llm
      1 from llm_runner.runner.lifecycle
      1 from llm_runner.llm.seed
      1 from llm_runner.llm.routing_api
      1 from llm_runner.llm.preset_resolve
```

JustVoice reaches deepest into the kit — `runner.hardware` 17 lines and `runner.arbiter` 11 — so
the JavaScript kit has to export those surfaces too, not only `installLlm`. Each app keeps
running the Python kit until its own step.

### B3 · Step 2 — every program a server starts

`git grep -n -E "subprocess\.(Popen|run|call|check_output|check_call)\(|create_subprocess_(exec|shell)\(|os\.startfile\(|_spawn_child\("` (tests dropped), all four repos:

```
just-llm-runner/llm_runner/platform/procs.py:35:    return subprocess.run(argv, creationflags=NO_CONSOLE, **kw)
just-llm-runner/llm_runner/platform/procs.py:40:    return subprocess.check_output(argv, creationflags=NO_CONSOLE, **kw)
just-llm-runner/llm_runner/platform/procs.py:45:    return subprocess.Popen(argv, creationflags=NO_CONSOLE, **kw)
just-llm-runner/llm_runner/runner/calibrate.py:256:            proc, job = _spawn_child(self._popen, argv, logf)
just-llm-runner/llm_runner/runner/process.py:946:def _spawn_child(popen, argv, logf, _sleep=time.sleep):
just-llm-runner/llm_runner/runner/process.py:1101:            proc, job = _spawn_child(popen, [str(server_exe), *flags], logf)
just-llm-runner/llm_runner/runner/process.py:1175:        proc, job = _spawn_child(popen, [str(server_exe), *argv], logf)
just-llm-runner/scripts/check-clean-install.py:169:    return subprocess.run(cmd, capture_output=True, text=True, **kw)
just-llm-runner/scripts/check-structured-output.py:160:    proc = subprocess.Popen(  # noqa: S603 — a trusted, already-installed release exe
JustVioce/server/justvoice/system_info.py:56:            out = subprocess.check_output(
```

The callers of the kit's no-console doors — `git grep -n -E "procs\.(run|check_output|popen)\(|…import procs"`:

```
just-llm-runner/llm_runner/runner/bandwidth.py:110:        brand = procs.run(
just-llm-runner/llm_runner/runner/binary.py:379:        proc = run() if run else procs.run(  # noqa: S603 — a trusted, just-unpacked release exe
just-llm-runner/llm_runner/runner/binary.py:439:            proc = run(argv) if run else procs.run(  # noqa: S603 — a trusted, just-unpacked release exe
just-llm-runner/llm_runner/runner/hardware.py:297:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:352:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:424:        out = procs.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
just-llm-runner/llm_runner/runner/hardware.py:516:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:554:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:605:            out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:629:        out = procs.run(["ps", "-o", "rss=", "-p", str(pid)],
just-llm-runner/llm_runner/runner/hardware.py:653:            return procs.run(cmd, capture_output=True, text=True,
just-llm-runner/llm_runner/runner/hardware.py:793:            return procs.run(cmd, capture_output=True, text=True,
just-llm-runner/llm_runner/runner/hardware.py:825:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:874:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:1009:        return procs.run(
just-llm-runner/llm_runner/runner/hardware.py:1067:        out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:1204:            out = procs.run(
just-llm-runner/llm_runner/runner/hardware.py:1212:                out = procs.run(
JustVioce/server/justvoice/mastering.py:226:        result = procs.run(cmd, capture_output=True, timeout=600)
JustVioce/server/justvoice/system_info.py:45:            out = procs.check_output(
JustVioce/server/justvoice/system_info.py:89:        out = procs.check_output(
```

And JustVoice's speech runtime — `git grep -n -E "popen|Popen|spawn" -- 'server/justvoice/*.py'`, the line that starts it:

```
server/justvoice/engines/audiocpp/runtime.py:396:            from llm_runner.runner.process import spawn_child
server/justvoice/engines/audiocpp/runtime.py:398:            popen = functools.partial(subprocess.Popen, cwd=str(exe.parent),
server/justvoice/engines/audiocpp/runtime.py:400:            proc, job = spawn_child(popen, [str(exe), "--config", str(conf_path), "--no-ui"], out)
```

| Change | Exceptions already on the path |
|---|---|
| the spawn door → `child_process` + koffi job | the retry on WinError 2/5 (`process.py` `_SPAWN_ATTEMPTS`, `_TRANSIENT_SPAWN_WINERRORS`) · `CANT_START` 0xC0000142 (`procs.py`) · `NO_CONSOLE` on every launch (kit `782d705`) · `system_info.py:56` calls `subprocess` directly, outside the doors |

### B4 · Step 2 — the data-folder ladder, every copy

`git grep -n -E "dataroot\.txt|fn exe_dir|fn data_root|def default_data_dir|def install_dir|user_data_dir\(|app_data_dir\("` (tests and node_modules dropped):

```
just-llm-runner/llm_runner/platform/data_paths.py:90:def install_dir(source_root: Path | None = None) -> Path | None:
just-llm-runner/llm_runner/platform/data_paths.py:128:    return Path(platformdirs.user_data_dir(app_name))
JustVioce/server/justvoice/paths.py:25:def default_data_dir() -> Path:
JustVioce/src-tauri/src/lib.rs:72:fn exe_dir() -> Option<PathBuf> {
JustVioce/src-tauri/src/lib.rs:104:        .app_data_dir()
JustVioce/src-tauri/src/lib.rs:111:        v.push(dir.join("dataroot.txt"));
JustVioce/src-tauri/src/lib.rs:114:        v.push(cfg.join("dataroot.txt"));
justwrite-app/bench/harness/lib/dataRoot.js:41:  const candidates = [join(exeDir, "dataroot.txt")];
justwrite-app/scripts/smoke.js:75:    const pointer = join(exeDir, "dataroot.txt");
justwrite-app/server/justwrite_server/paths.py:25:def default_data_dir() -> Path:
justwrite-app/src-tauri/src/lib.rs:254:fn exe_dir() -> Option<PathBuf> {
justwrite-app/src-tauri/src/lib.rs:279:        .app_data_dir()
just_ai_i18n_docgen/server/just_ai_i18n_docgen/app.py:196:def default_data_dir() -> Path:
just_ai_i18n_docgen/src-tauri/src/lib.rs:36:fn exe_dir() -> Option<PathBuf> {
just_ai_i18n_docgen/src-tauri/src/lib.rs:61:        .app_data_dir()
```

(Comment-only hits trimmed: JustVoice `lib.rs` 70, 93, 186, 931, 1010; JustWrite `lib.rs` 251,
288, 291, 321, 729, `settings_api.py:30`, `data_admin.py:48`, `bench/…/dataRoot.js:8, 48` and
its test; docgen `lib.rs` 33, 68, 71, 101, 542, `app.py:205`.)

| Change | Producers of the data | Exceptions already on the path |
|---|---|---|
| one JS ladder replaces the Rust and Python copies | the user's "Change folder" writes `dataroot.txt` (Rust `storage_relocate`, three apps) · JustWrite's bench harness and smoke read the pointer | two dev roots today (`CLAUDE.md`, the renderer gate) · `dataroot.txt` lives outside the movable root · `_is_writable` falls back when the install dir is read-only (`data_paths.py:41`) · Tauri writes `.window-state.json` and `EBWebView` outside the root (kit FINDING) |

### B5 · Steps 2–5 — every renderer call into Tauri

The study's grep re-run — `git grep -n -E '@tauri-apps|__TAURI|isTauri|[^.a-zA-Z]invoke\(|tauri:' -- 'src/*.js' 'src/*.vue' 'src/*.mjs' ':!*.test.js' ':!src/mock/*'`, comment lines dropped:

```
JustVioce src/App.vue:19:import { AiSetupOffer, AiStatusButton, BootModelLoad, HelpDrawer, HelpTrigger, LlmUiHosts, TitleBar, isTauriShell, openExternal, pushToast, refreshRunnerModels, useAiTasksNav, useAiTasksStore, useModelApply, useRunnerModels, warmModelId } from "@delebash/llm-ui";
JustVioce src/App.vue:425:  if (isTauriShell()) {
JustVioce src/App.vue:426:    import("@tauri-apps/api/event").then(({ listen }) => {
JustVioce src/components/DictateWindow.vue:91:    const { emit } = await import("@tauri-apps/api/event");
JustVioce src/components/DictateWindow.vue:191:    const { listen } = await import("@tauri-apps/api/event");
JustVioce src/main.js:18:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
JustVioce src/services/native.js:24:import { invoke } from "@tauri-apps/api/core";
JustVioce src/services/native.js:25:import { isTauriShell } from "@delebash/llm-ui";
JustVioce src/services/native.js:28:export const hasShell = () => isTauriShell();
JustVioce src/services/native.js:35:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
JustVioce src/services/native.js:58:    return await invoke("shell_save_file", bytes, { headers });
JustVioce src/services/native.js:70:  return invoke("storage_get_root").catch(() => null);
JustVioce src/services/native.js:77:  return invoke("storage_relocate", { newRoot });
JustVioce src/services/native.js:85:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
JustVioce src/services/native.js:95:  return invoke("list_audio_output_devices").catch(() => []);
justwrite-app src/App.vue:159:  if (window.__TAURI_INTERNALS__) {
justwrite-app src/App.vue:160:    import("@tauri-apps/api/event").then(({ listen }) => {
justwrite-app src/main.js:38:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
justwrite-app src/services/native.js:21:import { invoke } from "@tauri-apps/api/core";
justwrite-app src/services/native.js:22:import { isTauriShell } from "@delebash/llm-ui";
justwrite-app src/services/native.js:25:export const hasShell = () => isTauriShell();
justwrite-app src/services/native.js:32:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
justwrite-app src/services/native.js:43:    const res = await invoke("pick_file", { title, filterName, filterExt, defaultDir });
justwrite-app src/services/native.js:70:    return await invoke("shell_save_file", bytes, { headers });
justwrite-app src/services/native.js:82:  return invoke("storage_get_root").catch(() => null);
justwrite-app src/services/native.js:89:  return invoke("storage_relocate", { newRoot });
justwrite-app src/services/native.js:97:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
justwrite-app src/services/native.js:106:  return invoke("set_tray_labels", { labels }).catch(() => {});
just_ai_i18n_docgen src/App.vue:68:  if (window.__TAURI_INTERNALS__) {
just_ai_i18n_docgen src/App.vue:69:    import("@tauri-apps/api/event").then(({ listen }) => {
just_ai_i18n_docgen src/main.js:5:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
just_ai_i18n_docgen src/services/native.js:18:import { invoke } from "@tauri-apps/api/core";
just_ai_i18n_docgen src/services/native.js:19:import { isTauriShell } from "@delebash/llm-ui";
just_ai_i18n_docgen src/services/native.js:22:export const hasShell = () => isTauriShell();
just_ai_i18n_docgen src/services/native.js:29:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
just_ai_i18n_docgen src/services/native.js:37:  return invoke("storage_get_root").catch(() => null);
just_ai_i18n_docgen src/services/native.js:44:  return invoke("storage_relocate", { newRoot });
just_ai_i18n_docgen src/services/native.js:52:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
just-llm-runner ui/src/common/index.js:68:export { configureExternal, openExternal, openPath, canOpenPath, isTauriShell } from "./services/external.js";
just-llm-runner ui/src/common/services/external.js:36:export function isTauriShell() {
just-llm-runner ui/src/common/services/external.js:37:  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
just-llm-runner ui/src/common/services/external.js:49:  if (config.open && isTauriShell()) {
just-llm-runner ui/src/common/services/external.js:58:  return !!config.openPath && isTauriShell();
just-llm-runner ui/src/common/services/fileSave.js:27:import { isTauriShell } from "./external.js";
just-llm-runner ui/src/common/services/fileSave.js:39:  return !!config.save && isTauriShell();
just-llm-runner ui/src/common/services/serverApi.js:51:    const isTauri = protocol === "tauri:" || hostname === "tauri.localhost";
just-llm-runner ui/src/common/services/serverApi.js:52:    if (!isDev && !isTauri && (protocol === "http:" || protocol === "https:")) return origin;
just-llm-runner ui/src/installLlmUi.js:23:import { configureExternal, isTauriShell } from "./common/services/external.js";
just-llm-runner ui/src/installLlmUi.js:54:  if (isTauriShell()) {
just-llm-runner ui/src/installLlmUi.js:57:      'installLlmUi(app, { external: { open: openUrl, openPath } }) from "@tauri-apps/plugin-opener".',
```

Changed since the study (2026-10-05):
- JustVoice's `native.js` gained `shell_save_file` (6 calls now);
- JustVoice's `App.vue` tray listener goes through `isTauriShell()`;
- JustVoice's `SettingsView.vue` `window.__TAURI__` lines are gone.

| Change | Exceptions already on the path |
|---|---|
| `invoke` → the preload bridge, `isTauriShell` → a bridge test | `DictateWindow` is never created · `list_audio_output_devices` is a placeholder returning `[]` (`lib.rs:612-633`) · every `invoke` turns a failure into `null`/`[]`/no-op, except `storage_relocate`, `shell_save_file` and JustWrite's `pick_file`, which throw anything but a cancel · `isTauriShell` gates the opener and native save in all three apps |

### B6 · Steps 3–5 — package scripts, scripts and workflows naming Python or Tauri

`grep -n -i -E 'tauri|python|py\.js|pytest|ruff|cargo|pyinstaller' <repo>/package.json`:

```
JustVioce/package.json:13:    "dev": "node scripts/tauri.js dev",
JustVioce/package.json:14:    "build": "tauri build",
JustVioce/package.json:15:    "tauri": "node scripts/tauri.js",
JustVioce/package.json:16:    "server": "cd server && node ../scripts/py.js -m justvoice.serve serve",
JustVioce/package.json:20:    "test:server": "cd server && node ../scripts/py.js -m pytest -q",
JustVioce/package.json:21:    "eval:discover": "cd server && node ../scripts/py.js scripts/eval_discover.py",
JustVioce/package.json:22:    "eval:attribution": "cd server && node ../scripts/py.js scripts/eval_attribution.py",
JustVioce/package.json:29:    "@tauri-apps/api": "^2.11.1",
JustVioce/package.json:30:    "@tauri-apps/plugin-opener": "^2.5.4",
JustVioce/package.json:43:    "@tauri-apps/cli": "^2.11.3",
justwrite-app/package.json:11:    "dev": "tauri dev",
justwrite-app/package.json:12:    "server": "cd server && node ../scripts/py.js -m justwrite_server.serve serve",
justwrite-app/package.json:13:    "build": "tauri build",
justwrite-app/package.json:14:    "tauri": "tauri",
justwrite-app/package.json:24:    "test:server": "cd server && node ../scripts/py.js -m pytest -q",
justwrite-app/package.json:54:    "@tauri-apps/api": "^2.11.1",
justwrite-app/package.json:55:    "@tauri-apps/plugin-opener": "^2.5.4",
justwrite-app/package.json:93:    "@tauri-apps/cli": "^2.11.3",
just_ai_i18n_docgen/package.json:7:    "dev": "tauri dev",
just_ai_i18n_docgen/package.json:9:    "build": "tauri build",
just_ai_i18n_docgen/package.json:12:    "server": "cd server && node ../scripts/py.js -m just_ai_i18n_docgen.serve serve",
just_ai_i18n_docgen/package.json:13:    "test:server": "cd server && node ../scripts/py.js -m pytest -q",
just_ai_i18n_docgen/package.json:15:    "tauri": "tauri",
just_ai_i18n_docgen/package.json:23:    "@tauri-apps/api": "^2",
just_ai_i18n_docgen/package.json:24:    "@tauri-apps/plugin-opener": "^2",
just_ai_i18n_docgen/package.json:35:    "@tauri-apps/cli": "^2",
```

`git grep -l -i -E "py\.js|python|pytest|ruff|tauri|cargo|pyinstaller" -- 'scripts/*' '.github/workflows/*'`:

```
JustVioce/.github/workflows/ci.yml
JustVioce/.github/workflows/codeql.yml
JustVioce/.github/workflows/release.yml
JustVioce/scripts/audiocpp-dev.js
JustVioce/scripts/diff_legacy.js
JustVioce/scripts/py.js
JustVioce/scripts/smoke.js
JustVioce/scripts/tauri.js
JustVioce/scripts/verify-engines-dismiss.js
justwrite-app/.github/workflows/release.yml
justwrite-app/scripts/bump.js
justwrite-app/scripts/py.js
justwrite-app/scripts/smoke.js
just_ai_i18n_docgen/scripts/py.js
just-llm-runner/scripts/check-clean-install.py
just-llm-runner/scripts/check-consumers.py
just-llm-runner/scripts/check-family.mjs
just-llm-runner/scripts/check-structured-output.py
just-llm-runner/scripts/dev-seed-test-model.py
just-llm-runner/scripts/dev-seed-tunes.py
just-llm-runner/scripts/lib/exec-resolve.mjs
just-llm-runner/scripts/refresh-seed-facts.py
just-llm-runner/scripts/seed-facts-audit.py
```

JustVoice's `eval:discover` and `eval:attribution` are Python scripts under `server/scripts/`.
They move with JustVoice's server (step 5). The kit's seven Python scripts move with the kit
(step 2).

### B7 · Steps 3–5 — user docs naming Python, Tauri, the sidecar or the server command

`git grep -c -i -E "python|tauri|sidecar|pip install|justvoice-server|justwrite-server|docgen-server|pyinstaller" -- 'docs/*.md' 'README.md' ':!docs/plans/*' ':!docs/dev/*' ':!docs/archive/*'` (file: matching lines):

```
JustVioce/README.md:11
JustVioce/docs/backups-and-data.md:1
JustVioce/docs/engines.md:4
JustVioce/docs/getting-started.md:1
JustVioce/docs/gpu.md:2
JustVioce/docs/import-and-export.md:2
JustVioce/docs/run-modes.md:4
JustVioce/docs/system-tray.md:2
JustVioce/docs/use-cases.md:1
JustVioce/docs/webhooks.md:1
JustVioce/docs/whats-new.md:3
justwrite-app/README.md:33
justwrite-app/docs/getting-started.md:6
justwrite-app/docs/headless-access.md:3
just_ai_i18n_docgen/README.md:7
just_ai_i18n_docgen/docs/cli.md:1
just_ai_i18n_docgen/docs/getting-started.md:2
just_ai_i18n_docgen/docs/troubleshooting.md:1
just-llm-runner/README.md:11
just-llm-runner/docs/app-structure.md:55
just-llm-runner/docs/family-structure-audit.md:25
just-llm-runner/docs/target-tree.md:12
```

Each app's docs change in that app's step, in the same change (the docs rule).

### B8 · Step 5 — users of the dev data root `src-tauri/target/debug/data`

`git grep -n "target/debug/data"` (code) and `git grep -c "target/debug/data" -- '*.md' ':!docs/plans/*'`:

```
JustVioce/server/justvoice/serve.py:48:    # `src-tauri/target/debug/data` resolves somewhere else entirely by the
JustVioce/src-tauri/src/lib.rs:92:// (dev: src-tauri/target/debug/data). Nothing lands anywhere the user did
just-llm-runner/llm_runner/platform/data_paths.py:18:   root in development (Tauri dev = `src-tauri/target/debug/data`, which the
just-llm-runner/llm_runner/runner/cache_registry.py:14:for an installed build, `src-tauri/target/debug/data` for a dev run — so no scan
JustVioce/ (md) CLAUDE.md:2
JustVioce/ (md) docs/dev/TASKS.md:2
just_ai_i18n_docgen/ (md) e2e/README.md:1
```

| Data moved | Producer | Exceptions already on the path |
|---|---|---|
| each app's dev root (database, models, caches) renamed to `<repo>/data` | the Rust ladder's `exe_dir()/data` in `tauri dev`, handed to the sidecar as `JUSTVOICE_DATA_DIR` (and the other apps' equivalents) · the gate's `--data-dir` flag | `<repo>/data` was deleted on 2026-08-22, and a bare headless run creates a fresh empty one there (`CLAUDE.md`). Before the rename, check `<repo>/data` is absent or empty, so nothing gets overwritten |
| JustVoice's own root: none — the database holds no path containing `target/debug/data` or `JustVioce/` other than the JustWrite ones below (measured 2026-10-07) | — | — |
| **saved absolute paths into JustWrite's dev root** — the family's shared model cache lives there | the kit's cache-folder choice (the user's pick, or the 2026-10-06 adoption of a sibling's cache) writes `runner_setting` row `cache_root` (`llm/stores.py:897`) · a saved model measurement writes its switches, model paths included (`llm/stores.py:1406`) · every app's boot writes its own line in the cache registry (`runner/cache_registry.py`) | measured 2026-10-07 (read-only): JustVoice's database 1 `runner_setting.value` (`…\justwrite-app\src-tauri\target\debug\data\ai-cache`) + 3 `measurement_switches.flag_value`; docgen's 1 `runner_setting.value`; JustWrite's 2 `measurement_switches.flag_value`; `%LOCALAPPDATA%\just-ai\caches.json` 2 lines (JustWrite's and JustVoice's `cacheRoot`). Renaming JustWrite's root in step 4 breaks all of them unless they are rewritten (§10 Q9) |

### B9 · Steps 2–5 — rule docs naming the old stack

`grep -c -i -E 'tauri|rust|python|pytest|ruff|pyinstaller|sidecar'`, 2026-10-07 (the study's
2026-10-05 counts in brackets; its two `~` figures were approximate):

```
JustVioce/CLAUDE.md 25            [25]
justwrite-app/CLAUDE.md 14        [14]
just_ai_i18n_docgen/CLAUDE.md 11  [11]
just-llm-runner/CLAUDE.md 12      [12]
just-llm-runner/scripts/check-family.mjs 22   [~50]
just-llm-runner/docs/app-structure.md 62      [~68]
JustVioce/docs/dev/design-law.md 0            [0]
```

### B10 · Steps 2–5 — the database connections (foreign keys)

`git grep -n -i "foreign_keys"` and `git grep -n -E "create_engine\("` (tests and scripts
dropped), 2026-10-07:

```
== JustVioce
server/justvoice/data_admin.py:162:                conn.execute(text("PRAGMA foreign_keys=OFF"))
server/justvoice/database/session.py:71:    def _enable_foreign_keys(dbapi_connection, _connection_record):
server/justvoice/database/session.py:73:        cursor.execute("PRAGMA foreign_keys=ON")
server/justvoice/storage/lexicons.py:279:                # SQLite FK cascade needs PRAGMA foreign_keys per connection;
server/justvoice/database/session.py:60:    engine = create_engine(
== just-llm-runner
llm_runner/platform/data_api.py:133:                con.execute("PRAGMA foreign_keys=OFF")
== justwrite-app
server/justwrite_server/database/session.py:49:    def _enable_foreign_keys(dbapi_connection, _record):
server/justwrite_server/database/session.py:51:        cursor.execute("PRAGMA foreign_keys=ON")
server/justwrite_server/database/session.py:43:    engine = create_engine(
== just_ai_i18n_docgen
server/just_ai_i18n_docgen/app.py:256:    engine = create_engine(f"sqlite:///{data_dir / 'app.db'}")
```

| Change | Exceptions already on the path |
|---|---|
| the connection opens through better-sqlite3, which turns foreign keys on by default (§1.5) | docgen runs with them off today · both restore paths switch them off on purpose · the lexicon store deletes entries itself so it doesn't depend on them (`lexicons.py:279`) |

---

## 10 · The questions, answered with the approval

All nine decided 2026-10-07 as leaned ("your rec on all go").

1. **Does approving the plan start step 1, with each later step getting its own go?**
   - Lean: yes. The steps are weeks apart, and each one may change the plan for the next.
2. **Database driver: better-sqlite3 13?**
   - Lean: yes. It read every cell like Python, it's twice as fast as `node:sqlite`, and its API
     is stable; `node:sqlite` is still a release candidate.
   - `node:sqlite` stays the fallback: the 15-line adapter worked.
3. **Query layer: plain SQL through a small kit helper?**
   - Lean: plain SQL — confirmed by the test (§1.5).
   - Drizzle passed every check too, but needed the same column map and converters, writes at
     half the speed, and is pre-1.0.
   - Kysely deadlocked; Prisma and Knex were ruled out on their docs and source.
4. **Keep Python's text formats wherever text is stored or hashed?**
   - One kit function, `pyJson`, writes exactly what Python's `json.dumps` writes for the
     options each call site passes (separators, sorted keys, `\uXXXX` escapes, `1.0`). Dates
     keep six fractional digits.
   - Lean: yes. Old and new servers then write the same bytes, so the database diff compares
     cells directly and the render-cache keys survive.
5. **Validation: TypeBox over zod?**
   - Lean: TypeBox. Fastify validates with JSON Schema natively, and TypeBox writes JSON Schema
     directly; zod needs a conversion step.
   - Its number-vs-integer is also where `pyJson` learns which numbers are floats (§1.5).
   - It gets proved on the kit's `Settings` model against pydantic first (§1.6).
6. **While the kit runs both languages (steps 2 to 5), where do kit server changes land?**
   - Lean: in both, in the same change. The other choice is freezing kit server features until
     JustVoice moves, which is months.
7. **During an app's freeze, does a server bug fix land in both the Python and the
   JavaScript?**
   - Lean: yes. Otherwise the route diff reports the fix as a difference.
8. **A new database's schema = the DDL Python creates today, captured from a fresh database?**
   - Lean: yes. That's how "today's schema exactly" stays exact for fresh installs, not only
     for existing databases.
9. **When a dev root is renamed, rewrite the saved paths into it?**
   - JustWrite's dev root holds the shared model cache. When it moves (step 4), the rewrite
     covers seven database cells across the three apps and two cache-registry lines (§9 B8).
   - Lean: yes, with a one-off command run by hand on this machine, with the apps closed. It's
     not shipped code: packaged installs don't move.

---

## Appendix A · The lexicon store ported both ways (the §1.5 test)

The port of `server/justvoice/storage/lexicons.py` (the one-shot legacy-file import left out),
as run in the test. Throwaway code, kept here because the scratchpad isn't kept.

### The lexicon store on plain SQL — `f-lex-plain.cjs`

```js
// LexiconStore on the plain-SQL helper — a port of server/justvoice/storage/lexicons.py
// (the one-shot legacy-file import left out). `now` is the store's _now() (UTC, "Z");
// `utcnow` and `uuid4` are the model defaults (_utcnow, _uuid).
const fs = require("node:fs");
const path = require("node:path");

const entryToRow = (e) => ({
  word: e.grapheme,
  pronunciation: e.phoneme_ipa || e.alias || "",
  notation: e.phoneme_ipa ? "ipa" : "phonetic",
});
const rowToEntry = (r) =>
  r.notation === "ipa"
    ? { grapheme: r.word, phoneme_ipa: r.pronunciation, alias: null }
    : { grapheme: r.word, phoneme_ipa: null, alias: r.pronunciation };
const asEntry = (e) => ({ grapheme: e.grapheme, phoneme_ipa: e.phoneme_ipa ?? null, alias: e.alias ?? null });

class LexiconStore {
  constructor(db, dir, { now, utcnow, uuid4 }) {
    Object.assign(this, { db, dir, now, utcnow, uuid4 });
    fs.mkdirSync(dir, { recursive: true });
  }

  #addEntry(lexiconId, e) {
    this.db.insert("lexicon_entries", { id: this.uuid4(), lexicon_id: lexiconId, ...entryToRow(e), created_at: this.utcnow() });
  }

  #hydrate(row) {
    const entries = this.db.all("select * from lexicon_entries where lexicon_id = ? order by created_at", [row.id], "lexicon_entries");
    return {
      id: row.id,
      name: row.name,
      entries: entries.map(rowToEntry),
      scope: row.scope || "global",
      description: row.description,
      project_id: row.project_id,
      persona_id: row.persona_id,
      created_at: row.created_at || this.now(),
      updated_at: row.updated_at || this.now(),
    };
  }

  #row(id) {
    return this.db.one("select * from lexicons where id = ?", [id], "lexicons");
  }

  list() {
    return this.db.all("select * from lexicons order by created_at", [], "lexicons").map((r) => this.#hydrate(r));
  }

  get(id) {
    const row = this.#row(id);
    return row ? this.#hydrate(row) : null;
  }

  create(name, { entries = [], scope = "global", description = null, project_id = null, persona_id = null, id = null } = {}) {
    const lex = {
      id: id || `lex_${this.uuid4().replaceAll("-", "")}`,
      name,
      entries: entries.map(asEntry),
      scope,
      description,
      project_id,
      persona_id,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.db.tx(() => {
      const { entries: _, ...row } = lex;
      this.db.insert("lexicons", row);
      for (const e of entries) this.#addEntry(lex.id, e);
    });
    return lex;
  }

  update(id, entries, name = null) {
    return this.db.tx(() => {
      const row = this.#row(id);
      if (!row) return null;
      const set = name != null && name.trim() ? { name: name.trim() } : {};
      this.db.run("delete from lexicon_entries where lexicon_id = ?", [id]);
      for (const e of entries) this.#addEntry(id, e);
      this.db.update("lexicons", { ...set, updated_at: this.now() }, "id = ?", [id]);
      return this.#hydrate(this.#row(id));
    });
  }

  appendEntry(id, entry) {
    return this.db.tx(() => {
      if (!this.#row(id)) return null;
      this.#addEntry(id, entry);
      this.db.update("lexicons", { updated_at: this.now() }, "id = ?", [id]);
      return this.#hydrate(this.#row(id));
    });
  }

  delete(id) {
    // Entries go explicitly so the result doesn't depend on foreign_keys being on.
    const deleted = this.db.tx(() => {
      this.db.run("delete from lexicon_entries where lexicon_id = ?", [id]);
      return this.db.run("delete from lexicons where id = ?", [id]).changes;
    });
    for (const suffix of [".json", ".json.migrated"]) fs.rmSync(path.join(this.dir, `${id}${suffix}`), { force: true });
    return deleted > 0;
  }
}
module.exports = { LexiconStore };
```

### The lexicon store on Drizzle — `f-lex-drizzle.cjs`

```js
// LexiconStore on Drizzle (better-sqlite3, sync mode) — the same port as f-lex-plain.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { eq, asc } = require("drizzle-orm");

const entryToRow = (e) => ({
  word: e.grapheme,
  pronunciation: e.phoneme_ipa || e.alias || "",
  notation: e.phoneme_ipa ? "ipa" : "phonetic",
});
const rowToEntry = (r) =>
  r.notation === "ipa"
    ? { grapheme: r.word, phoneme_ipa: r.pronunciation, alias: null }
    : { grapheme: r.word, phoneme_ipa: null, alias: r.pronunciation };
const asEntry = (e) => ({ grapheme: e.grapheme, phoneme_ipa: e.phoneme_ipa ?? null, alias: e.alias ?? null });

class LexiconStore {
  constructor(db, tables, dir, { now, utcnow, uuid4 }) {
    Object.assign(this, { db, dir, now, utcnow, uuid4, lexicons: tables.lexicons, entries: tables.lexicon_entries });
    fs.mkdirSync(dir, { recursive: true });
  }

  #addEntry(q, lexiconId, e) {
    q.insert(this.entries).values({ id: this.uuid4(), lexicon_id: lexiconId, ...entryToRow(e), created_at: this.utcnow() }).run();
  }

  #hydrate(q, row) {
    const entries = q.select().from(this.entries).where(eq(this.entries.lexicon_id, row.id)).orderBy(asc(this.entries.created_at)).all();
    return {
      id: row.id,
      name: row.name,
      entries: entries.map(rowToEntry),
      scope: row.scope || "global",
      description: row.description,
      project_id: row.project_id,
      persona_id: row.persona_id,
      created_at: row.created_at || this.now(),
      updated_at: row.updated_at || this.now(),
    };
  }

  #row(q, id) {
    return q.select().from(this.lexicons).where(eq(this.lexicons.id, id)).get() ?? null;
  }

  list() {
    return this.db.select().from(this.lexicons).orderBy(asc(this.lexicons.created_at)).all().map((r) => this.#hydrate(this.db, r));
  }

  get(id) {
    const row = this.#row(this.db, id);
    return row ? this.#hydrate(this.db, row) : null;
  }

  create(name, { entries = [], scope = "global", description = null, project_id = null, persona_id = null, id = null } = {}) {
    const lex = {
      id: id || `lex_${this.uuid4().replaceAll("-", "")}`,
      name,
      entries: entries.map(asEntry),
      scope,
      description,
      project_id,
      persona_id,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.db.transaction((tx) => {
      const { entries: _, ...row } = lex;
      tx.insert(this.lexicons).values(row).run();
      for (const e of entries) this.#addEntry(tx, lex.id, e);
    });
    return lex;
  }

  update(id, entries, name = null) {
    return this.db.transaction((tx) => {
      if (!this.#row(tx, id)) return null;
      const set = name != null && name.trim() ? { name: name.trim() } : {};
      tx.delete(this.entries).where(eq(this.entries.lexicon_id, id)).run();
      for (const e of entries) this.#addEntry(tx, id, e);
      tx.update(this.lexicons).set({ ...set, updated_at: this.now() }).where(eq(this.lexicons.id, id)).run();
      return this.#hydrate(tx, this.#row(tx, id));
    });
  }

  appendEntry(id, entry) {
    return this.db.transaction((tx) => {
      if (!this.#row(tx, id)) return null;
      this.#addEntry(tx, id, entry);
      tx.update(this.lexicons).set({ updated_at: this.now() }).where(eq(this.lexicons.id, id)).run();
      return this.#hydrate(tx, this.#row(tx, id));
    });
  }

  delete(id) {
    // Entries go explicitly so the result doesn't depend on foreign_keys being on.
    const deleted = this.db.transaction((tx) => {
      tx.delete(this.entries).where(eq(this.entries.lexicon_id, id)).run();
      return tx.delete(this.lexicons).where(eq(this.lexicons.id, id)).run().changes;
    });
    for (const suffix of [".json", ".json.migrated"]) fs.rmSync(path.join(this.dir, `${id}${suffix}`), { force: true });
    return deleted > 0;
  }
}
module.exports = { LexiconStore };
```

### The plain-SQL helper, the date and true/false converters, and `pyJson` — `f-sql.cjs`

```js
// The plain-SQL helper the kit would carry: better-sqlite3, synchronous, plus the two
// conversions SQLAlchemy does for us today (DateTime and Boolean), driven by a column map
// taken from today's models. And pyJson: Python's json.dumps, byte for byte.
const Database = require("better-sqlite3");

// SQLAlchemy stores DateTime as "YYYY-MM-DD HH:MM:SS.ffffff"; Python's isoformat() gives
// "YYYY-MM-DDTHH:MM:SS[.ffffff]", dropping the fraction when it is zero.
const STORED = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;
function dtFromDb(text) {
  if (text == null) return null;
  const m = STORED.exec(text);
  if (!m) return text;
  const f = (m[3] || "").padEnd(6, "0");
  return `${m[1]}T${m[2]}${f === "000000" ? "" : `.${f}`}`;
}
// An ISO string, naive or with an offset. SQLAlchemy's SQLite DateTime drops the offset
// and keeps the wall-clock time, so this does too.
const ISO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})?$/;
function dtToDb(v) {
  if (v == null) return null;
  const m = ISO.exec(v);
  if (!m) throw new Error(`not a datetime: ${v}`);
  return `${m[1]} ${m[2]}.${(m[3] || "").padEnd(6, "0")}`;
}
const boolToDb = (v) => (v == null ? null : v ? 1 : 0);
const boolFromDb = (v) => (v == null ? null : !!v);

function open(file, { types = {}, readonly = false } = {}) {
  const db = new Database(file, { readonly });
  if (!readonly) db.pragma("foreign_keys = ON");
  const stmts = new Map();
  const prep = (sql) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };
  const kinds = (table) => types[table] || {};
  const fromRow = (table, row) => {
    if (!row) return null;
    const k = kinds(table);
    for (const c in row) {
      if (k[c] === "datetime") row[c] = dtFromDb(row[c]);
      else if (k[c] === "bool") row[c] = boolFromDb(row[c]);
    }
    return row;
  };
  const toDb = (table, col, v) => {
    const k = kinds(table)[col];
    return k === "datetime" ? dtToDb(v) : k === "bool" ? boolToDb(v) : v;
  };
  return {
    raw: db,
    all: (sql, params = [], table) => prep(sql).all(params).map((r) => (table ? fromRow(table, r) : r)),
    one: (sql, params = [], table) => (table ? fromRow(table, prep(sql).get(params)) : prep(sql).get(params) ?? null),
    run: (sql, params = []) => prep(sql).run(params),
    insert(table, obj) {
      const cols = Object.keys(obj);
      const sql = `insert into "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`;
      return prep(sql).run(cols.map((c) => toDb(table, c, obj[c])));
    },
    update(table, obj, where, params = []) {
      const cols = Object.keys(obj);
      const sql = `update "${table}" set ${cols.map((c) => `"${c}" = ?`).join(", ")} where ${where}`;
      return prep(sql).run([...cols.map((c) => toDb(table, c, obj[c])), ...params]);
    },
    tx: (fn) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

// Python's json.dumps for the options a call site passes. Numbers: JavaScript can't tell
// 1.0 from 1, so a call site that stores floats says which keys are floats (`floats`).
function pyFloat(x) {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  const [mant, e] = x.toExponential().split("e");
  const exp = Number(e);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  if (exp >= -4 && exp < 16) {
    let s;
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
      const frac = digits.slice(exp + 1);
      s = `${intPart}.${frac || "0"}`;
    } else {
      s = `0.${"0".repeat(-exp - 1)}${digits}`;
    }
    return (neg ? "-" : "") + s;
  }
  const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${neg ? "-" : ""}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}
function pyJson(v, { separators = [", ", ": "], sortKeys = false, ensureAscii = true, floats = new Set() } = {}, key = null) {
  const [itemSep, keySep] = separators;
  const u = (c) => `\\u${c.toString(16).padStart(4, "0")}`;
  const str = (s) => {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const c = s.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (c < 0x20 || (ensureAscii && c > 0x7e)) out += u(c); // UTF-16 units = Python's surrogate pairs
      else out += ch;
    }
    return `${out}"`;
  };
  const opts = { separators, sortKeys, ensureAscii, floats };
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return Number.isInteger(v) && !floats.has(key) ? String(v) : pyFloat(v);
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return `[${v.map((x) => pyJson(x, opts, key)).join(itemSep)}]`;
  const keys = Object.keys(v);
  if (sortKeys) keys.sort();
  return `{${keys.map((k) => `${str(k)}${keySep}${pyJson(v[k], opts, k)}`).join(itemSep)}}`;
}

module.exports = { open, dtFromDb, dtToDb, boolToDb, boolFromDb, pyJson, pyFloat };
```

### Drizzle's tables, built from the same column map — `f-drizzle.cjs`

```js
// Drizzle tables for every model table, built from the same column map (f-types.json),
// with two custom column types that store what SQLAlchemy stores.
const { sqliteTable, text, integer, real, customType } = require("drizzle-orm/sqlite-core");
const { dtToDb, dtFromDb, boolToDb, boolFromDb } = require("./f-sql.cjs");

const pyDateTime = customType({ dataType: () => "DATETIME", toDriver: dtToDb, fromDriver: dtFromDb });
const pyBool = customType({ dataType: () => "BOOLEAN", toDriver: boolToDb, fromDriver: boolFromDb });
const BUILD = { text, int: integer, float: real, datetime: pyDateTime, bool: pyBool };

function tablesFrom(types) {
  const out = {};
  for (const [name, cols] of Object.entries(types)) {
    const def = {};
    for (const c of cols.__model_order__) def[c] = BUILD[cols[c]](c);
    out[name] = sqliteTable(name, def);
  }
  return out;
}
module.exports = { tablesFrom };
```
