# SPDX-License-Identifier: MIT
"""GET/PUT /v1/speech-runtime — the one audio.cpp runtime every speech engine shares.

The AI page's runtime row reads this: which release, which backend this machine runs
(CUDA, Vulkan, CPU, Metal), whether it is installed, and whether its processes are up —
the GPU one and, since CPU placement (2026-10-02), the CPU one for models placed there.
Installing goes through any audio.cpp engine's Install (POST /v1/engines/{id}/install),
which installs the runtime once for all of them
(docs/plans/2026-10-01-audiocpp-switch.md §3.1). PUT changes the backend or GPU — it
saves the setting, frees every speech slot and stops both processes, so the next load
starts the chosen build — or the CPU process's threads, which frees only the models on
the CPU and stops only that process. The CPU bar (`cpu_min_realtime`) restarts nothing.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..app_state import get_state
from ..errors import bad_request
from ..models import SpeechRuntimeSettings

log = logging.getLogger(__name__)

router = APIRouter(tags=["engines"])


class JapaneseDictionaryInfo(BaseModel):
    installed: bool
    version: str
    size_bytes: int                  # on disk once installed
    download_bytes: int


class SpeechRuntimeInfo(BaseModel):
    runtime: str = "audio.cpp"
    version: str                     # the installed release, else the pinned one
    installed: bool
    # The pinned release when an older one is installed — the runtime row offers
    # "Update to <it>"; the older build keeps working until then (2026-10-03).
    update_to: str | None = None
    backend: str | None = None       # "cuda" | "vulkan" | "cpu" | "metal" — the build in use
    build: str | None = None         # the build key ("cuda12", "vulkan", …)
    # `npm run dev`: the checkout the development build came from ("..\audio.cpp"), else None.
    # `version` is then "dev · <commit>" (decided 2026-10-03, D4).
    dev_source: str | None = None
    backend_setting: str = "auto"    # settings.engines.speech_runtime.backend
    backends: list[str] = []         # the builds audio.cpp publishes for this OS
    gpu: int = 0                     # settings.engines.speech_runtime.gpu
    gpus: list[str] = []             # this machine's GPUs, by index
    running: bool = False
    pid: int | None = None
    models_known: int = 0            # installed models the server may load
    # The CPU process (CPU placement, 2026-10-02).
    cpu_threads: int = 0             # the setting; 0 = the physical core count
    cpu_threads_used: int = 0        # what the CPU process runs with
    physical_cores: int = 0
    cpu_min_realtime: float = 2.0    # Auto's bar for the CPU
    cpu_running: bool = False
    cpu_pid: int | None = None
    # The optional Japanese dictionary (gap 7) — None while the pinned runtime cannot use it.
    japanese_dictionary: JapaneseDictionaryInfo | None = None


def _japanese_dictionary() -> JapaneseDictionaryInfo | None:
    from ..engines.audiocpp import japanese, release
    from ..engines.manager import engines_runtime_root

    if not release.pinned_has("japanese"):
        return None
    return JapaneseDictionaryInfo(installed=japanese.dictionary_dir(engines_runtime_root()) is not None,
                                  version=japanese.VERSION, size_bytes=japanese.INSTALLED_BYTES,
                                  download_bytes=japanese.DOWNLOAD_BYTES)


def _info() -> SpeechRuntimeInfo:
    from ..engines.audiocpp import dev_build, release
    from ..engines.audiocpp.runtime import (
        _hardware,
        _settings,
        available_backends,
        backend_of,
        cpu_threads,
        get_server,
        installed_exe,
        installed_tag,
        physical_cores,
        selected_asset,
    )

    exe = installed_exe()
    tag = installed_tag() if exe is not None else None
    dev = dev_build.current()
    asset = selected_asset() if exe is None and dev is None else None
    srv = get_server("gpu")
    cpu = get_server("cpu")
    known = len(srv._run.models) if srv.is_running() and srv._run else 0
    s = _settings()
    try:
        gpus = [g.name for g in (getattr(_hardware(), "gpus", None) or [])]
    except Exception:  # noqa: BLE001 — no kit / detection failed → no list
        gpus = []
    if dev is not None:
        # The development build: its own version and backend, never an update.
        version, update_to, backend, build = dev.version, None, dev.backend, None
    else:
        version = tag or release.TAG
        update_to = release.TAG if tag is not None and tag != release.TAG else None
        backend = backend_of(exe) if exe else (None if asset is None else
                                               ("cuda" if asset.gpu.startswith("cuda") else asset.gpu))
        build = exe.parent.name if exe else (asset.gpu if asset else None)
    return SpeechRuntimeInfo(
        version=version,
        installed=exe is not None,
        update_to=update_to,
        backend=backend,
        build=build,
        dev_source=dev.source if dev is not None else None,
        backend_setting=s.backend or "auto",
        backends=available_backends(),
        gpu=s.gpu,
        gpus=gpus,
        running=srv.is_running(),
        pid=srv.pid,
        models_known=known,
        cpu_threads=s.cpu_threads,
        cpu_threads_used=cpu_threads(),
        physical_cores=physical_cores(),
        cpu_min_realtime=s.cpu_min_realtime,
        cpu_running=cpu.is_running(),
        cpu_pid=cpu.pid,
        japanese_dictionary=_japanese_dictionary(),
    )


@router.post("/v1/speech-runtime/japanese-dictionary", status_code=202)
def install_japanese_dictionary() -> dict:
    """Start the Japanese dictionary's download; poll /v1/jobs/{job_id}."""
    from ..engines.audiocpp import release
    from ..installer import spawn_japanese_dictionary_install

    if not release.pinned_has("japanese"):
        raise bad_request("this speech runtime cannot read Japanese yet")
    return {"job_id": spawn_japanese_dictionary_install(get_state())}


# Plain `def`: hardware detection shells out once, and a PUT waits for the server to
# stop — both belong on the thread pool, not the event loop.
@router.get("/v1/speech-runtime", response_model=SpeechRuntimeInfo)
def speech_runtime() -> SpeechRuntimeInfo:
    return _info()


@router.put("/v1/speech-runtime", response_model=SpeechRuntimeInfo)
def set_speech_runtime(body: SpeechRuntimeSettings) -> SpeechRuntimeInfo:
    from ..engines.audiocpp.runtime import available_backends, forget_installed, shutdown_server
    from ..engines.manager import get_manager

    backend = (body.backend or "auto").strip().lower()
    if backend != "auto" and backend not in available_backends():
        raise bad_request(f"audio.cpp has no {backend} build for this machine")
    if body.gpu < 0:
        raise bad_request("gpu must be 0 or more")
    if body.cpu_threads < 0:
        raise bad_request("cpu_threads must be 0 (the physical core count) or more")
    if body.cpu_min_realtime <= 0:
        raise bad_request("cpu_min_realtime must be more than 0")
    store = get_state().settings
    cur = store.get()
    old = cur.engines.speech_runtime
    new = SpeechRuntimeSettings(backend=backend, gpu=body.gpu, cpu_threads=body.cpu_threads,
                                cpu_min_realtime=body.cpu_min_realtime)
    if old != new:
        cur.engines.speech_runtime = new
        store.set(cur)
        mgr = get_manager()
        build_changed = (old.backend, old.gpu) != (new.backend, new.gpu)
        threads_changed = old.cpu_threads != new.cpu_threads
        # Free the slots whose process stops (their bookings go with them), then stop
        # it — the next load starts it again with the new setting.
        for kind in ("tts", "stt"):
            slot = mgr.loaded_for(kind)
            if slot is None or not getattr(slot.manifest, "uses_audiocpp", False):
                continue
            if build_changed or (threads_changed and getattr(slot, "placement", "gpu") == "cpu"):
                mgr.unload(kind)
        if build_changed:
            shutdown_server()
            forget_installed()
            log.info("speech runtime set to %s (gpu %d); both processes stopped", backend, body.gpu)
        elif threads_changed:
            shutdown_server("cpu")
            log.info("speech runtime CPU threads set to %d; the CPU process stopped", new.cpu_threads)
    return _info()
