# SPDX-License-Identifier: MIT
"""Dataset-builder projects — generated training clips, line by line.

Alexandria's Dataset tab (`app/static/index.html` dataset-builder, read
2026-08-21): pick a voice description, write rows of emotion + text,
generate each row into a WAV, hear it, regenerate the ones that came out
wrong, then save the set as a training dataset.

Projects live on DISK, not in the page:

    $DATA_DIR/justvoice/training/builder/<id>/
        project.json         — description, seed, rows
        sample_0000.wav …    — the generated clip for row N

That is the whole reason this module exists rather than the rows living in
the renderer. Generating 120 clips is an hour of GPU time; losing it to a
refresh, a crash, or an accidental tab close is not acceptable, so every
generated clip is written the moment it exists and the project is
reloadable by id.

Row status is DERIVED from whether its wav is on disk — never stored — so
the record cannot drift from the files it describes.
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..paths import training_root
from .atomic import atomic_write_json


def builder_root(data_dir: Path) -> Path:
    root = training_root(data_dir) / "builder"
    root.mkdir(parents=True, exist_ok=True)
    return root


def project_dir(data_dir: Path, project_id: str) -> Path:
    return builder_root(data_dir) / project_id


def sample_path(data_dir: Path, project_id: str, index: int) -> Path:
    return project_dir(data_dir, project_id) / f"sample_{index:04d}.wav"


def _record_path(data_dir: Path, project_id: str) -> Path:
    return project_dir(data_dir, project_id) / "project.json"


def _hydrate(data_dir: Path, rec: dict) -> dict:
    """Stamp each row's status from the files actually present."""
    pid = rec["id"]
    for i, row in enumerate(rec.get("rows") or []):
        row["index"] = i
        row["has_audio"] = sample_path(data_dir, pid, i).is_file()
        if row.get("status") == "generating":
            # A "generating" flag that survived a restart is a lie — the
            # process that was generating is gone.
            row["status"] = "done" if row["has_audio"] else "pending"
        else:
            row["status"] = "done" if row["has_audio"] else (row.get("status") or "pending")
    return rec


def list_projects(data_dir: Path) -> list[dict]:
    out: list[dict] = []
    for rec in sorted(builder_root(data_dir).glob("*/project.json")):
        try:
            out.append(_hydrate(data_dir, json.loads(rec.read_text(encoding="utf-8"))))
        except Exception:
            continue
    out.sort(key=lambda r: r.get("created_at") or "")
    return out


def get_project(data_dir: Path, project_id: str) -> dict | None:
    p = _record_path(data_dir, project_id)
    if not p.is_file():
        return None
    try:
        return _hydrate(data_dir, json.loads(p.read_text(encoding="utf-8")))
    except Exception:
        return None


def create_project(data_dir: Path, name: str) -> dict:
    pid = f"dsb-{uuid.uuid4().hex[:12]}"
    project_dir(data_dir, pid).mkdir(parents=True, exist_ok=True)
    rec = {
        "id": pid,
        "name": name,
        "description": "",
        "engine": None,
        "language": "en-US",
        "global_seed": None,
        "rows": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    atomic_write_json(_record_path(data_dir, pid), rec)
    return _hydrate(data_dir, rec)


def save_project(data_dir: Path, project_id: str, patch: dict) -> dict | None:
    """Merge `patch` into the stored record. Rows are replaced wholesale —
    the renderer owns their order and text; the server owns their audio."""
    rec = get_project(data_dir, project_id)
    if rec is None:
        return None
    for key in ("name", "description", "engine", "language", "global_seed"):
        if key in patch:
            rec[key] = patch[key]
    if "rows" in patch:
        rec["rows"] = [
            {
                "emotion": (r.get("emotion") or "").strip(),
                "text": (r.get("text") or "").strip(),
                "seed": r.get("seed"),
                "status": r.get("status") or "pending",
            }
            for r in (patch["rows"] or [])
        ]
    atomic_write_json(_record_path(data_dir, project_id), _strip(rec))
    return _hydrate(data_dir, rec)


def _strip(rec: dict) -> dict:
    """Derived fields never go to disk — see the module docstring."""
    out = dict(rec)
    out["rows"] = [
        {k: v for k, v in r.items() if k not in ("index", "has_audio")}
        for r in (rec.get("rows") or [])
    ]
    return out


def write_sample(data_dir: Path, project_id: str, index: int, wav: bytes) -> None:
    project_dir(data_dir, project_id).mkdir(parents=True, exist_ok=True)
    sample_path(data_dir, project_id, index).write_bytes(wav)


def drop_samples_from(data_dir: Path, project_id: str, count: int) -> None:
    """Delete clips for rows past `count` — called when rows are removed so
    a shortened project cannot leave orphan audio behind that a later row
    would silently inherit."""
    d = project_dir(data_dir, project_id)
    if not d.is_dir():
        return
    for f in d.glob("sample_*.wav"):
        try:
            if int(f.stem.split("_")[1]) >= count:
                f.unlink()
        except (ValueError, IndexError, OSError):
            continue


def delete_project(data_dir: Path, project_id: str) -> bool:
    d = project_dir(data_dir, project_id)
    if not d.is_dir():
        return False
    shutil.rmtree(d, ignore_errors=True)
    return True


def generated_samples(data_dir: Path, project_id: str) -> list[dict]:
    """Rows that have audio, in row order, as {wav_b64, transcript}.

    The transcript is the row's own text — that is the whole advantage of a
    generated set over a recorded one: the transcript is known exactly,
    never guessed by a transcriber."""
    import base64

    rec = get_project(data_dir, project_id)
    if rec is None:
        return []
    out: list[dict] = []
    for i, row in enumerate(rec.get("rows") or []):
        p = sample_path(data_dir, project_id, i)
        if not p.is_file():
            continue
        out.append(
            {
                "wav_b64": base64.b64encode(p.read_bytes()).decode(),
                "transcript": row.get("text") or "",
                "row_index": i,
            }
        )
    return out
