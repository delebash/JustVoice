# SPDX-License-Identifier: MIT
"""The audio.cpp release JustVoice runs, and the model repo it downloads from.

Both pinned: a binary or a model file is a fact about a COMMIT, not a branch. A bump is a
deliberate change here, re-checked against the release's own asset list and the model
repo's tree (sizes below are the bytes that commit serves).

audio.cpp is Apache-2.0 (LICENSE ships inside every archive). The app runs our own copy's
releases (github.com/delebash/audio.cpp, branch `jv`, tags `v0.9.0-jv.N`) since 2026-10-03;
`npm run dev` runs that checkout's own build instead (`dev_build.py`).
"""

from __future__ import annotations

import platform as _platform
import sys

from llm_runner.runner.schema import BinaryAsset

# Our build 4 on audio.cpp v0.9.0 (github.com/delebash/audio.cpp, published 2026-10-04 by the
# fork's release workflow): everything since jv.1 in one release (decided 2026-10-03) — Kokoro
# blends and inline IPA, Chatterbox Turbo / Nano cloning, Chatterbox in Hebrew, Russian, Chinese
# and Japanese, Kokoro's Japanese voices, models registered at run time (`model_management`),
# Qwen3's memory fixes, and libmecab beside the executable on every platform. jv.2 and jv.3 were
# tagged on commits whose macOS build failed and were never published; their names are not
# reused (decided 2026-10-04). Upstream's v0.9.0 was released 2026-09-30 (795c45fb).
TAG = "v0.9.0-jv.4"
_DL = f"https://github.com/delebash/audio.cpp/releases/download/{TAG}"

# Older pinned releases an install may still hold, newest first. One of them keeps working
# until the runtime row's "Update to <TAG>" installs the pinned build (decided 2026-10-03).
PREVIOUS_TAGS: tuple[str, ...] = ("v0.9.0-jv.1", "v0.9.0")

# Every build the app has pinned or will, oldest first — upstream's, then ours
# (github.com/delebash/audio.cpp, tags v0.9.0-jv.N). A feature names the first build that has
# it, so an older installed build refuses that feature by name instead of failing inside.
BUILDS_IN_ORDER: tuple[str, ...] = ("v0.9.0", "v0.9.0-jv.1", "v0.9.0-jv.4")
FEATURES: dict[str, str] = {
    "voxcpm2_transcript": "v0.9.0-jv.1",   # a VoxCPM2 clone uses the clip's transcript
    "voice_pack": "v0.9.0-jv.4",   # Kokoro blends (gap 2)
    "inline_ipa": "v0.9.0-jv.4",   # Kokoro "[word](/phonemes/)" — a lexicon's IPA (gap 3)
    "turbo_clone": "v0.9.0-jv.4",  # Chatterbox Turbo / Nano clone a voice (gap 1)
    "chatterbox_he_ru_zh": "v0.9.0-jv.4",   # Chatterbox in Hebrew, Russian, Chinese (gap 7)
    "japanese": "v0.9.0-jv.4",     # Kokoro's Japanese voices, Chatterbox Japanese (gap 7)
    # Models registered at run time without the WebUI's other endpoints — nothing downloaded or
    # deleted restarts a process (audit 2026-10-04 §13.2). Older builds list their models.
    "model_management": "v0.9.0-jv.4",
}


def pinned_has(feature: str) -> bool:
    """Whether the PINNED build has `feature` — what the app offers. The installed build may
    still be older; `runtime.has_feature` answers for it. Under `npm run dev` the app runs
    our checkout's own build (`dev_build.py`), the fork's latest, which has every feature."""
    from . import dev_build

    if dev_build.current() is not None:
        return feature in FEATURES
    first = FEATURES.get(feature)
    if first not in BUILDS_IN_ORDER or TAG not in BUILDS_IN_ORDER:
        return False
    return BUILDS_IN_ORDER.index(TAG) >= BUILDS_IN_ORDER.index(first)

# The model files: audio.cpp's own GGUF packages. Commit pinned 2026-10-01.
MODEL_REPO = "audio-cpp/audio.cpp-gguf"
MODEL_REVISION = "7bf52723f5a95b6cec53ea905fd10eca1c8b942e"

SERVER_EXE = "audiocpp_server.exe" if sys.platform == "win32" else "audiocpp_server"


# The pinned release's archives, by their published sha256 (GitHub's asset digests for
# v0.9.0-jv.4, read 2026-10-05 from the published release). The kit refuses a download that
# doesn't match, before anything is unpacked — the rows were URLs only, on a tag that could be
# re-uploaded (audit §5 E6). A new TAG brings its own; an archive missing here is launch-verified
# only.
SHA256: dict[str, str] = {
    "audio-v0.9.0-jv.4-bin-windows-x64-cuda12.4.zip": "0e36c9764df350aec58159fd2588ad4c2fc87e3685034ea3f1089550fbd6afdd",
    "audio-v0.9.0-jv.4-cudart-windows-x64-cuda12.4.zip": "475a21d187171a0c9e835b1840d494dbec305c799b33be59c2265041e5848a07",
    "audio-v0.9.0-jv.4-bin-windows-x64-cuda13.3.zip": "a31ad974101b3c4a59a9f68f2a157a5ff7e2471aece18f4c80ee026c5d98e216",
    "audio-v0.9.0-jv.4-cudart-windows-x64-cuda13.3.zip": "5f07adf13799320992b77948d2332d903ab699b732e4ee31bc953328543a15c3",
    "audio-v0.9.0-jv.4-bin-windows-x64-vulkan.zip": "f7b74cc9e389857c69524b1584fc4bfbc530cd45eac8f289a63123e2fb0c90ef",
    "audio-v0.9.0-jv.4-bin-windows-x64-cpu-portable.zip": "03e25b41d62645975bb077f290affbd965b35f153e1124d9e9ebba28b8700a98",
    "audio-v0.9.0-jv.4-bin-ubuntu-x64-vulkan.tar.gz": "847a68aca76858f15e007e17627bdf54509375a0f369b69f19568dc348911f61",
    "audio-v0.9.0-jv.4-bin-ubuntu-x64-cpu-portable.tar.gz": "7776d5a85f0f92583965737fcc010318ec5cadc0f5915120c9291e34c6a876e6",
    "audio-v0.9.0-jv.4-bin-macos-arm64-metal.tar.gz": "1a5cbace610c9a31393e21cb4cf7bf3db893b83ad58ba1afeced169fc0a2ae7c",
    "audio-v0.9.0-jv.4-bin-macos-x64-metal.tar.gz": "717eea7bec0b7fd54176ce8f0ef8c6b9878110c2bd58e6f9056fbee6c09d6f6f",
}


def _row(platform: str, gpu: str, archive: str, runtime: str | None = None) -> BinaryAsset:
    return BinaryAsset(
        platform=platform, gpu=gpu, server_exe=SERVER_EXE,
        asset_url=f"{_DL}/{archive}",
        runtime_url=f"{_DL}/{runtime}" if runtime else None,
        sha256=SHA256.get(archive),
        runtime_sha256=SHA256.get(runtime) if runtime else None,
    )


def binaries() -> list[BinaryAsset]:
    """Every build of the pinned release, as the kit's acquisition rows.

    Windows CUDA builds ship their CUDA runtime DLLs separately (the cudart archive is
    unpacked beside the exe). CUDA 13.3 is the Blackwell build (the kit's chip rule picks
    it for compute capability ≥ 10). Linux has no general CUDA archive — NVIDIA boxes run
    the Vulkan build, as llama.cpp does. macOS ships one Metal build per CPU arch. The CPU
    builds are the PORTABLE ones: the plain build assumes this CPU's newest instructions and
    exits at start on an older one (audio.cpp issue #352; audit §5 E7)."""
    mac_arch = "arm64" if _platform.machine().lower() in ("arm64", "aarch64") else "x64"
    return [
        _row("windows", "cuda12", f"audio-{TAG}-bin-windows-x64-cuda12.4.zip",
             f"audio-{TAG}-cudart-windows-x64-cuda12.4.zip"),
        _row("windows", "cuda13", f"audio-{TAG}-bin-windows-x64-cuda13.3.zip",
             f"audio-{TAG}-cudart-windows-x64-cuda13.3.zip"),
        _row("windows", "vulkan", f"audio-{TAG}-bin-windows-x64-vulkan.zip"),
        _row("windows", "cpu", f"audio-{TAG}-bin-windows-x64-cpu-portable.zip"),
        _row("linux", "vulkan", f"audio-{TAG}-bin-ubuntu-x64-vulkan.tar.gz"),
        _row("linux", "cpu", f"audio-{TAG}-bin-ubuntu-x64-cpu-portable.tar.gz"),
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
