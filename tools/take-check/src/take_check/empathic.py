# SPDX-License-Identifier: MIT
"""take-check empathic: LAION Empathic-Insight-Voice's expert heads on every take of a manifest.

Each take goes through the Whisper encoder once (NeMo's `EmpathicInsightVoice`, vendored in
`emotion_encoder.py`), then through every head the LAION repo ships — 40 emotions plus attributes
such as Arousal, Valence and "Monotone vs. Expressive". Each head's raw score is written as it
comes out (no softmax, no combining): `empathic.csv`, one row per take.
"""

import csv
import sys
from pathlib import Path


def score_empathic(manifest: Path, out: Path, device: str, cache: Path, size: str = "small", only: list[str] | None = None) -> int:
    import torch

    from take_check.emotion_encoder import ALL_HEADS, EmpathicInsightVoice
    from take_check.manifest import load_manifest

    # Each head is a 295 MB file (a 73.7M-parameter projection of the whole Whisper sequence), so all
    # 55 hold about 16 GB of memory; `only` loads just the heads named.
    labels = only or ALL_HEADS
    unknown = [h for h in labels if h not in ALL_HEADS]
    if unknown:
        print(f"take-check empathic: no head called {', '.join(unknown)}", file=sys.stderr)
        return 2
    takes = load_manifest(manifest)
    out.mkdir(parents=True, exist_ok=True)
    model = EmpathicInsightVoice.from_pretrained(
        size=size, device=device, mlp_device=device, cache_dir=cache / "empathic", cache_classifiers=True
    ).eval()
    print(f"take-check empathic: {len(takes)} takes, {len(labels)} heads, {device}", flush=True)
    heads = {label: model._get_classifier(label) for label in labels}
    rows = []
    with torch.no_grad():
        for n, take in enumerate(takes, 1):
            emb = model.extract_whisper_embedding(take.wav)
            row = {"id": take.id, "model": take.model, "line": take.line, "seed": take.seed, "told": take.told}
            for label, head in heads.items():
                param = next(head.parameters())
                row[label] = float(head(emb.to(device=param.device, dtype=param.dtype)).squeeze().item())
            rows.append(row)
            if n % 50 == 0:
                print(f"  {n}/{len(takes)}", flush=True)
    path = out / "empathic.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"take-check empathic: wrote {path}", flush=True)
    return 0
