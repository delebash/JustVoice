"""Engine model installer — streaming download + SHA-256 verify + tar.bz2 extract.

Background-task pattern: `POST /v1/engines/{id}/install` returns 202
with a job_id; the actual download happens in a thread. Progress is
observable via `GET /v1/jobs/{job_id}`.

For sidecar engines (anything PyTorch-based), this is a marker-only
op — the Python adapter's `from_pretrained()` handles HF cache on
first load.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import tarfile
import threading
import uuid
from pathlib import Path
from typing import Callable

import requests

from .app_state import AppState
from .engines.catalog import known_engines
from .engines.external_openai import ExternalOpenAiTtsBackend
from .engines.kokoro import KokoroBackend
from .engines.model_catalog import models_for
from .models import JobStatus, ModelVariant

log = logging.getLogger(__name__)


def spawn_install(
    state: AppState,
    engine_id: str,
    variant: ModelVariant,
    model_dir: Path,
) -> str:
    """Kick off an install in the background. Returns the job_id."""
    job_id = f"install-{engine_id}-{variant.id}"
    total = sum(f.size_bytes for f in variant.files)
    state.job_set(
        job_id,
        JobStatus(
            job_id=job_id,
            engine_id=engine_id,
            model_variant=variant.id,
            phase="connecting",
            bytes_downloaded=0,
            bytes_total=total,
        ).model_dump(),
    )

    def worker():
        try:
            _run_install(state, job_id, engine_id, variant, model_dir)
            state.job_update(job_id, phase="completed", bytes_downloaded=total)
            _register_engine_after_install(state, engine_id, model_dir)
        except Exception as e:
            log.exception("install failed for %s/%s", engine_id, variant.id)
            state.job_update(job_id, phase="failed", error=str(e))

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def _run_install(
    state: AppState,
    job_id: str,
    engine_id: str,
    variant: ModelVariant,
    model_dir: Path,
) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)

    # Sidecar engines: install is a marker-only op
    entry = next((e for e in known_engines() if e.id == engine_id), None)
    if entry and not entry.prerequisites.rust_native:
        state.job_update(
            job_id, phase="verifying", current_file=".installed marker"
        )
        (model_dir / ".installed").write_text(f"variant={variant.id}\n")
        return

    # Rust-native (Kokoro): real download
    cumulative = 0
    for file in variant.files:
        # URL override from settings.models.url_overrides
        overrides = state.settings.get().models.url_overrides
        url = overrides.get(variant.id, file.url)

        state.job_update(
            job_id, phase="connecting", current_file=file.target_path
        )

        target_path = model_dir / file.target_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        partial_path = target_path.with_suffix(target_path.suffix + ".partial")

        actual_hash = _stream_download(
            url,
            partial_path,
            on_progress=lambda n: state.job_update(
                job_id,
                phase="downloading",
                bytes_downloaded=cumulative + n,
                current_file=file.target_path,
            ),
        )

        # SHA-256 verify (skip TODO placeholders)
        if file.sha256 not in (
            "TODO_FILL_SHA256_FROM_RELEASE",
            "TODO_FILL_SHA256_FROM_HF",
            "",
        ):
            state.job_update(job_id, phase="verifying")
            if actual_hash.lower() != file.sha256.lower():
                partial_path.unlink(missing_ok=True)
                raise RuntimeError(
                    f"SHA-256 mismatch for {file.target_path}: expected {file.sha256}, got {actual_hash}"
                )

        # Extract or rename
        if _is_archive(file.target_path):
            state.job_update(job_id, phase="extracting")
            _extract_tar_bz2(partial_path, model_dir, file.target_path)
            partial_path.unlink(missing_ok=True)
        else:
            partial_path.rename(target_path)

        cumulative += file.size_bytes


def _stream_download(url: str, dest: Path, on_progress: Callable[[int], None]) -> str:
    """Stream + hash. Returns hex digest. Throttles progress callbacks."""
    h = hashlib.sha256()
    downloaded = 0
    progress_at = 0
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 64):
                if not chunk:
                    continue
                f.write(chunk)
                h.update(chunk)
                downloaded += len(chunk)
                # Throttle: report ~once per MB
                if downloaded - progress_at >= 1024 * 1024:
                    on_progress(downloaded)
                    progress_at = downloaded
    on_progress(downloaded)
    return h.hexdigest()


def _is_archive(name: str) -> bool:
    n = name.lower()
    return n.endswith((".tar.bz2", ".tbz2", ".tar.gz", ".tgz"))


def _extract_tar_bz2(archive: Path, dest: Path, original_name: str) -> None:
    """Extract using the original filename for format detection (not the .partial suffix)."""
    n = original_name.lower()
    if n.endswith((".tar.bz2", ".tbz2")):
        mode = "r:bz2"
    elif n.endswith((".tar.gz", ".tgz")):
        mode = "r:gz"
    else:
        raise RuntimeError(f"Unsupported archive format: {original_name}")
    with tarfile.open(archive, mode) as tar:
        tar.extractall(dest)


def _register_engine_after_install(
    state: AppState, engine_id: str, model_dir: Path
) -> None:
    """Construct + register the real engine for the just-installed id."""
    if engine_id == "kokoro":
        kokoro = KokoroBackend(model_dir)
        if not kokoro.model_files_present():
            log.warning(
                "kokoro install reported success but model files missing at %s", model_dir
            )
            return
        state.engines.register(kokoro)
        log.info("kokoro registered post-install from %s", model_dir)
        return

    # Sidecar engines: skip live registration. They get registered when
    # the user clicks Load (the Python adapter's from_pretrained handles
    # the HF cache on first load).
    log.info("sidecar engine %s marker installed; will load on demand", engine_id)


def uninstall_engine(state: AppState, engine_id: str, model_dir: Path) -> bool:
    """Unload, remove model files, unregister."""
    if state.engines.current() == engine_id:
        engine = state.engines.get(engine_id)
        if engine:
            try:
                engine.unload()
            except Exception as e:
                log.warning("unload before uninstall failed for %s: %s", engine_id, e)
        state.engines.clear_current()

    removed = False
    if model_dir.exists():
        shutil.rmtree(model_dir, ignore_errors=True)
        removed = True

    state.engines.unregister(engine_id)
    return removed
