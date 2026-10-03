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


def sixteen_bit(row: dict, path: str, size_bytes: int, *, dtype: str = "bf16",
                source: dict | None = None, companions: list | None = None) -> dict:
    """The 16-bit sibling of an 8-bit variant row (switch plan §5, gap 9): same model, same
    capabilities, the original precision. Its id swaps the `-q8` tail for `-<dtype>`, its name
    says "16-bit", its description says so, and it has no reference CPU speed of its own (the
    8-bit row's would be wrong — a render measures this one). `source` replaces the default
    one-file source (a multi-file source, another repo); `companions` replaces the companion
    files (speech recognition's aligner)."""
    name = row["name"]
    name = f"{name[:-1]}, 16-bit)" if name.endswith(")") else f"{name} (16-bit)"
    desc = row["description"].replace(" 8-bit weights.", "").rstrip()
    out = {
        **{k: v for k, v in row.items() if k != "cpu_realtime"},
        "id": row["id"].removesuffix("-q8") + f"-{dtype}",
        "name": name,
        "description": f"{desc} 16-bit weights — a larger download that needs more memory.",
        "sources": [source or model_source(path, size_bytes)],
        "audiocpp": {**row["audiocpp"], "file": path},
    }
    if companions is not None:
        out["audiocpp"]["companions"] = companions
    return out


def model_source(path: str, size_bytes: int, *, repo: str = MODEL_REPO,
                 revision: str = MODEL_REVISION) -> dict:
    """A manifest variant's `sources` row for one GGUF file in the pinned model repo —
    the shape `speech_cache.fetch_hf_variant` already downloads. `repo` / `revision`
    name another pinned repo for a model audio.cpp does not publish (our own conversions)."""
    return {"hf_repo": repo, "revision": revision,
            "size_bytes": size_bytes, "files": [path]}
