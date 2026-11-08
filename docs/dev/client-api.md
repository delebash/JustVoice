# The client API — another app calling JustVoice

Another app on this machine, or on the network, can ask JustVoice for character voices and spoken
lines while it runs — the desktop app or the headless server (`justvoice-server serve`), at
`http://127.0.0.1:17494` by default. JustDirect is its first caller (2026-11-08). JustWrite does not
use it: JustWrite hands a book over as a file (`design-decisions.md` §3).

- **Version:** `GET /v1/health` answers `client_api: 1`. It goes up when a shape below changes.
- **Who is calling:** send `X-Client: <your app's name>` on every request. A voice you make keeps it
  as its `made_by`, so you can list and delete only your own voices.
- **Sign-in:** the server's token rule applies as for any client (Settings → Server; a loopback
  caller is let in unless `requireForLoopback` is on). Send the token as `Authorization: Bearer …`.
- **Long work** is a job of the kit's job router: the start answers `202` with the job's snapshot
  (`{id, kind, state, progress, message, result, error, …}`); follow it with `GET /v1/jobs/:id`
  (or `GET /v1/jobs/:id/events`, server-sent events), stop it with `DELETE /v1/jobs/:id`. `state`
  ends as `done` (the `result` below), `error` (`error.message`) or `cancelled`.
- **The examples** are `server/tests/fixtures/client-api/*.json`; `server/tests/client_api.test.js`
  checks every route against them, so a field renamed or dropped fails JustVoice's suite first. A
  caller's fake can copy them.
- **Licence words** (`commercial`): `Yes`, `Conditional`, `Separate licence`, `Unclear`, `No` —
  JustVoice's reading of each model's licence at its source; the Speech engines list shows the same.

## 1. A character's voice — `POST /v1/character-voices`

The one-click run's recipe for one person: a language model writes a voice description from your
card and their lines (the Local "one speaker" prompt, AI Settings → Prompts → Voices from the book),
the voice is designed once on `book_voices.design_model` speaking a calm line of theirs, and that
take is kept as the clip of a voice on `book_voices.clone_model` — the model that then speaks every
line. With no language model set, your description goes to the designer as written
(`described_by: null`).

Body (`character-voice.request.json`): `name`, `description` (who they are), `lines` (optional),
`context` (the story in a line, optional), `language` (`en-US`), `gender` (`male` / `female`,
optional), `commercial_use` (optional). With `commercial_use: true`, a design or cast model whose
word is `No`, `Separate licence` or `Unclear` is refused with `409` before anything runs.

→ `202`, a job of kind `character-voice`. Its result (`character-voice.result.json`): `voice_id`,
`name`, `gender`, `description`, `described_by`, `design` and `clone` (`{model, name, commercial,
summary, url}`), `audition` (the line it was designed speaking) and `audition_url` (the kept clip,
`GET /v1/voices/:id/clip.wav`).

## 2. One line — `POST /v1/audio/speech`

OpenAI's speech request (platform.openai.com/docs/api-reference/audio/createSpeech), `voice` a
JustVoice voice id (`speech.request.json`): `input`, `voice`, `instructions` (the delivery in
words), `response_format` (`wav` only; anything else is `400`), `speed` (0.25–4), and JustVoice's
own `emotion` (`neutral`, `happy`, `sad`, `angry`, `fearful`, `whispered`, `shouted`, `sarcastic`,
`contemptuous`) and `seed`. `model` is accepted and ignored — a voice speaks with its own model.
Send both `emotion` and `instructions`: some models take only a label, others only words. → the
line as `audio/wav`. A line already spoken the same way comes back from the render cache.

## 3. A voice from a recording — `POST /v1/voices/clone`

As the app's own clone: `{name, ref_wav_b64, language, gender, transcript}`. Leave out `engine`
and `model` and the voice goes on the cast model (`book_voices.clone_model`). → `201`, the voice row
(`voice.row.json`), its `made_by` and `licence` included.

## 4. Your voices — `GET /v1/voices?made_by=<X-Client>` and `DELETE /v1/voices/:id`

Every voice row carries `made_by` (null for a voice made in JustVoice) and `licence` (`{commercial,
summary, url}`, null for an online provider's voice). `DELETE` answers `{deleted: true}`.

## 5. Many lines, then the card is yours — `POST /v1/audio/speech/batch`

Body (`speech-batch.request.json`): `lines` — each `{id, voice, input, instructions, emotion,
speed, seed}`, `id` your own (letters, digits, `_`, `-`, `.`; each once) — and `release`
(default true). → `202`, a job of kind `speech-batch`; the lines are spoken in order. Its result
(`speech-batch.result.json`): `lines` — `{id, file, url, voice, seconds, error}`; a line that failed
has its `error` and no `file`, and the rest go on.

- One line's WAV: `GET /v1/audio/speech/batch/:job_id/lines/:id.wav` (each line's `url`).
- All of them: `GET /v1/audio/speech/batch/:job_id.zip` — `manifest.json` (the result) and the WAVs.
- `release: true` lets go of every speech model JustVoice holds when the batch ends — done, failed
  or cancelled — so the graphics card is free for your own models again. JustVoice never touches
  another app's models.
- Done with it: `DELETE /v1/audio/speech/batch/:job_id` (a running batch is stopped, an ended one
  forgotten with its files). Batches left more than a day go when the next one starts.
- Each line goes through JustVoice's one speech queue as a single line, which takes its turn ahead of
  a running book render at the next line boundary (`synth_scheduler.js`, interactive): a batch slows
  a book that is rendering, it doesn't wait for it to finish.

## Where it lives

`server/src/api/client_api.js` (the routes), `server/src/models.js` (`CharacterVoiceRequest`,
`SpeechRequest`, `SpeechBatchRequest`, the voice row's `made_by` and `licence`),
`server/src/api/voices_api.js` (`clientOf`, `modelLicence`, the clone default, `?made_by`),
`server/src/version.js` (`CLIENT_API_VERSION`). The design and its attacks:
`docs/plans/2026-11-08-commercial-engine.md`.
