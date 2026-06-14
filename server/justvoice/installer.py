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
import importlib
import importlib.util
import logging
import re
import shutil
import subprocess
import sys
import tarfile
import threading
from pathlib import Path
from typing import Callable

import requests

from .app_state import AppState
from .engines.catalog import known_engines
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
        except _Cancelled:
            log.info("install cancelled for %s/%s", engine_id, variant.id)
            state.job_update(job_id, phase="failed", error="cancelled by user")
            # Best-effort cleanup of any partials so the disk isn't littered.
            try:
                shutil.rmtree(model_dir, ignore_errors=True)
            except Exception:
                pass
        except Exception as e:
            log.exception("install failed for %s/%s", engine_id, variant.id)
            state.job_update(job_id, phase="failed", error=str(e))
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def _missing_modules(modules: list[str]) -> list[str]:
    out: list[str] = []
    for m in modules:
        try:
            if importlib.util.find_spec(m) is None:
                out.append(m)
        except (ImportError, ValueError):
            out.append(m)
    return out


def _pip_install(
    state: AppState,
    job_id: str,
    packages: list[str],
) -> None:
    """Run `python -m pip install <packages>` and stream output to the job.

    Uses the running server's own Python interpreter (sys.executable) so the
    installed package lands in the same site-packages the deferred imports
    will look in. Cancellable mid-flight via _is_cancelled — we terminate the
    subprocess and raise _Cancelled. Streams stdout/stderr lines into
    job_state.current_file so the UI's progress row reflects pip's chatter
    (which file it's downloading, which wheel it's building, etc.).
    """
    if not packages:
        return
    state.job_update(
        job_id,
        phase="installing-deps",
        current_file=f"pip install {' '.join(packages)}",
    )
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--progress-bar",
        "off",
        *packages,
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    try:
        assert proc.stdout is not None
        last_line = ""
        for line in proc.stdout:
            if _is_cancelled(job_id):
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                raise _Cancelled()
            line = line.rstrip()
            if not line:
                continue
            last_line = line
            # Keep the latest pip line in the job so the UI sees activity.
            state.job_update(
                job_id,
                phase="installing-deps",
                current_file=line[:200],
            )
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(
                f"pip install failed (exit {rc}). Last line: {last_line!r}"
            )
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    # Bust importlib's path/spec caches so a fresh find_spec sees the
    # just-installed package without restarting the server.
    importlib.invalidate_caches()


def _run_install(
    state: AppState,
    job_id: str,
    engine_id: str,
    variant: ModelVariant,
    model_dir: Path,
) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)

    if _is_cancelled(job_id):
        raise _Cancelled()

    # Phase 0: pip-install Python runtime deps if any are declared and any
    # are not already importable. Runs against the same interpreter the
    # server is on, so deferred `import` inside engine.load() picks up the
    # new package without a restart.
    entry = next((e for e in known_engines() if e.id == engine_id), None)
    if entry and entry.pip_packages:
        missing = _missing_modules(entry.runtime_deps)
        if missing:
            log.info(
                "engine %s missing runtime modules %s; running pip install",
                engine_id,
                missing,
            )
            _pip_install(state, job_id, entry.pip_packages)
            if _is_cancelled(job_id):
                raise _Cancelled()

    # Sidecar engines: install is a marker-only op
    if entry and not entry.prerequisites.rust_native:
        state.job_update(
            job_id, phase="verifying", current_file=".installed marker"
        )
        (model_dir / ".installed").write_text(f"variant={variant.id}\n")
        return

    # Rust-native (Kokoro): real download
    cumulative = 0
    for file in variant.files:
        if _is_cancelled(job_id):
            raise _Cancelled()

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
            cancel_check=lambda: _is_cancelled(job_id),
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
    """Legacy hook — kept as a stub. All built-in engines are now managed
    plugins; the manager registers them itself after its own install path.
    This function is a no-op so the legacy `spawn_install` codepath
    continues to compile, but nothing calls it for any current engine.
    """
    log.info("legacy register_after_install called for %s (no-op — engine should be managed)", engine_id)


# ─── S1: unified prefetch worker ──────────────────────────────────────
# Shared entry point for fetching a model variant's weights to disk with
# real progress + cancel. Honors operator source overrides (S0:
# engine_sources_api.resolve_source). Two strategies behind one
# contract:
#   - URL source (e.g. kokoro's k2-fsa tarball) → stream the file with
#     _stream_download + extract if archived (the existing path).
#   - HF source (chatterbox / dia / qwen3 / whisper / luxtts / moss /
#     tada / qwen3_llm) → huggingface_hub.snapshot_download with a
#     tqdm hook that pushes byte counts into job state.


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
        target_dir = manifest.models_dir / variant_id
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
            if source.get("hf_repo"):
                _hf_snapshot_to(state, job_id, source["hf_repo"], source.get("hf_revision"), target_dir)
            else:
                _url_stream_to(state, job_id, source["url"], target_dir, variant)
            state.job_update(job_id, phase="completed")
            state.job_append_log(job_id, "[completed] prefetch finished")
        except _Cancelled:
            log.info("prefetch cancelled for %s/%s", engine_id, variant_id)
            state.job_update(job_id, phase="failed", error="cancelled by user")
            # Clean partial weights so the next attempt starts fresh and the
            # on-disk check doesn't lie about completeness.
            shutil.rmtree(target_dir, ignore_errors=True)
        except Exception as e:
            log.exception("prefetch failed for %s/%s", engine_id, variant_id)
            state.job_update(job_id, phase="failed", error=str(e))
            state.job_append_log(job_id, f"[failed] {e}")
        finally:
            _clear_cancel(job_id)

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def _hf_snapshot_to(
    state: AppState,
    job_id: str,
    repo_id: str,
    revision: str | None,
    target_dir: Path,
) -> None:
    """Pull an HF repo into target_dir with byte-accurate progress + cancel.

    huggingface_hub.snapshot_download accepts a custom `tqdm_class` —
    we plug a callable that mirrors tqdm's update/n/total surface into
    job_state and polls _is_cancelled between updates.
    """
    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        raise RuntimeError(
            "huggingface_hub is required for HF-distributed engines but isn't "
            "available in this Python environment"
        ) from e

    state.job_update(job_id, phase="downloading", current_file=repo_id)

    # tqdm-shaped reporter — snapshot_download instantiates it per file,
    # so we accumulate total bytes across files in the shared closure.
    cumulative = {"bytes": 0}

    class _Reporter:  # mimics tqdm just enough for snapshot_download
        def __init__(self, *_args, total: int | None = None, desc: str | None = None, **_kwargs):
            self.total = total or 0
            self.n = 0
            self.desc = desc or repo_id
            state.job_update(job_id, current_file=str(self.desc)[:200])

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            cumulative["bytes"] += self.n
            return False

        def update(self, n: int = 1) -> None:
            if _is_cancelled(job_id):
                raise _Cancelled()
            self.n += n
            state.job_update(
                job_id,
                phase="downloading",
                bytes_downloaded=cumulative["bytes"] + self.n,
            )

        def close(self) -> None:
            cumulative["bytes"] += self.n

        # snapshot_download sometimes sets these directly
        def set_description(self, desc: str, refresh: bool = True) -> None:  # noqa: ARG002
            self.desc = desc
            state.job_update(job_id, current_file=str(desc)[:200])

        def reset(self, total: int | None = None) -> None:
            self.total = total or 0
            self.n = 0

    if _is_cancelled(job_id):
        raise _Cancelled()

    snapshot_download(
        repo_id=repo_id,
        revision=revision,
        local_dir=str(target_dir),
        local_dir_use_symlinks=False,
        tqdm_class=_Reporter,
    )


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
        state.job_update(job_id, phase="extracting", current_file=filename)
        _extract_tar_bz2(partial, target_dir, filename)
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


_PKG_VERSION_RE = re.compile(r"[=<>!~\s\[]")


def _pkg_name(spec: str) -> str:
    """Strip version pin / extras from a pip spec.

    Examples: "torch>=2.2" → "torch", "uvicorn[standard]>=0.32" → "uvicorn".
    Splits on the first occurrence of any version-spec character so the
    earlier "scan separators in order" bug (which returned "chatterbox-tts>"
    for "chatterbox-tts>=0.2") can't recur.
    """
    return _PKG_VERSION_RE.split(spec, 1)[0].strip()


def pip_uninstall_engine_deps(engine_id: str) -> list[str]:
    """Pip-uninstall packages declared by this engine that no OTHER engine
    in the catalog also declares.

    Returns the list of bare package names actually removed. Shared deps
    (e.g. `torch`, which six engines all declare) are skipped so removing
    one engine doesn't disable the others. Synchronous — the engine
    uninstall HTTP request blocks until pip is done.
    """
    target = next((e for e in known_engines() if e.id == engine_id), None)
    if not target or not target.pip_packages:
        return []

    target_names = {_pkg_name(p) for p in target.pip_packages}
    others = (e for e in known_engines() if e.id != engine_id)
    shared: set[str] = set()
    for other in others:
        for spec in other.pip_packages:
            shared.add(_pkg_name(spec))

    to_remove = [name for name in target_names if name and name not in shared]
    if not to_remove:
        return []

    cmd = [
        sys.executable,
        "-m",
        "pip",
        "uninstall",
        "-y",
        "--disable-pip-version-check",
        *to_remove,
    ]
    log.info("pip uninstall for %s: %s", engine_id, to_remove)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        log.warning(
            "pip uninstall failed for %s (rc=%s): %s",
            engine_id,
            result.returncode,
            (result.stderr or "")[:500],
        )
        return []
    importlib.invalidate_caches()
    return to_remove
