# The test kit and round 4 (plan, 2026-10-16)

Steps 2 and 3 of the order decided 2026-10-11 (TASKS "The order of work after the research sweep":
"2. Build a small test kit, following NeMo's standard recipe … 3. Round 4, done the authors' way …
4. Back to the one-click plan, with the research folded in"). The user's go, 2026-10-16: "your rec do
it all stop stoping and finish it all go!", on "Can I build the test kit next, following NVIDIA
NeMo's own scoring recipe? That recipe is in Python … Rec: yes, in Python." Facts it rests on:
RESEARCH §10.6 (rounds 1–3), §10.8 (each model's documented way of taking emotion), §10.11 (scorers
and protocol).

## 1 · What it is

- **The test kit** scores a take without a person: does it read back as its words, is it the same
  speaker as the voice's clip, how good does it sound, and what emotion does it carry — the four
  checks of NeMo's take-scoring recipe. It ranks models and rejects broken takes; scorers agree with
  people on a model's average, weakly on one take (RESEARCH §10.11), so choosing between good takes
  stays with a person. A tool beside the app, in Python; nothing of it ships.
- **Round 4** picks the engine that voices the one-click run's characters (the one-click plan's Q2):
  every model in our build that clones a voice and takes emotion in one request, each given emotion
  **the way its authors document it**, on the book's own lines, through the app. The kit scores
  every take; the best few go to a blind listening page for the user's ears, as rounds 1–3 did.

## 2 · The kit — each piece and its standard

| Piece | Follows | Link |
|---|---|---|
| The project | a uv project (`pyproject.toml`, `uv.lock`), Python 3.12, in `tools/take-check/` | [docs.astral.sh/uv/concepts/projects](https://docs.astral.sh/uv/concepts/projects/) |
| The harness | **VERSA** as-is, pinned to a commit, run from a YAML score config. NeMo's `evaluate_generated_audio.py` is the recipe; NeMo installs on Linux only and this machine has no WSL, so VERSA — the standard harness RESEARCH §10.11 names — computes the same checks | [github.com/wavlab-speech/versa](https://github.com/wavlab-speech/versa) |
| Read-back | VERSA `whisper_wer` (Whisper large-v3), both texts through Whisper's normaliser | VERSA metric catalog |
| Same speaker | VERSA `speaker` with WavLM-base-plus-sv (NeMo's option), against the voice's clip | VERSA metric catalog |
| Quality | VERSA `utmosv2` | VERSA metric catalog |
| Emotion | emotion2vec+ large through FunASR's `AutoModel`, its documented use (nine classes: angry, disgusted, fearful, happy, neutral, other, sad, surprised, unknown); VERSA `emo_vad` beside it | [github.com/ddlBoJack/emotion2vec](https://github.com/ddlBoJack/emotion2vec) |
| Loud and soft (shouted, whispered) | integrated loudness, ITU-R BS.1770, through pyloudnorm — the told take against the same line not told | [github.com/csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm) |
| The summary | scipy's `stats.bootstrap`, paired over lines | [docs.scipy.org — bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html) |

**Built 2026-10-16** (`tools/take-check/README.md`): VERSA v1.1.0 (`38454c95`), torch 2.11 cu126,
funasr 1.4.16, the UTMOSv2 fork VERSA uses; ESPnet and openai-whisper beside it for `whisper_wer`
instead of VERSA's whole `external` group; a book's curly quotes go to Whisper as ASCII (its
normaliser splits "There’s"); contemptuous is read as emotion2vec+'s `disgusted`; shouted and
whispered through loudness. On the CPU, 6 takes in 8½ minutes with the first downloads.

Each score is read on its own, as VERSA reports them; no combined score (RESEARCH §10.11: a z-score
combiner is NOT STANDARD — not built). Input: a folder of takes and a `manifest.json` (one entry per
take: its wav, its words, the voice's clip, the emotion asked, the model, the seed, told or not).
Output: `scores.csv`, one row per take, and `summary.json` per model.

## 3 · Round 4

**The candidates** — in our build, clone a voice, take emotion in one request, fit an 8 GB card
(RESEARCH §10.8; licence words as the app shows them — tested, not ruled on):

| Model | The authors' way | What the app sends today |
|---|---|---|
| VoxCPM2 | the clip alone + "(…)" direction prefix | the same since 2026-10-11 (a directed line drops the clip's words) |
| IndexTTS 2.5 | an eight-value emotion vector at weight ~0.65 (README), not text mode | emotion text at weight 1.0 — **round 4 tries both** |
| Chatterbox Multilingual | exaggeration ~0.7 with guidance ~0.3 for expressive lines (README) | nothing — **round 4 sets them on told lines** |
| CosyVoice3 | its fixed instruction sentences (very happy / sad / angry, loud, soft) | the same since the adoption slices |
| Higgs Audio TTS 3 | `<|emotion:…|>` and style tags | the same |
| Fish Audio S2 Pro | free-form `[tag]` cues | the same |
| Breeze TTS 2 | instruction + guidance 4 | the same |
| MOSS-TTS v1.5 | its `instruct` in words | the same ("not yet tested by JustVoice") |
| Chatterbox Turbo | nine sound tags, no emotions | the baseline |

Out, with the reason: FireRedTTS3 (no direction on a clone), Qwen3 Base (drops direction), Qwen3
CustomVoice and VoiceDesign (no clone — the narrator's candidates, not the characters'), dots.tts
(emotion only through a second Edit pass), OmniVoice (whispered only).

**The lines** — Alice VII–VIII's answer key (`server/samples/alice-in-wonderland/`): the 50 cue
lines whose cue names an emotion (shouted 18, sad 11, whispered 7, angry 6, fearful 5,
contemptuous 2, happy 1), each **told** (its emotion and its cue's words, the model's way) and
**not told**; seeds 7, 8, 9. One voice for every line — the Hatter, frozen from his VoiceDesign
audition as in rounds 1–3 — copied to each model.

**The method:**
1. `server/scripts/round4_render.js` (the eval scripts' pattern, `server/scripts/eval_attribution.js`)
   renders every take through the running app — `POST /v1/voices/{id}/copy` for each model's voice,
   `POST /v1/generate` with the line's delivery and the model's own settings (`delivery.engine`) —
   into `data/round4/` with the kit's manifest. Models load and unload as the app does.
2. The kit scores every take.
3. **Screening:** per model, how often a told take carries its emotion against the same line not
   told (the gain), its read-back, its speaker similarity across lines; and speed. The best three or
   four go on.
4. **By ear:** a blind page (an artifact with its own database, as rounds 1–3), the user's answers
   per take — like the book / plain / wrong feeling — on a random seed per line.

**Accepted:** by the user's ears; the winner's documented way becomes its direction in its notes
(`curated/<family>.js`), and the one-click plan's Q2 is settled.

## 4 · Blast radius

New files only: `tools/take-check/`, `server/scripts/round4_render.js`, takes under `data/round4/`
(gitignored). The app's code is not changed by this plan; it renders through the existing routes.
The user's data gains the Hatter's copies on each model (voices, removed after the round) and the
memory prices of the models it loads.

## 5 · Running it

The GPU is shared with the JustWrite session: a message before each run and after. The kit's
scorers run on the GPU only while no speech model is loaded.
