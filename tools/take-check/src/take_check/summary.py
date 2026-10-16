# SPDX-License-Identifier: MIT
"""Per-model summary: mean and median of every score, and told-minus-untold differences
with paired bootstrap 95% confidence intervals over lines (scipy.stats.bootstrap,
paired=True). Each score stays on its own; nothing is combined."""

import math
import statistics
import warnings

import numpy as np
from scipy import stats

# Differences read told against untold, line by line.
PAIRED_SCORES = ("emotion_asked_prob", "loudness_lufs", "wer")
BOOTSTRAP_SEED = 0


def _number(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _describe(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "mean": None, "median": None}
    return {"n": len(values), "mean": statistics.fmean(values), "median": statistics.median(values)}


def _mean_difference(told, untold, axis=-1):
    return np.mean(told - untold, axis=axis)


def paired_bootstrap(pairs: list[tuple[float, float]]) -> dict:
    """told-minus-untold over lines: mean difference and its 95% CI."""
    result = {"n_lines": len(pairs), "mean_diff": None, "ci_low": None, "ci_high": None}
    if not pairs:
        result["note"] = "no paired lines"
        return result
    told = np.array([p[0] for p in pairs])
    untold = np.array([p[1] for p in pairs])
    result["told_mean"] = float(told.mean())
    result["untold_mean"] = float(untold.mean())
    result["mean_diff"] = float(np.mean(told - untold))
    if len(pairs) < 2:
        result["note"] = "a confidence interval needs 2 or more paired lines"
        return result
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ci = stats.bootstrap(
            (told, untold),
            _mean_difference,
            paired=True,
            vectorized=True,
            confidence_level=0.95,
            method="BCa",
            rng=np.random.default_rng(BOOTSTRAP_SEED),
        ).confidence_interval
    result["ci_low"] = _number(ci.low)
    result["ci_high"] = _number(ci.high)
    if caught:
        result["note"] = "; ".join(str(w.message) for w in caught)
    return result


def _line_means(rows: list[dict], score: str) -> dict[str, dict[bool, float]]:
    """{line: {told: mean over seeds}} for one score."""
    grouped: dict[str, dict[bool, list[float]]] = {}
    for row in rows:
        value = _number(row.get(score))
        if value is None:
            continue
        grouped.setdefault(row["line"], {}).setdefault(row["told"], []).append(value)
    return {
        line: {told: statistics.fmean(values) for told, values in by_told.items()}
        for line, by_told in grouped.items()
    }


def _paired(rows: list[dict], score: str, line_emotion: dict[str, str | None]) -> dict:
    means = _line_means(rows, score)
    pairs = {
        line: (by_told[True], by_told[False])
        for line, by_told in means.items()
        if True in by_told and False in by_told
    }
    by_emotion: dict[str, list[tuple[float, float]]] = {}
    for line, pair in pairs.items():
        by_emotion.setdefault(line_emotion.get(line) or "(none)", []).append(pair)
    return {
        "all": paired_bootstrap(list(pairs.values())),
        "by_emotion_asked": {
            emotion: paired_bootstrap(values) for emotion, values in sorted(by_emotion.items())
        },
    }


def summarise(rows: list[dict], score_columns: list[str], line_emotion: dict[str, str | None]) -> dict:
    summary: dict[str, dict] = {}
    for model in sorted({row["model"] for row in rows}):
        model_rows = [row for row in rows if row["model"] == model]
        told_rows = [row for row in model_rows if row["told"]]
        untold_rows = [row for row in model_rows if not row["told"]]
        lines = {row["line"] for row in model_rows}
        paired_lines = {row["line"] for row in told_rows} & {row["line"] for row in untold_rows}
        scores = {}
        for column in score_columns:
            scores[column] = {
                group: _describe([v for v in (_number(r.get(column)) for r in group_rows) if v is not None])
                for group, group_rows in (("all", model_rows), ("told", told_rows), ("untold", untold_rows))
            }
        summary[model] = {
            "counts": {
                "takes": len(model_rows),
                "told": len(told_rows),
                "untold": len(untold_rows),
                "lines": len(lines),
                "paired_lines": len(paired_lines),
            },
            "scores": scores,
            "told_minus_untold": {
                "method": (
                    "per line, the mean over seeds of told takes minus that of untold takes; "
                    "scipy.stats.bootstrap(paired=True, method='BCa', confidence_level=0.95, "
                    f"n_resamples=9999, rng=default_rng({BOOTSTRAP_SEED})) of the mean over lines"
                ),
                **{score: _paired(model_rows, score, line_emotion) for score in PAIRED_SCORES},
            },
        }
    return summary
