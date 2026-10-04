# Chatterbox Turbo and Nano tag check — 2026-10-04

The persona redesign's slice P8 (plan `2026-10-03-persona-redesign.md` §6.2, call 8): before the
app lists a tag in a picker, prove the model performs it. The user, 2026-10-03: *"render each one
on Turbo and listen before the app lists it. A tag that does nothing would be a broken promise in
the list"*. Nobody here can listen, so the check is mechanical (call 8: *"each tag is rendered on
Turbo with and without it; it passes when the tag's word is not heard (speech recognition) and the
audio differs. A tag that fails leaves the list."*).

**Result: all 19 tags pass on both Chatterbox Turbo and Chatterbox Nano. The tag list is
unchanged** (`engines/capability_details.py`, the `chatterbox-turbo` row; Nano is a copy of it).

## How it was run

- The tool: `server/scripts/turbo_tag_check.py` (`--model chatterbox-nano` for Nano;
  `--from-renders` re-scores a folder of earlier renders without rendering again).
- The app: `npm run dev` — our audio.cpp build (dev `6d1825eb`, CUDA), the real data dir. The
  pinned release cannot clone on Turbo yet, so the check cannot run on a packaged app or the
  headless server.
- **Nothing written to the library.** The reference clip is a Kokoro audition (`af_heart` reading
  two sentences, 7.5 s — Turbo and Nano need a clip longer than 5 s); the Turbo voice is an
  unsaved `POST /v1/voices/preview` candidate; transcripts come from the stateless
  `POST /v1/transcribe` (Qwen3-ASR 1.7B q8).
- One line, one seed (4242): *"I told you we would be late, and now look where we are."* A state
  or register tag leads the line (`[angry] I told you…`), a sound sits mid-line
  (`…be late, [sigh] and now…`) — where the persona page and Generate put them.
- **Changed**: the RMS of the sample-wise difference from the plain render, relative to the plain
  render's RMS, plus the length change. The floor is rendering the plain line twice with the same
  seed — **0.0 on both models** (the renders are bit-identical), so any difference is the tag's.
- **Heard**: a word in the tagged transcript, not in the plain line, that starts like the tag's
  word (`whisper…`, `dramat…`, `throat` …). The sound a tag asks for is NOT its word: a performed
  `[shush]` transcribes as *"Shh"* and `[groan]` as *"Ugh!"* — the tag working. (The first scoring
  counted *"shh"* as the word and failed `[shush]`; the probe was wrong, not the tag, and was
  fixed before the record.)

## Turbo (`chatterbox-turbo-q8`) — plain 2.76 s

| Kind | Tag | Length | Difference | Transcript of the tagged render | Verdict |
|---|---|---|---|---|---|
| emotion | `[angry]` | 2.88 s | 1.46 | I told you we would be late, and now look where we are. | pass |
| emotion | `[fear]` | 2.96 s | 1.52 | (same) | pass |
| emotion | `[happy]` | 3.44 s | 1.69 | (same) | pass |
| emotion | `[sarcastic]` | 2.88 s | 1.45 | (same) | pass |
| emotion | `[surprised]` | 3.16 s | 1.69 | (same) | pass |
| emotion | `[crying]` | 3.44 s | 1.74 | (same) | pass |
| emotion | `[whispering]` | 2.88 s | 1.39 | (same) | pass |
| register | `[narration]` | 3.28 s | 1.72 | (same) | pass |
| register | `[dramatic]` | 3.28 s | 1.65 | (same) | pass |
| register | `[advertisement]` | 3.44 s | 1.73 | (same) | pass |
| sound | `[cough]` | 3.44 s | 1.71 | (same) | pass |
| sound | `[laugh]` | 3.28 s | 1.72 | (same) | pass |
| sound | `[chuckle]` | 3.64 s | 1.78 | (same) | pass |
| sound | `[sigh]` | 3.92 s | 1.91 | (same) | pass |
| sound | `[gasp]` | 3.56 s | 1.72 | (same) | pass |
| sound | `[groan]` | 3.56 s | 1.91 | I told you we would be late. **Ugh!** And now look where we are. | pass |
| sound | `[sniff]` | 3.52 s | 1.71 | (same as the plain line) | pass |
| sound | `[clear throat]` | 3.44 s | 2.07 | (same) | pass |
| sound | `[shush]` | 3.92 s | 1.71 | I told you we would be late. **Shh**, and now look where we are. | pass |

## Nano (`chatterbox-nano-q8`) — plain 3.16 s

| Kind | Tag | Length | Difference | Transcript of the tagged render | Verdict |
|---|---|---|---|---|---|
| emotion | `[angry]` | 3.28 s | 1.37 | I told you we would be late, and now look where we are. | pass |
| emotion | `[fear]` | 3.40 s | 1.50 | (same) | pass |
| emotion | `[happy]` | 3.16 s | 1.32 | (same) | pass |
| emotion | `[sarcastic]` | 3.44 s | 1.50 | (same) | pass |
| emotion | `[surprised]` | 3.56 s | 1.55 | (same) | pass |
| emotion | `[crying]` | 3.64 s | 1.48 | I told **ye** we would be late, and now look where we are. | pass |
| emotion | `[whispering]` | 3.48 s | 1.17 | (same as the plain line) | pass |
| register | `[narration]` | 3.36 s | 1.45 | (same) | pass |
| register | `[dramatic]` | 3.72 s | 1.60 | (same) | pass |
| register | `[advertisement]` | 3.16 s | 1.40 | (same) | pass |
| sound | `[cough]` | 3.64 s | 1.85 | (same) | pass |
| sound | `[laugh]` | 3.72 s | 1.59 | (same) | pass |
| sound | `[chuckle]` | 3.72 s | 1.66 | (same) | pass |
| sound | `[sigh]` | 3.68 s | 1.58 | (same) | pass |
| sound | `[gasp]` | 3.64 s | 1.62 | (same) | pass |
| sound | `[groan]` | 3.92 s | 1.70 | I told you we would be late. **Ah**, and now look where we are. | pass |
| sound | `[sniff]` | 3.76 s | 1.63 | (same as the plain line) | pass |
| sound | `[clear throat]` | 3.68 s | 1.65 | (same) | pass |
| sound | `[shush]` | 4.60 s | 1.80 | I told you we would be late. **Shh**, and now look where we are. | pass |

## What this proves, and what it doesn't

- **Proved:** every tag reaches the model and changes the take, and no tag is read out as its
  word. That is the broken promise the check was for — a listed tag that is spoken aloud, or
  silently ignored.
- **Not proved:** that each tag sounds like its name. Any change to the input tokens moves a
  seeded take, so "the audio differs" shows the tag arrived, not that `[sarcastic]` sounds
  sarcastic. Most sounds lengthen the line (a sigh adds 1.2 s on Turbo), which fits a sound being
  made; the states and registers can only be judged by ear. The WAVs of both runs were kept in the
  session's scratch folder, not the repo; re-run the script to hear them.
- **One seed, one line.** A tag that works here can still be weak on another line or voice.

## Found on the way (open, not fixed here — see TASKS)

1. **A model swap leaves speech recognition's memory booked, so every later transcription is
   refused until the app restarts.** Loading Nano after Turbo restarted the shared audio.cpp
   process (runtime pid 20228 → 24428), which took the resident recogniser down with it
   (memory in use 5154 → 1625 MB). The arbiter kept `stt:asr` booked at 2756 MB, and from then
   on every `POST /v1/transcribe` was refused: *"not enough memory to load asr: it needs ~4752 MB
   (+1024 MB safety margin) but only 5436 MB free of 8192 MB (measured, minus what is booked)
   remain. Resident: stt:asr (2756 MB)"* — with 677 MiB actually in use on the card.
   `POST /v1/engines/unload {"kind":"stt"}` did not clear it (`previous_engine: null`). The
   mechanism in the code: `_admit_memory` prices against the ledger (`free = total − max(used,
   committed)`), and `make_room(…, exclude="stt:asr")` never evicts the booking of the engine
   being loaded — so a stale booking under the same key can never be released.
   Dictation and Captures share this door (`ensure_stt_loaded`).
2. **The first Turbo load was refused while the language model was still leaving.** The arbiter
   logged *"evict LRU gemma-4-26b-a4b-qat (llm, 6825 MB) — loading chatterbox"* and 0.6 s later
   the load failed *"only 4101 MB free"*; a retry a few seconds later loaded. Seen once; the
   manager already waits up to 4 s for an eviction to drain, so the path that refused needs
   reading before anything is changed.
