"""Static engine catalog — what JustTTS knows about each engine,
independent of whether it's installed.

Mirrors the Rust ``engines::catalog`` module. 8 engines:
  - kokoro (Rust-native via sherpa-onnx; now Python-native via
    sherpa-onnx-python — same .onnx weights, same audio output)
  - luxtts, qwen3, chatterbox (3 variants), tada, dia, moss-tts,
    higgs-audio (all PyTorch-based)
"""

from __future__ import annotations

from ..models import EngineInfo, Prerequisites


def known_engines() -> list[EngineInfo]:
    return [
        kokoro(),
        luxtts(),
        qwen3(),
        chatterbox(),
        tada(),
        dia(),
        moss_tts(),
        higgs_audio(),
    ]


def kokoro() -> EngineInfo:
    return EngineInfo(
        id="kokoro",
        name="Kokoro",
        description=(
            "k2-fsa's Kokoro via sherpa-onnx — 54 preset voices across 8 languages "
            "(en-US, en-GB, ja, zh, es, fr, hi, it, pt-BR). ~50 MB binary footprint, "
            "~700 MB model download. CUDA / Metal (CoreML) / DirectML / CPU."
        ),
        backend="sherpa-onnx",
        capabilities=["preset_voices", "gpu_accel", "phoneme_override"],
        prerequisites=Prerequisites(
            rust_native=True,
            sidecar=False,
            disk_space_mb=700,
            model_files_needed=["kokoro-base"],
            gpu_runtimes=["cuda", "coreml", "directml", "cpu"],
        ),
        runtime_deps=["sherpa_onnx"],
        pip_packages=["sherpa-onnx>=1.13"],
    )


def luxtts() -> EngineInfo:
    return EngineInfo(
        id="luxtts",
        name="LuxTTS",
        description="Multilingual TTS with preset voices and broad language coverage. Lighter than the Qwen3/Chatterbox tier.",
        backend="python",
        capabilities=["preset_voices", "gpu_accel"],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=1200, gpu_runtimes=["cuda", "metal"]
        ),
        runtime_deps=["luxtts", "torch"],
    )


def qwen3() -> EngineInfo:
    return EngineInfo(
        id="qwen3",
        name="Qwen3-TTS",
        description=(
            "Alibaba's open-weight TTS. Two variants: 1.7B (full feature set, "
            "best published English WER) and 0.6B (faster, ~half VRAM). Voice "
            "cloning, voice design from prose, instruct field, native paralinguistic tags."
        ),
        backend="python",
        capabilities=[
            "preset_voices",
            "voice_cloning",
            "voice_design",
            "instruct_field",
            "paralinguistic_tags",
            "gpu_accel",
        ],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=7000, gpu_runtimes=["cuda", "metal"]
        ),
        runtime_deps=["qwen3_tts", "torch"],
        pip_packages=["qwen-tts>=0.1", "torch>=2.2"],
    )


def chatterbox() -> EngineInfo:
    return EngineInfo(
        id="chatterbox",
        name="Chatterbox",
        description=(
            "Resemble AI's open-source TTS family with three variants: Original "
            "(500M EN), Turbo (350M EN, native paralinguistic tags), Multilingual "
            "(500M, 23 languages). Voice cloning, per-render exaggeration / "
            "cfg_weight / temperature knobs. CPU-only on Mac (PyTorch/MPS upstream bug)."
        ),
        backend="python",
        capabilities=[
            "voice_cloning",
            "paralinguistic_tags",
            "gpu_accel",
        ],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=2800, gpu_runtimes=["cuda"]
        ),
        runtime_deps=["chatterbox", "torch"],
        pip_packages=["chatterbox-tts>=0.2", "torch>=2.2"],
    )


def tada() -> EngineInfo:
    return EngineInfo(
        id="tada",
        name="TADA",
        description="Hume AI's TADA — multilingual TTS with voice cloning. 1B and 3B variants.",
        backend="python",
        capabilities=["preset_voices", "voice_cloning", "gpu_accel"],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=6000, gpu_runtimes=["cuda", "metal"]
        ),
        runtime_deps=["tada", "torch"],
    )


def dia() -> EngineInfo:
    return EngineInfo(
        id="dia",
        name="Dia",
        description="Dia — multi-speaker single-pass dialogue. 1.6B and 2-2B variants.",
        backend="python",
        capabilities=["preset_voices", "single_speaker_dialogue", "gpu_accel"],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=6000, gpu_runtimes=["cuda", "metal"]
        ),
        runtime_deps=["dia", "torch"],
    )


def moss_tts() -> EngineInfo:
    return EngineInfo(
        id="moss-tts",
        name="MOSS-TTS v1.5",
        description="MOSS-TTS — documented 1-hour stable single-pass generation. 12-16 GB VRAM.",
        backend="python",
        capabilities=["preset_voices", "gpu_accel"],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=12000, gpu_runtimes=["cuda"]
        ),
        runtime_deps=["moss_tts", "torch"],
    )


def higgs_audio() -> EngineInfo:
    return EngineInfo(
        id="higgs-audio",
        name="Higgs Audio v3",
        description="Higgs Audio v3 — rich expression control, wide emotional range. **Non-commercial license.**",
        backend="python",
        capabilities=[
            "voice_cloning",
            "paralinguistic_tags",
            "instruct_field",
            "gpu_accel",
        ],
        prerequisites=Prerequisites(
            sidecar=False, disk_space_mb=8000, gpu_runtimes=["cuda"]
        ),
        runtime_deps=["higgs_audio", "torch"],
    )


def compute_status(
    entry_id: str,
    registered: bool,
    registered_ready: bool,
    current_id: str | None,
) -> str:
    """Match the Rust crate's compute_status logic."""
    if not registered:
        return "not_installed"
    is_current = current_id == entry_id
    if is_current and registered_ready:
        return "loaded"
    if is_current:
        return "loading"
    return "installed"
