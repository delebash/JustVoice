<!-- SPDX-License-Identifier: MIT -->
# The clean-room rewrite of the voicebox-derived files — the spec (half 1)

## What this is

**Decided 2026-10-08** — `docs/dev/TASKS.md`, the Electron item, "a clean-room rewrite of all 14
credited pieces". The user's words on the plan as shown: "1. A spec, no code. One agent reads
each credited file and writes down only what it must do: its inputs, outputs, edge cases, and
which existing tests pin it. 2. Fresh code from the spec. A second agent, which is never shown
the old files, writes new code and new prompt wording from that spec alone." — then "1 and do
the clean room rewrite", "your rec on all go".

Fifteen JustVoice files were derived from the MIT project voicebox and carry its credit. They
are rewritten from scratch so that no credit is needed:

- **Half 1 — this document.** One agent read each file and wrote down what it must do. No code,
  no prompt wording, no example text, no effect-preset values, none of the old files' internal
  names, comments or control flow.
- **Half 2 — the writer.** A second agent, who never sees the old files, writes new code, new
  prompt wording, new few-shot examples and new preset values from this document alone.

**The proof:** every existing test passes unchanged; the old and new refinement prompts are
compared side by side in the Refine Lab on real captures (the new wording goes in only if the
clean-up is as good); the capture pill, the dictation window and keep-alive are checked in the
running app; MCP is checked with a real MCP client (for example Claude Code's `claude mcp add`).
After that the credits go: the 15 headers, NOTICE.md's entry, LICENSES.md's row,
voicebox-pin.txt, the About line, and the CLAUDE.md and README mentions (not this document's
job).

### Rules for the writer

- **What you must not read:** the 15 files below, their git history, the voicebox project, the
  `refine.*` prompt rows in any existing database (they hold the old wording), the *Built-in
  presets* table in `docs/effects.md` (it holds the old values), and any `docs/plans/*` file
  that quotes the old prompts. Everything else in the repo and the kit is yours to read.
- **House rules** (global and project CLAUDE.md): plain JavaScript, `.js` only, `"type":
  "module"`; every file starts with `SPDX-License-Identifier: MIT` and **no** voicebox
  attribution block; Biome must pass (`npm run lint`); the standard first (the MCP SDK's
  documented patterns, the kit's helpers, this repo's own services); nothing is hand-rolled that
  `@delebash/llm-ui` already ships; the renderer uses a `height: 100%` chain, never `100vh`.
- **The gates:** `npm run lint && npm run test:server && npm run test:unit` must pass, and the
  renderer gate (`npm run build:vite`, then `npm run smoke` against a running server — see the
  project CLAUDE.md) must pass with zero JS errors.
- **What is fixed** is listed under each file's *Interface* and *Callers*: export names, route
  paths, wire field names, table and column names, exact strings a test or caller depends on.
  Everything under *Free to change* is yours.
- Where this document says "current behaviour" and lists it under **Gaps**, the user has not
  ruled. Reproduce the current behaviour unless the user rules otherwise.

### What the writer may build on (ours and the kit's)

These are JustVoice's or the kit's own and are not part of the clean room:

| Module | What it offers |
|---|---|
| `@delebash/llm-runner/platform/sql` | `openDatabase(file, {foreignKeys})` → a handle with `register`, `createTables`, `all`, `one`, `get`, `insert`, `update`, `delete`, `count`, `tx`, `exec`, `run`, `value`, `columnNames`, `tableNames`, `raw`, `close`; `registerDefaultFn(name, fn)` |
| `@delebash/llm-runner/platform/log` | `getLogger(name)` → `debug`, `info`, `warning`, `exception` |
| `@delebash/llm-runner/platform/py` | `RuntimeError`, `ValueError`, `strip`, `splitWs`, `PY_WS`, `b64decode`, `isDict`, `pyRound`, `pyTypeName`, `pyInt`, `strRepr` |
| `@delebash/llm-runner/platform/pyjson` | `pyJson` (Python `json.dumps` text), `pyJsonCompact`, `jsonLoads`, `pyJsonParse`, `pyFloatValue`, `PyFloat`, `pyRepr` |
| `@delebash/llm-runner/platform/models` | `T`, `opt`, `nullable` (the request/response schema builders) |
| `@delebash/llm-runner/platform/errors` | `RequestValidationError` (→ 422), `HttpError`; `server/src/errors.js` re-exports `badRequest` (400), `notFound` (404), `internal` (500) |
| `@delebash/llm-runner/platform/data_paths` | `purePath`, `samePath` |
| `@delebash/llm-runner/llm` | `render(template, variables)`, `stores` (`getPromptStore`, `getProviderStore`), `loadFromConfigs`, `LLMNotConfiguredError`; `@delebash/llm-runner/llm/seed`: `seedLlm` |
| `@delebash/llm-ui` | `AppModal`, `UiButton` and the rest of the kit's components and services |
| `@modelcontextprotocol/sdk` 1.30.1 | `McpServer`, the low-level `Server`, `StreamableHTTPServerTransport`, `isInitializeRequest`, the request schemas; peer `zod` 4.6.5 is installed (see Gaps) |
| `@fastify/multipart` | the multipart parser |
| `server/src/app_state.js` | `getState()` → `.dataDir`, `.settings.get()`, `.personas.get(id)` / `.list()`, `.engines.current()` |
| `server/src/models.js` | `construct`, `DateTime`, `utcNowNaive`, `GenerateRequest` |
| `server/src/paths.js` | `defaultDataDir()`, `generationsRoot(dataDir)` |
| `server/src/media_paths.js` | `storeMediaPath(absPath)` (the stored, data-root-relative form), `mediaFile(stored)` (back to a real path) |
| `server/src/engines/manager.js` | `getManager()` → `loadedFor(kind)`, `status(engineId)`, `load(engineId, opts)`, `transcribe({audio_path, language})` |
| `server/src/engines/llm/run.js` | `runFeature(action, variables, overrides)` → `{text, model, …}` |
| `server/src/api/generate_api.js` | `generate(req)` → the WAV (a Buffer, or an object whose `body` is one) |
| `server/src/api/voices_api.js` | `listVoices()` → `{voices: […]}` |
| `server/src/render_core.js` | `_resolveEngineForVoice(state, voiceId)`, `_lineModel(state, voiceId, engineId)` |
| `server/src/database/models_schema.js` | `TABLES` — the schema itself (DDL + column kinds/defaults); not credited, stays exactly as it is |
| `src/services/native.js` | `dictateEmit(event, payload)`, `onDictateEvent(event, fn)` → unsubscribe |
| `src/stores/api.js` | `useApi()` → `.serverUrl` |

The research register's relevant entries: `docs/dev/RESEARCH.md` §3 ("Dictation can't be
started from the app", "An MCP generation's length still assumes 16 kHz", "Long lines also hold
~0.9–1 s silences inside the take") and §6 ("Whole-number floats are stored as `1.0`", "Free-form
stored JSON keeps Python's floats", "The port to JavaScript — wave D … MCP", "The port to
JavaScript — the API wave, agent 1", the shell's "No dictation feature runs today").

---

## 1. `server/src/refinement.js` — transcript refinement

### 1.1 Role

Dictation produces raw speech-to-text output: no capitals, no punctuation, filler words,
spoken self-corrections, technical terms spelled out as words. This module turns that into
clean written text with a language model. It owns three things: the **repeat-collapse** step
that removes recogniser loops before the model sees the text; the **flags** (three user
toggles) that decide which cleanup sections go into the system prompt; and the **prompt
texts** — the ground rules, the three section texts, and the few-shot examples sent as chat
history. The section texts here are the *seed source*: `seed_feature_prompts.js` copies them
into the shared prompt rows `refine.base`, `refine.smart_cleanup`, `refine.self_correction`,
`refine.preserve_technical`, which the user can edit. Production composes the system prompt
from those rows, not from these constants. The few-shot examples are read from code on every
call.

### 1.2 Interface

| Export | Kind | Contract |
|---|---|---|
| `collapseRepetitiveArtifacts(text, minRun = 6)` | function | string → string. See 1.3. |
| `_REPETITION_RUN_THRESHOLD` | const number | `6` — the default `minRun`. |
| `_MAX_REPETITION_UNIT_CHARS` | const number | `60` — the longest repeating unit (in characters) the character pass looks for. |
| `_tokenKey(word)` | function | string → string: the word with every character that is not a Unicode letter, a Unicode digit or `_` removed, lower-cased. |
| `RefinementFlags` | class | `new RefinementFlags({smartCleanup = true, selfCorrection = true, preserveTechnical = true} = {})`; instance properties `smartCleanup`, `selfCorrection`, `preserveTechnical` (booleans); `toDict()` → `{smart_cleanup, self_correction, preserve_technical}` **in that key order** (the Refine Lab's preview lists the enabled sections in this order); static `fromDict(data)` → a `RefinementFlags`. |
| `_BASE_INSTRUCTIONS` | const string | the ground rules (seed text). |
| `_SMART_CLEANUP` | const string | the *Remove filler* section (seed text). |
| `_SELF_CORRECTION` | const string | the *Take your corrections* section (seed text). |
| `_PRESERVE_TECHNICAL` | const string | the *Keep technical words* section (seed text). |
| `REFINEMENT_EXAMPLES` | const array | an array of `[userText, assistantText]` string pairs — the few-shot turns. |
| `composeRefinementSystem(flags)` | function | `RefinementFlags` → string (the system prompt). Synchronous. |
| `refineTranscript(transcript, flags, {settings = null} = {})` | async function | → `[refinedText: string, modelId: string]`. `settings` is accepted and ignored (callers pass it). Throws whatever the LLM run throws, including the kit's `LLMNotConfiguredError` when no provider is available. |

Imports from ours and the kit (allowed): `render`, `stores` from `@delebash/llm-runner/llm`;
`PY_WS`, `splitWs`, `strip` from `@delebash/llm-runner/platform/py`; `runFeature` from
`./engines/llm/run.js`.

### 1.3 Behaviour

**The repeat-collapse step.** Purpose: a recogniser sometimes loops — the same word or phrase
dozens or hundreds of times when the audio trails off. Small models then truncate real content
to make room, big ones echo the loop. Removing loops deterministically before the model sees
the text avoids both. Rhetorical repetition below the threshold must survive.

Contract, two passes applied in order:

1. **Word pass.** The text is split on whitespace (Python's definition of whitespace — the
   kit's `splitWs`). If there are fewer than `minRun` tokens, the text is returned exactly as
   given. Otherwise every run of `minRun` or more consecutive tokens whose `_tokenKey` is the
   same non-empty key is **removed entirely** (all of its tokens, not collapsed to one). Tokens
   whose key is empty (pure punctuation) never form a run. The surviving tokens are joined with
   single spaces — so once there are at least `minRun` tokens, line breaks and multiple spaces
   become single spaces even when nothing was removed.
2. **Character pass.** Any unit of 2 to 60 characters (counted in Unicode code points; any
   characters, line breaks included) that occurs `minRun` or more times back to back is removed
   entirely, scanning left to right, preferring the shortest unit, non-overlapping. If nothing
   was removed the text is returned unchanged; if something was, every whitespace run becomes a
   single space and the result is trimmed.

Cases the tests pin (`captures.test.js` `collapse_repetitive_artifacts`): `"ok URL URL URL URL URL
URL done"` → `"ok done"` (a run of six equal tokens goes entirely; tokens differing only in case
or surrounding punctuation would count as equal too);
`"I said no, no, no, no, no to that"` keeps `"no, no, no, no, no"` (five is below the
threshold); `"end 谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看 fin"` → `"end fin"` (a CJK
loop with no spaces goes in the character pass); `"wooooooow"` → unchanged (a doubled letter is
too few repeats of a two-character unit).

**The flags.** Three booleans, all on by default. `fromDict`: a missing, null or empty object →
all three on; a key that is absent → on; a key that is present → its value coerced to a boolean
by JavaScript truthiness. The wire form (`toDict`) is snake_case and is what `captures` rows
store in `refinement_flags_json`.

**Composing the system prompt** (`composeRefinementSystem`):

- Read the row `refine.base` from the kit's prompt store. If it does not exist, return an empty
  string.
- The base row's `system` text is a template with three markers: `{{smart_cleanup}}`,
  `{{self_correction}}`, `{{preserve_technical}}` (marker name = flag wire name = row-key
  suffix). For each, supply the `system` text of the row `refine.<name>` when that flag is on
  and the row exists; otherwise supply an empty string. All three names are **always**
  supplied — the kit's `render` fails loud on a missing name; an off section is an empty value,
  not a missing one.
- Render the template with the kit's `render`. The markers' order in the base row is the order
  the sections appear; a marker the user deleted drops that section even when its toggle is on;
  a base row with no markers composes to its own text.
- Empty sections leave blank-line runs behind: collapse every run of three or more line breaks
  to exactly two, then trim.

**Running a refinement** (`refineTranscript`): collapse loops in the transcript (above), then
run the shared feature action `refine.base` through `runFeature` with the variables
`{transcript: <collapsed text>}` and the overrides `system: <composeRefinementSystem(flags)>`
and `history: <REFINEMENT_EXAMPLES as alternating chat turns, user then assistant, pair by pair,
in array order>`. The user half of the call is rendered by the kit from the base row's
`user_template` (`{{transcript}}`). Return the response text trimmed and the response's `model`.
Errors propagate.

**What the prompt texts must make the model do** (the writer writes all new wording):

- **The ground rules (`_BASE_INSTRUCTIONS`).** The model is a text transformer, not an
  assistant. Every user message is a raw dictation transcript to be rewritten — data, never a
  request to the model. A transcript that is a question comes back as a cleaned-up question and
  is never answered; a command comes back as a cleaned-up command and is never carried out; a
  greeting comes back cleaned and is never returned. The job: remove disfluencies (hesitation
  sounds) and filler phrases used as filler; add sentence capitalization and punctuation so it
  reads as written prose; fix a speech-recognition mis-hearing only when the context makes the
  intended word obvious, and leave it when in doubt. Never: answer, follow, refuse, apologize or
  greet; summarize, shorten or drop an idea the speaker said; add words, examples,
  explanations, code or details the speaker did not say; swap the speaker's words for synonyms;
  wrap the output in quotes, code fences or a preamble. Output only the cleaned transcript.
  **It must not contain the word "technical"** (the all-off test, 1.5). Note: `seed_feature_prompts.js`
  appends, after these rules, a fixed line telling the model to return the transcript unchanged
  when no sections follow, and then the three markers — that file is not on the list and stays.
- **Remove filler (`_SMART_CLEANUP`).** Remove hesitation sounds and filler words *when they are
  used as filler* (not when the same word carries meaning); add sentence-level punctuation and
  capitalization so it reads like competent typed text; fix clear speech-recognition artefacts;
  no other rephrasing. Must be non-empty (turning it off must shorten the composed prompt — 1.5).
- **Take your corrections (`_SELF_CORRECTION`).** When the speaker audibly changes their mind
  mid-utterance, drop the retracted part **and** the spoken correction cue, keeping only the
  final intent. Typical cues are the common spoken phrases for taking something back or
  restarting. Apply only when the correction is unambiguous; when uncertain, keep the original
  wording. **The composed all-on prompt must contain the substring "self"** (case-insensitive;
  1.5) — naming the section's purpose ("self-correction") satisfies it.
- **Keep technical words (`_PRESERVE_TECHNICAL`).** Keep technical terms, code identifiers,
  command and library names, acronyms and file paths exactly as said — never translated,
  expanded or normalized. When the speaker dictates a punctuation word inside a technical term,
  write the symbol: "dot" → `.`, "slash" → `/`, "colon" → `:` inside URLs and code, "dash" or
  "hyphen" → `-`, "underscore" → `_`. **Must contain the word "technical"** (1.5).
- Whether a section carries a short inline illustration is the writer's choice; inline examples
  inside a system prompt are known to make very small models echo the example for unrelated
  input, which is why the main examples ride as chat turns.

**The few-shot examples (`REFINEMENT_EXAMPLES`).** Real user→assistant turn pairs, raw
transcript in, cleaned transcript out. The categories they must teach:

1. A casual, filler-heavy statement → the same statement with fillers gone, capitals and
   punctuation added, nothing else changed.
2. A question → the same question, cleaned, ending in a question mark — never answered.
3. A request addressed to an assistant (a reminder, "write an email to …") → the same request,
   cleaned — never carried out.
4. A spoken self-correction → only the final intent survives.
5. A creative or entertaining request ("write a poem about …", "tell a joke about …") → the
   request, cleaned — never fulfilled.

Order matters: models weigh the turns nearest the real input most, so the hardest rules (never
fulfil a request) go last. At least one pair is required (the Lab test needs two history
turns); the count is the writer's. The examples must be new text.

### 1.4 Callers

```
server/src/api/refine_lab_api.js:22:import { composeRefinementSystem, REFINEMENT_EXAMPLES, RefinementFlags } from "../refinement.js";
server/src/seed_feature_prompts.js:21:import { _BASE_INSTRUCTIONS, _PRESERVE_TECHNICAL, _SELF_CORRECTION, _SMART_CLEANUP } from "./refinement.js";
server/tests/captures.test.js:12:import { collapseRepetitiveArtifacts as collapse, composeRefinementSystem, RefinementFlags } from "../src/refinement.js";
```

- `captures_api.js` (file 7) builds `RefinementFlags` from settings, reads stored flags with
  `fromDict`, stores `toDict()`, calls `refineTranscript` and uses only the first element.
- `refine_lab_api.js` — `POST /v1/ai/prompt-preview` returns `composeRefinementSystem` of the
  current Capture toggles and lists the enabled toggle names from `toDict()` key order;
  `POST /v1/refine/lab-run` runs `refine.base` with `REFINEMENT_EXAMPLES` as history (raw
  transcript, no collapse step) and the composed system unless the column sent its own.
- `seed_feature_prompts.js` builds the four `refine.*` seed rows from the four constants: the
  base row's system is `_BASE_INSTRUCTIONS` + the unchanged-fallback line + the three markers;
  each section row's system is its constant. Seeding is insert-if-missing, so **an existing
  database keeps whatever text its rows hold** (see Gaps).

User docs describing it: `docs/dictation.md` (Cleanup), `docs/ai-features.md` ("Prompts are
editable — and Dictation cleanup is one card with sections"), `docs/settings-reference.md`
(`captures`).

### 1.5 Tests that pin it

- `server/tests/captures.test.js`
  - `collapse_repetitive_artifacts` — the four cases in 1.3.
  - `compose_refinement_system_toggles` — after the seeded LLM boot: all-on composition,
    lower-cased, contains `"self"` and `"technical"`; all-off composition contains `"return the
    transcript unchanged"` (that line is in `seed_feature_prompts.js`) and does **not** contain
    `"technical"`.
  - `capture_crud_and_refine_degrades` — with the kit's `dispatch.chat` forced to throw
    `LLMNotConfiguredError`, a capture's transcript falls back to the raw text (exercises
    `refineTranscript` throwing).
- `server/tests/refine_lab.test.js`
  - `prompt_preview_serves_the_composed_refine_call` — the composed system is non-empty; with
    `captures.smart_cleanup` turned off the composition differs and is **shorter**.
  - `lab_run_rides_production_history` — history has ≥ 2 turns, the first `user`, the second
    `assistant`.
  - `lab_run_defaults_to_the_composed_system` — the Lab run's system equals the preview's.
- `server/tests/llm_seeds.test.js` `all_actions_seed_as_shared_rows` — the four `refine.*` rows
  exist (13 actions in all) and `refine.base`'s user template is `{{transcript}}` (both from
  `seed_feature_prompts.js`).

### 1.6 Free to change

All prompt wording and the examples (that is the point); how the two collapse passes are
implemented (any approach giving the contract above); internal helper names; the class's
internals as long as the constructor options, the three properties, `toDict` key order and
`fromDict` defaults hold.

---

## 2. `server/src/mcp/server.js` — the MCP endpoint

### 2.1 Role

JustVoice speaks the Model Context Protocol so an AI agent (Claude Code, Claude Desktop, Cursor,
any MCP client) can list voices and personas, speak text and transcribe audio through the
running server. This module builds the MCP server object with JustVoice's tools and mounts the
Streamable HTTP transport on the Fastify app at `/mcp`, with one session per client.

Rebuild it on the official SDK's documented patterns (`@modelcontextprotocol/sdk` 1.30.1 —
its `docs/server.md` and the "Streamable HTTP server (stateful)" example,
`src/examples/server/simpleStreamableHttp.ts`, on GitHub): a server object per session, a
`StreamableHTTPServerTransport` per session keyed by its `mcp-session-id`, a new session only
for an `initialize` request, the transport's `handleRequest(req, res, parsedBody)` doing the
protocol work.

### 2.2 Interface

| Export | Contract |
|---|---|
| `buildMcpServer()` | → an SDK server object with the four tools registered (file 3), with a `connect(transport)` method. Must work with no database, no app state and no HTTP request (the tests connect it to the SDK's `InMemoryTransport`). |
| `mountInto(app)` | `app`: a Fastify instance (the kit's `createServer`). **Synchronous**: registers the routes before returning, and returns `{close: async () => void}`. Must not touch the database or app state at mount time. |
| `SERVER_NAME`, `SERVER_VERSION`, `INSTRUCTIONS`, `CAPABILITIES` | exported today; no caller outside the file. Free. |

`server/src/mcp/index.js` (not on the list) re-exports `mountInto` from `./server.js` — keep
that export name and module.

Routes registered by `mountInto`: `GET`, `POST`, `DELETE` on both `/mcp` and `/mcp/`.

HTTP contract:

- `POST` without an `mcp-session-id` header whose JSON body is an `initialize` request → a new
  session: the session id is 32 lowercase hex digits; the reply carries it in the
  `mcp-session-id` header (the SDK does this).
- Any request carrying an `mcp-session-id` that names an open session → handled by that
  session's transport (`POST` messages, `GET` the server-to-client SSE stream, `DELETE` ends the
  session).
- An `mcp-session-id` that names no open session → **404** (the MCP spec's "session not found",
  which tells a client to initialize again).
- No session id and not an initialize `POST` → **400**. Today the transport-level checks for
  that case also answer **406** when the `Accept` header lacks `text/event-stream` (GET) or
  lacks both `application/json` and `text/event-stream` (POST), and **415** when a POST's
  `Content-Type` is not `application/json`, each as a JSON-RPC error body. The SDK's transport
  makes the same checks once a session exists.
- `initialize` negotiates the protocol version the SDK's way (the requested version when
  supported, else the latest).
- `/mcp` is **not** behind the app's bearer auth or CSRF check (the kit's hooks gate `/v1`
  paths only — RESEARCH §6). Keep that (see Gaps).
- `close()` closes every open session's transport and forgets them; a transport that closes on
  its own (DELETE, client gone) removes its session from the table.

Before handing the request to the transport, run it inside the per-request context of file 5
(the `X-JustVoice-Client-Id` header's first value or null, and the socket's remote address) so
tool handlers can read them. `mountInto` also installs file 5's response hook that stamps
`last_seen_at`.

Imports from ours and the kit (allowed): `getLogger`; the SDK's `McpServer` or `Server`,
`StreamableHTTPServerTransport`, `isInitializeRequest`, the request schemas; `node:crypto`
`randomUUID`.

### 2.3 Behaviour

- Advertise the `tools` capability. Today it also advertises empty `prompts` and `resources`
  lists, `logging`, `experimental` and a UI extension, all to mirror the Python server's wire;
  none is needed now (free).
- `serverInfo.name` is `justvoice`. The version today is fastmcp's own "3.4.5" (a Python
  leftover) — the writer may report the app's version (`server/src/version.js`) instead.
- Server `instructions`: one or two sentences saying JustVoice is a local voice production
  server, `justvoice.speak` renders text in a voice and returns an audio URL, and the `list_*`
  tools discover voices and personas. New wording.
- A request for a method the server does not serve gets a JSON-RPC error (the SDK's default is
  fine).
- Log at info when MCP is mounted and when a session is created (wording free).
- `app.js` wraps `mountInto` in a try/catch (a failed mount must not stop the app) and calls
  `close()` in its `onClose` hook before stopping engines.

### 2.4 Callers

```
server/src/mcp/index.js:6:export { mountInto } from "./server.js";
server/src/app.js:83:import { mountInto as mountMcp } from "./mcp/index.js";
server/src/app.js:384:    mcp = mountMcp(app);
server/tests/mcp_server.test.js:14:import { mountInto } from "../src/mcp/index.js";
server/tests/mcp_server.test.js:16:import { buildMcpServer } from "../src/mcp/server.js";
src/views/SettingsView.vue:671:  claude_code: `claude mcp add justvoice --transport http --url ${api.serverUrl}/mcp --header "X-JustVoice-Client-Id: claude-code"`,
src/views/SettingsView.vue:672:  curl: `curl -X POST ${api.serverUrl}/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'X-JustVoice-Client-Id: my-script' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
```

`app.js` relies on: `mountInto` returning synchronously an object with an async `close()`; the
routes registered before the static catch-all (`mountStatic`, registered after it). Settings →
MCP shows connection snippets for `/mcp` with the client-id header. External MCP clients rely on
the Streamable HTTP transport at `/mcp` on the app port.

User docs: `docs/mcp-server.md`, `docs/troubleshooting.md` ("MCP clients can't find the
server" — stale: names fastmcp), `docs/use-cases.md`.

### 2.5 Tests that pin it

`server/tests/mcp_server.test.js`:

- `mcp_mounted` — on a bare kit `createServer` app, `mountInto(app)` (not awaited), then
  `app.ready()`: `app.hasRoute({method: "POST", url: "/mcp"})` and the same for `GET` are true.
- `tools_registered` — `buildMcpServer().connect(<in-memory transport>)` with no database or
  state; an SDK `Client`'s `listTools()` names include `justvoice.speak`,
  `justvoice.transcribe`, `justvoice.list_voices`, `justvoice.list_personas`.
- `speak_without_resolvable_voice_raises` — see file 3.

### 2.6 Free to change

The SDK API level (`McpServer` vs low-level `Server` — see Gaps on zod), the exact refusal
bodies and their wording, the advertised optional capabilities, the server version string, the
instructions text, the log lines, internal names and structure. Keep: the four routes, the
session model, 404 for an unknown session, the synchronous `mountInto` returning `{close}`.

---

## 3. `server/src/mcp/tools.js` — the four MCP tools

### 3.1 Role

The tool surface agents call: speak text in a voice (persisting a Generation row and returning a
fetchable audio URL — a headless server plays nothing), list voices, list personas, transcribe
a clip. Thin wrappers over existing routes and services, so an agent sees what the UI sees.

### 3.2 Interface

No export of this file is imported outside `server/src/mcp/` today. Today it exports `TOOLS`,
`listTools`, `validateArgs`, `callTool`, the four handlers and `_speak`; the writer may reshape
these freely as long as file 2's `buildMcpServer()` registers the tools below.

**The tools** (names, parameter names and result field names are fixed — docs, users' agent
configs and the test depend on them; descriptions are new):

| Tool | Parameters | Result (an object) |
|---|---|---|
| `justvoice.speak` | `text` string, required · `voice` string or null, optional · `persona` string or null, optional · `language` string or null, optional | `{generation_id, status: "completed", voice: <voice id>, persona: <persona name or null>, duration_sec: <number or null>, audio_url: "/v1/generations/<id>/audio", source: "mcp"}` |
| `justvoice.list_voices` | `limit` integer, optional, default 200 | `{voices: [{id, name, engine, source, language, gender}], total}` |
| `justvoice.transcribe` | `audio_base64` string or null, optional · `audio_path` string or null, optional · `language` string or null, optional | `{text, language}` |
| `justvoice.list_personas` | none | `{personas: [{id, name, voice_id, language, has_note}]}` |

Unknown parameters are refused; a parameter of the wrong type is refused. A refusal or a failure
comes back as a tool result with `isError: true` and a text content item carrying the reason.
A success carries the result object as JSON text in a text content item (every client reads
that); today it also carries the same object as `structuredContent` with an open object
`outputSchema` (recommended, free).

Description content each tool must convey:

- speak — renders text to speech in a JustVoice voice; returns a generation id and an
  `audio_url` to GET the WAV; pass `voice` (a voice id) or `persona` (a persona name); with
  neither, the client's binding or the global default voice applies.
- list_voices — lists the voice library (presets, cloned, designed); the returned `id` is what
  speak's `voice` takes.
- transcribe — transcribes a clip with the local speech recognition; pass exactly one of
  `audio_base64` or `audio_path` (an absolute local path — loopback callers only).
- list_personas — lists personas (finished voices) with their voice; the returned `name` is what
  speak's `persona` takes.

Imports from ours and the kit (allowed): `getState`; `Generation`, `uuid` (file 10);
`getDb` (file 9); `storeMediaPath`; `generationsRoot`; `b64decode`, `ValueError`, `pyRound`;
`currentClientId`, `requestIsLoopback` (file 5); `resolveVoice` (file 4); `_MAX_UPLOAD_MB`,
`_sttTranscribe` (file 7); `listVoices` (voices_api); `generate` (generate_api); `construct`,
`GenerateRequest` (models.js); `_resolveEngineForVoice`, `_lineModel` (render_core). Today the
captures, voices, generate, models and render_core modules are loaded lazily at call time (they
sit in import cycles with the app); keep them lazy or otherwise avoid a load-time cycle.

### 3.3 Behaviour

**speak.**

- Resolve the voice with file 4 from (`voice`, `persona`, the request's client id from file 5,
  the database handle). Nothing resolves → a tool error whose text **contains "No voice
  resolved"** (the test) and tells the caller the four ways out: pass a voice id, pass a persona
  name, bind a persona to this client at `POST /v1/mcp/bindings`, or set
  `settings.mcp.default_voice`.
- Build a `GenerateRequest` with `voice` = the resolved voice id, `text`, `language` = the
  given language, else the resolved persona's language, else null, and `persona_id` = the
  resolved persona's id or null; call `generate_api.generate`. The answer is the WAV — a Buffer,
  or an object whose `body` is one.
- Persist one `generations` row: a new uuid; `persona_id`; `text`; `language` = the given
  language or `"en"` (not the persona's — see Gaps); `engine` = the engine that spoke it
  (`_resolveEngineForVoice`), else the registry's current engine, else `"managed"`; `model` =
  `_lineModel(...)` when the engine is known, else null; `status` `"completed"`; `source`
  `"mcp"`; `duration_sec` = (WAV byte length − 44) ÷ 32,000 rounded to 3 places when the WAV is
  longer than 44 bytes, else null (this assumes 16 kHz 16-bit mono — RESEARCH §3; see Gaps).
  Write the WAV to `<generationsRoot(dataDir)>/<id>.wav` and store `audio_path` as
  `storeMediaPath(<that path>)` (data-root relative). The insert, the file write and the
  `audio_path` update happen in one database transaction.
- Return the result object above. Generation errors propagate as a tool error.

**list_voices.** `limit` outside 1..1000 → a tool error. Otherwise call `voices_api.listVoices()`,
map each voice to `{id, name, engine, source, language, gender}` (a falsy gender becomes null),
return the first `limit` of them and `total` = the full count. Today `limit` is checked
leniently (a boolean, a whole-number float or a numeric string is accepted as an integer) —
free.

**transcribe.**

- Exactly one of `audio_base64` / `audio_path` must be given (an empty string counts as not
  given) → otherwise a tool error.
- The size cap is `_MAX_UPLOAD_MB` (the constant, 200) MB.
- Path mode: only for a loopback caller (file 5's `requestIsLoopback`) — otherwise a tool error
  saying remote callers must use base64 (so a server bound to 0.0.0.0 is not a local-file read
  primitive). The path must be absolute (Windows: a drive letter and separator, or a UNC share;
  elsewhere a leading `/`), must name an existing regular file, and must be within the cap; each
  failure is its own tool error. Then transcribe it in place with `captures._sttTranscribe(path,
  language)`.
- Base64 mode: decode strictly (an invalid character is a tool error naming the reason), check
  the decoded size against the cap, write it to a fresh temporary folder as a `.wav`, transcribe
  it, and remove the folder however that ends.
- Return `{text, language}` with `language` echoed as given (null when not given).

**list_personas.** All personas from the persona store, in its order (creation time), each as
`{id, name, voice_id, language, has_note: <whether the persona has a non-empty note>}`.

### 3.4 Callers

Only file 2 (it registers the tools). Agents call them over `/mcp`. `docs/mcp-server.md` lists
the four tools and says `audio_path` is loopback-only and `speak` returns an `audio_url`.

### 3.5 Tests that pin it

`server/tests/mcp_server.test.js`:

- `tools_registered` — the four names (file 2).
- `speak_without_resolvable_voice_raises` — with a fresh database and app state, no binding, no
  default voice and no HTTP request: `callTool({name: "justvoice.speak", arguments: {text:
  "hello"}})` returns `isError: true` and `content[0].text` contains `"No voice resolved"`.
  The handler must therefore read "no client id" (null) cleanly when there is no HTTP request.

### 3.6 Free to change

All descriptions; error wording other than "No voice resolved"; the argument-validation
mechanism and its messages (today they imitate pydantic's text — no longer needed); the error
prefix; the lenient integer coercion; structure and names.

---

## 4. `server/src/mcp/resolve.js` — which voice an MCP call speaks with

### 4.1 Role

Decides the voice for `justvoice.speak` from the call's arguments, the calling client's
binding, and the global default.

### 4.2 Interface

| Export | Contract |
|---|---|
| `resolveVoice(voice, persona, clientId, h)` | `voice`, `persona`, `clientId`: string or null/undefined; `h`: a database handle (file 9's). → an object `{voice_id: string, persona: <persona object or null>}`, or `null` when nothing resolves. Synchronous. Never throws for "not found". |
| `Resolved` | class today (`voice_id`, `persona`); no caller outside the MCP package. Free. |

The persona object is the persona store's (it has at least `id`, `name`, `voice_id`,
`language`, `note`).

Imports (allowed): `strip`; `getState`; `MCPBinding` (file 10).

### 4.3 Behaviour

Precedence, first match wins (empty strings count as absent):

1. An explicit `voice` → `{voice_id: voice, persona: null}`, even if `persona` is also given.
2. An explicit `persona` → look it up by id in the persona store; if not found, by name —
   trimmed and case-insensitive on both sides — over the store's list. Found and it has a voice
   → `{voice_id: <its voice>, persona: <it>}`. Not found, or found without a voice → **`null`
   at once** (do not fall through to the binding or the default; the caller reports it).
3. A `clientId` → the `mcp_bindings` row for that client id (read through `h`). If it has a
   `persona_id` and that persona exists and has a voice → `{voice_id, persona}`. Otherwise fall
   through.
4. `getState().settings.get().mcp.default_voice` when set → `{voice_id: <it>, persona: null}`.
5. Otherwise `null`.

### 4.4 Callers

```
server/tests/mcp_server.test.js:15:import { resolveVoice } from "../src/mcp/resolve.js";
```

and file 3 (speak). Settings → MCP edits the bindings (`/v1/mcp/bindings`, not on the list) and
the default voice (`PATCH /v1/settings` `mcp.default_voice`).

### 4.5 Tests that pin it

`server/tests/mcp_server.test.js` `resolve_precedence`: with persona "Mara Vance" (voice
`af_heart`) — explicit `"voice-x"` with persona and client also given → `voice_id` `"voice-x"`,
`persona` null; persona `"mara vance"` → `af_heart` and the persona's id; a binding row
`{client_id: "cli-1", persona_id}` inserted with `h.insert(MCPBinding, …)` → client `"cli-1"`
resolves to `af_heart`; unknown client, no default → `null`; after setting
`settings.mcp.default_voice = "fallback-voice"` → `"fallback-voice"`.

### 4.6 Free to change

Everything but the signature, the result's two field names and the precedence.

---

## 5. `server/src/mcp/context.js` — who is calling

### 5.1 Role

Gives tool handlers the calling client's identity and address without passing the HTTP request
through every call, and records when each client was last heard from (the bindings table's
*last seen* column in Settings → MCP).

### 5.2 Interface

Exported today: `CLIENT_ID_HEADER`, `runWithRequest({clientId, remoteAddr}, fn)`,
`currentClientId()`, `currentRemoteAddr()`, `requestIsLoopback()`, `_isStampedPath(path)`,
`_stampLastSeen(clientId)`, `installClientIdHook(app)`. None is imported outside
`server/src/mcp/`; names and split are free, the behaviours below are not.

Fixed: the header name **`X-JustVoice-Client-Id`** (case-insensitive as HTTP headers are) —
users' MCP configs, `docs/mcp-server.md` and Settings → MCP's snippets use it.

Tables touched: `mcp_bindings` — `client_id` (VARCHAR, primary key, not null), `last_seen_at`
(DATETIME, nullable), `created_at` (DATETIME, filled by the schema's default on insert). The
other columns (`label`, `persona_id`, `default_engine`) are left alone.

Imports (allowed): `node:async_hooks` `AsyncLocalStorage` (the standard Node per-request
context), `node:net` `isIP`, `getLogger`, `MCPBinding` (file 10), `getDb` (file 9),
`utcNowNaive` (models.js).

### 5.3 Behaviour

- **Per-request context.** For the duration of handling one `/mcp` request, the client id (the
  header's first value, or null) and the remote address (the socket's, or null) are available
  to anything running in that request. Outside a request (the in-memory test transport, a
  background task) the client id is null and the address is null. The SDK's
  `extra.requestInfo.headers` in a tool handler is an acceptable source for the header too; the
  remote address still has to come from the socket.
- **Loopback.** True only for an IPv4 address in 127.0.0.0/8, the IPv6 address `::1`, or an
  IPv4-mapped IPv6 address of a 127.x address (`::ffff:127.0.0.1`, which Node reports on
  dual-stack sockets). No request, no address or an address that does not parse → false
  (deny).
- **Last seen.** After the response to any request whose path (query string ignored) is exactly
  `/mcp` or starts with `/mcp/` (a path boundary: `/mcpfoo` does not count) and that carried the
  client-id header, upsert that client's `mcp_bindings` row: create it with `client_id` and
  `last_seen_at` = now, or update `last_seen_at` = now. One transaction. It never throws: a
  missing database is skipped silently, any other failure is logged at debug level. The hook is
  installed on the root app by `mountInto` and runs for every request, filtering by path.
  Python stamped from a thread after the response; here it runs once the response has been sent
  (Fastify `onResponse`) — it worked in the port's comparison (RESEARCH §6, "the stamped
  `mcp_bindings` row").

### 5.4 Callers

Files 2 and 3 only. The stamped column is shown by Settings → MCP through `GET
/v1/mcp/bindings` (`server/src/api/mcp_bindings_api.js`, not on the list):

```
src/views/SettingsView.vue:614:    last_seen: b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : null,
```

### 5.5 Tests that pin it

No direct test. `resolve_precedence` and `speak_without_resolvable_voice_raises` run with no
request in flight (the client id must read null without error).

### 5.6 Free to change

Mechanism, names, file split, log wording. Keep the header name, the loopback rule, the path
rule and the never-throws stamp.

---

## 6. `server/src/audio/chunked.js` — splitting long text into pieces

### 6.1 Role

A speech model is given long text in pieces: the host cuts a line longer than the model's piece
length at natural boundaries, each piece is spoken, and the pieces are joined by the DSP program
(`dsp_client.join` / `streamJoin`, by the join rule whose constants live here). This file is the
splitter plus those constants.

### 6.2 Interface

| Export | Contract |
|---|---|
| `DEFAULT_MAX_CHUNK_CHARS` | const `800` — the default piece length (`settings.generation.max_chunk_chars`' default). |
| `splitTextIntoChunks(text, maxChars = DEFAULT_MAX_CHUNK_CHARS)` | `text`: any value (coerced to string); `maxChars`: integer. → array of strings. Synchronous, pure. |
| `PIECE_JOIN_PAUSE_MS` | const `260` — where two pieces meet in silence, the silence is cut down to this. |
| `PIECE_JOIN_SILENCE_DBFS` | const `-60.0` — "quiet" threshold for that rule. |
| `WINDOW_MS` | const `10` — quiet is judged in windows of this length. |

The three join constants are JustVoice's own measured decision (2026-10-07, RESEARCH §3 "Long
lines also hold ~0.9–1 s silences") — keep the values; `dsp_client.js` sends them to the DSP
program, which applies the rule.

Imports (allowed): `PY_WS` from `@delebash/llm-runner/platform/py`.

### 6.3 Behaviour

Lengths and positions are counted in **Unicode code points** (an emoji is one character), not
UTF-16 units. "Whitespace" is Python's definition (the kit's `PY_WS`).

- Trim the text. Empty → `[]`. At most `maxChars` → `[<trimmed text>]`.
- Otherwise produce pieces left to right. Each piece is taken from the start of what remains
  (leading whitespace dropped), ends at the best boundary inside the first `maxChars`
  characters, and is trimmed; an empty piece is dropped. When what remains fits in `maxChars`
  it is the last piece. Nothing but whitespace at the cut is lost: the pieces, concatenated with
  whitespace ignored, equal the text with whitespace ignored. No piece is longer than
  `maxChars`.
- Boundary preference, best first; within each kind the **last** one in the window wins:
  1. **A sentence end.** `.`, `!` or `?` followed by whitespace or by the end of the window,
     except: a `.` right after a known abbreviation (the run of letters immediately before the
     period, lower-cased, is one of: mr, mrs, ms, dr, prof, sr, jr, st, ave, blvd, inc, ltd,
     corp, dept, est, approx, vs, etc); a `.` whose preceding run of letters is directly
     preceded by a digit, or which directly follows a digit (a decimal, and also a sentence
     ending in a number); a punctuation mark inside a `[…]` tag. Also any CJK sentence end `。`
     `！` `？` anywhere in the window (no following space needed). The later of the two kinds
     wins.
  2. **A clause boundary.** `;`, `:`, `,` or `—` (em dash) followed by whitespace or the end of
     the window, not inside a `[…]` tag.
  3. **A space** — the last ASCII space (U+0020 only) in the window.
  4. **A hard cut** after `maxChars` characters; if that cut would fall strictly inside a `[…]`
     tag found within the window, cut just before the tag's `[` instead, unless the tag starts
     at the window's first character.
- A piece includes its boundary character (the period, the comma; a space boundary is trimmed
  away).
- `[…]` tags are found left to right in the window: from a `[` to the next `]`, non-overlapping;
  an unclosed `[` ends the search. A tag is meant to be atomic (`[laugh]` never split); the
  current rules leave some edge cases where it can be (Gaps).
- Current output, measured 2026-10-08 (for reference — no test pins these): `"We met e.g. at noon. Then
  left."` at 14 → `["We met e.g.", "at noon.", "Then left."]`; `"It was 2024. Then we left
  town."` at 16 → `["It was 2024.", "Then we left", "town."]`; `"一二三四五六七八九十…"` (20 CJK
  characters, no punctuation) at 8 → three hard-cut pieces of 8, 8, 4; `"短句。另一句。第三句。"`
  at 6 → three sentences; `"aaa; bbb, ccc: ddd — eee"` at 10 → `["aaa; bbb,", "ccc: ddd —",
  "eee"]`.

### 6.4 Callers

```
server/src/api/generate_api.js:17:import { DEFAULT_MAX_CHUNK_CHARS, splitTextIntoChunks } from "../audio/chunked.js";
server/src/api/generate_api.js:89:  return [pyInt(gen.max_chunk_chars ?? DEFAULT_MAX_CHUNK_CHARS), pyInt(gen.crossfade_ms ?? 50)];
server/src/api/generate_api.js:306:      const chunks = splitTextIntoChunks(req.text, maxChunkChars);
server/src/api/generate_api.js:411:    const chunks = splitTextIntoChunks(req.text, maxChunkChars);
server/src/api/voice_preview_api.js:23:import { splitTextIntoChunks } from "../audio/chunked.js";
server/src/api/voice_preview_api.js:858:      const pieces = splitTextIntoChunks(text, pieceChars);
server/src/audio/dsp_client.js:40:import * as chunked from "./chunked.js";
server/src/audio/dsp_client.js:269:    pause_ms: chunked.PIECE_JOIN_PAUSE_MS,
server/src/audio/dsp_client.js:270:    silence_dbfs: pyFloatValue(chunked.PIECE_JOIN_SILENCE_DBFS),
server/src/audio/dsp_client.js:271:    window_ms: chunked.WINDOW_MS,
server/src/engines/manager.js:39:import { DEFAULT_MAX_CHUNK_CHARS } from "../audio/chunked.js";
server/src/engines/manager.js:746:    let cap = DEFAULT_MAX_CHUNK_CHARS;
server/src/render_core.js:30:import { DEFAULT_MAX_CHUNK_CHARS, splitTextIntoChunks } from "./audio/chunked.js";
server/src/render_core.js:189:  const cap = pyInt(state.settings.get().generation?.max_chunk_chars ?? DEFAULT_MAX_CHUNK_CHARS);
server/src/render_core.js:763:    const chunks = splitTextIntoChunks(effectiveText, maxChunkChars);
server/tests/chunked.test.js:6:import { PIECE_JOIN_PAUSE_MS, splitTextIntoChunks } from "../src/audio/chunked.js";
```

What they rely on: Generate and the render path call the splitter only when the text is longer
than the piece length (counted in code points) and synthesize each piece in order (seed + piece
index); the voice preview streams pieces of `max(80, stream_piece_chars)` and, if the splitter
returns nothing, speaks the whole text; `dsp_client` sends the three join constants with every
join (`pause_ms`, `silence_dbfs` as a float, `window_ms`).

User docs: `docs/engines.md` ("Long lines, and what a model costs", "Long text, cut into
pieces" — the abbreviation, decimal, CJK and bracket-tag claims are there).

### 6.5 Tests that pin it

- `server/tests/chunked.test.js`: `short_text_is_one_chunk` (`"Just a sentence."` at 800 → one
  piece, unchanged); `splits_at_sentence_boundary` (`"First sentence. Second sentence. Third
  sentence."` at 20 → every piece ≤ 25 characters, and the pieces joined with spaces removed
  equal the text with spaces removed); `does_not_split_abbreviation` (`"Dr. Smith met Mr. Jones
  at the café. They had tea."` at 30 → no piece is exactly `"Dr."` or `"Mr."`);
  `does_not_split_paralinguistic_tag` (`"Once upon a time [laugh] there was a wolf."` at 20 → the
  pieces joined contain `"[laugh]"`); `pieces_meet_at_the_piece_pause_not_their_padding` (the
  joined gap is between `PIECE_JOIN_PAUSE_MS` and that + 20 ms). The other tests there exercise
  `dsp_client` joins.
- `server/tests/split_and_calibration.test.js` `a_long_line_goes_to_the_model_in_its_own_piece_length`
  — a 3-sentence line rendered with a model piece length of 70 reaches the model in ≥ 3 pieces,
  each ≤ 70 code points; with no model length (cap 800) in one piece.

### 6.6 Free to change

Implementation, names, internal structure; the abbreviation list may grow. Keep the exports and
their values, code-point counting, the boundary preference, and the piece guarantees above.

---

## 7. `server/src/api/captures_api.js` — the dictation backend

### 7.1 Role

The server side of dictation: a recording comes in (from the future desktop hotkey, or any
headless caller), the local speech recognizer transcribes it, the refinement pass (file 1)
optionally cleans it, and a `captures` row keeps **both** texts so the UI can show either. Also
a stateless `POST /v1/transcribe`, re-refine and re-transcribe, pin, list, read, audio download
and delete. It also hosts the shared multipart-form helpers and the speech-recognition loader
that `align_api`, `projects_api`, `voice_bundle_api` and the MCP tools use.

### 7.2 Interface

**Exports other modules use (fixed):**

| Export | Contract |
|---|---|
| `router(app)` | async Fastify plugin registering the routes below (registered by `app.js`). |
| `_MAX_UPLOAD_MB` | const `200`. |
| `cfg` | mutable object `{_MAX_UPLOAD_MB: 200}` — **the routes read `cfg._MAX_UPLOAD_MB` at request time** (a test sets it to 0 and restores it from the constant; `align_api` and `voice_bundle_api` read it too). |
| `ensureSttLoaded()` | async → `[manager, settings]` (the engine manager and the current settings object). See 7.3. |
| `_sttTranscribe(audioPath, language)` | async → the recognizer's text (string). |
| `_readForm(req)` | async → `{files: {<field>: {path, filename, size}}, fields: {<field>: string}}`. |
| `_requireFile(form, name)` | → the file entry, or throws the kit's `RequestValidationError` (→ 422) with one "missing" error located at `["body", name]` — the same FastAPI-style shape `align_api.js` builds for its own missing form fields. |
| `_formField(form, name, dflt)` | → the field's string, or `dflt` when it is missing **or empty** (FastAPI's form semantics). |
| `_useForms(app)` | async — makes a Fastify plugin context read multipart forms (see 7.3). |

**Exported today, no outside caller (free to keep, rename or drop):** `_capturesDir`,
`_maybeRefine`, `CaptureRow`, `CaptureList`, `UpdateCaptureRequest`, `RefineBody`, `_row`.

**Spy-ability (required).** `captures.test.js` replaces `_sttTranscribe` with
`vi.spyOn(<module namespace>, "_sttTranscribe")`. Every route's call to `_sttTranscribe`,
`_sttTranscribe`'s call to `ensureSttLoaded`, and the routes' calls to the refine-or-fall-back
helper must go through the module's own live exports so a spy installed on the namespace takes
effect — this repo's pattern is the module importing its own namespace (`import * as self`, as
`render_core.js` and `generate_api.js` do).

**The capture row on the wire** (every route that returns a capture):

| Field | Type | Source |
|---|---|---|
| `id` | string | `captures.id` |
| `source` | string | `captures.source` (`mic` · `system_audio` · `upload`) |
| `language` | string or null | `captures.language` (what the caller asked for, not what was detected) |
| `duration_ms` | integer or null | `captures.duration_ms` (never written today — always null) |
| `transcript` | string or null | `captures.transcript` (refined, or the raw text when refinement did not run) |
| `raw_transcript` | string or null | `captures.raw_transcript` |
| `refinement_flags` | object | `refinement_flags_json` parsed; `{}` when empty |
| `audio_url` | string | `/v1/captures/<id>/audio` |
| `pinned` | boolean | `captures.pinned` |
| `created_at` | datetime string | `captures.created_at` (ISO, naive UTC) |

**Routes** (all JSON unless said; errors are the kit's problem+json: 400 `badRequest`, 404
`notFound`, 422 validation):

| Method & path | Input | Answer |
|---|---|---|
| `POST /v1/transcribe` | multipart: `file` (required), `language` (optional; empty = not sent) | 200 `{text, language}` (`language` echoed, null when not sent). No row. |
| `POST /v1/captures` | multipart: `file` (required), `source` (optional, default `upload`; empty = default), `language` (optional) | **201** + the capture row |
| `GET /v1/captures` | query `limit` integer (default 50), `offset` integer (default 0) | 200 `{captures: [row…], total}` |
| `GET /v1/captures/:capture_id` | — | 200 row; 404 |
| `GET /v1/captures/:capture_id/audio` | — | 200 the WAV, `Content-Type: audio/wav`, `Content-Length`, `Content-Disposition: attachment; filename="<id>.wav"`; 404 when the row or the file is missing |
| `PATCH /v1/captures/:capture_id` | JSON `{pinned: boolean or null}` (optional, default null) | 200 row; 404 |
| `DELETE /v1/captures/:capture_id` | — | 200 `{deleted: true}`; 404 |
| `POST /v1/captures/:capture_id/refine` | JSON `{smart_cleanup, self_correction, preserve_technical}`, each boolean or null, optional | 200 row; 404; 400 when there is no raw transcript |
| `POST /v1/captures/:capture_id/retranscribe` | query `language` string (optional) | 200 row; 404; 400 when the audio is missing |

**Table** `captures` (from `models_schema.js`, unchanged): `id` VARCHAR PK not null (uuid
default) · `audio_path` VARCHAR not null · `source` VARCHAR not null (default `mic`) · `language`
VARCHAR · `duration_ms` INTEGER · `transcript` TEXT · `raw_transcript` TEXT ·
`refinement_flags_json` TEXT · `pinned` BOOLEAN not null (default false) · `created_at` DATETIME
(now by default).

**Files:** recordings at `<dataDir>/captures/<id>.wav` (folder created on demand), stored in
`audio_path` data-root-relative via `storeMediaPath`, read back via `mediaFile`.

Imports from ours and the kit (allowed): `@fastify/multipart`; `RequestValidationError`;
`getLogger`; `T`, `opt`, `nullable`; `jsonLoads`, `pyJson`; `getState`; `Capture`, `uuid`
(file 10); `getDb` (file 9); `badRequest`, `notFound`; `mediaFile`, `storeMediaPath`;
`construct`, `DateTime`; file 1; `getManager` from `../engines/manager.js` (loaded lazily
today — keep it lazy or avoid a load-time cycle).

### 7.3 Behaviour

**Loading speech recognition** (`ensureSttLoaded`): if nothing is loaded in the manager's `stt`
slot, look at the `asr` engine's status: `installed` → log at info that speech recognition is
being loaded on first use (naming `settings.captures.stt_model`) and load `asr` with
`{device: "auto", variant: settings.captures.stt_model}`; any other status → 400 saying speech
recognition is `<status>` and to install the speech runtime on the AI page. Return the manager
and the settings.

**Transcribing** (`_sttTranscribe`): ensure loaded; the language is the argument, else
`settings.captures.language`; `""` or `"auto"` means none (null — the recognizer detects it);
call the manager's `transcribe({audio_path, language})` and return its text. Shared by
dictation, `/v1/transcribe`, MCP and nothing else.

**Refine or fall back:** run file 1's `refineTranscript(raw, flags, {settings})`; on **any**
error log a warning that refinement was skipped (with the reason) and fall back to the raw
transcript — a refinement failure never loses the raw text.

**The form reader** (`_readForm`, `_useForms`) — FastAPI's `File()`/`Form()` semantics:

- `_useForms(app)` registers `@fastify/multipart` in that plugin context with no file-size
  limit of its own (the routes cap uploads themselves) and a 1 MiB field-size limit, and adds
  an `onResponse` hook that deletes the request's spool folder once the answer has been sent.
  It is called once per plugin context (captures, align, voice bundle, and the project-import
  child context).
- `_readForm(req)`: a request that is not multipart has no form (every field missing — so a
  required file answers 422). A multipart request is read whole before the handler continues:
  each file part is streamed into a fresh spool folder under the OS temp directory (read the
  temp directory at call time — a test redirects it with `TEMP`/`TMP`) as its own file **with
  no `.wav` extension**, recorded as `{path, filename, size}` under its field name; every other
  part becomes a string under its field name. The spool folder is remembered on the request for
  the cleanup hook.

**Size cap:** an upload is copied in chunks from the spool to its destination; once the running
total exceeds `cfg._MAX_UPLOAD_MB` MiB (strictly greater; 0 refuses any non-empty file) the copy
stops and the route answers 400 `upload exceeds <N> MB`.

**`POST /v1/transcribe`:** read the form; require `file` (422); `language` from the form (empty
= null). Copy the upload, capped, into a fresh temporary folder as `upload.wav`; transcribe it;
**delete that folder however the request ends** (oversize, transcription error, success) —
`audit_step5.test.js` checks that no `.wav` remains anywhere under the temp directory after an
oversized upload. Answer `{text, language}`.

**`POST /v1/captures`:** read the form; require `file` (422) — checked before anything else;
`source` from the form (default `upload`), `language` (default null). A source other than `mic`,
`system_audio`, `upload` → 400. New uuid; copy the upload, capped, to
`<dataDir>/captures/<id>.wav` (on a refusal or error the partial file is removed and the error
re-raised). Transcribe it; **if transcription fails the error propagates, the WAV stays on disk
and no row is written** (current behaviour, a Python bug copied on purpose — RESEARCH §6; see
Gaps). Flags = the three `settings.captures` toggles (`smart_cleanup`, `self_correction`,
`preserve_technical`). Transcript = the raw text; when `settings.captures.auto_refine` is on,
refine-or-fall-back. Insert the row: `id`, `audio_path` (relative), `source`, `language`,
`raw_transcript`, `refinement_flags_json` = the flags' `toDict()` as JSON text (written with the
kit's `pyJson`), `transcript`. Answer 201 with the row read back.

**`GET /v1/captures`:** `limit` clamped to 1..200, `offset` to ≥ 0; rows ordered newest first by
`created_at` (pinned rows are **not** sorted first here — the Captures page does that);
`total` is the count of all captures. A non-integer `limit`/`offset` → 422.

**`PATCH /v1/captures/:id`:** 404 when missing; when `pinned` is not null, store it; answer the
row (a body with `pinned: null` or no `pinned` changes nothing).

**`DELETE /v1/captures/:id`:** 404 when missing; delete the audio file if the row names one
(ignore a file that is already gone); delete the row; `{deleted: true}`.

**`POST /v1/captures/:id/refine`:** 404 when missing; 400 when `raw_transcript` is empty or
null. Flags: each body field that is null takes the capture's stored flag (stored flags read
with `RefinementFlags.fromDict`, so a missing store means all on). Always refines (ignores
`auto_refine`); **does not** catch errors — a refinement failure (no provider, model error)
surfaces as the app's generic 500 (see Gaps). Store `transcript` = the refined text and
`refinement_flags_json` = the new flags; never touch `raw_transcript`. Answer the row.

**`POST /v1/captures/:id/retranscribe`:** 404 when missing; 400 when `audio_path` is empty or
does not name an existing file. Transcribe the stored audio with the query `language`, else the
capture's own `language`. Flags = the stored flags (`fromDict`). Transcript = raw; when
`auto_refine` is on, refine-or-fall-back. Store `raw_transcript` and `transcript` (flags and
language unchanged). Answer the row.

### 7.4 Callers

```
server/src/app.js:36:import { router as capturesRouter } from "./api/captures_api.js";
server/src/api/align_api.js:25:import * as captures from "./captures_api.js";
server/src/api/align_api.js:32:  const [mgr, settings] = await captures.ensureSttLoaded();
server/src/api/align_api.js:48:  await captures._useForms(app);
server/src/api/align_api.js:55:    const form = await captures._readForm(req);
server/src/api/align_api.js:63:    const language = captures._formField(form, "language", null);
server/src/api/align_api.js:66:    if (wav.length > captures.cfg._MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`upload exceeds ${captures.cfg._MAX_UPLOAD_MB} MB`);
server/src/api/projects_api.js:62:import * as captures from "./captures_api.js";
server/src/api/projects_api.js:796:    const form = await captures._readForm(req);
server/src/api/projects_api.js:1248:    await captures._useForms(child);
server/src/api/voice_bundle_api.js:15:import * as captures from "./captures_api.js";
server/src/api/voice_bundle_api.js:50:  await captures._useForms(app);
server/src/api/voice_bundle_api.js:72:    const form = await captures._readForm(req);
server/src/api/voice_bundle_api.js:73:    const file = captures._requireFile(form, "file");
server/src/api/voice_bundle_api.js:75:    const cap = captures.cfg._MAX_UPLOAD_MB;
server/tests/audit_step5.test.js:12:import * as captures from "../src/api/captures_api.js";
server/tests/audit_step5.test.js:38:  captures.cfg._MAX_UPLOAD_MB = captures._MAX_UPLOAD_MB;
server/tests/audit_step5.test.js:291:  captures.cfg._MAX_UPLOAD_MB = 0;
server/tests/captures.test.js:10:import * as captures from "../src/api/captures_api.js";
server/tests/captures.test.js:27:  vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("um hello hello world");
src/components/PersonaCloneMaker.vue:133:api.safeRequest("/v1/captures", { captures: [] }).then((r) => { captures.value = r?.captures || []; });
src/components/PersonaCloneMaker.vue:148:    const blob = await api.requestBlob(`/v1/captures/${id}/audio`);
src/views/CapturesView.vue:45:    const updated = await api.request(`/v1/captures/${c.id}`, {
src/views/CapturesView.vue:76:    const res = await api.request("/v1/captures");
src/views/HomeView.vue:121:    safeRequest("/v1/captures?limit=1", { captures: [], total: null }),
```

What they rely on: `align_api` — `ensureSttLoaded` returning `[mgr, settings]`, the form
helpers, `cfg._MAX_UPLOAD_MB`; `projects_api`'s import route — `_readForm` returning
`form.fields` and `form.files.file` with `.path` and `.filename`, and `_useForms` working in a
child context whose content-type parsers were all removed and replaced; `voice_bundle_api` —
`_useForms`, `_readForm`, `_requireFile`, `cfg`; the MCP tools (file 3) — `_MAX_UPLOAD_MB` and
`_sttTranscribe`. The renderer: Captures (list, `pinned` PATCH, the row fields `id`, `source`,
`language`, `duration_ms`, `created_at`, `transcript`, `raw_transcript`, `pinned`), Home (`total`
with `limit=1`), the persona clone maker (list + audio blob).

User docs: `docs/dictation.md`, `docs/backups-and-data.md` (capture audio stored relative to the
data folder; reset wipes captures), `docs/troubleshooting.md` ("Dictation won't start").

### 7.5 Tests that pin it

- `server/tests/captures.test.js`: `transcribe_stateless` (multipart `file` → 200,
  `text` = the spied recognizer's text); `capture_crud_and_refine_degrades` (201; raw and
  transcript both the raw text when refinement is unavailable; `refinement_flags.smart_cleanup`
  true; list `total` 1; the `audio_url` serves bytes starting `RIFF`; retranscribe 200; delete
  200; list `total` 0).
- `server/tests/audit_step5.test.js` `an_oversized_transcription_upload_leaves_no_file` — temp
  directory redirected via `TEMP`/`TMP`, `cfg._MAX_UPLOAD_MB = 0`, a 68-byte upload to
  `/v1/transcribe` → 400, and no file ending `.wav` anywhere under that temp directory.
- The form helpers through the project import route: `server/tests/corrections.test.js` (its
  import helper, every test), `server/tests/narrator_on_import.test.js`
  `a_game_import_gets_no_narrator`, `server/tests/reimport_update.test.js` (its `importCsv`
  helper, every test), `server/tests/import_book_prose.test.js`
  `endpoint_multipart_dry_run_epub`.

### 7.6 Free to change

Internal structure and names; the response field order; error wording (keep the meaning: the
UI shows the detail to the user); log wording; how the cap is enforced (streaming is
recommended — uploads can be 200 MB). Keep: the routes, status codes, wire fields, the
exports in the fixed table, spy-ability, temp-folder cleanup, the `cfg` read at request time.

---

## 8. `server/src/database/migrations.js` — column upgrades for old databases

### 8.1 Role

One-time, idempotent upgrades that bring a database created by an older JustVoice up to the
current schema, run on every start before the tables are created. A desktop app has one SQLite
file per user, so a migration framework is not used: each step checks for a table or column
and acts only when it is missing.

### 8.2 Interface

| Export | Contract |
|---|---|
| `runMigrations(h)` | `h`: a kit database handle. Synchronous. Returns nothing. Must be safe on a brand-new empty file, on a fully created current schema (a no-op), and on an old database. |

Imports (allowed): `getLogger`.

### 8.3 Behaviour

Read the database's table names once (SQLite's own `sqlite_*` tables left out), then, in this
order, each step only when its condition holds, logging at info when it does real work:

1. `generations` exists without `ok_status` → add `ok_status VARCHAR NOT NULL DEFAULT 'ok'`.
2. Drop the retired tables `profile_channels`, `profile_samples`, `voice_profiles` — each only
   if present, children before the parent.
3. `blocks` exists → add `extraction_confidence FLOAT` and `source VARCHAR`, each if missing.
4. `mcp_bindings` exists → add `persona_id VARCHAR`, `default_engine VARCHAR`,
   `last_seen_at DATETIME`, each if missing.
5. `captures` exists without `pinned` → add `pinned BOOLEAN NOT NULL DEFAULT 0`.
6. A table `feature_prompts` exists, no `jv_feature_prompts` exists, and `feature_prompts` has a
   `temperature` column but no `json_mode` column (JustVoice's own old prompt table, not the
   shared stack's table of the same name) → rename it to `jv_feature_prompts`, in a
   transaction. `engines/llm/migrate_prompts.js` (run later by `seedWorkspace`) reads that table,
   merges edited rows into the shared table and drops it.

Every added column already exists in `models_schema.js`'s DDL, so a fresh database never needs
any step. Order constraints: step 6 must run before the kit's `installLlm` creates its own
`feature_prompts` (it does — `initDb` runs first in `createApp`).

### 8.4 Callers

```
server/src/data_admin.js:19:import { runMigrations } from "./database/migrations.js";
server/src/data_admin.js:154:    runMigrations(h);
server/tests/helpers.js:7:import { runMigrations } from "../src/database/migrations.js";
```

and file 9 (`initDb`, before creating tables). `data_admin`'s factory reset, on its
drop-tables-in-place fallback, calls it **after** `createTables`; `tests/helpers.js` `tmpDb()`
also calls it after `createTables` — both need it to be a no-op on the current schema.

### 8.5 Tests that pin it

No test targets a migration step. Every test built on `tests/helpers.js` `tmpDb()` (most of the
server suite's database tests) and `server/tests/factory_reset.test.js`
(`factory_reset_survives_missing_table` and siblings) call it on a current schema.
`server/tests/llm_seeds.test.js` `edited_legacy_row_migrates_wins_and_table_drops` and
`legacy_identify_key_renames` plant `jv_feature_prompts` directly (they exercise
`migrate_prompts.js`, not step 6).

### 8.6 Free to change

Structure, names, log wording. Whether the six steps stay at all is a user decision (Gaps — the
no-migrations rule).

---

## 9. `server/src/database/session.js` — opening the database

### 9.1 Role

Owns the one better-sqlite3 handle every store and route uses: opens `justvoice.db` in the data
folder with foreign keys on, registers the schema, runs the upgrades, creates missing tables,
and hands the handle out. Re-opens when a different data folder is asked for (tests build many
apps in one process); closes for factory reset and tests.

### 9.2 Interface

| Export | Contract |
|---|---|
| `cfg` | a **mutable** object `{handle: <handle or null>, dbPath: <string or null>}`. Tests and `data_admin` assign both properties directly; every reader goes through it, so `getDb()`, `getDbPath()` and `initDb()` must read `cfg`'s current values, never a private copy. |
| `initDb(dataDir = null)` | Synchronous. See 9.3. |
| `getDb()` | → `cfg.handle`; throws the kit's `RuntimeError` when it is null (message: the database is not initialized; call it during app startup — no caller matches the text). |
| `getDbPath()` | → `cfg.dbPath` (null before `initDb`). |
| `closeDb()` | Closes the handle if there is one (ignoring a close error) and sets `cfg.handle` to null. Leaves `cfg.dbPath` as it was (callers that want it gone set it to null themselves). |

`server/src/database/index.js` (not on the list) re-exports `cfg`, `closeDb`, `getDb`,
`getDbPath`, `initDb`.

Imports (allowed): `node:fs` `mkdirSync`, `node:path`; `getLogger`; `RuntimeError`; `purePath`,
`samePath`; `openDatabase`; `defaultDataDir` (`../paths.js`); `runMigrations` (file 8); `TABLES`
(file 10).

### 9.3 Behaviour

`initDb(dataDir)`:

- If a handle is open: with no `dataDir` → do nothing; if `cfg.dbPath` is set and its folder is
  the same path as `dataDir` (`samePath`: normalized, case-insensitive on Windows) → do nothing.
  Otherwise close the open handle (ignore errors) and continue.
- The folder is `dataDir`, else `defaultDataDir()`; create it if missing.
- `cfg.dbPath` = `purePath(<folder>/justvoice.db)` — the file name `justvoice.db` is fixed
  (backup/restore read it through `getDbPath`; `docs/backups-and-data.md`).
- **Start-up order (other code relies on it):** open with `foreignKeys: true` → register
  `TABLES` (the schema's column kinds and defaults) → `runMigrations` → `createTables(TABLES)`
  (creates only what is missing, with the schema's exact DDL and indexes) → publish the handle
  in `cfg.handle` → log at info the database path.
- Upgrades run before creation so an old table gets its new columns before creation (a no-op
  for existing tables) and so the old prompt table is renamed before the kit's own
  `feature_prompts` exists.

The wider boot order around it: `createApp` calls `initDb(dataDir)` first, then
`installLlm(app, {db: getDb(), …})` (the kit's LLM tables in the same file), then the routes,
then the MCP mount; `serve.js` then runs `seedWorkspace()` (file 11). Factory reset
(`data_admin.runFactoryReset`): `closeDb()` → delete the file and its `-wal`/`-shm` → set
`cfg.dbPath` null → `initDb(<same folder>)` → `seedBuiltinEffectPresets()` →
`reseedSharedLlm(cfg.handle)`; when the file could not be deleted it drops every table on the
open handle instead, then `createTables(TABLES)` → `runMigrations` → seeds.

### 9.4 Callers

```
server/src/app.js:77:import { initDb, getDb } from "./database/session.js";
server/src/data_admin.js:22:import * as dbSession from "./database/session.js";
server/src/data_admin.js:108:  const dbPath = dbSession.cfg.dbPath;
server/src/data_admin.js:110:  if (dbPath !== null && dbSession.cfg.handle !== null) {
server/src/data_admin.js:111:    dbSession.closeDb();
server/src/data_admin.js:124:    dbSession.cfg.dbPath = null;
server/src/data_admin.js:125:    dbSession.initDb(dataDir);
server/src/data_admin.js:206:    getDbPath: () => dbSession.cfg.dbPath,
server/src/database/index.js:34:export { cfg, closeDb, getDb, getDbPath, initDb } from "./session.js";
server/src/engines/llm/migrate_prompts.js:28:import * as dbSession from "../../database/session.js";
server/src/api/render_chapter_api.js:46:  if (session.cfg.handle === null) throw internal("database not initialized");
server/src/api/render_lines_api.js:30:  if (session.cfg.handle === null) throw internal("database not initialized");
server/src/line_takes.js:527:  if (session.cfg.handle === null) return 0;
server/src/api/webhooks_api.js:210:  return cfg.SessionLocal ?? session.cfg.handle ?? null;
server/src/storage/lexicons.js:64:    return this._handle ?? session.cfg.handle;
server/src/storage/personas.js:103:    return this._handle ?? session.cfg.handle;
server/src/storage/settings_store.js:88:    const h = session.cfg.handle;
```

`session.getDb()` is called by: `api/{active_tasks, bulk_delete, cache, captures, channels,
effect_presets, export_jobs, extraction, lexicons, mcp_bindings, personas, prefs,
project_export, projects, pronunciation, speakers, sse_streams, takes, webhooks}_api.js`,
`export_audiobook.js`, `export_voicelines.js`, `render_jobs.js`, files 3 and 5. `session.cfg.handle`
is read (null = not ready) by `storage/{lexicons,personas,settings_store}.js`,
`render_chapter_api.js`, `render_lines_api.js`, `webhooks_api.js`, `line_takes.js`,
`engines/llm/migrate_prompts.js` and file 11. Test helpers and suites:

```
server/tests/helpers.js:41:  session.initDb(dir);
server/tests/helpers.js:42:  return session.cfg.handle;
server/tests/helpers.js:47:  session.closeDb();
server/tests/helpers.js:48:  session.cfg.dbPath = null;
server/tests/app_helpers.js:100:  session.closeDb();
server/tests/app_helpers.js:101:  session.cfg.dbPath = null;
server/tests/engines_helpers.js:84:  session.initDb(d);
server/tests/engines_helpers.js:85:  llmDb.configureStorage(session.cfg.handle);
server/tests/engines_helpers.js:94:  session.closeDb();
server/tests/engines_helpers.js:95:  session.cfg.dbPath = null;
server/tests/llm_boot.js:17:  session.closeDb();
server/tests/llm_boot.js:18:  session.cfg.dbPath = null;
server/tests/llm_boot.js:19:  session.initDb(dir);
server/tests/factory_reset.test.js:38:  session.cfg.handle = saved.handle;
server/tests/factory_reset.test.js:39:  session.cfg.dbPath = saved.dbPath;
server/tests/factory_reset.test.js:46:  session.cfg.handle = h;
server/tests/factory_reset.test.js:47:  session.cfg.dbPath = null;
server/tests/pause_between_lines.test.js:29:  session.cfg.handle = h;
server/tests/project_lexicon.test.js:225:    session.cfg.handle = h;
server/tests/render_cache_stats.test.js:24:  session.cfg.handle = h;
server/tests/render_chapter_scene_mode.test.js:22:  session.cfg.handle = h;
server/tests/render_jobs.test.js:50:  session.cfg.handle = h;
server/tests/render_truth.test.js:116:  session.cfg.handle = h;
server/tests/voice_instruct.test.js:45:  session.cfg.handle = h;
```

(each of the last seven sets it back to `null` after the test).

### 9.5 Tests that pin it

Effectively the whole server suite (114 `*.test.js` files) boots through `initDb`/`getDb`. The specific
contracts: `factory_reset.test.js` (with `cfg.handle` = a temp handle and `cfg.dbPath` = null,
`runFactoryReset` must take the drop-in-place path; `cfg` is saved and restored around each
test); the suites listed above that point `cfg.handle` at a temp database and expect every
store and route to use it; the helpers that call `initDb(dir)` repeatedly with different
folders and `closeDb()` + `cfg.dbPath = null` between tests; `mcp_server.test.js` and
`seed_effect_presets.test.js` (`initDbAt` then `getDb()`).

### 9.6 Free to change

Internals and log wording. Keep every export, `cfg`'s two property names and live reading, the
re-init rule, the file name, the start-up order and foreign keys on.

---

## 10. `server/src/database/models.js` — the table names and row defaults

### 10.1 Role

The single place code gets table names from (each entity name exported as its table's name, so
code writes `h.get(Persona, id)` or `select * from ${Persona}`), the schema list, and the two
JavaScript functions that fill the schema's computed column defaults (new ids and timestamps).

### 10.2 Interface

| Export | Value |
|---|---|
| `TABLES` | re-export of `models_schema.js`'s `TABLES` |
| `TABLE_NAMES` | the table names, in `TABLES` order |
| `uuid()` | → a new random UUID v4 string with dashes |
| `utcnow()` | → the current naive-UTC time as `models.js`'s `utcNowNaive()` gives it (`YYYY-MM-DDTHH:MM:SS.ffffff`, the fraction dropped when zero) |
| `PersonaChannel` | `"persona_channels"` |
| `Persona` | `"personas"` |
| `Lexicon` | `"lexicons"` |
| `LexiconEntry` | `"lexicon_entries"` |
| `Project` | `"projects"` |
| `Speaker` | `"speakers"` |
| `Scene` | `"scenes"` |
| `Block` | `"blocks"` |
| `Generation` | `"generations"` |
| `Take` | `"takes"` |
| `GenerationVersion` | `"generation_versions"` |
| `RenderJob` | `"render_jobs"` |
| `RenderJobBlock` | `"render_job_blocks"` |
| `Story` | `"stories"` |
| `StoryItem` | `"story_items"` |
| `Channel` | `"channels"` |
| `MCPBinding` | `"mcp_bindings"` |
| `Capture` | `"captures"` |
| `EffectPreset` | `"effect_presets"` |
| `Webhook` | `"webhooks"` |
| `SpeakerCorrection` | `"speaker_corrections"` |
| `Pref` | `"prefs"` |
| `SettingsRow` | `"settings"` |

**Required side effect at module load:** register, with the kit's `registerDefaultFn`, the
function that makes a new uuid under the name **`justvoice.database.models._uuid`** and the one
that gives the current time under **`justvoice.database.models._utcnow`**. Those exact strings
are what `models_schema.js` names as its `defaultFn` / `onupdateFn` (every table's `id`,
`created_at`, `updated_at`); without them every insert that leaves an id or timestamp out
throws. This module is imported by file 9, so the registration happens before any insert.

Imports (allowed): `node:crypto` `randomUUID`; `registerDefaultFn`; `utcNowNaive`
(`../models.js`); `TABLES` (`./models_schema.js`).

### 10.3 Behaviour

No logic beyond the above. The schema itself (the 23 tables, their DDL, column kinds and
defaults) lives in `models_schema.js` and stays exactly as it is.

### 10.4 Callers

```
server/src/api/_speaker_helpers.js:27:import { Block, Persona, Scene, Speaker } from "../database/models.js";
server/src/api/active_tasks_api.js:10:import { Generation } from "../database/models.js";
server/src/api/bulk_delete_api.js:11:import { Generation, Persona } from "../database/models.js";
server/src/api/cache_api.js:8:import { Generation } from "../database/models.js";
server/src/api/channels_api.js:9:import { Channel, PersonaChannel, uuid } from "../database/models.js";
server/src/api/effect_presets_api.js:13:import { EffectPreset, uuid } from "../database/models.js";
server/src/api/export_jobs_api.js:27:import { Project } from "../database/models.js";
server/src/api/extraction_api.js:31:import { Block, Project, Scene, Speaker, SpeakerCorrection, Take } from "../database/models.js";
server/src/api/lexicons_api.js:5:import { Project } from "../database/models.js";
server/src/api/mcp_bindings_api.js:10:import { MCPBinding } from "../database/models.js";
server/src/api/personas_api.js:14:import { Block, Generation, Lexicon, MCPBinding, Project, Speaker } from "../database/models.js";
server/src/api/prefs_api.js:17:import { Pref } from "../database/models.js";
server/src/api/project_export_api.js:19:import { Block, Generation, Lexicon, LexiconEntry, Persona, Project, Scene, Speaker, Take } from "../database/models.js";
server/src/api/projects_api.js:48:import { Block, Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry, Project, Scene, Speaker, Take } from "../database/models.js";
server/src/api/pronunciation_api.js:15:import { Block, LexiconEntry, Persona, Project, Scene, Speaker } from "../database/models.js";
server/src/api/render_chapter_api.js:30:import { Block, Project, Scene, Speaker } from "../database/models.js";
server/src/api/render_lines_api.js:20:import { Project, Scene } from "../database/models.js";
server/src/api/speakers_api.js:17:import { Block, Persona, Project, Scene, Speaker, SpeakerCorrection } from "../database/models.js";
server/src/api/sse_streams_api.js:11:import { Generation } from "../database/models.js";
server/src/api/takes_api.js:14:import { Block, Generation, Scene, Take } from "../database/models.js";
server/src/api/webhooks_api.js:17:import { Webhook, uuid } from "../database/models.js";
server/src/data_admin.js:20:import { TABLE_NAMES, TABLES } from "./database/models.js";
server/src/database/index.js:7-33  re-exports every table name, TABLE_NAMES, TABLES
server/src/export_audiobook.js:25:import { Scene } from "./database/models.js";
server/src/export_voicelines.js:27:import { Block, Project, Scene, Speaker } from "./database/models.js";
server/src/line_takes.js:34:import { Block, Generation, Project, Scene, Speaker, Take } from "./database/models.js";
server/src/render_jobs.js:35-46:  a multi-line import of Block, Generation, Project, RenderJob, RenderJobBlock, Scene, Speaker, Take, utcnow, uuid from "./database/models.js"
server/tests/analyze_persist.test.js:19:import { Generation, Take, uuid } from "../src/database/models.js";
server/tests/bulk_delete_filters.test.js:9:import { Generation, Persona, uuid } from "../src/database/models.js";
server/tests/chapter_text.test.js:21:import { Generation, Take, uuid } from "../src/database/models.js";
server/tests/corrections.test.js:11:import { Block, SpeakerCorrection } from "../src/database/models.js";
server/tests/export_voicelines.test.js:14:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/generation_history_actions.test.js:9:import { Generation, uuid } from "../src/database/models.js";
server/tests/helpers.js:8:import { TABLES } from "../src/database/models.js";
server/tests/import_materialize.test.js:13:import { Block, Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry, Persona, Project, Scene, Speaker } from "../src/database/models.js";
server/tests/line_takes.test.js:26:import { Take } from "../src/database/models.js";
server/tests/mcp_server.test.js:12:import { MCPBinding } from "../src/database/models.js";
server/tests/project_lexicon.test.js:26:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/render_cache_stats.test.js:14:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/render_chapter_scene_mode.test.js:13:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/render_helpers.js:20:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/render_jobs.test.js:20:import { Block, Generation, Project, RenderJob, RenderJobBlock, Scene, Speaker, Take, uuid } from "../src/database/models.js";
server/tests/render_truth.test.js:21:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/speaker_pronouns.test.js:9:import { Scene, uuid } from "../src/database/models.js";
server/tests/split_merge.test.js:23:import { Generation, Take, uuid } from "../src/database/models.js";
server/tests/takes.test.js:19:import { Block, Generation, Persona, Project, Scene, Take, uuid } from "../src/database/models.js";
server/tests/voice_instruct.test.js:17:import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
server/tests/webhooks.test.js:10:import { Webhook } from "../src/database/models.js";
```

plus files 3, 4, 5, 7, 9. `data_admin` counts `TABLE_NAMES.length` as the tables a reset
cleared and passes `TABLES` to the shared backup router.

### 10.5 Tests that pin it

Every test listed above uses the names as table names in SQL and `h.insert`/`h.get`; every test
that inserts a row without an id or timestamp relies on the two registered defaults.

### 10.6 Free to change

Nothing visible: the export names and values, the two registration names and the UUID/time
formats are all fixed. Comments and layout are the writer's.

---

## 11. `server/src/database/seed.js` — boot-time seeding

### 11.1 Role

Idempotent seeding run after the app is built: the four built-in effect presets (the
voicebox-derived part — the preset data), and the workspace seed, which runs the shared LLM
stack's migrations and seed in a fixed order and boots the provider registry from the database.
Kept out of the app factory so a test's fresh app starts from an empty database.

### 11.2 Interface

| Export | Contract |
|---|---|
| `BUILTIN_EFFECT_PRESETS` | array of `{name: string, sort_order: integer, description: string, chain: [{type: string, enabled: true, params: {<param>: <number>}}]}` — **the voicebox-derived part; new values and descriptions** (11.3). |
| `seedBuiltinEffectPresets()` | Synchronous. Inserts any missing built-in preset. Never throws. |
| `seedWorkspace()` | async. The workspace seed in its fixed order. |

**Table** `effect_presets` (unchanged): `id` VARCHAR PK not null (uuid default) · `name`
VARCHAR not null, **UNIQUE** · `description` TEXT · `chain_json` TEXT not null · `is_builtin`
BOOLEAN not null (default false) · `sort_order` INTEGER not null (default 100) · `created_at`
DATETIME (now by default).

Imports from ours and the kit (allowed): `getLogger`; `pyFloatValue`, `pyJson`; `session.cfg`
(file 9). `seedWorkspace`'s collaborators, loaded at call time today (dynamic imports avoid a
load-time cycle — keep it that way or otherwise avoid one): `loadFromConfigs`, `stores` from
`@delebash/llm-runner/llm`; `seedLlm` from `@delebash/llm-runner/llm/seed`; `getState` from
`../app_state.js`; `migrateJvPromptsToShared`, `liftEditedTunablesIntoPresets` from
`../engines/llm/migrate_prompts.js`; `migrateSettingsProvidersToDb` from
`../engines/llm/migrate_providers.js`; `retireDefaultCatalogRows` from `../llm_bootstrap.js`.

### 11.3 Behaviour

**The built-in presets** — identity is the **name** (ids are random per database):

| Name (fixed) | Character of the sound |
|---|---|
| `Robotic` | a metallic, machine-like voice — a slow, sweeping, comb-filtered shimmer |
| `Radio` | a thin, band-limited AM-radio voice, squashed and pushed forward |
| `Echo Chamber` | a spacious room with a trailing echo |
| `Deep Voice` | a lower-pitched, warmer, fuller voice |

Display order (`GET /v1/effect-presets` orders by `sort_order`, then `created_at`): Robotic,
Radio, Echo Chamber, then Deep Voice; all four sort **before** a user preset saved with the
default `sort_order` of 100.

The effect kinds the chain supports (`server/src/audio/effects.js`, run by the DSP program;
unknown types are skipped): `reverb` (room_size, damping, wet_level, dry_level, width,
freeze_mode) · `chorus` (rate_hz, depth, centre_delay_ms, feedback, mix) · `distortion`
(drive_db) · `gain` (gain_db) · `compressor` (threshold_db, ratio, attack_ms, release_ms) ·
`pitch_shift` (semitones) · `delay` (delay_seconds, feedback, mix) · `highpass` / `lowpass`
(cutoff_frequency_hz) · `eq_low` / `eq_mid` / `eq_high` (cutoff_frequency_hz, gain_db, q). The
UI's ranges and defaults per parameter are `EFFECT_CATALOG` in
`server/src/api/effect_presets_api.js` (`chorus` works in the chain but is not in that
catalog). The writer designs each chain and chooses every value and description.

Constraints on the new chains (from the tests, 11.5):

- every effect in every preset is a kind the chain knows, and is `enabled: true`;
- **each effect on its own audibly changes** a half-second 220 Hz sine at 30 % of full scale,
  24 kHz mono (the output bytes must differ from the input) — so no no-op settings (e.g. a
  filter cutoff that leaves 220 Hz untouched to the last bit, zero gain);
- **each whole preset keeps the audio's length** (same number of frames) and changes it.
- Every parameter value is stored as a float: whole numbers written as `1.0`, not `1` (wrap
  them with the kit's `pyFloatValue`; RESEARCH §6, "Whole-number floats are stored as `1.0`").

`seedBuiltinEffectPresets()`: when `session.cfg.handle` is null, return silently. Otherwise, in
one transaction, for each built-in in order: if **any** row with that name exists (built-in or a
user's), leave it alone; else insert `{name, description, chain_json: <the chain as Python-style
JSON text, pyJson>, is_builtin: true, sort_order}`. Any error → log a warning that the built-in
effect-preset seed failed and continue. Because rows are matched by name and never updated,
**an existing database keeps its old built-in values until a reset** (the user's saved presets
are untouched either way).

`seedWorkspace()` — **the order is the contract** (JustWrite's order):

1. `seedBuiltinEffectPresets()` (independent).
2. `await migrateJvPromptsToShared()` — before the shared seed, so a user's edited legacy
   prompt wins over the seed default.
3. `await migrateSettingsProvidersToDb(getState().settings.get())`.
4. `seedLlm()` — the shared seed.
5. `await liftEditedTunablesIntoPresets()` — after the presets exist.
6. `retireDefaultCatalogRows()`.
7. `loadFromConfigs(stores.getProviderStore().list())` — the provider registry boots from the
   database, so `registered` flags are live from boot.

Errors in steps 2–7 propagate.

### 11.4 Callers

```
server/src/data_admin.js:21:import * as dbSeed from "./database/seed.js";
server/src/data_admin.js:127:      dbSeed.seedBuiltinEffectPresets();
server/src/data_admin.js:155:    dbSeed.seedBuiltinEffectPresets();
server/src/serve.js:27:import { seedWorkspace } from "./database/seed.js";
server/src/serve.js:163:      await seedWorkspace();
server/tests/app_helpers.js:22:import { seedWorkspace } from "../src/database/seed.js";
server/tests/app_helpers.js:34:  if (seed) await seedWorkspace();
server/tests/effects_chain.test.js:14:import { BUILTIN_EFFECT_PRESETS } from "../src/database/seed.js";
server/tests/engine_vram_wiring.test.js:15:import { seedWorkspace } from "../src/database/seed.js";
server/tests/llm_boot.js:9:import { seedWorkspace } from "../src/database/seed.js";
server/tests/llm_boot.js:36:  if (seed) await seedWorkspace();
server/tests/llm_seeds.test.js:13:import { seedWorkspace } from "../src/database/seed.js";
server/tests/seed_effect_presets.test.js:14:import { seedBuiltinEffectPresets } from "../src/database/seed.js";
```

`serve.js` runs `seedWorkspace()` right after `createApp`; factory reset runs
`seedBuiltinEffectPresets()` after re-creating the database. The effect-preset routes
(`effect_presets_api.js`) refuse to edit or delete a row with `is_builtin` true.

User docs: `docs/effects.md` (*Built-in presets* — its table must be rewritten from the new
values; the writer must not read the old one), `docs/backups-and-data.md` (reset).

### 11.5 Tests that pin it

- `server/tests/seed_effect_presets.test.js` `builtins_seeded_and_buildable` — after
  `initDbAt` + `seedBuiltinEffectPresets()`, `effect_presets` rows with `is_builtin` include
  the names `Robotic`, `Radio`, `Echo Chamber`, `Deep Voice`; every enabled entry of every
  stored chain (read with `pyJsonParse`), applied alone to the test tone, changes it.
- `server/tests/effects_chain.test.js` `every_shipped_builtin_preset_runs_end_to_end` —
  `BUILTIN_EFFECT_PRESETS` is non-empty; each preset's `chain`, applied to the fixture sine
  (`audio_fixtures.js` `sineWav`), keeps the frame count and changes the audio.
- `seedWorkspace`: `server/tests/llm_seeds.test.js` (every test — the shared rows, the
  presets, the legacy-row migration winning over the seed, the identify-key rename, the
  catalog), `server/tests/engine_vram_wiring.test.js` (the VRAM claim after
  `seedWorkspace`), and every test built with `appClient(dir, {seed: true})` or `llmBoot`
  (`captures.test.js`, `refine_lab.test.js`, …).

### 11.6 Free to change

All preset values and descriptions (that is the point), the exact effect kinds each built-in
uses, the chain entries' key order. Keep the four names, the display order, the
insert-if-missing-by-name rule, the never-throws seed, `seedWorkspace`'s order.

---

## 12. `src/components/AudioKeepAlive.vue` — holding the audio output open

### 12.1 Role

Keeps the operating system's audio output session from going dormant while the app is idle, so
the first playback after a long idle does not fail or pop. It plays real silence (zero samples)
in a loop at full volume forever — not a muted element, which a browser engine may optimize
away. The original reason was macOS's WebKit tearing down its CoreAudio session after idle
(only an app restart restored it); `docs/channels.md` ("Audio keep-alive (macOS)") describes it.

### 12.2 Interface

No props, no emits, no slots, nothing exposed; renders nothing visible. No store or service.
Default export used as `<AudioKeepAlive />`. No other file or test references its markup or
classes.

### 12.3 Behaviour

- On mount: create a short silent WAV (any length and rate; 16-bit PCM zeros are enough) as a
  blob URL, and an audio element **outside the DOM** that loops it at full volume with
  preload on. Try to play.
- `play()` may return a rejected promise (autoplay blocked until a user gesture) **or no promise
  at all** (jsdom's stub, and older engines) — both must be handled without an exception or an
  unhandled rejection. A blocked play is logged at **debug** level only (the renderer gate counts
  console errors).
- Retry play on the first user gestures (window `pointerdown`, `keydown`) and when the page
  wakes (document `visibilitychange` when it becomes visible, window `focus`, window `pageshow`),
  only when the element exists and is paused.
- On unmount: remove every listener, pause, clear the source, revoke the blob URL.

### 12.4 Callers

```
src/App.vue:12:import AudioKeepAlive from "./components/AudioKeepAlive.vue";
src/App.vue:438:    <AudioKeepAlive />
```

Mounted once at the top of the main shell. `docs/channels.md` points to `system-tray.md` "for
the AudioKeepAlive setup" — there is none there (stale).

### 12.5 Tests that pin it

- `src/boot.smoke.test.js` (kit `registerBootSmoke`) mounts the whole app in jsdom: the
  component must mount without throwing when `play()` returns undefined (jsdom prints "Not
  implemented: HTMLMediaElement's play() method" — expected).
- The renderer gate (`npm run smoke`, `scripts/smoke.js`) loads every view in headless Chromium
  and fails on any page error or console error — a blocked autoplay must stay silent.

### 12.6 Free to change

Everything inside (how the silence is made — e.g. a small WAV writer or a Web Audio source —
names, timing). A silent-WAV builder exists in `src/mock/personaMock.js` (`silentWav`) but that
file is mock-only and left out of a packaged build; promoting a shared helper would be a new
service (ask first per the house rule).

---

## 13. `src/components/ChordPicker.vue` — a keyboard-chord editor

### 13.1 Role

A modal for recording a keyboard chord (for the dictation hotkeys): the user holds keys, sees
them as key caps, releases, and saves. **Nothing imports it today** — the hotkeys are not wired
and Settings' Hotkeys card was removed on 2026-10-05 (`docs/dictation.md`, Hotkeys).

### 13.2 Interface

| Prop | Type | Default |
|---|---|---|
| `open` | Boolean | `false` |
| `title` | String | a short title asking the user to pick a chord |
| `description` | String | one sentence: press the keys, release, then save |
| `initialKeys` | Array of strings | `[]` |

Emits: `save` with the captured key list (array of strings); `cancel` with no payload. No
slots, nothing exposed.

Uses the kit's `AppModal` (dismissable, a narrow dialog with an eyebrow line, the title and a
footer slot) and `UiButton` (secondary Cancel, primary Save — disabled while nothing is
captured). The footer uses the app's global `jv-spacer` class to push the buttons right. No
other file or test references its classes.

### 13.3 Behaviour

- Shown only while `open` is true. Each time `open` turns true: clear the held keys, set the
  captured chord to a copy of `initialKeys`, clear the unsupported-key message, and focus the
  capture box shortly after paint (about 50 ms). The capture box is focusable, keeps focus (it
  takes focus back when it loses it), and has an accessible label asking for the chord's keys.
- Listens to `keydown` and `keyup` on the window in the **capture** phase while mounted, acting
  only while `open`.
- `Escape` and `Tab` pass through untouched (Esc closes the modal → `cancel`; Tab moves focus).
- On another key press: name the key from `KeyboardEvent.code`: letter keys by their letter
  (`KeyA` → `A`), digit-row keys by their digit (`Digit1` → `1`), the left/right modifiers as
  `CtrlL` `CtrlR` `ShiftL` `ShiftR` `AltL` `AltR` `CmdL` `CmdR` (the Meta keys are Cmd),
  `Escape` → `Esc`, and every other code as itself (`Space`, `Enter`, `Backspace`, `F1`…).
  An event with no code cannot be used: show a one-line message naming the key and swallow the
  event. Otherwise swallow the event (prevent default, stop propagation), clear the message,
  and — unless the key is already held (auto-repeat) — add it to the held set and make the
  captured chord the held set sorted modifiers first (names beginning Ctrl, Shift, Alt, Cmd),
  each group alphabetical.
- On key release: remove it from the held set; the captured chord does not change, so the user
  can let go before clicking Save.
- The capture box shows the captured keys as key caps, or a placeholder prompt when none.
- Save emits `save` with the captured list; Cancel and the modal's close emit `cancel`.

### 13.4 Callers

None (`git grep -n ChordPicker -- src` finds only the file itself). `README.md` lists it among
components.

### 13.5 Tests that pin it

None.

### 13.6 Free to change

Everything inside, copy included (production copy, no design notes). See Gaps: the key names do
not match the format `settings.captures` stores its chords in, and whether to rewrite or delete
an unused component is the user's call.

---

## 14. `src/components/CapturePill.vue` — the dictation status pill

### 14.1 Role

The small floating pill that tells the user what dictation (or agent speech) is doing:
listening, transcribing, refining, speaking, done, idle, or failed — with a level-meter-like
row of bars, an elapsed timer and a stop button while recording. Used inside the dictation
window (file 15).

### 14.2 Interface

| Prop | Type | Default |
|---|---|---|
| `state` | String, one of `recording`, `transcribing`, `refining`, `speaking`, `completed`, `rest`, `error` (validated) | `rest` |
| `elapsedMs` | Number | `0` |
| `errorMessage` | String | `""` |

Emits: `stop` (no payload) — the user clicked stop while recording; `dismiss` (no payload) —
after the user clicked the error pill. No slots, nothing exposed, no store or service; the
browser clipboard only. No other file or test references its classes or attributes.
(`CapturesView.vue` draws its own static look-alike pills with its own `cap-pill` classes.)

### 14.3 Behaviour

What the user sees in each state:

| State | Label | Bars | Timer | Stop button |
|---|---|---|---|---|
| `recording` | a word saying it is listening, trailing off (it is ongoing) | lively, playing | shown | shown |
| `transcribing` | a word saying it is transcribing, trailing off | pulsing, working | shown | — |
| `refining` | a word saying it is refining, trailing off | pulsing, working | shown | — |
| `speaking` | a word saying it is speaking, trailing off | lively, playing | shown | — |
| `completed` | a word saying it is finished | flat, dim | shown | — |
| `rest` | no label | flat, dim | — | — |
| `error` | the error message, or a generic error word when it is empty | pulsing | — | — |

- The pill is a rounded, dark, translucent capsule with light text, a blurred backdrop and a
  soft shadow; in the error state it turns the app's danger colour. Five thin bars in the
  accent colour; their animation follows the mode (playing: an uneven bounce staggered across
  the bars; working: a steady pulse staggered across the bars; idle: short, still, faded).
- The timer reads `m:ss` from `elapsedMs` (whole seconds, minutes not padded, seconds two
  digits), with tabular figures, slightly faded.
- The stop button (a stop glyph, with an accessible label saying it stops the recording) emits
  `stop` without triggering anything on the pill itself.
- In the error state the whole pill acts as a button: clicking it copies the error message to
  the clipboard (a clipboard failure is ignored) and emits `dismiss`. With an empty error
  message a click does nothing.

### 14.4 Callers

Only file 15 (it renders the pill with `state`, `elapsedMs`, `errorMessage` and listens to
`dismiss`; it does not listen to `stop`). `docs/dictation.md` describes the floating pill as
planned.

### 14.5 Tests that pin it

None (the window that hosts it is never created).

### 14.6 Free to change

All markup, classes, copy, animation and timing. Keep the props, their allowed values and the two
events. Make the error pill keyboard-activatable if the user agrees (Gaps).

---

## 15. `src/components/DictateWindow.vue` — the floating dictation window

### 15.1 Role

The root component of a separate, transparent, always-on-top window that shows only the capture
pill. `src/main.js` mounts it **instead of the app** when the page URL has `?view=dictate`
(with the kit wired and Pinia installed, skipping the main shell's server checks). Its one
working cycle today is **agent speech**: when an MCP agent's `justvoice.speak` generation is
announced, it waits for the generation, then plays it and shows the pill while it plays. The
user-dictation cycle (start/stop recording from the hotkey) is not implemented. **The window is
never created today**: the Electron shell has no window-to-window channel, and
`services/native.js`'s `dictateEmit` / `onDictateEvent` are no-ops (RESEARCH §6, "No dictation
feature runs today").

### 15.2 Interface

No props, emits or slots (it is an app root). Uses:

- `CapturePill` (file 14) — `state`, `elapsedMs`, `errorMessage` (always empty today), `@dismiss`.
- `useApi()` from `../stores/api.js` — `serverUrl`.
- `dictateEmit(event, payload)` and `onDictateEvent(event, fn) → unsubscribe` from
  `../services/native.js`.

The shell channel's event names are an interface with the (future) shell — keep them:

| Event | Direction | Payload |
|---|---|---|
| `dictate:speak-start` | shell → window | `{generation_id}` — as an object **or a JSON string** |
| `dictate:speak-end` | shell → window | `{status?}` — object or JSON string |
| `dictate:show` | window → shell | `{}` — show the window now |
| `dictate:hide` | window → shell | `{}` — hide the window (the shell owns hiding it, not the page) |

Server endpoints it uses: `GET <serverUrl>/v1/generate/<id>/status` (Server-Sent Events, each
message JSON with a `status`); audio from `<serverUrl>/audio/<id>` today — **no server route
serves that path** (Gaps; the generation audio route is `/v1/generations/<id>/audio`).

### 15.3 Behaviour

- On mount, make the page's `html` and `body` backgrounds transparent (the window takes the
  pill's shape); restore them on unmount. The root fills the window and centres the pill with
  a small margin. The pill is shown only when the state is not `rest`.
- **speak-start:** parse the payload (string or object); unparseable or without a
  `generation_id` → ignore. End any cycle in progress (the last speak wins). Set the pill to
  `transcribing` as a waiting cue (the window is still hidden), timer 0. Subscribe to the
  generation's status stream. Start a **60 s** stuck timer: if audio has not started by then,
  end the cycle. On a status message: `completed` → cancel the stuck timer, close the stream,
  start playback; `failed` or `not_found` → close the stream and end the cycle; anything else,
  and unparseable messages (heartbeats), → ignore. Stream errors are ignored (the browser
  reconnects; the stuck timer is the backstop).
- **Playback:** play the generation's audio. When it actually starts playing: emit
  `dictate:show`, set the pill to `speaking`, and tick the timer from that moment (every 250 ms).
  When it ends, errors, or `play()` is refused → end the cycle.
- **speak-end:** parse the payload; unparseable → ignore. A `status` present and not `completed`
  → end the cycle at once. Otherwise start a **15 s** grace timer: if audio still has not
  started by then, end the cycle (the pill must never stay up forever).
- **Ending a cycle:** close the status stream, stop and release the audio, clear every timer,
  set the pill to `rest` with timer 0, and emit `dictate:hide`.
- The pill's `dismiss` ends the cycle. On unmount: unsubscribe from both shell events (an
  unsubscribe that throws is ignored) and end the cycle.

Server facts it depends on (not on the list): the status stream sends a frame `{id, status,
duration, error, source}` when it starts and `{id, status: "not_found"}` for a missing row; it
never reports a later status change (a Python bug copied on purpose — RESEARCH §6), which is
fine here because MCP `speak` writes its row already `completed`.

### 15.4 Callers

```
src/main.js:5:import DictateWindow from "./components/DictateWindow.vue";
src/main.js:172:    const app = createApp(DictateWindow);
```

`server/src/api/sse_streams_api.js`'s header names the dictation window's agent-speak cycle as a
subscriber of the status stream. User docs: `docs/dictation.md` (the floating pill — planned),
`docs/getting-started.md` (tray "Show dictate").

### 15.5 Tests that pin it

None. `src/boot.smoke.test.js` boots `main.js` without `?view=dictate`, so it does not mount
this component, but `main.js` imports it — it must import cleanly.

### 15.6 Free to change

Markup, classes, internal names, structure. Follow the house layout rule (a `height: 100%`
chain, never `100vh` — the current root uses viewport units). Keep the event names and payload
handling, the timings (60 s, 15 s, 250 ms), the server endpoints (subject to the Gap on the
audio URL).

---

## Conflicts

No existing test pins old prompt wording, example text or preset **values**. These tests pin
**parts** of what is being rewritten; they pass unchanged as long as the new text honours them —
the user decides only if the writer finds them in the way:

1. `server/tests/captures.test.js` `compose_refinement_system_toggles` — the all-on composition
   must contain `"self"` and `"technical"` (case-insensitive), and the all-off composition must
   not contain `"technical"` — so the new ground rules may not use the word "technical", and the
   new self-correction/technical sections must carry those words.
2. `server/tests/mcp_server.test.js` `speak_without_resolvable_voice_raises` — the new speak
   error text must contain `"No voice resolved"`.
3. `server/tests/seed_effect_presets.test.js` `builtins_seeded_and_buildable` — pins the four
   built-in **names** (`Robotic`, `Radio`, `Echo Chamber`, `Deep Voice`) and that every effect
   in them, alone, changes a 220 Hz test tone; `server/tests/effects_chain.test.js`
   `every_shipped_builtin_preset_runs_end_to_end` — each preset keeps the frame count and
   changes the audio. The new values must satisfy both; the names stay.
4. `server/tests/refine_lab.test.js` `prompt_preview_serves_the_composed_refine_call` — turning
   *Remove filler* off must make the composed prompt shorter (the new section must be
   non-empty).

Outside the tests, `docs/effects.md`'s *Built-in presets* table carries the old values and must
be rewritten from the new ones in the same change.

## Gaps

Things I could not pin down, or where the current behaviour looks wrong and only the user can
rule. The spec's default for each is the current behaviour.

1. **Migrations under the no-migrations rule.** The six upgrade steps (file 8) exist only for
   databases older than the current schema; the user's standing rule is "no migrations — the
   user resets". Keep them in the rewrite, or make `runMigrations` an empty, still-exported
   no-op (callers stay)? Step 6 (the old prompt-table rename) also feeds
   `migrate_prompts.js`, which `llm_seeds.test.js` exercises by planting the table directly.
2. **The ground rules overlap the *Remove filler* toggle.** The base text always tells the model
   to remove fillers and add punctuation, while the base row (in `seed_feature_prompts.js`) also
   says to return the transcript unchanged when no section follows — so with every toggle off
   the prompt contradicts itself, and *Remove filler* off still removes fillers. Keep that
   split, or move the filler/punctuation job into the section only?
3. **The "return the transcript unchanged" line** lives in `seed_feature_prompts.js` (not on the
   list) and `captures.test.js` pins it. I cannot tell from this repo whether that sentence came
   from voicebox (no upstream access here).
4. **`seed_presets.js`' refine Lab samples** (the per-section sample transcripts) closely echo
   the old few-shot and inline examples (names, a "src slash components … dot tsx" path, a
   meeting time). Not on the list; rewrite them too?
5. **Existing databases keep the old texts.** The `refine.*` prompt rows and the built-in effect
   presets are both insert-if-missing, so the dev database keeps the old wording and values
   until a reset (or a per-row reset in the AI console). The new examples take effect at once
   (they are read from code). The Refine Lab A/B depends on this.
6. **The dictation window plays `/audio/<id>`**, which no server route serves; the generation's
   audio is `/v1/generations/<id>/audio` (what MCP `speak` returns as `audio_url`). Keep the dead
   path or use the real one? Nothing exercises the window today.
7. **`ChordPicker` has no caller**, and its key names (`CtrlR`, `ShiftR`, …) do not match the
   format `settings.captures.chord_*_keys` stores (`ControlRight`, `ShiftRight`, `Space` — the
   browser's `code` names). Rewrite as is, align it with the settings, or delete it (the
   "removed means removed everywhere" rule would then apply to README's mention)?
8. **The error pill is not keyboard-activatable** — it is a focusable button-role element but
   Enter/Space do nothing. Fix in the rewrite?
9. **MCP on the SDK's documented high-level API needs zod.** `McpServer.registerTool` takes zod
   schemas; `zod` 4.6.5 is installed only as the SDK's peer dependency and is not in
   `package.json`. Adding it is a dependency change (the user's go); the alternative is the
   SDK's documented low-level `Server` with plain JSON Schemas (what the old file used).
10. **Python-compatibility details now unneeded** — fastmcp's "3.4.5" as the server version,
    pydantic-worded argument errors, empty prompt/resource capabilities, the `"server-error"`
    refusal envelope. The spec marks them free; confirm they may go.
11. **`/mcp` is outside bearer auth and CSRF** (the kit gates `/v1` only), while
    `docs/mcp-server.md` tells users to add the bearer header when tokens are set. A server
    bound to the network lets anyone call `speak`. Keep (spec default), or gate `/mcp`?
12. **MCP `speak`'s `duration_sec` assumes 16 kHz mono 16-bit** (RESEARCH §3) — wrong for every
    engine that is not 16 kHz. Keep, or read the WAV header (`server/src/audio/wav.js`
    `parseWavHeader`)?
13. **MCP `speak` stores `language` as the argument or `"en"`**, while it generates with the
    persona's language when no argument is given — the row can say `en` for a line spoken in
    another language. Keep?
14. **Settings → MCP's curl snippet** posts `tools/list` with no `initialize` and no session; a
    stateful server answers 400 to it. (Outside the list — `SettingsView.vue`.)
15. **Chunker edge cases** (file 6), all current behaviour, none pinned by a test: the dotted
    abbreviations (e.g., i.e., a.m., p.m., U.S.) never match, so `"e.g."` ends a sentence
    although `docs/engines.md` says the splitter knows it; a sentence ending in a number
    (`"2024."`) is not a sentence end; the space fallback ignores tags, so a tag with a space in
    it (`[clears throat]`) can be split; a tag running past the window's end can be hard-cut;
    and a `maxChars` of 0 or less never finishes (the server does not bound
    `generation.max_chunk_chars`). Reproduce exactly, or fix?
16. **`POST /v1/captures` leaves the WAV behind when transcription fails** (a Python bug copied
    on purpose, RESEARCH §6). Keep?
17. **`POST /v1/captures/{id}/refine` with no LLM** answers the generic 500 (the module comment
    in file 1 says the API maps it to 501; no route does). Keep?
18. **MCP `transcribe` with `audio_path: ""` and `audio_base64` set** goes into path mode today
    and is refused as "not absolute"; the spec treats an empty string as not given. Confirm.
19. **`captures.duration_ms` is never written**, so the Captures page and the clone maker always
    show no length. Out of scope unless the user says so.
20. **Stale user docs found while reading:** `docs/mcp-server.md` and `docs/troubleshooting.md`
    say a missing `fastmcp` package disables MCP; `docs/channels.md` sends the reader to
    `system-tray.md` for keep-alive setup that is not there; `docs/effects.md`'s preset table
    (above). The rewrite's change should update them.
21. **Keep-alive under Electron.** The reason it exists (macOS WebKit dropping its CoreAudio
    session) predates the move to Electron's Chromium; whether Chromium needs it is unmeasured.
    The user ruled it be rewritten ("keep alive is standard"), so the spec keeps it.
