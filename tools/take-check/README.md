# take-check

Scores speech takes without a person: does a take read back as its words, is it the same speaker
as the voice's clip, how good does it sound, what emotion does it carry, and how loud is it. A
tool beside JustVoice, in Python; nothing of it ships with the app. The plan it was built from is
`docs/plans/2026-10-16-test-kit-and-round-4.md` §2.

Scorers agree with people on a model's average and only weakly on one take (RESEARCH §10.11), so
use it to rank models and to reject broken takes; choosing between good takes stays with a person.
Each score is reported on its own. There is no combined score.

## The recipe it follows

NVIDIA NeMo's take-scoring recipe,
`nemo/collections/tts/modules/magpietts_inference/evaluate_generated_audio.py` (read-back WER/CER,
speaker similarity with WavLM-base-plus-sv, UTMOSv2). NeMo installs on Linux only, and this machine
has no WSL, so the same checks run through **VERSA**, the standard speech-evaluation harness, used
as it is: its own scorer (`versa.bin.scorer`, the `versa-score` command), a YAML score config,
and `--io soundfile` wav.scp inputs.

| Score | Computed by | Model |
|---|---|---|
| Read-back | VERSA `whisper_wer`, both texts through Whisper's English normaliser (`text_cleaner: whisper_en`) | Whisper large-v3 |
| Same speaker | VERSA `speaker`, Hugging Face x-vector backend, the take against `reference_wav` | microsoft/wavlm-base-plus-sv |
| Quality | VERSA `pseudo_mos` with `predictor_types: ["utmosv2"]` | UTMOSv2 (fusion_stage3, fold 0) |
| Emotion (classes) | emotion2vec+ large through FunASR's `AutoModel`, as the emotion2vec README shows | iic/emotion2vec_plus_large (`hub="hf"`) |
| Emotion (dimensions) | VERSA `emo_vad` | audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim |
| Loudness | pyloudnorm `Meter.integrated_loudness` (ITU-R BS.1770) | — |
| Summary | `scipy.stats.bootstrap(..., paired=True)` over lines | — |

The VERSA config is `src/take_check/versa_score.yaml`; each entry is copied from VERSA's
`egs/separate_metrics/*.yaml`.

### Pinned versions

- **VERSA** `38454c95f95d9ea717ebf800abe237e846b0f16e` — the v1.1.0 release tag
  (github.com/wavlab-speech/versa, 2026-09-09), installed from git with its `text` and `ml` groups.
- **UTMOSv2**: the fork VERSA's `tools/install_utmosv2.sh` installs, github.com/ftshijt/UTMOSv2
  at `65b7dc8fa626fc61a00400a34f393fc8c897ea04`. Its weights come the way that script and
  `tools/activate_utmosv2.sh` fetch them: a git-lfs clone of the same fork at the same commit,
  named by `UTMOSV2_CHACHE` (the variable's spelling is UTMOSv2's own). `take-check` makes the
  clone in `.cache/utmosv2` on first run and pulls only the checkpoint VERSA loads
  (`fusion_stage3/fold0_s42_best_model.pth`, 818 MB; the script pulls all five folds). The
  fork's own fallback clones github.com/sarulab-speech/UTMOSv2, which no longer keeps its weights
  there (upstream commit 85675ed moved them to Hugging Face), so it cannot be used.
- **PyTorch** 2.11.0 + torchaudio 2.11.0 + torchvision 0.26.0, CUDA 12.6 wheels, from the PyTorch
  index the uv way ([uv: PyTorch](https://docs.astral.sh/uv/guides/integration/pytorch/)).
- **FunASR** 1.4.16, **openai-whisper** 20250625, **ESPnet** 202610.post2 (VERSA's `whisper_wer`
  needs its `TextCleaner`), **transformers** below 5 (what VERSA's model CI installs),
  **pyloudnorm** 0.2.0. Everything else is in `uv.lock`.

## Install

Needs [uv](https://docs.astral.sh/uv/) and `git lfs`. From this folder:

```bash
uv sync
```

Python 3.12 is required (`requires-python = ">=3.12,<3.13"`). The environment (`.venv`) is
about 4.9 GB. The first `score` downloads the models, about 8.4 GB, into `.cache/` here
(`--cache-dir` moves it): Whisper large-v3 2.9 GB, emotion2vec+ large 1.9 GB, UTMOSv2 1.6 GB
(the clone keeps the checkpoint twice, in `.git/lfs` and checked out), WavLM-base-plus-sv
0.8 GB, wav2vec2-base (UTMOSv2's) 0.7 GB, the audeering model 0.6 GB.

On Windows without Developer Mode, Hugging Face's cache copies files instead of linking them
(it warns about symlinks; harmless). The first download of emotion2vec+ can stop with
`[WinError 1314] A required privilege is not held by the client` — a race in
`huggingface_hub`'s parallel download while it is still testing for symlinks. Run the command
again: the rest of the files are already there and the last one downloads alone.

## Run

```bash
uv run take-check score --manifest <path to manifest.json> --out <folder> [--device cpu|cuda]
```

`--device cpu` (the default) hides the GPU from every library (`CUDA_VISIBLE_DEVICES=-1`);
`--device cuda` runs every model on the GPU. Run the GPU only while no speech model is loaded.
On this machine's CPU, VERSA took about 6.5 minutes for six 1–2 s takes, most of it Whisper
large-v3; a full round wants the GPU.

### manifest.json

```json
{
  "takes": [
    {
      "id": "voxcpm2/7-2-told-7",
      "wav": "voxcpm2/7-2-told-7.wav",
      "text": "No room! No room!",
      "reference_wav": "E:/Dev/Web/JustVioce/data/voices/voice_…/ref.wav",
      "emotion_asked": "shouted",
      "model": "voxcpm2",
      "seed": 7,
      "told": true,
      "line": "7-2"
    }
  ]
}
```

- `wav`, `reference_wav` — absolute, or relative to the manifest.
- `emotion_asked` — the emotion the take was told, or `null` for a take not told.
- `line` — a key shared by the told and untold takes of the same line. The line's emotion is read
  from whichever of its takes names one; two different emotions on one line is an error.
- Other fields in an entry are ignored.

## Output

`<out>/scores.csv`, one row per take:

| Column | Meaning |
|---|---|
| `id`, `model`, `line`, `seed`, `told`, `emotion_asked` | from the manifest |
| `wer`, `cer` | (deletions + insertions + substitutions) / reference length, over words and characters, from VERSA's edit counts (as VERSA's `scripts/postprocess/filter_wer.py` computes it). 0 is a perfect read-back; it can pass 1 when the take adds words. Whisper's English normaliser turns a typographic apostrophe into a space, so the kit sends a book's curly quotes and apostrophes (‘ ’ “ ”) to VERSA as their ASCII forms (`versa_scores.plain_quotes`); `There’s` read back as `There's` was a substitution on a correct take. |
| `spk_similarity` | cosine similarity of the take's and the reference clip's WavLM x-vectors, −1 to 1. It drops on emotional speech, so compare it within one character and emotion, never against a fixed bar. |
| `utmosv2` | predicted mean opinion score, about 1–5. VERSA averages five passes, each on randomly chosen frames, so a rerun can differ in the second decimal. |
| `emotion_top` | emotion2vec+'s most probable class |
| `emotion_asked_prob` | the probability of the line's asked emotion, on told and untold takes alike — when the emotion is one of the nine classes, and contemptuous read as `disgusted`, the nearest (as IndexTTS's authors map it; `cli.EMOTION_CLASS`); empty otherwise (shouted and whispered — read them through `loudness_lufs`) |
| `emo_angry` … `emo_unknown` | emotion2vec+'s nine class probabilities (angry, disgusted, fearful, happy, neutral, other, sad, surprised, unknown); they sum to 1 |
| `arousal`, `valence`, `dominance` | VERSA `emo_vad`, the audeering model's three dimensions, about 0–1 |
| `loudness_lufs` | integrated loudness, LUFS (BS.1770). Higher is louder; compare a shouted or whispered take with the same line not told. |
| `duration_s` | the take's length in seconds |
| `chars_per_s` | characters of `text` per second of the take |
| `whisper_hyp_text` | what Whisper heard, after the normaliser |

`<out>/summary.json`, per model:

- `counts` — takes, told, untold, lines, paired lines (lines with both told and untold takes).
- `scores` — mean, median and n of every column above, over all, told and untold takes.
- `told_minus_untold` — for `emotion_asked_prob`, `loudness_lufs` and `wer`: per line, the mean
  over seeds of the told takes minus that of the untold takes; then the mean over lines with a 95%
  paired bootstrap interval (`scipy.stats.bootstrap`, BCa, 9,999 resamples, seed 0). Given for all
  paired lines and for each asked emotion (`by_emotion_asked`, so shouted and whispered lines have
  their own loudness difference). An interval needs two or more paired lines.

`<out>/versa/` keeps VERSA's inputs, its per-take `versa_scores.jsonl` and its log `versa.log`.
If any score is missing, the command still writes both files, lists what is missing and exits 1.

## Licences

The kit's own code is MIT. Run locally, it uses (checked 2026-10-16 on GitHub and Hugging Face):
VERSA (Apache-2.0 licence file, MIT badge), Whisper (MIT), microsoft/wavlm-base-plus-sv (no
licence on its model card), UTMOSv2 (MIT), FunASR (MIT) with emotion2vec+ large ("other" on its
model card; FunASR Model License v1.1 vs an MIT badge — RESEARCH §10.11), the audeering emotion
model (CC-BY-NC-SA-4.0, non-commercial), pyloudnorm (MIT). None of it ships with JustVoice.
