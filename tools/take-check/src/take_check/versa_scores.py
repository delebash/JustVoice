# SPDX-License-Identifier: MIT
"""Runs VERSA's scorer as its README documents it and reads back its per-take results.

The scorer is `versa-score` (versa/bin/scorer.py) with `--io soundfile`: a pred wav.scp
(the takes), a gt wav.scp (each take's voice clip), a text file (each take's words) and
the score config in versa_score.yaml. It writes one JSON line per take.
"""

import json
import os
import subprocess
import sys
from importlib import resources
from pathlib import Path

from take_check.manifest import Take

# The keys VERSA writes for the metrics in versa_score.yaml, per metric.
EXPECTED_KEYS = {
    "whisper_wer": [
        "whisper_hyp_text",
        "whisper_wer_delete",
        "whisper_wer_insert",
        "whisper_wer_replace",
        "whisper_wer_equal",
        "whisper_cer_delete",
        "whisper_cer_insert",
        "whisper_cer_replace",
        "whisper_cer_equal",
    ],
    "speaker": ["spk_similarity"],
    "pseudo_mos (utmosv2)": ["utmosv2"],
    "emo_vad": ["arousal_emo_vad", "valence_emo_vad", "dominance_emo_vad"],
}


# Whisper's English normaliser turns a curly apostrophe into a space, so "There’s" read back as
# "There's" scored a substitution; a book's typographic quotes go as their ASCII forms.
_QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'})


def plain_quotes(text: str) -> str:
    return text.translate(_QUOTES)


def _error_rate(row: dict, unit: str) -> float | None:
    """(deletions + insertions + substitutions) / reference length, as VERSA's
    scripts/postprocess/filter_wer.py `compute_error_rates` reads its edit counts."""
    keys = [f"whisper_{unit}_{op}" for op in ("delete", "insert", "replace", "equal")]
    if any(row.get(key) is None for key in keys):
        return None
    delete, insert, replace, equal = (row[key] for key in keys)
    reference = equal + delete + replace
    if reference == 0:
        return 0.0
    return (delete + insert + replace) / reference


def run_versa(
    takes: list[Take],
    work_dir: Path,
    cache_dir: Path,
    use_gpu: bool,
    env: dict[str, str],
    quality_seeds: set[str] | None = None,
    whisper_model: str | None = None,
) -> tuple[dict[str, dict], list[str]]:
    """Score every take with VERSA. Returns ({take id: scores}, [problems]).

    One VERSA run per metric of versa_score.yaml, so each model has the card to itself: together
    they filled an 8 GB card and spilled into system memory, 11 s a take (2026-10-16). UTMOSv2,
    the slowest, scores only the takes whose seed is in `quality_seeds` when it is given — a
    model's average quality, not each take's (RESEARCH §10.11: quality predictors agree with
    people on averages only)."""
    import yaml

    work_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    # VERSA keys are whitespace-free; the manifest's ids may not be.
    keys = {f"take{index:05d}": take for index, take in enumerate(takes)}
    metrics = yaml.safe_load(resources.files("take_check").joinpath("versa_score.yaml").read_text(encoding="utf-8"))
    rows: dict[str, dict] = {key: {"key": key} for key in keys}
    problems: list[str] = []
    skipped: set[tuple[str, str]] = set()
    # Python's UTF-8 mode: VERSA opens the scp and text files with the locale's encoding.
    versa_env = {**env, "PYTHONUTF8": "1"}
    for metric in metrics:
        name = metric["name"] if metric["name"] != "pseudo_mos" else "utmosv2"
        if name == "whisper_wer" and whisper_model:
            metric = {**metric, "model_tag": whisper_model}
        chosen = keys
        if name == "utmosv2" and quality_seeds:
            chosen = {k: t for k, t in keys.items() if str(t.seed) in quality_seeds}
            skipped.update((k, name) for k in keys if k not in chosen)
        if not chosen:
            continue
        run_dir = work_dir / name
        run_dir.mkdir(parents=True, exist_ok=True)
        pred_scp = run_dir / "pred.scp"
        gt_scp = run_dir / "gt.scp"
        text_file = run_dir / "text"
        pred_scp.write_text("".join(f"{k} {t.wav}\n" for k, t in chosen.items()), encoding="utf-8")
        gt_scp.write_text("".join(f"{k} {t.reference_wav}\n" for k, t in chosen.items()), encoding="utf-8")
        text_file.write_text(
            "".join(f"{k} {' '.join(plain_quotes(t.text).split())}\n" for k, t in chosen.items()), encoding="utf-8"
        )
        config = run_dir / "versa_score.yaml"
        config.write_text(yaml.safe_dump([metric], sort_keys=False), encoding="utf-8")
        output = run_dir / "versa_scores.jsonl"
        log = run_dir / "versa.log"
        command = [
            sys.executable,
            "-m",
            "versa.bin.scorer",
            "--score_config", str(config),
            "--pred", str(pred_scp),
            "--gt", str(gt_scp),
            "--text", str(text_file),
            "--output_file", str(output),
            "--io", "soundfile",
            "--cache_folder", str(cache_dir),
        ]
        if use_gpu:
            command.append("--use_gpu")
        print(f"take-check:   VERSA {name} on {len(chosen)} takes ...", flush=True)
        with log.open("w", encoding="utf-8") as log_file:
            result = subprocess.run(
                command, cwd=cache_dir, env=versa_env, stdout=log_file, stderr=subprocess.STDOUT
            )
        if result.returncode != 0:
            problems.append(f"versa-score ({name}) exited with code {result.returncode}; see {log}")
        if output.is_file():
            for line in output.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    rows.setdefault(row["key"], {"key": row["key"]}).update(row)

    scores: dict[str, dict] = {}
    for key, take in keys.items():
        row = rows[key]
        for metric, metric_keys in EXPECTED_KEYS.items():
            short = "utmosv2" if metric.startswith("pseudo_mos") else metric
            if (key, short) in skipped:
                continue
            if any(row.get(k) is None for k in metric_keys):
                problems.append(f"{take.id}: VERSA metric {metric} gave no value; see {work_dir / short / 'versa.log'}")
        scores[take.id] = {
            "wer": _error_rate(row, "wer"),
            "cer": _error_rate(row, "cer"),
            "whisper_hyp_text": row.get("whisper_hyp_text"),
            "spk_similarity": row.get("spk_similarity"),
            "utmosv2": row.get("utmosv2"),
            "arousal": row.get("arousal_emo_vad"),
            "valence": row.get("valence_emo_vad"),
            "dominance": row.get("dominance_emo_vad"),
        }
    return scores, problems


def base_env(cache_dir: Path, device: str) -> dict[str, str]:
    """The environment both VERSA and this process run with: every model cache under
    cache_dir, and on --device cpu no GPU visible to any library."""
    env = dict(os.environ)
    hf = cache_dir / "huggingface"
    env.update(
        {
            # The same locations VERSA's --cache_folder sets (versa/scorer_shared.py
            # configure_shared_cache_environment), so FunASR's download lands beside VERSA's.
            "HF_HOME": str(hf),
            "HF_HUB_CACHE": str(hf),
            "TORCH_HOME": str(cache_dir / "torch"),
            "MODELSCOPE_CACHE": str(cache_dir / "modelscope"),
            # UTMOSv2 clones its weights here (utmosv2/_core/_constants.py; the name is its own).
            "UTMOSV2_CHACHE": str(cache_dir / "utmosv2"),
            "NUMBA_CACHE_DIR": str(cache_dir / "numba"),
        }
    )
    if device == "cpu":
        # An invalid index hides every device (CUDA's documented CUDA_VISIBLE_DEVICES rule);
        # an empty value does not on Windows.
        env["CUDA_VISIBLE_DEVICES"] = "-1"
    return env
