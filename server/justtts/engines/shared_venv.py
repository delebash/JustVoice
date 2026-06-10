"""Cross-platform shared-venv setup — `setup-python` recipe in Python so the
host can drive it from the GUI's "Set up engines" action.

Shared engines (manifest.ISOLATION == "shared", the default) all run against
ONE Python interpreter at `server/justvoice/engines/.shared-venv/`. Setup
detects GPU + OS, installs the right torch wheel, then bulk-installs every
shared engine's `SHARED_INSTALL_STEPS`. Once the shared venv exists, clicking
"Install" on a shared engine afterwards only downloads model files.

Cross-platform detection:
    - macOS arm64:    Apple Silicon → CPU torch + optional MLX deps later
    - macOS x86_64:   CPU torch
    - Linux:          nvidia-smi → cu124 / cu128; else CPU
    - Windows:        nvidia-smi → cu124; Intel Arc → xpu; else CPU
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from .manager import (
    SHARED_VENV_DIR,
    _current_os_label,
    _run_uv_pip,
    _venv_python,
    discover_engines,
    InstallError,
    _check_uv_available,
)

log = logging.getLogger(__name__)


# ─── GPU / wheel-index detection ──────────────────────────────────────


def detect_gpu() -> tuple[str, str | None, str]:
    """Returns (vendor, torch_index_url_or_None, label).

    Windows-side detection uses powershell Win32_VideoController; Linux-side
    uses nvidia-smi. Override via JUSTVOICE_TORCH_INDEX env var.
    """
    # User override always wins.
    override = os.environ.get("JUSTVOICE_TORCH_INDEX")
    if override:
        return "override", override, f"override({override})"

    if _current_os_label() == "macos":
        # macOS has no CUDA wheels. Apple Silicon uses MPS (default torch
        # from PyPI works). Intel Mac uses CPU.
        return "apple", None, "macos-default"

    # NVIDIA via nvidia-smi (works on both Windows + Linux).
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            # cu124 covers the widest torch range (2.4+ through 2.7+).
            # cu128 only has wheels for torch>=2.7 — picking cu124 means
            # chatterbox's torch==2.6.0 pin resolves cleanly.
            return "nvidia", "https://download.pytorch.org/whl/cu124", "cuda-124"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Intel Arc on Windows — detect via Get-CimInstance Win32_VideoController.
    if _current_os_label() == "windows":
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0 and "Arc" in (r.stdout or ""):
                return "intel-arc", "https://download.pytorch.org/whl/xpu", "intel-xpu"
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    # Linux ROCm: skip for now (would need rocm-smi detection); user can
    # set JUSTVOICE_TORCH_INDEX=https://download.pytorch.org/whl/rocm6.0
    return "cpu", None, "cpu"


# ─── Setup driver ─────────────────────────────────────────────────────


def setup_shared_venv(
    progress: Callable[[str, str | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Build (or rebuild) the shared venv with every shared engine's deps.

    Idempotent — re-running over an existing venv just re-checks the packages.
    Pass `force=True` to nuke the existing venv first.

    Returns a summary dict with the detected GPU, the torch index used, and
    the engine ids that contributed install steps.
    """
    uv = _check_uv_available()

    def emit(phase: str, line: str | None = None) -> None:
        if progress:
            progress(phase, line)
        if line:
            log.info("[shared-venv] [%s] %s", phase, line[:200])

    def check_cancel() -> None:
        if cancel_check and cancel_check():
            raise InstallError("cancelled by user")

    if force and SHARED_VENV_DIR.exists():
        emit("clearing", str(SHARED_VENV_DIR))
        shutil.rmtree(SHARED_VENV_DIR, ignore_errors=True)

    # 1. Create the venv pinned to host Python.
    emit("creating-venv", f"uv venv {SHARED_VENV_DIR}")
    r = subprocess.run(
        [uv, "venv", str(SHARED_VENV_DIR), "--python", sys.executable, "--allow-existing"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        # Fall back to letting uv pick a Python.
        r = subprocess.run(
            [uv, "venv", str(SHARED_VENV_DIR), "--allow-existing"], capture_output=True, text=True
        )
    if r.returncode != 0:
        raise InstallError(f"uv venv failed: {r.stderr.strip() or r.stdout.strip()}")
    py = _venv_python(SHARED_VENV_DIR)
    if not py.is_file():
        raise InstallError(f"venv created but python not at {py}")
    check_cancel()

    # 2. justvoice_plugin (the SDK every engine subprocess imports).
    plugin_dir = Path(__file__).resolve().parents[2] / "justvoice_plugin"
    emit("installing-plugin", f"installing justvoice_plugin from {plugin_dir}")
    _run_uv_pip(uv, py, ["pip", "install", str(plugin_dir)], emit, check_cancel)
    check_cancel()

    # 3. Detect GPU + install torch with the right wheel index.
    vendor, index_url, label = detect_gpu()
    emit("detecting-gpu", f"detected: {label}")
    torch_pkgs = ["torch", "torchaudio"]
    cmd = ["pip", "install"]
    if index_url:
        cmd += ["--index-url", index_url]
    cmd += torch_pkgs
    emit("installing-torch", f"vendor={vendor} index={index_url or 'default'}")
    _run_uv_pip(uv, py, cmd, emit, check_cancel)
    check_cancel()

    # 4. Walk every shared engine, execute its shared_install_steps in order.
    #    Within an engine's steps we keep the original ordering so that
    #    --no-deps + git overrides come AFTER the subdeps they replace
    #    (preserves the upstream justfile sequencing).
    manifests = discover_engines()
    shared_ids: list[str] = []
    for mid, m in sorted(manifests.items()):
        if m.isolation != "shared":
            continue
        if not m.supports_current_os():
            emit("skipping", f"{mid}: not supported on {_current_os_label()}")
            continue
        shared_ids.append(mid)
        for i, step in enumerate(m.shared_install_steps):
            check_cancel()
            kind = step.get("kind")
            emit("step", f"{mid} [{i + 1}/{len(m.shared_install_steps)}] {kind}")
            if kind == "torch":
                # Torch already installed up top — skip per-engine torch steps
                # in the shared world so chatterbox's `torch==2.6.0` pin doesn't
                # try to reinstall on top of the GPU-specific wheel we chose.
                continue
            elif kind == "pip":
                packages = step.get("packages", [])
                if packages:
                    _run_uv_pip(uv, py, ["pip", "install", *packages], emit, check_cancel)
            elif kind == "pip-no-deps":
                packages = step.get("packages", [])
                if packages:
                    _run_uv_pip(uv, py, ["pip", "install", "--no-deps", *packages], emit, check_cancel)
            elif kind == "pip-git":
                url = step["url"]
                ref = step.get("ref")
                spec = f"git+{url}" + (f"@{ref}" if ref else "")
                _run_uv_pip(uv, py, ["pip", "install", spec], emit, check_cancel)
            elif kind == "pip-find-links":
                url = step["url"]
                packages = step.get("packages", [])
                _run_uv_pip(uv, py, ["pip", "install", "--find-links", url, *packages], emit, check_cancel)
            elif kind == "pip-local":
                rel = step["path"]
                resolved = (m.engine_dir / rel).resolve()
                _run_uv_pip(uv, py, ["pip", "install", str(resolved)], emit, check_cancel)
            elif kind == "requirements-file":
                req = m.engine_dir / step.get("path", "requirements.txt")
                _run_uv_pip(uv, py, ["pip", "install", "-r", str(req)], emit, check_cancel)
            else:
                log.warning("unknown shared install step kind for %s: %r", mid, kind)

    # 5. Apple Silicon: install MLX deps if we're on arm64+Darwin.
    #    Optional — skip cleanly if file doesn't exist yet (we haven't ported it).
    if _current_os_label() == "macos" and platform.machine() == "arm64":
        mlx_file = Path(__file__).resolve().parents[2] / "engines" / "_mlx_requirements.txt"
        if mlx_file.is_file():
            emit("installing-mlx", str(mlx_file))
            _run_uv_pip(uv, py, ["pip", "install", "-r", str(mlx_file)], emit, check_cancel)

    emit("done", None)
    return {
        "venv": str(SHARED_VENV_DIR),
        "python": str(py),
        "gpu_vendor": vendor,
        "gpu_label": label,
        "torch_index_url": index_url,
        "shared_engines": shared_ids,
        "current_os": _current_os_label(),
    }
