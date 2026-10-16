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
    """Return {take id: {"labels": [...], "scores": [...]}} in the model's label order. A take
    scored before in this output folder (same id, same file) is read from its results.json."""
    import json

    output_dir.mkdir(parents=True, exist_ok=True)
    saved_file = output_dir / "results.json"
    saved = json.loads(saved_file.read_text(encoding="utf-8")) if saved_file.is_file() else {}
    results: dict[str, dict] = {}
    todo = []
    for take in takes:
        old = saved.get(take.id)
        if old and old.get("wav") == str(take.wav):
            results[take.id] = {"labels": old["labels"], "scores": old["scores"]}
        else:
            todo.append(take)
    if not todo:
        return results
    from funasr import AutoModel

    model = AutoModel(
        model=MODEL_ID,
        hub="hf",  # the README's choice outside mainland China
        device="cuda:0" if device == "cuda" else "cpu",
        disable_update=True,
    )
    for take in todo:
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
    keep = {**saved, **{t.id: {**results[t.id], "wav": str(t.wav)} for t in takes if t.id in results}}
    saved_file.write_text(json.dumps(keep, ensure_ascii=False), encoding="utf-8")
    return results
