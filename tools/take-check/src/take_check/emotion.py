# SPDX-License-Identifier: MIT
"""emotion2vec+ large through FunASR's AutoModel, as the emotion2vec README documents it:
nine classes (angry, disgusted, fearful, happy, neutral, other, sad, surprised, unknown)
with a probability each, per utterance."""

from pathlib import Path

from take_check.manifest import Take

MODEL_ID = "iic/emotion2vec_plus_large"


def _english(label: str) -> str:
    # The model's labels (its tokens.txt) are bilingual, e.g. "生气/angry"; keep the English
    # half. The ninth is "<unk>", which the README lists as "8: unknown".
    if label == "<unk>":
        return "unknown"
    return label.split("/")[-1].strip().lower()


def score_emotion(takes: list[Take], device: str, output_dir: Path) -> dict[str, dict]:
    """Return {take id: {"labels": [...], "scores": [...]}} in the model's label order."""
    from funasr import AutoModel

    model = AutoModel(
        model=MODEL_ID,
        hub="hf",  # the README's choice outside mainland China
        device="cuda:0" if device == "cuda" else "cpu",
        disable_update=True,
    )
    results: dict[str, dict] = {}
    for take in takes:
        result = model.generate(
            str(take.wav),
            output_dir=str(output_dir),
            granularity="utterance",
            extract_embedding=False,
        )[0]
        results[take.id] = {
            "labels": [_english(label) for label in result["labels"]],
            "scores": [float(score) for score in result["scores"]],
        }
    return results
