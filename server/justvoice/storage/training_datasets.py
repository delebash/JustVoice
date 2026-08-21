# SPDX-License-Identifier: MIT
"""Training datasets — clips + transcripts saved as reusable objects.

Alexandria's Dataset concept (2026-08-20): prepared or hand-assembled
clips survive as a named thing you pick at train time, instead of
evaporating with the page. Layout per dataset, exactly what the trainers
consume:

    $DATA_DIR/justvoice/training/datasets/<id>/
        record.json          — TrainingDataset metadata (atomic_write_json)
        sample_0000.wav …    — the clips
        metadata.jsonl       — {"audio_filepath": ..., "text": ...} per clip

The runner copies a dataset's files into the job's dataset dir at train
time (copy, not reference — the trainer writes ref.wav beside the clips
and must not mutate the stored dataset).
"""

from __future__ import annotations

import base64
import io
import json
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from ..models import TrainingDataset
from ..paths import training_root
from .atomic import atomic_write_json


def datasets_root(data_dir: Path) -> Path:
    root = training_root(data_dir) / "datasets"
    root.mkdir(parents=True, exist_ok=True)
    return root


def dataset_dir(data_dir: Path, dataset_id: str) -> Path:
    return datasets_root(data_dir) / dataset_id


def list_datasets(data_dir: Path) -> list[TrainingDataset]:
    out: list[TrainingDataset] = []
    for rec in sorted(datasets_root(data_dir).glob("*/record.json")):
        try:
            out.append(TrainingDataset.model_validate(json.loads(rec.read_text(encoding="utf-8"))))
        except Exception:
            continue
    return out


def get_dataset(data_dir: Path, dataset_id: str) -> TrainingDataset | None:
    rec = dataset_dir(data_dir, dataset_id) / "record.json"
    if not rec.is_file():
        return None
    try:
        return TrainingDataset.model_validate(json.loads(rec.read_text(encoding="utf-8")))
    except Exception:
        return None


def create_dataset(
    data_dir: Path,
    name: str,
    samples: list[dict],
    *,
    language: str | None = None,
    ref_index: int | None = None,
    origin: str = "clips",
) -> TrainingDataset:
    """`samples`: [{"wav_b64": ..., "transcript": ...}] — the same shape the
    train request carries, so the LoRA tab's clip table saves as-is.

    `ref_index` names the clip that becomes the voice's identity anchor. Out
    of range is treated as "not chosen" rather than raising: the runner's
    longest-clip fallback is always a valid answer, and refusing to save a
    whole dataset over one bad index would lose the clips."""
    from ..audio.wav import parse_wav_header

    ds_id = f"ds-{uuid.uuid4().hex[:12]}"
    d = dataset_dir(data_dir, ds_id)
    d.mkdir(parents=True, exist_ok=True)

    if ref_index is not None and not (0 <= ref_index < len(samples)):
        ref_index = None

    total_seconds = 0.0
    with open(d / "metadata.jsonl", "w", encoding="utf-8") as meta:
        for i, s in enumerate(samples):
            wav = base64.b64decode(s["wav_b64"])
            fname = f"sample_{i:04d}.wav"
            (d / fname).write_bytes(wav)
            try:
                fmt, _off, _size = parse_wav_header(wav)
                total_seconds += fmt.duration_sec
            except Exception:
                pass
            meta.write(
                json.dumps(
                    {"audio_filepath": fname, "text": (s.get("transcript") or "").strip()}
                )
                + "\n"
            )

    ref_transcript = (
        (samples[ref_index].get("transcript") or "").strip()
        if ref_index is not None
        else None
    )
    rec = TrainingDataset(
        id=ds_id,
        name=name,
        clip_count=len(samples),
        total_seconds=round(total_seconds, 2),
        created_at=datetime.now(timezone.utc),
        language=language,
        ref_index=ref_index,
        ref_transcript=ref_transcript,
        origin=origin,
    )
    atomic_write_json(d / "record.json", rec.model_dump(mode="json"))
    return rec


def update_dataset(
    data_dir: Path,
    dataset_id: str,
    *,
    name: str | None = None,
    language: str | None = None,
    ref_index: int | None = None,
) -> TrainingDataset | None:
    """Rename / retarget the reference clip / correct the language.

    Returns None when the dataset is gone. `ref_index` out of range is
    rejected here (unlike create) — an explicit retarget that silently did
    nothing would be worse than an error the caller can report."""
    rec = get_dataset(data_dir, dataset_id)
    if rec is None:
        return None
    if name is not None:
        rec.name = name
    if language is not None:
        rec.language = language
    if ref_index is not None:
        if not (0 <= ref_index < rec.clip_count):
            raise ValueError(
                f"reference clip {ref_index + 1} is outside this dataset's "
                f"{rec.clip_count} clips"
            )
        rec.ref_index = ref_index
        rec.ref_transcript = _transcript_at(data_dir, dataset_id, ref_index)
    atomic_write_json(
        dataset_dir(data_dir, dataset_id) / "record.json", rec.model_dump(mode="json")
    )
    return rec


def _transcript_at(data_dir: Path, dataset_id: str, index: int) -> str | None:
    rows = _metadata_rows(data_dir, dataset_id)
    if 0 <= index < len(rows):
        return (rows[index].get("text") or "").strip()
    return None


def _metadata_rows(data_dir: Path, dataset_id: str) -> list[dict]:
    meta = dataset_dir(data_dir, dataset_id) / "metadata.jsonl"
    if not meta.is_file():
        return []
    rows: list[dict] = []
    for line in meta.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def load_samples(data_dir: Path, dataset_id: str) -> list[dict]:
    """The dataset's clips back in request shape (wav_b64 + transcript)."""
    d = dataset_dir(data_dir, dataset_id)
    out: list[dict] = []
    meta = d / "metadata.jsonl"
    if not meta.is_file():
        return out
    for line in meta.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            wav = (d / row["audio_filepath"]).read_bytes()
            out.append(
                {
                    "wav_b64": base64.b64encode(wav).decode(),
                    "transcript": row.get("text") or "",
                }
            )
        except Exception:
            continue
    return out


def copy_into(
    data_dir: Path, dataset_id: str, dest: Path, *, ref_index: int | None = None
) -> int:
    """Copy the dataset's clips + metadata.jsonl into `dest` (the job's
    dataset dir). Returns the clip count. Raises LookupError if absent.

    Also plants ref.wav + ref_text.txt when a reference clip is chosen —
    `ref_index` overrides the dataset's stored choice for this run only.
    Planting it HERE (not in the runner) keeps the dataset's own decision
    travelling with its files; the runner only falls back to longest-clip
    when nobody chose."""
    d = dataset_dir(data_dir, dataset_id)
    if not (d / "metadata.jsonl").is_file():
        raise LookupError(f"training dataset '{dataset_id}' not found")
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in d.iterdir():
        if f.name == "record.json":
            continue
        shutil.copy2(f, dest / f.name)
        if f.suffix == ".wav":
            n += 1

    rec = get_dataset(data_dir, dataset_id)
    chosen = ref_index if ref_index is not None else (rec.ref_index if rec else None)
    if chosen is not None:
        rows = _metadata_rows(data_dir, dataset_id)
        if 0 <= chosen < len(rows):
            src = d / rows[chosen]["audio_filepath"]
            if src.is_file():
                shutil.copy2(src, dest / "ref.wav")
                (dest / "ref_text.txt").write_text(
                    (rows[chosen].get("text") or "").strip(), encoding="utf-8"
                )
    return n


def delete_dataset(data_dir: Path, dataset_id: str) -> bool:
    d = dataset_dir(data_dir, dataset_id)
    if not d.is_dir():
        return False
    shutil.rmtree(d, ignore_errors=True)
    return True


# ── ZIP transport — Alexandria's interchange format, both directions ─────
#
# A dataset travels as a ZIP of WAV clips plus metadata.jsonl
# ({"audio_filepath": ..., "text": ...} per line), with optional ref.wav /
# ref_text.txt naming the reference sample. That is byte-compatible with
# Alexandria's upload/download format AND with both of our trainers, so a
# dataset built there trains here and vice versa.

# Import guards: a ZIP is untrusted input. The caps are generous for real
# datasets (hours of 24 kHz mono WAV) and fatal for a zip bomb.
_ZIP_MAX_FILES = 5_000
_ZIP_MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB uncompressed


def build_zip(data_dir: Path, dataset_id: str) -> bytes | None:
    """The dataset as a ZIP: clips + metadata.jsonl (+ ref.wav/ref_text.txt
    when a reference sample is chosen). None when the dataset is gone."""
    d = dataset_dir(data_dir, dataset_id)
    meta = d / "metadata.jsonl"
    if not meta.is_file():
        return None
    rec = get_dataset(data_dir, dataset_id)
    rows = _metadata_rows(data_dir, dataset_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("metadata.jsonl", meta.read_text(encoding="utf-8"))
        for row in rows:
            f = d / row["audio_filepath"]
            if f.is_file():
                z.writestr(row["audio_filepath"], f.read_bytes())
        if rec and rec.ref_index is not None and 0 <= rec.ref_index < len(rows):
            ref = d / rows[rec.ref_index]["audio_filepath"]
            if ref.is_file():
                z.writestr("ref.wav", ref.read_bytes())
                z.writestr(
                    "ref_text.txt",
                    (rows[rec.ref_index].get("text") or "").strip(),
                )
    return buf.getvalue()


def import_zip(
    data_dir: Path, name: str, payload: bytes, *, language: str | None = None
) -> TrainingDataset:
    """Create a dataset from an uploaded ZIP.

    Accepts our own build_zip output and Alexandria's dataset ZIPs
    unchanged. Entry paths are flattened to their basename — a ZIP must
    not be able to write outside the dataset directory. When the ZIP
    carries ref.wav matching one of the clips byte-for-byte, that clip
    becomes the reference sample. Raises ValueError with the reason on
    anything unusable.
    """
    try:
        z = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise ValueError("that file is not a ZIP archive")

    infos = [i for i in z.infolist() if not i.is_dir()]
    if len(infos) > _ZIP_MAX_FILES:
        raise ValueError(f"ZIP holds {len(infos)} files — the limit is {_ZIP_MAX_FILES}")
    total = sum(i.file_size for i in infos)
    if total > _ZIP_MAX_TOTAL_BYTES:
        raise ValueError("ZIP unpacks past the 4 GB limit")

    by_base: dict[str, zipfile.ZipInfo] = {}
    for i in infos:
        base = Path(i.filename).name
        if base and base not in by_base:
            by_base[base] = i

    meta_info = by_base.get("metadata.jsonl")
    if meta_info is None:
        raise ValueError(
            "no metadata.jsonl in the ZIP — every clip needs a transcript line "
            '({"audio_filepath": ..., "text": ...} per line)'
        )

    rows: list[dict] = []
    for line in z.read(meta_info).decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            raise ValueError("metadata.jsonl has a line that is not valid JSON")
        fname = Path(str(row.get("audio_filepath") or row.get("audio") or "")).name
        if not fname:
            continue
        rows.append({"file": fname, "text": (row.get("text") or "").strip()})
    if not rows:
        raise ValueError("metadata.jsonl lists no clips")

    ref_bytes = z.read(by_base["ref.wav"]) if "ref.wav" in by_base else None

    samples: list[dict] = []
    ref_index: int | None = None
    missing: list[str] = []
    for idx, row in enumerate(rows):
        info = by_base.get(row["file"])
        if info is None:
            missing.append(row["file"])
            continue
        wav = z.read(info)
        if ref_bytes is not None and wav == ref_bytes and ref_index is None:
            ref_index = len(samples)
        samples.append(
            {"wav_b64": base64.b64encode(wav).decode(), "transcript": row["text"]}
        )
    if not samples:
        raise ValueError(
            f"none of the clips named in metadata.jsonl are in the ZIP "
            f"(first missing: {missing[0]})"
        )

    return create_dataset(
        data_dir, name, samples,
        language=language, ref_index=ref_index, origin="uploaded",
    )
