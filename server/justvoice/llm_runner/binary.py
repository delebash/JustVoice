# SPDX-License-Identifier: GPL-3.0-or-later
"""P1.2 — llama.cpp binary acquisition.

Selects the right prebuilt `llama-server` asset from the manifest for the
detected platform + GPU, downloads it (reusing the installer's streaming
download), unpacks the zip, and returns the path to the server executable.

JustVoice-only Python (JustWrite reimplements this ~logic in its Rust shell
reading the same manifest — see docs/plans/2026-06-16-builtin-llm-runner.md
§2.2), so reusing installer/system_info/paths infra here is fine.

The github-zip path (Windows CUDA/CPU, macOS Metal) is fully wired. The
docker source (Linux CUDA) raises a clear NotImplementedError for now — a
documented later item.
"""

from __future__ import annotations

import logging
import platform
import zipfile
from pathlib import Path
from typing import Callable

from ..models import SystemInfo
from ..paths import cache_root
from .schema import BinaryAsset, RunnerManifest

log = logging.getLogger(__name__)


def _platform_key() -> str:
    sysname = platform.system().lower()
    if sysname.startswith("win"):
        return "windows"
    if sysname == "darwin":
        return "macos"
    return "linux"


def _gpu_preference(system: SystemInfo) -> list[str]:
    """Ordered GPU-asset preference for this machine, most-capable first,
    always ending in 'cpu' as the universal fallback.

    cuda13 vs cuda12: we default to cuda12 (broadest driver compatibility);
    a future refinement can promote cuda13 from the NVIDIA driver version.
    """
    rt = system.runtimes or {}
    prefs: list[str] = []
    if rt.get("metal"):
        prefs.append("metal")
    if rt.get("cuda"):
        prefs.append("cuda12")
    if rt.get("rocm"):
        prefs.append("rocm")
    if rt.get("vulkan"):
        prefs.append("vulkan")
    prefs.append("cpu")
    return prefs


def select_binary(manifest: RunnerManifest, system: SystemInfo) -> BinaryAsset | None:
    """Pick the best binary asset for (platform, gpu); None if none match.

    Tries the GPU preference order, falling back to CPU for the platform.
    """
    plat = _platform_key()
    by_gpu = {b.gpu: b for b in manifest.llamacpp.binaries if b.platform == plat}
    for gpu in _gpu_preference(system):
        if gpu in by_gpu:
            return by_gpu[gpu]
    return None


def binary_dir(data_dir: Path, build: str) -> Path:
    """Where an unpacked llama.cpp build lives (cache-like, per build tag)."""
    return cache_root(data_dir) / "llm-runner" / "llamacpp" / build


def _find_server_exe(root: Path, exe_name: str) -> Path | None:
    """Locate the server exe in the unpacked tree (zips vary: root or subdir)."""
    direct = root / exe_name
    if direct.is_file():
        return direct
    for found in root.rglob(exe_name):
        if found.is_file():
            return found
    return None


def acquired_server_exe(data_dir: Path, manifest: RunnerManifest, system: SystemInfo) -> Path | None:
    """Return the path to an already-unpacked server exe, or None."""
    asset = select_binary(manifest, system)
    if asset is None:
        return None
    return _find_server_exe(binary_dir(data_dir, manifest.llamacpp.pinned_build), asset.server_exe)


def _unzip(zip_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)


def acquire_binary(
    data_dir: Path,
    manifest: RunnerManifest,
    system: SystemInfo,
    on_progress: Callable[[int], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> Path:
    """Ensure the llama.cpp `llama-server` binary is on disk; return its path.

    Idempotent: if already unpacked for the pinned build, returns immediately.
    github-zip sources are downloaded + unzipped; docker sources raise (later).
    """
    asset = select_binary(manifest, system)
    if asset is None:
        raise RuntimeError(
            f"no llama.cpp binary in the manifest for platform={_platform_key()}"
        )

    dest = binary_dir(data_dir, manifest.llamacpp.pinned_build)
    existing = _find_server_exe(dest, asset.server_exe)
    if existing is not None:
        return existing

    if asset.source == "docker" or not asset.asset_url:
        raise NotImplementedError(
            f"binary source {asset.source!r} for {asset.platform}/{asset.gpu} "
            "is not wired yet (Linux CUDA via docker is a later item); "
            "use a github-asset binary or run an external llama-server"
        )

    # Reuse the installer's streaming download (bytes + cancel).
    from ..installer import _stream_download

    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "_download.zip"
    log.info("downloading llama.cpp %s/%s from %s", asset.platform, asset.gpu, asset.asset_url)
    _stream_download(
        asset.asset_url,
        archive,
        on_progress=on_progress or (lambda _n: None),
        cancel_check=cancel_check,
    )
    _unzip(archive, dest)
    archive.unlink(missing_ok=True)

    exe = _find_server_exe(dest, asset.server_exe)
    if exe is None:
        raise RuntimeError(
            f"{asset.server_exe} not found in the unpacked archive at {dest}"
        )
    # Ensure executable bit on POSIX.
    if _platform_key() != "windows":
        exe.chmod(exe.stat().st_mode | 0o111)
    return exe
