# SPDX-License-Identifier: MIT
"""Engine install jobs — the speech runtime, and model downloads into the speech cache.

Background-task pattern: `POST /v1/engines/{id}/install` returns 202
with a job_id; the work happens in a thread. Progress is observable via
`GET /v1/jobs/{job_id}`.

- `spawn_managed_install` — the shared speech runtime (audio.cpp + eSpeak NG),
  through `EngineManager.install` (the 2026-10-01 switch: one install for every
  engine).
- `spawn_prefetch` — one model variant's file(s) into the speech cache as plain
  files + files.json (the kit's chunked, resumable downloader).

The URL/tarball arm (kokoro-onnx's model + voices pack) went with the per-engine
runtimes on 2026-10-01: every variant is now a pinned Hugging Face file.
"""

from __future__ import annotations

import logging
import threading

from .app_state import AppState
from .models import JobStatus

log = logging.getLogger(__name__)


# ─── Install job control (cancel) ──────────────────────────────────────
# A set-once Event per job_id that
# long-running download loops can poll. We expose `cancel(job_id)` so the
# DELETE /v1/jobs/{id} endpoint can signal it without touching internals.

_JOBS_LOCK = threading.Lock()
_CANCEL_EVENTS: dict[str, threading.Event] = {}


def cancel(job_id: str) -> None:
    """Signal an install job to stop at the next safe checkpoint. Idempotent."""
    with _JOBS_LOCK:
        _CANCEL_EVENTS.setdefault(job_id, threading.Event()).set()


def _is_cancelled(job_id: str) -> bool:
    with _JOBS_LOCK:
        ev = _CANCEL_EVENTS.get(job_id)
    return ev is not None and ev.is_set()


def _clear_cancel(job_id: str) -> None:
    with _JOBS_LOCK:
        _CANCEL_EVENTS.pop(job_id, None)


def spawn_managed_install(state: AppState, engine_id: str) -> str:
    """Background install for an engine — the shared speech runtime.

    Runs `engines.manager.EngineManager.install()` on a worker thread; mirrors
    progress + cancellation into the job-state machinery the GUI polls.
    """
    from .engines.manager import get_manager

    mgr = get_manager()
    manifest = mgr.get_manifest(engine_id)
    if manifest is None:
        raise ValueError(f"no managed engine with id {engine_id}")

    # Reuse the engine id + a stable suffix so the GUI's "watch this job"
    # mapping doesn't have to deal with a UUID.
    job_id = f"install-{engine_id}-managed"

    # Reset cancel flag in case this engine was cancelled previously.
    _clear_cancel(job_id)

    state.job_set(
        job_id,
        JobStatus(
            job_id=job_id,
            engine_id=engine_id,
            model_variant="managed",
            phase="connecting",
            bytes_downloaded=0,
            bytes_total=0,
        ).model_dump(),
    )

    def worker():
        try:
            def progress(phase: str, line: str | None) -> None:
                # Put the live download line in current_file so the GUI shows
                # it, and on the rolling log tail so a failed install can be
                # debugged from the GUI.
                state.job_update(job_id, phase=phase, current_file=(line or "")[:200])
                if line:
                    state.job_append_log(job_id, f"[{phase}] {line}")
                else:
                    state.job_append_log(job_id, f"[{phase}]")

            def cancel_check() -> bool:
                return _is_cancelled(job_id)

            mgr.install(engine_id, progress=progress, cancel_check=cancel_check)
            state.job_update(job_id, phase="completed")
            state.job_append_log(job_id, "[completed] install finished successfully")
        except Exception as e:
            log.exception("managed install failed for %s", engine_id)
            err = str(e)
            phase = "failed"
            if "cancelled" in err.lower():
                err = "cancelled by user"
            state.job_update(job_id, phase=phase, error=err)
            state.job_append_log(job_id, f"[failed] {err}")
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def spawn_prefetch(
    state: AppState,
    engine_id: str,
    variant_id: str,
) -> str:
    """Kick off a model-only fetch in the background. Returns the job_id.

    Fetches the variant's pinned file(s) into the speech cache; never touches
    the runtime.
    """
    from .api.engine_sources_api import resolve_source
    from .engines.manager import get_manager
    from .engines.model_catalog import models_for

    manager = get_manager()
    manifest = manager.get_manifest(engine_id)
    if manifest is None:
        raise ValueError(f"no managed engine with id {engine_id}")

    variant = next((v for v in models_for(engine_id) if v.id == variant_id), None)
    source, provenance = resolve_source(engine_id, variant_id)
    if not source.get("hf_repo"):
        raise ValueError(
            f"engine {engine_id} variant {variant_id!r} has no download source "
            "(catalog entry has no files and there is no operator override)"
        )

    job_id = f"prefetch-{engine_id}-{variant_id}"
    _clear_cancel(job_id)
    total = (source.get("size_mb") or (variant.size_mb if variant else 0) or 0) * 1024 * 1024
    state.job_set(
        job_id,
        JobStatus(
            job_id=job_id,
            engine_id=engine_id,
            model_variant=variant_id,
            phase="connecting",
            bytes_downloaded=0,
            bytes_total=total,
        ).model_dump(),
    )
    state.job_append_log(
        job_id, f"[connecting] source={source} provenance={provenance}"
    )

    def worker() -> None:
        # Phase ② (plan doc §12): every fetch lands in the SPEECH CACHE as
        # plain files + a files.json manifest — never the HF hub-cache
        # layout (blobs + symlink-or-copy was the WinError-1314 class).
        from llm_runner.runner.download import DownloadCancelled

        from . import speech_cache

        try:
            state.job_update(job_id, phase="connecting")
            # The manifest's full multi-source spec when present (the speech-
            # recognition model + its aligner); an operator override carries a
            # single repo and no pinned files → its whole tree.
            sources = source.get("sources") or [{
                "hf_repo": source["hf_repo"],
                "revision": source.get("hf_revision"),
                "files": source.get("files")}]
            speech_cache.fetch_hf_variant(
                state.data_dir, engine_id, variant_id, sources,
                on_progress=lambda done, tot: state.job_update(
                    job_id, phase="downloading",
                    bytes_downloaded=done, bytes_total=tot,
                ),
                cancel_check=lambda: _is_cancelled(job_id),
            )
            state.job_update(job_id, phase="completed")
            state.job_append_log(job_id, "[completed] prefetch finished")
        except DownloadCancelled:
            log.info("prefetch cancelled for %s/%s", engine_id, variant_id)
            # The kit downloader's chunked partials (.part + .json maps) sit
            # beside the plain files — the next fetch resumes past completed
            # chunks and skips complete files by size.
            state.job_append_log(job_id, "[cancelled] partial files kept for resume")
            state.job_update(job_id, phase="failed", error="cancelled by user")
        except Exception as e:
            log.exception("prefetch failed for %s/%s", engine_id, variant_id)
            state.job_update(job_id, phase="failed", error=str(e))
            state.job_append_log(job_id, f"[failed] {e}")
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id
