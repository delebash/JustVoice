# SPDX-License-Identifier: MIT
"""The audio.cpp release JustVoice runs, and the model repo it downloads from.

Both pinned: a binary or a model file is a fact about a COMMIT, not a branch. A bump is a
deliberate change here, re-checked against the release's own asset list and the model
repo's tree (sizes below are the bytes that commit serves).

audio.cpp is Apache-2.0 (LICENSE ships inside every archive). The cut runs the upstream
release unchanged; our own copy of the repo takes over when the first change needs C++
(plan §3.1, §5).
"""

from __future__ import annotations

import platform as _platform
import sys

from llm_runner.runner.schema import BinaryAsset

TAG = "v0.9.0"                       # released 2026-09-30 — git 795c45fb
_DL = f"https://github.com/0xShug0/audio.cpp/releases/download/{TAG}"

# The model files: audio.cpp's own GGUF packages. Commit pinned 2026-10-01.
MODEL_REPO = "audio-cpp/audio.cpp-gguf"
MODEL_REVISION = "7bf52723f5a95b6cec53ea905fd10eca1c8b942e"

SERVER_EXE = "audiocpp_server.exe" if sys.platform == "win32" else "audiocpp_server"


def _row(platform: str, gpu: str, archive: str, runtime: str | None = None) -> BinaryAsset:
    return BinaryAsset(
        platform=platform, gpu=gpu, server_exe=SERVER_EXE,
        asset_url=f"{_DL}/{archive}",
        runtime_url=f"{_DL}/{runtime}" if runtime else None,
    )


def binaries() -> list[BinaryAsset]:
    """Every build of the pinned release, as the kit's acquisition rows.

    Windows CUDA builds ship their CUDA runtime DLLs separately (the cudart archive is
    unpacked beside the exe). CUDA 13.3 is the Blackwell build (the kit's chip rule picks
    it for compute capability ≥ 10). Linux has no general CUDA archive — NVIDIA boxes run
    the Vulkan build, as llama.cpp does. macOS ships one Metal build per CPU arch."""
    mac_arch = "arm64" if _platform.machine().lower() in ("arm64", "aarch64") else "x64"
    return [
        _row("windows", "cuda12", f"audio-{TAG}-bin-windows-x64-cuda12.4.zip",
             f"audio-{TAG}-cudart-windows-x64-cuda12.4.zip"),
        _row("windows", "cuda13", f"audio-{TAG}-bin-windows-x64-cuda13.3.zip",
             f"audio-{TAG}-cudart-windows-x64-cuda13.3.zip"),
        _row("windows", "vulkan", f"audio-{TAG}-bin-windows-x64-vulkan.zip"),
        _row("windows", "cpu", f"audio-{TAG}-bin-windows-x64-cpu.zip"),
        _row("linux", "vulkan", f"audio-{TAG}-bin-ubuntu-x64-vulkan.tar.gz"),
        _row("linux", "cpu", f"audio-{TAG}-bin-ubuntu-x64-cpu.tar.gz"),
        _row("macos", "metal", f"audio-{TAG}-bin-macos-{mac_arch}-metal.tar.gz"),
    ]


def model_source(path: str, size_bytes: int) -> dict:
    """A manifest variant's `sources` row for one GGUF file in the pinned model repo —
    the shape `speech_cache.fetch_hf_variant` already downloads."""
    return {"hf_repo": MODEL_REPO, "revision": MODEL_REVISION,
            "size_bytes": size_bytes, "files": [path]}
