"""Cross-platform system detection — CPU / RAM / GPU + runtime availability.

Hardware primitives (GPU name/VRAM/driver, RAM, CPU cores) come from the
shared runner's single hardware authority — `llm_runner.runner.hardware.detect()`
— so JustVoice and the LLM runner never run two divergent `nvidia-smi`
probes. This module adds only the JustVoice-specific extras the runner does
not model: the full OS string, CPU name, ffmpeg availability, and the
richer runtime matrix (torch CUDA/MPS, DirectML, CoreML, MLX).
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys

from llm_runner.runner.hardware import detect as _detect_hardware

from .models import GpuInfo, SystemInfo


def detect() -> SystemInfo:
    # Hardware primitives from the shared single authority (no second probe).
    hw = _detect_hardware()
    return SystemInfo(
        os=f"{platform.system()} {platform.release()}",
        cpu_name=_cpu_name(),
        cpu_cores=hw.cpu_cores,
        ram_total_mb=hw.ram_mb,
        gpus=[
            GpuInfo(vendor=g.vendor, name=g.name, vram_mb=g.vram_mb, driver=g.driver)
            for g in hw.gpus
        ],
        runtimes=_detect_runtimes(hw.runtimes),
        ffmpeg=_detect_ffmpeg(),
    )


def _cpu_name() -> str:
    # Best-effort across platforms.
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["wmic", "cpu", "get", "name"], stderr=subprocess.DEVNULL, timeout=5
            ).decode("utf-8", errors="ignore")
            lines = [ln.strip() for ln in out.splitlines() if ln.strip() and "Name" not in ln]
            if lines:
                return lines[0]
        except Exception:
            pass
        return platform.processor() or "unknown"
    elif sys.platform == "darwin":
        try:
            out = subprocess.check_output(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
            return out.decode("utf-8").strip()
        except Exception:
            return platform.processor() or "unknown"
    else:
        # Linux: /proc/cpuinfo
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if line.startswith("model name"):
                        return line.split(":", 1)[1].strip()
        except Exception:
            pass
        return platform.processor() or "unknown"


def _detect_runtimes(base: dict[str, bool] | None = None) -> dict[str, bool]:
    """JustVoice's runtime matrix, layered on the runner's base detection.

    The runner already reports `cuda` (via nvidia-smi) and `metal`; we add
    the platform extras it doesn't model and override `cuda`/`mps` with
    torch's authoritative signal when torch is importable.
    """
    runtimes: dict[str, bool] = {"cpu": True}
    if base:
        runtimes.update(base)
    if sys.platform == "darwin":
        runtimes.setdefault("metal", True)
        runtimes["coreml"] = True
        runtimes["mlx"] = True
    if sys.platform == "win32":
        runtimes["directml"] = True
    # torch, if present, is the most accurate CUDA / MPS signal.
    try:
        import torch  # type: ignore

        runtimes["cuda"] = torch.cuda.is_available()
        if hasattr(torch.backends, "mps"):
            runtimes["mps"] = torch.backends.mps.is_available()
    except ImportError:
        pass
    return runtimes


def _detect_ffmpeg() -> dict | None:
    bin_ = shutil.which("ffmpeg")
    if not bin_:
        return None
    try:
        out = subprocess.check_output(
            [bin_, "-version"], stderr=subprocess.DEVNULL, timeout=5
        ).decode("utf-8", errors="ignore")
        first_line = out.splitlines()[0] if out else ""
        return {"bundled": False, "path": bin_, "version": first_line}
    except Exception:
        return {"bundled": False, "path": bin_, "version": "unknown"}
