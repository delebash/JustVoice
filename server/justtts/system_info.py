"""Cross-platform system detection — CPU / RAM / GPU + runtime availability.

Best-effort. Uses psutil if installed; falls back to platform module
otherwise. GPU detection tries nvidia-smi (NVIDIA) then platform
specific paths (lspci on Linux, wmic on Windows, system_profiler on macOS).
"""

from __future__ import annotations

import ctypes
import logging
import os
import platform
import shutil
import subprocess
import sys

from .models import GpuInfo, SystemInfo

log = logging.getLogger(__name__)


def detect() -> SystemInfo:
    try:
        import psutil  # type: ignore

        ram_total = psutil.virtual_memory().total // (1024 * 1024)
        cpu_cores = psutil.cpu_count(logical=True) or 0
    except ImportError:
        # psutil not installed — fall back to stdlib so the panel isn't all zeros.
        cpu_cores = os.cpu_count() or 0
        ram_total = _ram_total_mb_stdlib()
    return SystemInfo(
        os=f"{platform.system()} {platform.release()}",
        cpu_name=_cpu_name(),
        cpu_cores=cpu_cores,
        ram_total_mb=ram_total,
        gpus=_detect_gpus(),
        runtimes=_detect_runtimes(),
        ffmpeg=_detect_ffmpeg(),
    )


def _ram_total_mb_stdlib() -> int:
    """Best-effort total RAM without psutil. Returns 0 if undeterminable."""
    try:
        if sys.platform == "win32":
            class _MemStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = _MemStatus()
            stat.dwLength = ctypes.sizeof(_MemStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return int(stat.ullTotalPhys) // (1024 * 1024)
        else:
            # Linux / macOS: sysconf gives page size * page count.
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            return int(pages) * int(page_size) // (1024 * 1024)
    except Exception as e:
        log.debug("stdlib RAM detection failed: %s", e)
    return 0


def _cpu_name() -> str:
    # Best-effort across platforms.
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["wmic", "cpu", "get", "name"], stderr=subprocess.DEVNULL, timeout=5
            ).decode("utf-8", errors="ignore")
            lines = [l.strip() for l in out.splitlines() if l.strip() and "Name" not in l]
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


def _detect_gpus() -> list[GpuInfo]:
    gpus: list[GpuInfo] = []
    # NVIDIA first
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.check_output(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,driver_version",
                    "--format=csv,noheader,nounits",
                ],
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).decode("utf-8", errors="ignore")
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) == 3:
                    name, mem, driver = parts
                    try:
                        vram = int(mem)
                    except ValueError:
                        vram = None
                    gpus.append(
                        GpuInfo(vendor="NVIDIA", name=name, vram_mb=vram, driver=driver)
                    )
        except Exception as e:
            log.debug("nvidia-smi failed: %s", e)
    return gpus


def _detect_runtimes() -> dict[str, bool]:
    runtimes: dict[str, bool] = {"cpu": True}
    # CUDA — nvidia-smi available + responds
    if shutil.which("nvidia-smi"):
        try:
            subprocess.check_output(
                ["nvidia-smi"], stderr=subprocess.DEVNULL, timeout=3
            )
            runtimes["cuda"] = True
        except Exception:
            runtimes["cuda"] = False
    # macOS-only paths
    if sys.platform == "darwin":
        runtimes["metal"] = True
        runtimes["coreml"] = True
        runtimes["mlx"] = True
    # Windows-only paths
    if sys.platform == "win32":
        runtimes["directml"] = True
    # Try to import torch to get a more accurate signal
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
