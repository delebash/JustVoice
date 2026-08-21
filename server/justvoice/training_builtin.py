# SPDX-License-Identifier: MIT
"""Built-in LoRA adapters — voices that ship with the app, downloaded on use.

Alexandria's shape (builtin_lora/manifest.json + its Training tab, read
2026-08-21): a manifest of adapters the app knows about, listed in Trained
Adapters with "built-in" and "not downloaded" badges; Download fetches the
weights and from then on the adapter is an ordinary trained voice.

JV's version: BUILTIN_ADAPTERS below is the manifest (facts only — an
entry exists when its weights are actually published; a placeholder with
no real URL would be fiction). Downloading extracts the adapter ZIP into
the training adapters dir and mints a VoiceRecord(source="lora"), so the
voice renders through exactly the pipeline a locally-trained one does —
no second code path.

The adapter ZIP layout is what GET /v1/train/{job_id}/adapter.zip already
produces: the PEFT adapter files + ref_sample.wav + training_meta.json.
Publishing a built-in = train the voice here, download its zip, host it,
add the entry. The staged builder projects for the first two voices are
recorded in the 2026-08-21 plan doc.
"""

from __future__ import annotations

import io
import logging
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

# One entry per shipped adapter. Fields (all required):
#   id            slug, unique, becomes the adapter dir name
#   name          the voice's display name
#   gender        "male" | "female" — the voice record's gender
#   description   one line, shown in the adapters table
#   engine        the engine that renders it (e.g. "qwen3")
#   variant       the checkpoint family it was trained on (e.g. "qwen3-base-1.7b")
#   language      BCP-47-ish code the adapter was trained at
#   epochs / final_loss / sample_count   the run's facts, shown in the table
#   url           direct download of the adapter ZIP
#   size_bytes    exact byte size of that ZIP
BUILTIN_ADAPTERS: list[dict] = [
    # Empty until the first in-house voices are trained and published —
    # the two candidate datasets are staged in the Dataset Builder.
]

# Files an adapter ZIP must contain to be usable — the same contract the
# qwen3 engine enforces at render (_lora_clone_prompt refuses without them).
_REQUIRED_FILES = ("ref_sample.wav", "training_meta.json")

_MAX_ADAPTER_ZIP_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB — far above any real adapter


def adapters_root(data_dir: Path) -> Path:
    from .paths import training_root

    root = training_root(data_dir) / "adapters"
    root.mkdir(parents=True, exist_ok=True)
    return root


def builtin_dir(data_dir: Path, builtin_id: str) -> Path:
    return adapters_root(data_dir) / f"builtin-{builtin_id}"


def _find(builtin_id: str) -> dict | None:
    for entry in BUILTIN_ADAPTERS:
        if entry["id"] == builtin_id:
            return entry
    return None


def _voice_for(state, builtin_id: str):
    """The minted voice for a downloaded built-in, or None."""
    target = str(builtin_dir(Path(state.data_dir), builtin_id))
    for v in state.voices.list():
        if v.source == "lora" and v.adapter_path == target:
            return v
    return None


def list_builtin(state) -> list[dict]:
    """The manifest merged with this install's download state."""
    out: list[dict] = []
    for entry in BUILTIN_ADAPTERS:
        voice = _voice_for(state, entry["id"])
        downloaded = voice is not None and builtin_dir(
            Path(state.data_dir), entry["id"]
        ).is_dir()
        out.append({**entry, "downloaded": downloaded,
                    "voice_id": voice.id if voice else None})
    return out


def _fetch(url: str) -> bytes:
    """Download the adapter ZIP. Split out so tests can substitute it."""
    import httpx

    with httpx.Client(follow_redirects=True, timeout=600.0) as client:
        r = client.get(url)
        r.raise_for_status()
        if len(r.content) > _MAX_ADAPTER_ZIP_BYTES:
            raise ValueError("adapter download is larger than the 2 GB limit")
        return r.content


def download(state, builtin_id: str, *, fetch=None) -> dict:
    """Fetch the adapter's weights and mint its voice. Idempotent — a
    second call on a downloaded adapter returns the existing voice."""
    entry = _find(builtin_id)
    if entry is None:
        raise LookupError(f"no built-in adapter '{builtin_id}'")

    existing = _voice_for(state, builtin_id)
    dest = builtin_dir(Path(state.data_dir), builtin_id)
    if existing is not None and dest.is_dir():
        return {**entry, "downloaded": True, "voice_id": existing.id}

    payload = (fetch or _fetch)(entry["url"])
    try:
        z = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise ValueError(f"the download for '{entry['name']}' is not a ZIP archive")

    names = {Path(i.filename).name for i in z.infolist() if not i.is_dir()}
    missing = [f for f in _REQUIRED_FILES if f not in names]
    if missing:
        raise ValueError(
            f"the adapter ZIP for '{entry['name']}' is missing {', '.join(missing)} "
            f"— it cannot render without them"
        )

    # Extract flat (basenames only — an archive must not write outside its
    # own directory), replacing any partial earlier attempt.
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    for info in z.infolist():
        if info.is_dir():
            continue
        base = Path(info.filename).name
        if base:
            (dest / base).write_bytes(z.read(info))

    # A record that survived a lost adapter dir keeps its identity — the
    # re-download restores the FILES, it must not mint a second voice on
    # the same adapter path (review R1, reproduced: two records).
    if existing is not None:
        log.info("built-in adapter '%s' re-downloaded → voice %s kept", builtin_id, existing.id)
        return {**entry, "downloaded": True, "voice_id": existing.id}

    from .models import VoiceRecord

    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=entry["engine"],
        source="lora",
        name=entry["name"],
        language=entry.get("language") or "en-US",
        gender=entry.get("gender"),
        adapter_path=str(dest),
        created_at=now,
        updated_at=now,
    )
    created = state.voices.create(rec)
    log.info("built-in adapter '%s' installed → voice %s", builtin_id, created.id)
    return {**entry, "downloaded": True, "voice_id": created.id}
