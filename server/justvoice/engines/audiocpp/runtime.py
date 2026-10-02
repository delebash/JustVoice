# SPDX-License-Identifier: MIT
"""The audio.cpp server processes: install the pinned binary, run the servers, call them.

Two processes at most, one per PLACEMENT (CPU placement, 2026-10-02 —
docs/plans/2026-10-02-cpu-placement.md §8): "gpu" runs the installed build on its own
backend (CUDA, Vulkan, Metal), "cpu" runs the SAME build with `backend: cpu` for the models
placed on the CPU — measured at 0 MB of graphics memory. On a machine whose runtime is the
CPU build only the "cpu" one runs. Each config lists every installed model (`lazy_load` —
nothing loads until asked); WHICH model is resident, and where, is the engine manager's
call, made with `unload()` the way it used to terminate an engine process. Installing or
deleting a model changes the list, which restarts a process on its next use (`ensure`).
The servers run headless (`--no-ui`): audio.cpp's own web UI is never shown — ours is the UI.

The binary's install is the kit's (`llm_runner.runner.binary.acquire_runtime` — the same
stage → launch-verify → atomic swap llama.cpp gets); the pinned rows are `release.py`.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

from . import release

log = logging.getLogger(__name__)

FOLDER = "audiocpp"


# ─── The binary ─────────────────────────────────────────────────────────────


def _runtime_root() -> Path:
    from ..manager import engines_runtime_root

    return engines_runtime_root()


_HW = None
_INSTALLED: dict[str, Path | None] = {}


def _hardware():
    """The kit's hardware snapshot, once per process (detection shells out to nvidia-smi)."""
    global _HW
    if _HW is None:
        from llm_runner.runner.hardware import detect

        _HW = detect()
    return _HW


def forget_installed() -> None:
    """Drop the cached install answer — after an install, uninstall or backend change."""
    _INSTALLED.clear()


def _settings():
    """settings.engines.speech_runtime, or the defaults when there is no app state
    (unit tests, mid-boot)."""
    from ...models import SpeechRuntimeSettings

    try:
        from ...app_state import get_state

        return get_state().settings.get().engines.speech_runtime
    except Exception:  # noqa: BLE001 — no state → defaults
        return SpeechRuntimeSettings()


def configured_backend() -> str:
    """The operator's backend choice; "" = auto (this machine decides)."""
    b = (_settings().backend or "").strip().lower()
    return "" if b in ("", "auto") else b


def configured_gpu() -> int:
    return max(0, int(_settings().gpu or 0))


def physical_cores() -> int:
    """This machine's physical core count (psutil; the logical count when it cannot
    tell) — the CPU process's default thread count."""
    try:
        import psutil

        n = psutil.cpu_count(logical=False)
    except Exception:  # noqa: BLE001 — psutil missing or the platform cannot say
        n = None
    return max(1, int(n or os.cpu_count() or 1))


def cpu_threads() -> int:
    """settings.engines.speech_runtime.cpu_threads, 0 = the physical core count."""
    n = int(_settings().cpu_threads or 0)
    return n if n > 0 else physical_cores()


def cpu_min_realtime() -> float:
    """Auto's bar for the CPU — seconds of audio per second of work (decided: 2×)."""
    return float(_settings().cpu_min_realtime or 2.0)


def available_backends() -> list[str]:
    """The backends audio.cpp publishes a build of for this OS (the runtime row's choices)."""
    hw = _hardware()
    out: list[str] = []
    for b in release.binaries():
        if b.platform != hw.platform:
            continue
        name = "cuda" if b.gpu.startswith("cuda") else b.gpu
        if name not in out:
            out.append(name)
    return out


def selected_asset(backend: str | None = None):
    """The build for this box: `backend` ("cuda", "vulkan", "cpu", "metal") pins the
    family; empty lets the kit's GPU preference choose (CUDA on NVIDIA, Vulkan on
    AMD/Intel, Metal on a Mac). None = the operator's setting."""
    from llm_runner.runner.binary import concrete_gpu, select_runtime_asset

    if backend is None:
        backend = configured_backend()
    hw = _hardware()
    rows = release.binaries()
    if backend:
        key = concrete_gpu(hw, backend)
        return next((b for b in rows if b.platform == hw.platform and b.gpu == key), None)
    return select_runtime_asset(rows, hw)


def installed_exe(backend: str | None = None) -> Path | None:
    """The installed server for this box at the pinned tag, or None — never downloads.
    None = the operator's backend setting."""
    from llm_runner.runner.binary import installed_runtime_exe

    if backend is None:
        backend = configured_backend()
    if backend in _INSTALLED:
        exe = _INSTALLED[backend]
        if exe is None or exe.is_file():
            return exe
    asset = selected_asset(backend)
    exe = None if asset is None else installed_runtime_exe(_runtime_root(), FOLDER, release.TAG, asset)
    _INSTALLED[backend] = exe
    return exe


def install(
    backend: str | None = None,
    *,
    force: bool = False,
    on_progress: Callable[[int, int | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> Path:
    """Download + verify + swap in the pinned build for this box (idempotent)."""
    from llm_runner.runner.binary import acquire_runtime

    from ...speech_cache import _download_kwargs

    asset = selected_asset(backend)
    if asset is None:
        which = backend if backend is not None else configured_backend()
        raise RuntimeError(f"audio.cpp has no {which + ' ' if which else ''}build for this machine")
    return acquire_runtime(
        _runtime_root(), FOLDER, release.TAG, release.binaries(), _hardware(),
        gpu=asset.gpu, force=force, dl_kwargs=_download_kwargs(),
        on_progress=on_progress, cancel_check=cancel_check,
        # `--version` alone proves the DLLs load; this proves the flags we launch with exist.
        probe_argvs=[["--no-ui", "--max-loaded-models", "0", "--version"]],
    )


def backend_of(exe: Path) -> str:
    """The audio.cpp backend for an installed exe's variant dir (`…/<tag>/<gpu>/`)."""
    gpu = exe.parent.name
    return "cuda" if gpu.startswith("cuda") else gpu


# ─── The process ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ModelEntry:
    """One model the server may load — an installed variant of one of our engines."""

    id: str                      # our variant id
    family: str                  # audio.cpp family ("qwen3_tts", "chatterbox", …)
    task: str                    # "tts" | "clon" | "vdes" | "asr" | "align"
    path: str                    # the GGUF file in the speech cache
    session_options: tuple[tuple[str, Any], ...] = ()

    def to_config(self) -> dict:
        row: dict[str, Any] = {"id": self.id, "family": self.family, "task": self.task,
                               "mode": "offline", "path": self.path}
        if self.session_options:
            row["session_options"] = dict(self.session_options)
        return row


@dataclass
class _Running:
    proc: subprocess.Popen
    port: int
    signature: str
    log_path: Path
    models: dict[str, ModelEntry] = field(default_factory=dict)
    job: Any = None              # the Windows kill-on-close Job Object handle (kit), or None


class AudioCppError(RuntimeError):
    """An audio.cpp request failed; the message is the server's own words."""


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AudioCppServer:
    """One server process — the "gpu" or the "cpu" placement. Thread-safe; every method
    may start it."""

    def __init__(self, placement: str = "gpu") -> None:
        self.placement = placement
        self._lock = threading.RLock()
        self._run: _Running | None = None

    def _file_stem(self) -> str:
        # The GPU process keeps the names it has always had.
        return "audiocpp-server" if self.placement == "gpu" else f"audiocpp-server-{self.placement}"

    # -- lifecycle --

    def ensure(self, exe: Path, models: list[ModelEntry], *, data_dir: Path, device: int = 0,
               threads: int = 4, backend: str | None = None) -> None:
        """Running with exactly this model list (restart if it changed). `backend`
        overrides the build's own (the "cpu" process runs a GPU build on the CPU)."""
        cfg = {
            "host": "127.0.0.1", "backend": backend or backend_of(exe), "device": device,
            "threads": threads, "lazy_load": True, "max_loaded_models": 0,
            "models": [m.to_config() for m in sorted(models, key=lambda m: m.id)],
        }
        signature = json.dumps({"exe": str(exe), **cfg}, sort_keys=True)
        with self._lock:
            if self._run and self._run.signature == signature and self._run.proc.poll() is None:
                return
            self.stop()
            port = _free_port()
            conf_dir = data_dir / "engines-runtime-config"
            conf_dir.mkdir(parents=True, exist_ok=True)
            conf_path = conf_dir / f"{self._file_stem()}.json"
            conf_path.write_text(json.dumps({**cfg, "port": port}, indent=1), encoding="utf-8")
            log_path = data_dir / "logs" / f"{self._file_stem()}.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            out = open(log_path, "ab")  # noqa: SIM115 — owned by the child for its lifetime
            # Who started it — `engines/leftovers.py` reads this to stop a server whose
            # parent is gone (a hard-killed app must not leave a model in VRAM).
            env = {**os.environ, "JUSTVOICE_SERVER_PID": str(os.getpid())}
            # The kit's one spawn seam: on Windows the child goes into a kill-on-close
            # Job Object, so it dies WITH this process however this process dies (the
            # Python engines watched their server; audio.cpp does not), and a freshly
            # installed binary still held by the virus scanner is retried.
            from llm_runner.runner.process import spawn_child

            popen = functools.partial(subprocess.Popen, cwd=str(exe.parent),
                                      creationflags=flags, env=env)
            proc, job = spawn_child(popen, [str(exe), "--config", str(conf_path), "--no-ui"], out)
            self._run = _Running(proc, port, signature, log_path, {m.id: m for m in models}, job)
            self._wait_healthy()
            log.info("audio.cpp %s (%s) up on :%d (pid %d, %s, %d threads, %d models)",
                     release.TAG, self.placement, port, proc.pid, cfg["backend"], threads, len(models))

    def _wait_healthy(self, timeout: float = 60.0) -> None:
        run = self._run
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if run.proc.poll() is not None:
                raise AudioCppError(f"audio.cpp exited with {run.proc.returncode}: {self.log_tail()}")
            try:
                if httpx.get(f"http://127.0.0.1:{run.port}/health", timeout=2).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        raise AudioCppError(f"audio.cpp did not answer within {timeout:.0f}s: {self.log_tail()}")

    def stop(self) -> None:
        from llm_runner.runner.process import close_job

        with self._lock:
            run, self._run = self._run, None
        if run is None:
            return
        if run.proc.poll() is None:
            run.proc.terminate()
            try:
                run.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                run.proc.kill()
                run.proc.wait(timeout=10)
        close_job(run.job)

    def is_running(self) -> bool:
        return self._run is not None and self._run.proc.poll() is None

    @property
    def pid(self) -> int | None:
        return self._run.proc.pid if self.is_running() else None

    def has_model(self, model_id: str) -> bool:
        return self._run is not None and model_id in self._run.models

    def log_tail(self, lines: int = 12) -> str:
        if self._run is None:
            return ""
        try:
            text = self._run.log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        keep = [ln for ln in text.splitlines() if "SERVER_HTTP_DEBUG" not in ln and "TIMING" not in ln]
        return "\n".join(keep[-lines:])

    # -- requests --

    def _url(self, path: str) -> str:
        if not self.is_running():
            raise AudioCppError("audio.cpp is not running")
        return f"http://127.0.0.1:{self._run.port}{path}"

    @staticmethod
    def _raise_for(r: httpx.Response) -> None:
        if r.status_code < 400:
            return
        try:
            msg = r.json().get("error", {}).get("message") or r.text
        except ValueError:
            msg = r.text
        raise AudioCppError(msg[:500])

    def speech(self, body: dict, timeout: float = 900.0) -> tuple[bytes, dict]:
        r = httpx.post(self._url("/v1/audio/speech"), json=body, timeout=timeout)
        self._raise_for(r)
        return r.content, dict(r.headers)

    def transcribe(self, body: dict, timeout: float = 600.0) -> dict:
        r = httpx.post(self._url("/v1/audio/transcriptions/details"), json=body, timeout=timeout)
        self._raise_for(r)
        return r.json()

    def align(self, model: str, wav: bytes, text: str, language: str, timeout: float = 600.0) -> dict:
        r = httpx.post(self._url("/v1/audio/alignments"),
                       data={"model": model, "text": text, "language": language},
                       files={"file": ("audio.wav", wav, "audio/wav")}, timeout=timeout)
        self._raise_for(r)
        return r.json()

    def unload(self, model_ids: list[str]) -> None:
        if not self.is_running() or not model_ids:
            return
        r = httpx.post(self._url("/v1/tasks/unload_models"), json={"model_ids": model_ids}, timeout=120)
        self._raise_for(r)

    def unload_all(self) -> None:
        if not self.is_running():
            return
        r = httpx.post(self._url("/v1/tasks/unload_all_models"), timeout=120)
        self._raise_for(r)


PLACEMENTS = ("gpu", "cpu")
_servers: dict[str, AudioCppServer] = {}
_server_lock = threading.Lock()


def get_server(placement: str = "gpu") -> AudioCppServer:
    """The server for one placement ("gpu" | "cpu"), created on first use (not started)."""
    if placement not in PLACEMENTS:
        raise ValueError(f"unknown placement {placement!r}")
    with _server_lock:
        srv = _servers.get(placement)
        if srv is None:
            srv = _servers[placement] = AudioCppServer(placement)
        return srv


def shutdown_server(placement: str | None = None) -> None:
    """Stop one placement's server, or both (None)."""
    with _server_lock:
        srvs = [s for p, s in _servers.items() if placement in (None, p)]
    for srv in srvs:
        srv.stop()
