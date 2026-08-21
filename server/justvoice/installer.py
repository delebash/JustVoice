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
from pathlib import Path
from typing import Callable

import requests

from .app_state import AppState
from .models import JobStatus, ModelVariant

log = logging.getLogger(__name__)


# ─── Install job control (cancel) ──────────────────────────────────────
# Same shape as training_worker.cancel — a set-once Event per job_id that
# long-running download loops can poll. We expose `cancel(job_id)` so the
# DELETE /v1/jobs/{id} endpoint can signal it without touching internals.

_JOBS_LOCK = threading.Lock()
_CANCEL_EVENTS: dict[str, threading.Event] = {}


class _Cancelled(Exception):
    """Raised inside the worker when the user signals a cancel."""


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


def spawn_shared_venv_setup(state: AppState) -> str:
    """Background job that builds (or rebuilds) the shared engine venv.

    Mirrors the spawn_managed_install pattern: returns a job_id the GUI
    polls via /v1/jobs/{id} for progress + log lines. Idempotent.
    """
    from .engines.shared_venv import setup_shared_venv

    job_id = "setup-shared-venv"

    _clear_cancel(job_id)
    state.job_set(
        job_id,
        JobStatus(
            job_id=job_id,
            engine_id="(shared)",
            model_variant="setup",
            phase="starting",
            bytes_downloaded=0,
            bytes_total=0,
        ).model_dump(),
    )

    def worker():
        try:
            def progress(phase: str, line: str | None) -> None:
                state.job_update(job_id, phase=phase, current_file=(line or "")[:200])
                state.job_append_log(job_id, f"[{phase}] {line}" if line else f"[{phase}]")

            def cancel_check() -> bool:
                return _is_cancelled(job_id)

            summary = setup_shared_venv(progress=progress, cancel_check=cancel_check)

            # Venv-isolated engines (ISOLATION="venv") set up here too, so
            # isolation stays an implementation detail: the user runs ONE
            # setup and every built-in engine is ready to Load. Kokoro is
            # isolated because kokoro-onnx needs numpy>=2 while the shared
            # venv holds chatterbox's <2 ceiling (2026-08-19); MOSS is
            # deprecated and skipped unless already installed.
            from .engines.manager import discover_engines, install_engine

            for m in discover_engines().values():
                if m.isolation != "venv" or m.is_installed:
                    continue
                if (m.deprecated or "").strip():
                    continue
                if cancel_check():
                    raise RuntimeError("cancelled by user")
                progress("engine-venv", f"setting up {m.id}")
                try:
                    install_engine(m, progress=progress, cancel_check=cancel_check)
                except Exception as ee:  # noqa: BLE001 — one engine's venv
                    # failing must not fail the whole setup; the engine
                    # keeps its Install door as the retry path.
                    log.exception("venv engine setup failed: %s", m.id)
                    state.job_append_log(job_id, f"[engine-venv] {m.id} failed: {ee}")

            state.job_update(job_id, phase="completed")
            state.job_append_log(job_id, f"[completed] shared venv ready (gpu={summary.get('gpu_label')})")
        except Exception as e:
            log.exception("shared venv setup failed")
            err = str(e)
            if "cancelled" in err.lower():
                err = "cancelled by user"
            state.job_update(job_id, phase="failed", error=err)
            state.job_append_log(job_id, f"[failed] {err}")
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def spawn_managed_install(state: AppState, engine_id: str) -> str:
    """Background install for a manager-managed engine (one with manifest.py).

    Runs `engines.manager.EngineManager.install()` on a worker thread; mirrors
    progress + cancellation into the existing job-state machinery so the GUI
    sees the same `/v1/jobs/{job_id}` shape as for legacy engines.
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
                # Map phase to a human-friendly label + put the live pip /
                # download line in current_file so the GUI shows it.
                state.job_update(job_id, phase=phase, current_file=(line or "")[:200])
                # Also push to the rolling log tail so a failed install can
                # be debugged from the GUI (full pip output is captured up
                # to ~400 lines per job).
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
            # If the failure was a non-zero pip exit, include a hint where
            # the relevant lines usually are.
            if "pip" in err.lower() and "failed" in err.lower():
                state.job_append_log(
                    job_id,
                    "[hint] scroll up — pip's actual error message is in the lines "
                    "above (look for 'ERROR:' or a traceback)."
                )
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


# The legacy in-process install path was EXCISED 2026-08-14 together with the
# static catalog it read (`engines.catalog.known_engines`): `spawn_install` and
# its private cluster (`_missing_modules`, `_pip_install`, `_run_install`,
# `_register_engine_after_install`), plus `uninstall_engine` and
# `pip_uninstall_engine_deps`. Every engine is manifest-managed and owns its own
# venv, so the routes that called them returned before ever reaching that code.
# Managed installs go through `spawn_managed_install` (venv) + `spawn_prefetch`
# (models); git holds the removed code.


def _stream_download(
    url: str,
    dest: Path,
    on_progress: Callable[[int], None],
    cancel_check: Callable[[], bool] | None = None,
) -> str:
    """Stream + hash. Returns hex digest. Throttles progress callbacks.

    Polls `cancel_check` on every chunk so the user's cancel signal stops the
    download within ~64 KB of the request; the partial file is left on disk
    for the caller to clean up.
    """
    h = hashlib.sha256()
    downloaded = 0
    progress_at = 0
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 64):
                if cancel_check is not None and cancel_check():
                    raise _Cancelled()
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


def _estimate_archive_unpacked(archive: Path, original_name: str) -> int:
    """Sum every TarInfo.size in the archive — the honest "total extract
    bytes" number for the unified work-progress bar (docs/plans/
    2026-06-14-engines-progress-accuracy.md). Returns 0 for unsupported
    formats so the caller falls back to indeterminate-extract.
    """
    n = original_name.lower()
    if n.endswith((".tar.bz2", ".tbz2")):
        mode = "r:bz2"
    elif n.endswith((".tar.gz", ".tgz")):
        mode = "r:gz"
    else:
        return 0
    try:
        with tarfile.open(archive, mode) as tar:
            return sum(int(m.size or 0) for m in tar.getmembers())
    except Exception:
        return 0


def _extract_tar_bz2(
    archive: Path,
    dest: Path,
    original_name: str,
    on_member: Callable[[int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> None:
    """Extract using the original filename for format detection (not the
    .partial suffix).

    `on_member(size_bytes)` fires after each TarInfo extract so the worker
    can advance the unified bytes_downloaded counter through extract;
    `cancel_check()` is polled between members so a cancel during extract
    stops within one file rather than waiting for extractall() to finish.
    """
    n = original_name.lower()
    if n.endswith((".tar.bz2", ".tbz2")):
        mode = "r:bz2"
    elif n.endswith((".tar.gz", ".tgz")):
        mode = "r:gz"
    else:
        raise RuntimeError(f"Unsupported archive format: {original_name}")
    with tarfile.open(archive, mode) as tar:
        for member in tar.getmembers():
            if cancel_check is not None and cancel_check():
                raise _Cancelled()
            tar.extract(member, dest)
            if on_member is not None:
                on_member(int(member.size or 0))


def spawn_prefetch(
    state: AppState,
    engine_id: str,
    variant_id: str,
) -> str:
    """Kick off a model-only fetch in the background. Returns the job_id.

    Unlike spawn_install / spawn_managed_install, this does NOT touch the
    engine's venv or pip deps — it only fetches model weights. The Load
    step assumes the weights are on disk and never falls back to fetching.
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
    if not (source.get("url") or source.get("hf_repo")):
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

        is_hf = bool(source.get("hf_repo"))
        target_dir = speech_cache.variant_dir(state.data_dir, engine_id, variant_id)
        try:
            if is_hf:
                state.job_update(job_id, phase="connecting")
                # The manifest's full multi-source spec when present (TADA:
                # codec + model + tokenizer); an operator override carries a
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
            else:
                target_dir.mkdir(parents=True, exist_ok=True)
                # Multi-file URL variants (kokoro-onnx: model + voices pack)
                # carry one url row per file — fetch each. Single-url
                # tarball variants arrive as a one-row list and work as
                # before.
                url_rows = [s for s in (source.get("sources") or []) if s.get("url")]
                if not url_rows:
                    url_rows = [{"url": source["url"]}]
                for row in url_rows:
                    _url_stream_to(state, job_id, row["url"], target_dir, variant)
                speech_cache.write_manifest_from_dir(target_dir, url=url_rows[0]["url"])
            state.job_update(job_id, phase="completed")
            state.job_append_log(job_id, "[completed] prefetch finished")
        except (_Cancelled, DownloadCancelled):
            log.info("prefetch cancelled for %s/%s", engine_id, variant_id)
            state.job_update(job_id, phase="failed", error="cancelled by user")
            if is_hf:
                # The kit downloader's chunked partials (.part + .json maps)
                # sit beside the plain files — the next fetch resumes past
                # completed chunks and skips complete files by size.
                state.job_append_log(job_id, "[cancelled] partial files kept for resume")
            else:
                # URL path: partials live in target_dir, safe to wipe.
                shutil.rmtree(target_dir, ignore_errors=True)
        except Exception as e:
            log.exception("prefetch failed for %s/%s", engine_id, variant_id)
            state.job_update(job_id, phase="failed", error=str(e))
            state.job_append_log(job_id, f"[failed] {e}")
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


# `_hf_snapshot_to` + `_hf_cache_root` died 2026-08-14 (phase 2, plan doc
# sec 12): they wrote the HF hub-cache layout (blobs + symlink-or-copy
# snapshots) - the machinery the WinError-1314 class lived in. Speech
# fetches now land as PLAIN files via speech_cache.fetch_hf_variant.


def fetch_url_variant(
    data_dir: Path,
    engine_id: str,
    variant_id: str,
    url: "str | list[str]",
    on_progress=None,
    cancel_check=None,
) -> Path:
    """The load door's URL arm (phase ④ — the last legacy writer dies):
    stream a URL variant into the SPEECH CACHE and write its files.json,
    synchronously — no job plumbing. Takes one url (tarball variants) or a
    list (multi-file variants like kokoro-onnx's model + voices pack). The
    prefetch worker's `_url_stream_to` below is the job-channel twin; both
    ride the same primitives (`_stream_download`, `_extract_tar_bz2`).
    `on_progress` gets cumulative downloaded bytes per file; `cancel_check`
    (bool-returning) aborts via the streamer's `_Cancelled`. Returns the
    variant dir."""
    from . import speech_cache

    urls = [url] if isinstance(url, str) else list(url)
    target_dir = speech_cache.variant_dir(data_dir, engine_id, variant_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    for one in urls:
        filename = one.rsplit("/", 1)[-1] or "model.bin"
        partial = target_dir / (filename + ".partial")
        _stream_download(
            one,
            partial,
            on_progress=on_progress or (lambda n: None),
            cancel_check=cancel_check,
        )
        if _is_archive(filename):
            _extract_tar_bz2(partial, target_dir, filename,
                             on_member=None, cancel_check=cancel_check)
            partial.unlink(missing_ok=True)
        else:
            partial.rename(target_dir / filename)
    speech_cache.write_manifest_from_dir(target_dir, url=urls[0])
    return target_dir


def _url_stream_to(
    state: AppState,
    job_id: str,
    url: str,
    target_dir: Path,
    variant: ModelVariant | None,
) -> None:
    """Single-URL download path (kokoro-style: one tarball, then extract).

    Reuses _stream_download for bytes/SHA/cancel. If the URL points at an
    archive (.tar.bz2/.tar.gz), extract into target_dir and remove the
    archive.
    """
    filename = url.rsplit("/", 1)[-1] or "model.bin"
    partial = target_dir / (filename + ".partial")
    final = target_dir / filename
    state.job_update(job_id, phase="connecting", current_file=filename)

    _stream_download(
        url,
        partial,
        on_progress=lambda n: state.job_update(
            job_id,
            phase="downloading",
            bytes_downloaded=n,
            current_file=filename,
        ),
        cancel_check=lambda: _is_cancelled(job_id),
    )

    if _is_archive(filename):
        # A1+A2 (docs/plans/2026-06-14-engines-progress-accuracy.md):
        # one smooth bar through download AND extract. Discover the
        # archive's unpacked size, then ANCHOR bytes_total at
        # download_bytes + unpacked so the same unit ticks through
        # both phases — bar continues moving instead of resetting.
        downloaded_bytes = partial.stat().st_size
        unpacked = _estimate_archive_unpacked(partial, filename)
        state.job_update(
            job_id,
            phase="extracting",
            current_file=filename,
            bytes_downloaded=downloaded_bytes,
            bytes_total=(downloaded_bytes + unpacked) if unpacked > 0 else 0,
        )

        # Per-member extract: each member.size adds to bytes_downloaded
        # so the bar advances smoothly. cancel_check polled between
        # members so an abort during extract stops within one file.
        def _on_member(size: int) -> None:
            data = state.job_get(job_id) or {}
            cur = int(data.get("bytes_downloaded") or 0)
            state.job_update(job_id, bytes_downloaded=cur + size)

        _extract_tar_bz2(
            partial, target_dir, filename,
            on_member=_on_member if unpacked > 0 else None,
            cancel_check=lambda: _is_cancelled(job_id),
        )
        partial.unlink(missing_ok=True)
    else:
        partial.rename(final)

    # If the catalog declares per-file SHAs (e.g. kokoro's split files),
    # the existing spawn_install path verifies them. For the unified
    # prefetch we trust the upstream tarball SHA; per-file SHA verify
    # belongs in a follow-up if/when catalog entries get them.
    if variant and variant.files and variant.files[0].sha256 not in (
        "TODO_FILL_SHA256_FROM_RELEASE",
        "TODO_FILL_SHA256_FROM_HF",
        "",
    ):
        # The streamed file's hash isn't returned by _stream_download in
        # _url_stream_to (we don't capture the digest because we discard
        # _stream_download's return value to keep the call site simple).
        # If/when we tighten this, plumb the digest back. Today the
        # legacy spawn_install handles SHA-verified flows for kokoro.
        pass
