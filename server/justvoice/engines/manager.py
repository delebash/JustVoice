"""Subprocess engine manager — discovery, install (uv), lifecycle, HTTP proxy.

Each engine lives in `server/justvoice/engines/<id>/` with three source files:
- `manifest.py`   declarative metadata + install steps
- `engine.py`    adapter that subclasses justvoice_plugin.EmbeddedEngine
- `requirements.txt`  pip requirements

On Install: `uv venv` creates `engines/<id>/.venv/`, then we run each step
from `manifest.INSTALL` (pip / pip-no-deps / pip-git / pip-find-links /
torch / pip-local) against that venv.

On Load: spawn `<venv>/bin/python engines/<id>/engine.py serve --port 0`
as a subprocess. The plugin's `serve()` writes `PORT=<n>` to stdout once
it has bound; we read that, then POST /load.

On Synth: httpx to the engine's loopback port. Audio comes back as raw
bytes — no base64 overhead.

On Uninstall: terminate subprocess if running, then rmtree
`engines/<id>/.{venv,models,voices,state}`. Plugin source (manifest.py,
engine.py, requirements.txt) is left alone — that's the adapter, not user
state.

Cross-platform notes:
- Windows: subprocess uses `.venv\Scripts\python.exe`; POSIX uses `.venv/bin/python`.
- uv must be on PATH (we shell out via `subprocess.run(["uv", ...])`); the
  manager verifies this at startup and surfaces a clear error if missing.
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import httpx


log = logging.getLogger(__name__)


# ─── Constants ────────────────────────────────────────────────────────


ENGINES_DIR = Path(__file__).resolve().parent
# Folder names that aren't engines — skip during discovery.
NOT_ENGINES = {"__pycache__", "__init__", "base", "catalog", "factory", "registry", "model_catalog", "kokoro_voices", "_torch_helpers", "external_openai"}

PORT_HANDSHAKE_TIMEOUT_S = 30.0
HEALTH_CHECK_INTERVAL_S = 0.25
SUBPROCESS_KILL_TIMEOUT_S = 5.0


def _venv_python(venv_dir: Path) -> Path:
    """Path to the Python interpreter inside an engine's venv."""
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _current_os_label() -> str:
    """Normalised OS string used by manifests' SUPPORTED_OSES lists."""
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


# Where the shared venv lives — engines with ISOLATION="shared" (the default
# monolithic style) all run against this interpreter. The venv contains
# torch + every shared engine's Python deps, set up once via the
# `setup-python` recipe.
SHARED_VENV_DIR = ENGINES_DIR / ".shared-venv"


def shared_venv_python() -> Path:
    return _venv_python(SHARED_VENV_DIR)


def shared_venv_exists() -> bool:
    return shared_venv_python().is_file()


# ─── Manifest loading ─────────────────────────────────────────────────


class EngineManifest:
    """Lightweight wrapper around an engine's manifest.py module."""

    def __init__(self, engine_dir: Path, module: Any):
        self.engine_dir = engine_dir
        self.module = module

    @property
    def id(self) -> str:
        return getattr(self.module, "ID", self.engine_dir.name)

    @property
    def name(self) -> str:
        return getattr(self.module, "NAME", self.id)

    @property
    def description(self) -> str:
        return getattr(self.module, "DESCRIPTION", "")

    @property
    def license(self) -> str:
        return getattr(self.module, "LICENSE", "")

    @property
    def weights_license(self) -> str:
        """Model-weights license — distinct from framework code license.
        Falls back to LICENSE when WEIGHTS_LICENSE is unset (most engines
        ship Apache-2.0 code + Apache-2.0 weights, so the fallback is
        usually right). Override on engines whose weights diverge from
        their wrapper code license — e.g. TADA (Apache code + Llama-3.2
        Community weights)."""
        return getattr(self.module, "WEIGHTS_LICENSE", "") or getattr(self.module, "LICENSE", "")

    @property
    def attribution(self) -> str:
        """Attribution string the consuming tool must display when
        shipping output produced by this engine. Empty string means
        none required. Llama-3.2 §1.b mandates "Built with Llama" for
        any Llama-derivative — TADA sets this to that string."""
        return getattr(self.module, "ATTRIBUTION", "")

    @property
    def kind(self) -> str:
        """Phase 2 / Slice 1 — engine discriminator. Defaults to "tts"
        so every existing manifest stays backward-compatible without
        edits. LLM provider engines (Phase 2 / Slice 3+) declare
        KIND = "llm"; embedding engines KIND = "embedding"."""
        return getattr(self.module, "KIND", "tts")

    @property
    def capabilities(self) -> dict[str, bool]:
        return getattr(self.module, "CAPABILITIES", {})

    @property
    def requirements(self) -> dict[str, Any]:
        return getattr(self.module, "REQUIREMENTS", {})

    @property
    def install_steps(self) -> list[dict[str, Any]]:
        return getattr(self.module, "INSTALL", [])

    @property
    def models(self) -> list[dict[str, Any]]:
        return getattr(self.module, "MODELS", [])

    @property
    def static_voices(self) -> list[dict[str, Any]]:
        """Voices the engine ships statically — exposed to the host catalog
        even when the engine subprocess isn't loaded. Cloning-based engines
        leave this empty; their voices are user-created and stored host-side.
        """
        return getattr(self.module, "STATIC_VOICES", [])

    @property
    def default_variant_id(self) -> str | None:
        """The model variant `/v1/engines/<id>/load` loads when no variant is
        specified. Used by the GUI to (a) label which variant is the engine's
        default, and (b) hide that variant from the per-variant Load list so
        the user isn't offered two routes to the same model.
        """
        return getattr(self.module, "DEFAULT_VARIANT_ID", None)

    @property
    def isolation(self) -> str:
        """One of "shared" (engine runs against the shared venv at
        engines/.shared-venv/) or "venv" (engine gets its own private venv at
        engines/<id>/.venv/).

        Default is "shared" — the 5 core engines coexist in one venv with
        selective --no-deps. Reserve "venv" for engines that genuinely
        can't fit (e.g. MOSS-TTS needs flash-attn, Dia pins specific triton).
        """
        return getattr(self.module, "ISOLATION", "shared")

    @property
    def supported_oses(self) -> list[str]:
        """OSes this engine can install + run on. Default = all three.
        Manager filters the catalog by sys.platform so users on macOS don't
        see Dia (which requires triton — Linux/Windows only) or MOSS-TTS
        (flash-attn — barely works outside Linux).

        Values: "windows" | "linux" | "macos".
        """
        return getattr(self.module, "SUPPORTED_OSES", ["windows", "linux", "macos"])

    def supports_current_os(self) -> bool:
        """True if this engine declares support for the host's OS."""
        return _current_os_label() in self.supported_oses

    @property
    def shared_install_steps(self) -> list[dict[str, Any]]:
        """Install steps that should run when building the SHARED venv (not
        the per-engine venv). Used by shared engines that contribute Python
        deps to the shared interpreter. Defaults to the engine's INSTALL
        steps minus any 'model-*' steps (those run at per-engine Install
        time, not at shared-venv setup time)."""
        steps = getattr(self.module, "SHARED_INSTALL_STEPS", None)
        if steps is not None:
            return steps
        # Fallback: any INSTALL step that's not a model download.
        return [s for s in self.install_steps if not str(s.get("kind", "")).startswith("model-")]

    @property
    def model_install_steps(self) -> list[dict[str, Any]]:
        """Install steps that run at per-engine Install time (model file
        downloads). Defaults to the model-* steps from the engine's INSTALL list."""
        steps = getattr(self.module, "MODEL_INSTALL_STEPS", None)
        if steps is not None:
            return steps
        return [s for s in self.install_steps if str(s.get("kind", "")).startswith("model-")]

    @property
    def venv_dir(self) -> Path:
        return self.engine_dir / ".venv"

    @property
    def models_dir(self) -> Path:
        return self.engine_dir / "models"

    @property
    def is_installed(self) -> bool:
        """Heuristic — depends on isolation mode.

        For ISOLATION="venv": per-engine venv python exists.
        For ISOLATION="shared" (default): shared venv exists AND the engine's
        model_install_steps are all satisfied (model files on disk).
        """
        if self.isolation == "venv":
            return _venv_python(self.venv_dir).is_file()
        if not shared_venv_exists():
            return False
        # Shared engine: check that the engine's expected model files are present.
        # If there are no model_install_steps, the engine pulls via HF cache on
        # first load — we treat that as "installed" once the shared venv exists.
        steps = self.model_install_steps
        if not steps:
            return True
        for step in steps:
            expected = step.get("expected_files") or []
            if expected:
                if not all(any(self.models_dir.rglob(f)) for f in expected):
                    return False
            else:
                # No expected_files declared — check if models dir has any content.
                if not self.models_dir.exists() or not any(self.models_dir.iterdir()):
                    return False
        return True


def discover_engines() -> dict[str, EngineManifest]:
    """Scan engines/*/ for manifest.py and load each. Returns id → manifest.

    Uses regular `importlib.import_module` (not spec_from_file_location) so
    each engine package's `__init__.py` runs and relative imports inside
    `manifest.py` (e.g. `from .voices import ...`) resolve correctly.
    """
    import importlib

    out: dict[str, EngineManifest] = {}
    for child in sorted(ENGINES_DIR.iterdir()):
        if not child.is_dir():
            continue
        if child.name in NOT_ENGINES or child.name.startswith("_"):
            continue
        manifest_path = child / "manifest.py"
        if not manifest_path.is_file():
            continue
        if not (child / "__init__.py").is_file():
            log.warning("engine dir %s has manifest.py but no __init__.py — skipping", child)
            continue
        module_name = f"justvoice.engines.{child.name}.manifest"
        try:
            # Always re-import so manifest edits are picked up on refresh.
            if module_name in importlib.sys.modules:
                mod = importlib.reload(importlib.sys.modules[module_name])
            else:
                mod = importlib.import_module(module_name)
            manifest = EngineManifest(child, mod)
            out[manifest.id] = manifest
            log.info("discovered engine: %s (%s)", manifest.id, manifest.name)
        except Exception as e:
            log.exception("failed to load manifest %s: %s", module_name, e)
    return out


# ─── Install (uv-based) ───────────────────────────────────────────────


class InstallError(RuntimeError):
    pass


def _check_uv_available() -> str:
    """Confirm uv is on PATH. Returns the absolute path. Raises InstallError
    with an actionable message otherwise."""
    uv_path = shutil.which("uv")
    if not uv_path:
        raise InstallError(
            "uv is required but not found on PATH. Install it from https://docs.astral.sh/uv/ "
            "(macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`, "
            "Windows: `irm https://astral.sh/uv/install.ps1 | iex`)."
        )
    return uv_path


def _detect_torch_index_url() -> tuple[str | None, str]:
    """Pick a torch wheel index based on detected hardware.

    Returns (index_url, label). When index_url is None, default PyPI is used
    (CPU-only wheels). Detection logic for CUDA / Intel Arc / Apple Silicon.
    """
    # Env-var override always wins; then the settings knob.
    from .shared_venv import _settings_torch_override

    override = os.environ.get("JUSTVOICE_TORCH_INDEX") or _settings_torch_override()
    if override:
        return override, f"override({override})"

    # NVIDIA via nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            # cu124 covers the widest torch range we install (2.4+ through
            # 2.7+). cu128 only ships wheels for torch 2.7+; using it as
            # the default breaks engines that pin older torch (chatterbox
            # pins 2.6.0). Users on CUDA 12.8 with a torch>=2.7 engine
            # can override via JUSTVOICE_TORCH_INDEX=https://download.pytorch.org/whl/cu128.
            return "https://download.pytorch.org/whl/cu124", "cuda-124"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Intel Arc uses XPU wheels. We don't auto-detect Arc reliably, so
    # users with Arc set JUSTVOICE_TORCH_INDEX themselves.
    override = os.environ.get("JUSTVOICE_TORCH_INDEX")
    if override:
        return override, f"override({override})"

    return None, "cpu"


def install_engine(
    manifest: EngineManifest,
    progress: Callable[[str, str | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> None:
    """Install an engine.

    For shared engines (ISOLATION="shared", the default): make sure the
    shared venv exists (set it up if not), then run only the engine's
    model_install_steps (model file downloads). Python deps are already
    in the shared venv.

    For isolated engines (ISOLATION="venv"): create a per-engine venv at
    engines/<id>/.venv and run the full INSTALL list.

    `progress(phase, line)` reports each step + the latest pip / download
    line. `cancel_check` polled at every chunk + step boundary.
    """
    if manifest.isolation == "shared":
        return _install_engine_shared(manifest, progress, cancel_check)
    return _install_engine_isolated(manifest, progress, cancel_check)


def _install_engine_shared(
    manifest: EngineManifest,
    progress: Callable[[str, str | None], None] | None,
    cancel_check: Callable[[], bool] | None,
) -> None:
    """Install a shared engine: ensure the shared venv exists, then download
    the engine's model files only.
    """
    # 1. Make sure the shared venv is set up. If not, run the full shared-venv
    #    setup which installs torch + every shared engine's Python deps. This
    #    is the user's "first ever Install" path — they'll see ~5-10 minutes
    #    of shared-venv setup, then ~1-3 min model download for THIS engine.
    if not shared_venv_exists():
        # Import here to avoid a circular import at module load time
        # (shared_venv imports from manager).
        from . import shared_venv as sv

        if progress:
            progress("setup-shared-venv", "first-time setup: creating shared venv with all engine deps…")
        sv.setup_shared_venv(progress=progress, cancel_check=cancel_check)

    # 2. Pre-create the per-engine state directories so engine.py code paths
    #    can assume they exist.
    for sub in ("models", "voices", "state"):
        (manifest.engine_dir / sub).mkdir(parents=True, exist_ok=True)

    # 3. Run only the model_install_steps (model-tarball / model-file / HF
    #    prefetch). Python deps are already in the shared venv.
    steps = manifest.model_install_steps
    if not steps:
        if progress:
            progress("done", "no model files to download (engine pulls via HF cache on first load)")
        return

    for i, step in enumerate(steps):
        if cancel_check and cancel_check():
            raise InstallError("cancelled by user")
        kind = step.get("kind")
        if progress:
            progress("step", f"[{i + 1}/{len(steps)}] {kind}")
        if kind == "model-tarball":
            _install_model_tarball(manifest, step, _wrap_progress(progress), _wrap_cancel(cancel_check))
        elif kind == "model-file":
            _install_model_file(manifest, step, _wrap_progress(progress), _wrap_cancel(cancel_check))
        else:
            log.warning("ignoring non-model step %r in shared install (already handled by shared-venv setup)", kind)

    if progress:
        progress("done", None)


def _wrap_progress(progress):
    """Coerce None into a no-op callable for helpers that require one."""
    if progress is None:
        return lambda phase, line: None
    return progress


def _wrap_cancel(cancel_check):
    if cancel_check is None:
        return lambda: None
    def _check():
        if cancel_check():
            raise InstallError("cancelled by user")
    return _check


def _install_engine_isolated(
    manifest: EngineManifest,
    progress: Callable[[str, str | None], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> None:
    """Isolated engine: per-engine venv + full INSTALL pipeline. Same code
    path as the original pre-hybrid behaviour."""
    uv = _check_uv_available()
    venv = manifest.venv_dir

    def emit(phase: str, line: str | None = None) -> None:
        if progress:
            progress(phase, line)

    def check_cancel() -> None:
        if cancel_check and cancel_check():
            raise InstallError("cancelled by user")

    # 1. Create venv — idempotent (uv complains if one exists, so we
    #    pass --allow-existing). Pin to the same Python interpreter the
    #    JustVoice host is running on so wheel-compat matches the host's
    #    environment (otherwise uv may pick a different uv-managed Python
    #    version and pull wheels the host can't use).
    emit("creating-venv", f"uv venv {venv}")
    result = subprocess.run(
        [uv, "venv", str(venv), "--python", sys.executable, "--allow-existing"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        # Fall back to letting uv pick a Python (matching .python-version /
        # uv-managed Python) — last resort.
        result = subprocess.run(
            [uv, "venv", str(venv), "--allow-existing"], capture_output=True, text=True
        )
    if result.returncode != 0:
        raise InstallError(f"uv venv failed: {result.stderr.strip() or result.stdout.strip()}")
    check_cancel()

    python_exe = _venv_python(venv)
    if not python_exe.is_file():
        raise InstallError(f"venv created but python not found at {python_exe}")

    # 2. Always install justvoice-plugin first so the engine subprocess has its
    #    base class + serve() shim available.
    plugin_dir = Path(__file__).resolve().parents[2] / "justvoice_plugin"
    emit("installing-plugin", f"installing justvoice_plugin from {plugin_dir}")
    _run_uv_pip(uv, python_exe, ["pip", "install", str(plugin_dir)], emit, check_cancel)

    # 3. Execute each step from manifest.INSTALL.
    for i, step in enumerate(manifest.install_steps):
        check_cancel()
        kind = step.get("kind")
        emit("step", f"[{i + 1}/{len(manifest.install_steps)}] {kind}")

        if kind == "pip":
            packages = step.get("packages", [])
            if not packages:
                continue
            _run_uv_pip(uv, python_exe, ["pip", "install", *packages], emit, check_cancel)

        elif kind == "pip-no-deps":
            packages = step.get("packages", [])
            if not packages:
                continue
            _run_uv_pip(uv, python_exe, ["pip", "install", "--no-deps", *packages], emit, check_cancel)

        elif kind == "pip-git":
            url = step["url"]
            ref = step.get("ref")
            spec = f"git+{url}" + (f"@{ref}" if ref else "")
            _run_uv_pip(uv, python_exe, ["pip", "install", spec], emit, check_cancel)

        elif kind == "pip-find-links":
            url = step["url"]
            packages = step.get("packages", [])
            args = ["pip", "install", "--find-links", url, *packages]
            _run_uv_pip(uv, python_exe, args, emit, check_cancel)

        elif kind == "pip-local":
            path = step["path"]
            # Resolve relative to the engine's directory.
            resolved = (manifest.engine_dir / path).resolve()
            _run_uv_pip(uv, python_exe, ["pip", "install", str(resolved)], emit, check_cancel)

        elif kind == "torch":
            index_url, label = _detect_torch_index_url()
            version = step.get("version")  # e.g. "2.6.0" — pins torch to that release
            base_packages = step.get("packages") or ["torch", "torchaudio"]
            # Inject version pin if requested.
            if version:
                packages = [f"{p}=={version}" if "=" not in p else p for p in base_packages]
            else:
                packages = base_packages
            args = ["pip", "install"]
            if index_url:
                args += ["--index-url", index_url]
            args += packages
            emit("torch", f"torch variant: {label}{f' v{version}' if version else ''}")
            _run_uv_pip(uv, python_exe, args, emit, check_cancel)

        elif kind == "requirements-file":
            # Engine ships a requirements.txt; install it.
            req_file = manifest.engine_dir / step.get("path", "requirements.txt")
            _run_uv_pip(uv, python_exe, ["pip", "install", "-r", str(req_file)], emit, check_cancel)

        elif kind == "model-tarball":
            # Download + extract a .tar.bz2 / .tar.gz model tarball into the
            # engine's models/ dir. Used by Kokoro (k2-fsa GitHub Releases).
            _install_model_tarball(manifest, step, emit, check_cancel)

        elif kind == "model-file":
            # Download a single model file (no extraction).
            _install_model_file(manifest, step, emit, check_cancel)

        else:
            raise InstallError(f"unknown install step kind: {kind!r}")

    # 4. If the engine ships a requirements.txt and no requirements-file step
    #    was declared explicitly, install it here as a convenience.
    req_file = manifest.engine_dir / "requirements.txt"
    has_explicit_req_step = any(s.get("kind") == "requirements-file" for s in manifest.install_steps)
    if req_file.is_file() and not has_explicit_req_step:
        emit("requirements-txt", str(req_file))
        _run_uv_pip(uv, python_exe, ["pip", "install", "-r", str(req_file)], emit, check_cancel)

    # 5. Pre-create the models / voices / state dirs so engine.py code paths
    #    can assume they exist.
    for sub in ("models", "voices", "state"):
        (manifest.engine_dir / sub).mkdir(parents=True, exist_ok=True)

    emit("done", None)


def _install_model_tarball(
    manifest: EngineManifest,
    step: dict[str, Any],
    emit: Callable[[str, str | None], None],
    check_cancel: Callable[[], None],
) -> None:
    """Download + extract a .tar.bz2 / .tar.gz / .tgz tarball into the engine's
    models dir. Streams the download so the UI sees real progress; verifies
    SHA-256 when the step declares one (and it's not a TODO placeholder).

    The tarball is removed after successful extraction — no leftover bytes.
    """
    import hashlib
    import tarfile

    import requests

    url = step["url"]
    sha256 = step.get("sha256")
    skip_verify = step.get("skip_verify", False) or (
        isinstance(sha256, str) and sha256.startswith("TODO")
    )

    models_dir = manifest.models_dir
    models_dir.mkdir(parents=True, exist_ok=True)

    # Skip download if the engine's _resolved_dir logic would already find
    # the files (e.g. the user already installed the tarball before).
    # Heuristic: if any of the expected files are present anywhere under
    # models_dir, treat it as already-downloaded.
    expected = step.get("expected_files", [])
    if expected and all(any(models_dir.rglob(f)) for f in expected):
        emit("model-tarball", "model files already present, skipping download")
        return

    # Decide archive format from URL suffix.
    fn = url.rsplit("/", 1)[-1].lower()
    if fn.endswith((".tar.bz2", ".tbz2")):
        mode = "r:bz2"
    elif fn.endswith((".tar.gz", ".tgz")):
        mode = "r:gz"
    else:
        raise InstallError(f"unsupported model-tarball format: {fn}")

    tarball_path = models_dir / "_download.tar"
    emit("downloading-model", f"GET {url}")
    h = hashlib.sha256()
    downloaded = 0
    last_announce = 0
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0) or 0)
        with tarball_path.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 64):
                check_cancel()
                if not chunk:
                    continue
                f.write(chunk)
                h.update(chunk)
                downloaded += len(chunk)
                if downloaded - last_announce >= 1024 * 1024:
                    if total > 0:
                        emit("downloading-model", f"{downloaded // 1048576} / {total // 1048576} MB")
                    else:
                        emit("downloading-model", f"{downloaded // 1048576} MB")
                    last_announce = downloaded
    actual = h.hexdigest()
    emit("downloading-model", f"downloaded {downloaded // 1048576} MB ({actual[:12]}...)")

    if not skip_verify and sha256:
        if actual.lower() != sha256.lower():
            tarball_path.unlink(missing_ok=True)
            raise InstallError(
                f"model-tarball sha256 mismatch: expected {sha256}, got {actual}"
            )

    emit("extracting-model", str(tarball_path))
    with tarfile.open(tarball_path, mode) as tar:
        tar.extractall(models_dir)
    tarball_path.unlink(missing_ok=True)
    emit("model-tarball", "done")


def _install_model_file(
    manifest: EngineManifest,
    step: dict[str, Any],
    emit: Callable[[str, str | None], None],
    check_cancel: Callable[[], None],
) -> None:
    """Download a single model file (no extraction) into models_dir."""
    import hashlib

    import requests

    url = step["url"]
    target = step.get("target_path") or url.rsplit("/", 1)[-1]
    sha256 = step.get("sha256")
    skip_verify = step.get("skip_verify", False) or (
        isinstance(sha256, str) and sha256.startswith("TODO")
    )

    models_dir = manifest.models_dir
    models_dir.mkdir(parents=True, exist_ok=True)
    dest = models_dir / target
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists():
        emit("model-file", f"{target} already present, skipping")
        return

    emit("downloading-model", f"GET {url}")
    h = hashlib.sha256()
    downloaded = 0
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 64):
                check_cancel()
                if not chunk:
                    continue
                f.write(chunk)
                h.update(chunk)
                downloaded += len(chunk)

    if not skip_verify and sha256:
        actual = h.hexdigest()
        if actual.lower() != sha256.lower():
            dest.unlink(missing_ok=True)
            raise InstallError(f"model-file sha256 mismatch on {target}")
    emit("model-file", f"{target} ({downloaded // 1048576} MB)")


def _run_uv_pip(
    uv: str,
    python_exe: Path,
    args: list[str],
    emit: Callable[[str, str | None], None],
    check_cancel: Callable[[], None],
) -> None:
    """Run `uv pip ...` against a specific venv's interpreter, streaming
    output so the UI can show progress.

    uv's --python flag is a *pip-subcommand* option, not a global option,
    so it has to come after `pip install` (or whatever pip subcommand args
    is). We splice it in after the first arg.
    """
    # args[0] is "pip"; args[1] is the pip subcommand ("install"); --python
    # goes after that. Verify and place it correctly.
    if len(args) < 2 or args[0] != "pip":
        raise InstallError(f"_run_uv_pip args must start with ['pip', '<subcommand>', ...]; got {args}")
    cmd = [uv, args[0], args[1], "--python", str(python_exe), *args[2:], "--no-progress"]
    log.info("uv pip command: %s", " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    try:
        assert proc.stdout is not None
        last_line = ""
        for line in proc.stdout:
            check_cancel()
            line = line.rstrip()
            if not line:
                continue
            last_line = line
            emit("installing-deps", line[:200])
        rc = proc.wait()
        if rc != 0:
            raise InstallError(f"uv pip failed (exit {rc}). last: {last_line!r}")
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=SUBPROCESS_KILL_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                proc.kill()


# ─── Subprocess lifecycle ─────────────────────────────────────────────


class EngineProcess:
    """One running engine subprocess. Owns the Popen + the loopback port +
    the httpx client that proxies calls from the host to the engine."""

    def __init__(self, manifest: EngineManifest):
        self.manifest = manifest
        self.proc: subprocess.Popen | None = None
        self.port: int | None = None
        self.client: httpx.Client | None = None
        self._stderr_thread: threading.Thread | None = None

    def spawn(self) -> None:
        """Start the subprocess and read PORT= from stdout.

        For shared engines, the Python interpreter is the shared venv at
        engines/.shared-venv/. For isolated engines, the engine's own venv.
        """
        if self.manifest.isolation == "shared":
            python_exe = shared_venv_python()
            if not python_exe.is_file():
                raise RuntimeError(
                    f"shared venv not set up yet at {SHARED_VENV_DIR}. "
                    f"Click 'Set up engines' or POST /v1/engines/setup."
                )
        else:
            python_exe = _venv_python(self.manifest.venv_dir)
            if not python_exe.is_file():
                raise RuntimeError(
                    f"engine {self.manifest.id} is not installed (no venv at {self.manifest.venv_dir})"
                )
        engine_py = self.manifest.engine_dir / "engine.py"
        if not engine_py.is_file():
            raise RuntimeError(f"engine {self.manifest.id} is missing engine.py")

        env = os.environ.copy()
        # Isolate HF cache to this engine's models dir so Uninstall is a clean rmtree.
        # Set ONLY HF_HOME — transformers + huggingface_hub both honour it and
        # share the same cache tree below it. Setting HUGGINGFACE_HUB_CACHE +
        # TRANSFORMERS_CACHE explicitly creates a SPLIT cache: one tree gets
        # the safetensors, the other gets only the config.json, and loaders
        # that look in the wrong tree blow up with "Can't load feature
        # extractor for ...". Hit this on Qwen3-TTS's `speech_tokenizer/`.
        hf_home = self.manifest.models_dir / "hf"
        hf_home.mkdir(parents=True, exist_ok=True)
        env["HF_HOME"] = str(hf_home)
        env.pop("HUGGINGFACE_HUB_CACHE", None)
        env.pop("TRANSFORMERS_CACHE", None)
        env.pop("HF_HUB_CACHE", None)
        env["JUSTVOICE_MODEL_DIR"] = str(self.manifest.models_dir)
        env["JUSTVOICE_ENGINE_DIR"] = str(self.manifest.engine_dir)

        cmd = [str(python_exe), str(engine_py), "serve", "--port", "0"]
        log.info("spawning engine subprocess: %s", " ".join(cmd))
        self.proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            cwd=str(self.manifest.engine_dir),
        )

        # Read PORT= from stdout (first line). Timeout if the engine hangs.
        deadline = time.monotonic() + PORT_HANDSHAKE_TIMEOUT_S
        line = None
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                stderr_tail = self.proc.stderr.read() if self.proc.stderr else ""
                raise RuntimeError(
                    f"engine {self.manifest.id} subprocess exited during startup "
                    f"(rc={self.proc.returncode}). stderr: {stderr_tail[-2000:]}"
                )
            assert self.proc.stdout is not None
            line = self.proc.stdout.readline()
            if line and line.startswith("PORT="):
                break
            time.sleep(HEALTH_CHECK_INTERVAL_S)
        if not line or not line.startswith("PORT="):
            self.terminate()
            raise RuntimeError(f"engine {self.manifest.id} never announced port within {PORT_HANDSHAKE_TIMEOUT_S}s")
        try:
            self.port = int(line.strip().split("=", 1)[1])
        except ValueError:
            self.terminate()
            raise RuntimeError(f"engine {self.manifest.id} sent bad PORT line: {line!r}")

        # 30 min timeout — heavy autoregressive engines (Dia at max_new_tokens=3072,
        # MOSS-TTSD at 12,000+ tokens) can legitimately take 10+ min for a single
        # synth on consumer GPUs. Better to wait than to false-error.
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{self.port}", timeout=1800.0)

        # Pipe stderr to our logger so engine logs surface in JustVoice server logs.
        def relay_stderr() -> None:
            assert self.proc is not None
            assert self.proc.stderr is not None
            for ln in self.proc.stderr:
                log.info("[%s] %s", self.manifest.id, ln.rstrip())

        self._stderr_thread = threading.Thread(target=relay_stderr, daemon=True)
        self._stderr_thread.start()

        # Health probe — verify the FastAPI is actually responding.
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            try:
                r = self.client.get("/health")
                if r.status_code == 200:
                    log.info("engine %s ready on port %d", self.manifest.id, self.port)
                    return
            except httpx.HTTPError:
                pass
            time.sleep(HEALTH_CHECK_INTERVAL_S)
        self.terminate()
        raise RuntimeError(f"engine {self.manifest.id} subprocess started but /health never returned 200")

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def post(self, path: str, json: dict | None = None) -> httpx.Response:
        if not self.client:
            raise RuntimeError("engine subprocess not running")
        return self.client.post(path, json=json)

    def get(self, path: str) -> httpx.Response:
        if not self.client:
            raise RuntimeError("engine subprocess not running")
        return self.client.get(path)

    def terminate(self) -> None:
        """Best-effort graceful shutdown then SIGTERM/SIGKILL."""
        if self.client:
            try:
                self.client.post("/shutdown", timeout=2.0)
            except Exception:
                pass
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None

        if not self.proc:
            return

        if self.proc.poll() is None:
            try:
                if sys.platform == "win32":
                    self.proc.terminate()
                else:
                    self.proc.send_signal(signal.SIGTERM)
                self.proc.wait(timeout=SUBPROCESS_KILL_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                try:
                    self.proc.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    pass
            except Exception as e:
                log.warning("terminate failed for %s: %s", self.manifest.id, e)

        self.proc = None
        self.port = None


# ─── EngineManager — public surface ───────────────────────────────────


class EngineManager:
    """Top-level manager. One process per `kind` slot loaded at a time
    (Phase 2 / Slice 1 — was a single _current slot pre-Profile-kill).

    Slots map: kind ("tts" | "llm" | "embedding") → EngineProcess. Loading
    a new engine of the same kind unloads the prior occupant of THAT slot;
    other kinds stay loaded. Required for speaker attribution (needs LLM
    + TTS resident simultaneously) and similar mixed-kind workflows.

    `_current` is kept as a back-compat alias pointing at the TTS slot so
    callers that haven't been ported to the kind-aware API (current_id(),
    _require_current(), synth()) keep working.
    """

    def __init__(self):
        self._manifests: dict[str, EngineManifest] = {}
        # Per-kind slot map (Phase 2 / Slice 1).
        self._loaded: dict[str, EngineProcess] = {}
        # Per-engine last loaded variant — surfaced as EngineInfo.current_variant_id
        # so the UI shows server truth not local-state.
        self._current_variants: dict[str, str] = {}
        self._lock = threading.RLock()
        # Engine ids the client has requested to cancel-load. Checked by
        # `cancel_check` callbacks inside `load()`. Adds are made by the
        # `/v1/engines/{id}/cancel-load` endpoint; entries are removed at
        # the end of `load()` (whether the cancel landed in time or not).
        self._cancel_load_requests: set[str] = set()
        self.refresh_manifests()

    # ─── Per-kind slot helpers (Phase 2 / Slice 1) ────────────────────

    @property
    def _current(self) -> EngineProcess | None:
        """Back-compat alias for callers that haven't been ported to the
        kind-aware API. Returns the TTS slot's process or None."""
        return self._loaded.get("tts")

    @_current.setter
    def _current(self, proc: EngineProcess | None) -> None:
        if proc is None:
            self._loaded.pop("tts", None)
        else:
            self._loaded["tts"] = proc

    def loaded_for(self, kind: str) -> EngineProcess | None:
        with self._lock:
            proc = self._loaded.get(kind)
            return proc if proc and proc.is_alive() else None

    def current_for(self, kind: str) -> str | None:
        proc = self.loaded_for(kind)
        return proc.manifest.id if proc else None

    def current_variant_id(self, engine_id: str) -> str | None:
        with self._lock:
            return self._current_variants.get(engine_id)

    def request_cancel_load(self, engine_id: str) -> bool:
        """Mark an in-flight load for cancellation. Returns True if a load is
        actually in progress for that engine; False otherwise (no-op cancel).
        The load loop polls `cancel_check()` at safe points and raises
        `RuntimeError("cancelled")` to short-circuit. Side effect: kills the
        subprocess if it was already spawned."""
        with self._lock:
            self._cancel_load_requests.add(engine_id)
            # Find this engine across all kind slots and terminate it.
            for kind, proc in list(self._loaded.items()):
                if proc.manifest.id == engine_id:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    self._loaded.pop(kind, None)
                    self._current_variants.pop(engine_id, None)
                    return True
        return False

    def refresh_manifests(self) -> None:
        with self._lock:
            self._manifests = discover_engines()

    def manifests(self) -> dict[str, EngineManifest]:
        with self._lock:
            return dict(self._manifests)

    def get_manifest(self, engine_id: str) -> EngineManifest | None:
        with self._lock:
            return self._manifests.get(engine_id)

    def status(self, engine_id: str) -> str:
        """One of: not_installed | installed | loaded."""
        with self._lock:
            m = self._manifests.get(engine_id)
            if not m:
                return "not_installed"
            for proc in self._loaded.values():
                if proc.manifest.id == engine_id and proc.is_alive():
                    return "loaded"
            return "installed" if m.is_installed else "not_installed"

    def current_id(self) -> str | None:
        """Back-compat: returns the TTS slot's engine id. New callers
        should use current_for(kind) explicitly."""
        return self.current_for("tts")

    # ─── Install / Uninstall ──────────────────────────────────────────

    def install(
        self,
        engine_id: str,
        progress: Callable[[str, str | None], None] | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> None:
        m = self.get_manifest(engine_id)
        if m is None:
            raise InstallError(f"unknown engine: {engine_id}")
        install_engine(m, progress=progress, cancel_check=cancel_check)

    def uninstall(self, engine_id: str) -> dict:
        """Kill subprocess if running, rmtree every install-created directory.

        Leaves plugin SOURCE (manifest.py / engine.py / requirements.txt)
        untouched so a reinstall works.
        """
        m = self.get_manifest(engine_id)
        if m is None:
            raise InstallError(f"unknown engine: {engine_id}")
        with self._lock:
            for kind, proc in list(self._loaded.items()):
                if proc.manifest.id == engine_id:
                    proc.terminate()
                    self._loaded.pop(kind, None)
            self._current_variants.pop(engine_id, None)
        removed = []
        for sub in (".venv", "models", "voices", "state"):
            p = m.engine_dir / sub
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)
                removed.append(sub)
        return {"engine_id": engine_id, "removed": removed}

    # ─── Load / Unload ────────────────────────────────────────────────

    def load(
        self,
        engine_id: str,
        device: str = "auto",
        variant: str | None = None,
        progress: Callable[[str, str | None], None] | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> dict:
        m = self.get_manifest(engine_id)
        if m is None:
            raise RuntimeError(f"unknown engine: {engine_id}")

        # Drop any stale cancel flag and compose the caller's `cancel_check`
        # (if any) with our flag-driven one. Either signal aborts the load.
        with self._lock:
            self._cancel_load_requests.discard(engine_id)
        _server_cancel = lambda: engine_id in self._cancel_load_requests  # noqa: E731
        if cancel_check is None:
            effective_cancel = _server_cancel
        else:
            effective_cancel = lambda: _server_cancel() or cancel_check()  # noqa: E731

        def _maybe_cancel() -> None:
            if effective_cancel():
                raise RuntimeError("cancelled by user")

        try:
            _maybe_cancel()

            # For shared engines (monolithic style), Load is the only
            # button. If the shared venv isn't built or model files aren't on
            # disk yet, do that first — same task, no separate Install step.
            if m.isolation == "shared":
                if not shared_venv_exists():
                    if progress:
                        progress("setup-shared-venv", "first-time setup: creating shared venv…")
                    from . import shared_venv as sv
                    sv.setup_shared_venv(progress=progress, cancel_check=effective_cancel)

                _maybe_cancel()

                # Run model downloads if they haven't been fetched yet. For HF-cache
                # engines with no expected_files, this is a no-op (engine.load()
                # pulls from HF on first import). For Kokoro etc. we download here
                # so first-time Load is one transparent step.
                if not m.is_installed:
                    if progress:
                        progress("downloading-model", f"first load of {engine_id} — fetching model files")
                    _install_engine_shared(m, progress, effective_cancel)
            else:
                # Isolated engine — needs its own venv built via the Install button.
                if not m.is_installed:
                    raise RuntimeError(
                        f"engine {engine_id} (isolated) is not installed yet. "
                        f"Click Install to build its venv."
                    )

            _maybe_cancel()

            target_kind = m.kind
            with self._lock:
                # Unload the SAME-KIND slot's prior occupant — other kinds
                # stay loaded (Phase 2 / Slice 1).
                prior = self._loaded.get(target_kind)
                if prior and prior.manifest.id != engine_id:
                    log.info(
                        "unloading %s engine %s before loading %s",
                        target_kind, prior.manifest.id, engine_id,
                    )
                    prior.terminate()
                    self._loaded.pop(target_kind, None)
                elif prior and prior.manifest.id == engine_id and prior.is_alive():
                    # Already loaded — just return current voices.
                    if variant is not None:
                        self._current_variants[engine_id] = variant
                    return prior.get("/voices").json()

                if progress:
                    progress("spawning", f"spawning {engine_id} subprocess")
                proc = EngineProcess(m)
                proc.spawn()
                self._loaded[target_kind] = proc

            _maybe_cancel()

            # Now POST /load to the engine — this is where the model actually
            # comes into memory.
            if progress:
                progress("loading_weights", f"loading {engine_id} weights")
            r = proc.post("/load", json={"device": device, "variant": variant})
            if r.status_code != 200:
                log.warning("engine %s /load failed: %s", engine_id, r.text[:400])
                with self._lock:
                    proc.terminate()
                    self._loaded.pop(target_kind, None)
                raise RuntimeError(f"engine load failed: {r.text}")
            with self._lock:
                self._current_variants[engine_id] = variant or m.default_variant_id or ""
            if progress:
                progress("warming_up", f"{engine_id} ready")
            return r.json()
        finally:
            # Always clear the cancel flag — leaving stale "cancelled" state
            # would block the next load attempt.
            with self._lock:
                self._cancel_load_requests.discard(engine_id)

    def unload(self, kind: str | None = None) -> dict:
        """Unload the engine in the given kind's slot.

        kind=None means "unload all slots" (back-compat with the
        pre-Slice-1 /v1/engines/unload behavior that emptied the single
        loaded slot). New callers should pass kind explicitly.
        """
        with self._lock:
            if kind is None:
                if not self._loaded:
                    return {"previous_engine": None}
                # Back-compat: surface the first kind's previous engine,
                # then drop everything.
                prev = next(iter(self._loaded.values())).manifest.id
                for proc in list(self._loaded.values()):
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                self._loaded.clear()
                self._current_variants.clear()
                return {"previous_engine": prev}
            proc = self._loaded.get(kind)
            if not proc:
                return {"previous_engine": None}
            prev = proc.manifest.id
            proc.terminate()
            self._loaded.pop(kind, None)
            self._current_variants.pop(prev, None)
        return {"previous_engine": prev}

    # ─── Synth / voices / clone — HTTP proxy ─────────────────────────

    def voices(self, engine_id: str) -> list[dict]:
        proc = self._require_current(engine_id)
        r = proc.get("/voices")
        r.raise_for_status()
        return r.json().get("voices", [])

    def synth(self, engine_id: str, body: dict) -> tuple[bytes, dict]:
        """Returns (audio_bytes, headers_dict_for_re_export)."""
        proc = self._require_current(engine_id)
        r = proc.post("/synth", json=body)
        if r.status_code != 200:
            raise RuntimeError(f"engine synth failed: {r.text}")
        # Mirror the engine's audio headers back through to the host caller.
        sample_rate = r.headers.get("X-JustVoice-Sample-Rate")
        channels = r.headers.get("X-JustVoice-Channels")
        is_wav = r.headers.get("X-JustVoice-WAV-Container") == "1"
        return r.content, {
            "media_type": r.headers.get("content-type", "audio/wav"),
            "sample_rate": int(sample_rate) if sample_rate else None,
            "channels": int(channels) if channels else 1,
            "is_wav_container": is_wav,
        }

    def clone(self, engine_id: str, body: dict) -> dict:
        proc = self._require_current(engine_id)
        r = proc.post("/clone", json=body)
        if r.status_code != 200:
            raise RuntimeError(f"engine clone failed: {r.text}")
        return r.json()

    def transcribe(self, audio_path: str, language: str | None = None) -> str:
        """Speech-to-text via the loaded KIND="stt" engine (whisper).

        Raises RuntimeError with an actionable message when no STT engine
        is loaded — the captures API maps that to a 409 the UI can show.
        """
        proc = self.loaded_for("stt")
        if proc is None:
            raise RuntimeError(
                "no STT engine loaded — install + load Whisper on the Engines "
                "tab (or POST /v1/engines/whisper/load) first"
            )
        r = proc.post("/transcribe", json={"audio_path": audio_path, "language": language})
        if r.status_code != 200:
            raise RuntimeError(f"transcribe failed: {r.text[:400]}")
        return r.json().get("text", "")

    def _require_current(self, engine_id: str) -> EngineProcess:
        with self._lock:
            for proc in self._loaded.values():
                if proc.manifest.id == engine_id and proc.is_alive():
                    return proc
            raise RuntimeError(
                f"engine {engine_id} is not loaded — POST /v1/engines/{engine_id}/load first"
            )


# ─── Singleton accessor ───────────────────────────────────────────────


_manager: EngineManager | None = None
_manager_lock = threading.Lock()


def get_manager() -> EngineManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = EngineManager()
        return _manager


def shutdown_manager() -> None:
    """Called on JustVoice server shutdown — kill any running engine subprocess."""
    global _manager
    with _manager_lock:
        if _manager is None:
            return
        _manager.unload()
        _manager = None
