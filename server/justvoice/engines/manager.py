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
- Windows: subprocess uses `.venv\\Scripts\\python.exe`; POSIX uses `.venv/bin/python`.
- uv must be on PATH (we shell out via `subprocess.run(["uv", ...])`); the
  manager verifies this at startup and surfaces a clear error if missing.
"""

from __future__ import annotations

import atexit
import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
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

# The speech measured currency (the 2026-08-13/14 redesign, amended —
# docs/plans/2026-08-13-speech-catalog-redesign.md §10). The probes can
# shell out (nvidia-smi / typeperf), so every polling/per-line caller goes
# through a short TTL cache. There is NO pre-load estimate constant: the
# only numbers in the pricing chain are measured ones.
PROBE_TTL_S = 2.0


@contextmanager
def _kind_busy(kind: str):
    """Mark the arbiter's `kind` busy for the block (Q1's never-evict-busy —
    the 2026-08-13 VRAM wiring, step 4). Best-effort: without the shared stack
    there is no ledger and nothing to protect."""
    try:
        from llm_runner.runner.arbiter import get_arbiter

        arb = get_arbiter()
    except Exception:  # noqa: BLE001
        arb = None
    if arb is not None:
        arb.busy_begin(kind)
    try:
        yield
    finally:
        if arb is not None:
            arb.busy_end(kind)


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
    """Cheap check: the interpreter file is present.

    Deliberately does NOT prove the interpreter runs — see
    `shared_venv_healthy()`. Kept cheap because the install paths call it
    in loops.
    """
    return shared_venv_python().is_file()


# ─── Moved-install detection (user ruling 2026-08-14) ─────────────────
# The app folder is portable: the user can move the whole install and it
# keeps working, because everything inside it is relative. Python venvs are
# the exception — `pyvenv.cfg`, the `Scripts/` launchers and the installed
# console scripts all embed ABSOLUTE paths, so a moved install carries venvs
# that silently no longer work. We stamp each venv with the install path it
# was built for and compare on status, so a moved install reports "needs
# reinstall" up front instead of failing deep inside a load.
VENV_ORIGIN_FILE = ".jv-venv-origin"


def record_venv_origin(venv_dir: Path) -> None:
    """Stamp the install path this venv was created under. Best-effort: a
    venv that cannot be stamped simply falls back to the legacy behaviour
    (treated as matching) rather than breaking the install."""
    try:
        (venv_dir / VENV_ORIGIN_FILE).write_text(str(ENGINES_DIR.resolve()), encoding="utf-8")
    except OSError:  # noqa: BLE001 — a stamp is a convenience, never a gate
        log.debug("could not stamp venv origin at %s", venv_dir, exc_info=True)


def venv_origin_matches(venv_dir: Path) -> bool:
    """False ONLY when the stamp exists and names a different install.

    An unstamped venv (built before this existed) reads as matching — the
    interpreter health probe still covers the genuinely broken ones, and
    declaring every pre-existing venv dead would force a needless rebuild.
    """
    try:
        stamped = (venv_dir / VENV_ORIGIN_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return True
    if not stamped:
        return True
    return Path(stamped) == ENGINES_DIR.resolve()


# Cache for the health probe. `None` = not yet probed. Spawning a process is
# far too expensive for a check the readiness endpoint polls.
_venv_health: bool | None = None


def invalidate_shared_venv_health() -> None:
    """Drop the cached probe result — call after creating or deleting the venv."""
    global _venv_health
    _venv_health = None


def shared_venv_healthy() -> bool:
    """Does the shared venv's interpreter actually RUN?

    A venv is a handful of files plus a `pyvenv.cfg` naming the base Python
    it was created from. Delete or upgrade that base and every file is still
    on disk while the interpreter is dead — on Windows it exits non-zero with
    `No Python at '<old path>'`.

    This is not hypothetical. It happened here: `.shared-venv` was built
    against `E:\\Python310`, that install went away, and because readiness was
    only ever a file-existence check the server kept reporting the venv ready.
    The breakage surfaced instead as a 502 when something tried to load an
    engine — a symptom several layers away from the cause, which is the
    expensive kind of bug.

    Cached, since the answer only changes when the venv is created or removed.
    """
    global _venv_health
    if _venv_health is not None:
        return _venv_health
    exe = shared_venv_python()
    if not exe.is_file():
        _venv_health = False
        return _venv_health
    # A venv built under a DIFFERENT install path is dead in the same way
    # (absolute paths baked into its launchers) — catch it without paying
    # for a subprocess.
    if not venv_origin_matches(SHARED_VENV_DIR):
        log.warning(
            "shared venv was built for a different install location — the app "
            "folder moved; it will be rebuilt on the next engine setup"
        )
        _venv_health = False
        return _venv_health
    try:
        proc = subprocess.run(
            [str(exe), "-c", ""],
            capture_output=True, text=True, timeout=20,
        )
        _venv_health = proc.returncode == 0
        if not _venv_health:
            stderr = (proc.stderr or "").strip()[:200]
            log.error(
                "shared venv interpreter is present but does not run (%s) — "
                "re-run the shared-venv setup to rebuild it. stderr: %s",
                exe, stderr,
            )
    except (OSError, subprocess.SubprocessError) as e:
        log.error("shared venv interpreter could not be probed (%s): %s", exe, e)
        _venv_health = False
    return _venv_health


def legacy_files_engine_visible(models_dir: Path, expected: list[str]) -> bool:
    """True when every expected legacy file sits where the ENGINE will look:
    flat or ONE subdir under models_dir (the kokoro engine's own search).
    THE one probe for the legacy engine-dir layout — the load door and the
    catalog's on_disk flag must agree, or the row says "on disk" while the
    load can't find the files. The first probes used rglob at any depth and
    claimed a tarball extracted TWO levels deep
    (models/<variant>/<tarball-root>/) was servable — user-hit 2026-08-15
    ("Kokoro model files not found")."""
    if not expected or not models_dir.exists():
        return False

    def _visible(f: str) -> bool:
        if (models_dir / f).exists():
            return True
        return any((sub / f).exists()
                   for sub in models_dir.iterdir() if sub.is_dir())

    try:
        return all(_visible(f) for f in expected)
    except OSError:
        return False


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
        return self.kinds[0]

    @property
    def kinds(self) -> list[str]:
        """Engines redesign: multi-capability engines declare
        KINDS = ["tts", "stt"]; single-capability manifests keep KIND.
        Always non-empty; kinds[0] is the primary (slot + section)."""
        ks = getattr(self.module, "KINDS", None)
        if isinstance(ks, (list, tuple)) and ks:
            return [str(k) for k in ks]
        return [getattr(self.module, "KIND", "tts")]

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
            # A venv built under a different install path needs rebuilding
            # (the app folder moved) — report "not installed" so the UI
            # offers Install instead of failing deep inside a load.
            return _venv_python(self.venv_dir).is_file() and venv_origin_matches(self.venv_dir)
        if not shared_venv_exists() or not venv_origin_matches(SHARED_VENV_DIR):
            return False
        # Phase ④: a variant COMPLETE in the speech cache also counts — a
        # prefetched engine is installed (shared venv + files present), so
        # the status chip stops saying "not installed" over an on-disk row
        # and the load door never re-runs the legacy tarball steps.
        try:
            from .. import speech_cache
            from ..app_state import get_state

            if speech_cache.any_variant_on_disk(get_state().data_dir, self.id):
                return True
        except Exception:  # noqa: BLE001 — bare tests / no app state
            pass
        # Legacy: check that the engine's expected model files are present.
        # If there are no model_install_steps, the engine pulls via HF cache on
        # first load — we treat that as "installed" once the shared venv exists.
        # DELIBERATELY any-depth (not legacy_files_engine_visible): a tarball
        # stranded too deep still marks the ENGINE installed — the venv is
        # real, the per-variant on_disk flag says the truth about the files,
        # and the load door heals via the speech cache. Tightening this would
        # flip the chip to "not installed" and route users into the legacy
        # tarball re-install instead (2026-08-15 review).
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


#: Kept in lockstep with justvoice_plugin/pyproject.toml — the /load
#: `model_dir` contract (phase ②) rides the SDK, so a venv carrying an
#: older install gets a fast refresh at spawn.
PLUGIN_VERSION = "0.2.0"


def _ensure_plugin_current(python_exe: Path) -> None:
    """Refresh the venv's justvoice_plugin when it predates PLUGIN_VERSION
    (cheap dist-info glob; the reinstall is a tiny wheel, seconds).
    Best-effort by design: a failure leaves the old SDK, which degrades
    gracefully — it ignores the extra /load field and the engine loads its
    legacy way."""
    try:
        venv_root = python_exe.parents[1]
        sps = [venv_root / "Lib" / "site-packages",
               *venv_root.glob("lib/python*/site-packages")]
        sp = next((p for p in sps if p.is_dir()), None)
        if sp is None or list(sp.glob(f"justvoice_plugin-{PLUGIN_VERSION}.dist-info")):
            return
        uv = _check_uv_available()
        plugin_dir = Path(__file__).resolve().parents[2] / "justvoice_plugin"
        log.info("refreshing justvoice_plugin to %s in %s", PLUGIN_VERSION, venv_root)
        subprocess.run(
            [uv, "pip", "install", "--python", str(python_exe), "--reinstall",
             str(plugin_dir)],
            capture_output=True, text=True, timeout=180,
        )
    except Exception:  # noqa: BLE001 — best-effort; the old SDK still works
        log.debug("plugin currency refresh failed", exc_info=True)


#: The Python the ENGINE venvs are built on, pinned deliberately.
#:
#: Not `sys.executable`, for two reasons. In the shipped bundle the server is a
#: PyInstaller one-file sidecar, so `sys.executable` is `justvoice-server.exe` —
#: not a Python interpreter at all. Passing it to `uv venv --python` fails, and
#: the code then fell through to a no-`--python` fallback where uv picked
#: whatever interpreter it liked. Engine setup "worked" by accident, on an
#: unpredictable version.
#:
#: That unpredictability is the real problem: the engine wheels are
#: version-sensitive (torch cu124, numba/llvmlite ship per-Python builds), so
#: "whatever uv found" is not a basis for installing them. Pinning means uv
#: resolves a matching interpreter from the machine, or downloads a managed one
#: if there is none — which is also what lets engine install work on a box with
#: no Python at all, with the user never running a command.
#:
#: Bump this only together with checking the engine wheel matrix.
ENGINE_PYTHON_VERSION = "3.12"


def _uv_candidates() -> list[Path]:
    """Where to look for uv, in priority order.

    The BUNDLED copy wins. JustVoice ships uv as a Tauri `externalBin` sidecar,
    which lands beside the server binary — so a user who has never installed uv
    (i.e. almost every user) still gets working engine installs. PATH is the
    dev-machine fallback, not the shipping mechanism.
    """
    exe = "uv.exe" if sys.platform == "win32" else "uv"
    out: list[Path] = []
    # Frozen: sys.executable IS the sidecar, so its directory holds the
    # co-located uv. Unfrozen: this is the interpreter's dir, harmless to probe.
    try:
        out.append(Path(sys.executable).resolve().parent / exe)
    except OSError:
        pass
    # Dev convenience: a vendored copy under the repo, if anyone drops one in.
    out.append(ENGINES_DIR.parent.parent / "vendor" / exe)
    return out


def _check_uv_available() -> str:
    """Resolve uv — bundled sidecar first, then PATH. Returns an absolute path.

    Raises InstallError only when neither exists, which in a correctly built
    release should be unreachable.
    """
    for cand in _uv_candidates():
        if cand.is_file():
            return str(cand)
    uv_path = shutil.which("uv")
    if not uv_path:
        raise InstallError(
            "uv was not found beside the server binary or on PATH. A release build "
            "ships it as a sidecar, so this usually means a broken install — "
            "reinstall JustVoice. For a dev checkout, install uv from "
            "https://docs.astral.sh/uv/ (macOS/Linux: "
            "`curl -LsSf https://astral.sh/uv/install.sh | sh`, "
            "Windows: `irm https://astral.sh/uv/install.ps1 | iex`)."
        )
    return uv_path


def _detect_torch_index_url() -> tuple[str | None, str]:
    """Pick a torch wheel index based on detected hardware.

    Returns (index_url, label). When index_url is None, default PyPI is used
    (CPU-only wheels). Detection logic for CUDA / Intel Arc / Apple Silicon.
    """
    # User override always wins.
    override = os.environ.get("JUSTVOICE_TORCH_INDEX")
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

    # 1. Create venv — idempotent (uv complains if one exists, so we pass
    #    --allow-existing). Pinned to ENGINE_PYTHON_VERSION, NOT sys.executable:
    #    see that constant for why, but briefly — in the shipped bundle
    #    sys.executable is the PyInstaller sidecar, which is not an interpreter.
    #    There is deliberately no "let uv pick anything" fallback here; an
    #    engine venv on an arbitrary Python version installs wheels that may not
    #    match, and failing loudly beats a subtly wrong environment.
    emit("creating-venv", f"uv venv {venv} (python {ENGINE_PYTHON_VERSION})")
    result = subprocess.run(
        [uv, "venv", str(venv), "--python", ENGINE_PYTHON_VERSION, "--allow-existing"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise InstallError(f"uv venv failed: {result.stderr.strip() or result.stdout.strip()}")
    check_cancel()

    python_exe = _venv_python(venv)
    if not python_exe.is_file():
        raise InstallError(f"venv created but python not found at {python_exe}")
    # Stamp the install path this venv belongs to (moved-install detection).
    record_venv_origin(venv)

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

    # Skip download only if the engine's _resolved_dir logic would already
    # find the files (the user installed the tarball before) — THE one
    # engine-visibility probe, matching the engine's flat-or-one-subdir
    # search. The old any-depth rglob skipped the download for a tarball
    # stranded two levels deep, leaving the engine unloadable.
    expected = step.get("expected_files", [])
    if legacy_files_engine_visible(models_dir, expected):
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

        # Phase ②: the /load model_dir contract needs the current SDK in
        # the venv — refresh a stale install before the subprocess exists.
        _ensure_plugin_current(python_exe)

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

    def post(self, path: str, json: dict | None = None, timeout: float | None = None) -> httpx.Response:
        if not self.client:
            raise RuntimeError("engine subprocess not running")
        if timeout is not None:
            return self.client.post(path, json=json, timeout=timeout)
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
        # Per-kind activity locks — held around an engine's in-flight synth /
        # transcribe HTTP call, and by load/unload around terminating a slot's
        # occupant. Guarantees a load can never kill an engine process
        # mid-line now that endpoints await instead of blocking the event
        # loop (§7b P2-6 of docs/plans/2026-08-08-vram-think.md). Lock
        # order: activity → self._lock, never the reverse.
        self._activity_locks: dict[str, threading.Lock] = {}
        # The 2026-08-13 VRAM wiring: engine_id → the device its last confirmed
        # load actually resolved to (Q2: always visible, never hidden), and the
        # once-per-process kit hardware snapshot the device policy + admission
        # read (None until first use; detect shells out to nvidia-smi).
        self._resolved_devices: dict[str, str] = {}
        self._hw_cache = None
        self._hw_detected = False
        # The measured true-up's probe TTL cache: key → (monotonic ts, value).
        # Keys: "pool" (device-wide used) and "pid:<n>" (one engine process).
        self._probe_cache: dict[str, tuple[float, int | None]] = {}
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

    def _activity(self, kind: str) -> threading.Lock:
        """The kind's activity lock (see __init__). Created on first use."""
        with self._lock:
            lock = self._activity_locks.get(kind)
            if lock is None:
                lock = threading.Lock()
                self._activity_locks[kind] = lock
            return lock

    # ─── VRAM arbitration (the 2026-08-13 wiring — vram-think §6 step 3) ──
    #
    # The manager joins the kit's process-wide VramArbiter (the shared ledger
    # the bundled LLM runner already runs): device resolves HERE (the one load
    # door), a booking load admits via the shared `make_room`, a confirmed load
    # reserves with source="declared" (§13.1 — a manifest price never reads as
    # measured truth), and every unload path releases. All kit calls are
    # best-effort lazy imports so bare unit tests run without the shared stack.

    def _hardware(self):
        """The kit's hardware snapshot, detected once per process (it shells
        out to nvidia-smi). None when detection is unavailable — resolution
        then falls to CPU and admission books nothing."""
        if not self._hw_detected:
            self._hw_detected = True
            try:
                from llm_runner.runner.hardware import detect

                self._hw_cache = detect()
            except Exception:  # noqa: BLE001 — no kit / detect failure → honest CPU fallback
                self._hw_cache = None
        return self._hw_cache

    @staticmethod
    def _user_device_override(engine_id: str) -> str:
        """The operator's Device choice for this engine
        (settings.engines.engine_overrides[id].device — the Speech-engines
        card's Device select, Q2's decided setting). Best-effort: unit tests
        run without app state → "" (auto)."""
        try:
            from ..app_state import get_state

            ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
            return (ov.device or "") if ov else ""
        except Exception:  # noqa: BLE001 — no state / mid-boot → auto
            return ""

    def _resolve_device(self, m: EngineManifest, requested: str | None) -> str:
        """Q2 (decided 2026-08-08 round 2): an explicit request wins → the
        operator's per-engine Device setting → the auto policy (`cpu_adequate`
        manifest fact → cpu; else cuda when this box has it; else cpu). The
        resolved device is ALWAYS passed down explicitly — the engine
        subprocess's own torch/sherpa "auto" (hidden greedy-cuda) is the thing
        this removes (precedent: the runner's #274 embed placement)."""
        if requested not in (None, "", "auto"):
            return requested
        user = self._user_device_override(m.id)
        if user not in ("", "auto"):
            return user
        if (getattr(m, "requirements", None) or {}).get("cpu_adequate"):
            return "cpu"
        hw = self._hardware()
        runtimes = getattr(hw, "runtimes", None) or {}
        return "cuda" if runtimes.get("cuda") else "cpu"

    def _books_memory(self, resolved_device: str) -> bool:
        """THE ONE-POOL RULING (2026-08-13, "your rec go"): on one-pool boxes
        (integrated/unified — CPU and GPU are the same physical bytes) EVERY
        managed load books its measured footprint into the pool ledger; on
        discrete boxes only a device-resolved load holds VRAM (cpu is free —
        its RAM is display-only, §8.18). "cuda" in Q2's ruling means "a GPU
        device": kokoro's directml/coreml arms hold device memory the same
        way, so any non-cpu resolve books on discrete too."""
        hw = self._hardware()
        if hw is None:
            return False
        try:
            from llm_runner.runner.hardware import mem_arch

            if mem_arch(hw) != "discrete":
                return True
        except Exception:  # noqa: BLE001 — no kit → nothing to book against
            return False
        return resolved_device != "cpu"

    @staticmethod
    def _safety_margin_mb() -> int:
        """The runner config's existing margin knob (P5-4: the SAME knob the
        LLM admission subtracts — no new hardcoded value); the kit's seed
        default when the shared service isn't wired."""
        try:
            from llm_runner.runner.lifecycle import get_service

            return int(get_service().config().safety_margin_mb)
        except Exception:  # noqa: BLE001 — standalone/bare tests → the seed default
            try:
                from llm_runner.runner.config import DEFAULT_SAFETY_MARGIN_MB

                return int(DEFAULT_SAFETY_MARGIN_MB)
            except Exception:  # noqa: BLE001
                return 1024

    # ── The measured currency (the 2026-08-13/14 redesign, amended) ───────
    # The declared `vram_min_mb` died first (scaffold-invented fiction: 350M
    # turbo booked 4096); the ESTIMATE ladder that replaced it died the next
    # day (plan doc §10): run against real engines it priced turbo at
    # 4,455 MB — WORSE than the deleted number — because repos ship
    # alternative checkpoints that never co-load; a file's size is a fact,
    # a file's size predicting VRAM is a model with unpriced error terms.
    # The chain now: a PRIOR MEASURED footprint of this engine on this box
    # admits AND books early (covering the seconds between admission and the
    # post-load true-up); a FIRST-EVER load gets NO arithmetic — no invented
    # number, no eviction on its behalf: attempt, measure, book, persist
    # ("not measured yet" until the probe lands). Measurement is per-PID
    # over the engine's process TREE — tree, because Windows venv pythons
    # are launcher SHIMS whose child holds the memory (proven live: 4 MB at
    # the Popen pid, 1131 MB at its child); per-PID rather than a device
    # delta, because JV loads don't serialize under the runner's router
    # lock — a concurrent runner load would cross-charge a delta. The delta
    # survives only as the last-resort fallback on boxes with no
    # per-process arm (AMD Linux), labeled "computed", never persisted.

    def pool_used_mb(self, *, fresh: bool = False) -> int | None:
        """Measured used memory of the budget pool — THE kit's cached door.

        Delegates to `llm_runner.runner.hardware.used_pool_mb`, which owns the
        TTL cache for the whole family (2026-08-14). JustVoice used to keep its
        own cache over the same nvidia-smi call, so the speech strip and the LLM
        strip on the SAME page could report different occupancy at the same
        instant — two caches, two truths, the defect this redesign exists to
        remove. `fresh=True` bypasses the cache for the load door, which must
        never admit against a stale reading."""
        try:
            from llm_runner.runner.hardware import used_pool_mb

            return used_pool_mb(fresh=fresh)
        except Exception:  # noqa: BLE001 — no kit → honestly unmeasurable
            return None

    def _engine_proc_mb(self, proc: EngineProcess, *, fresh: bool = True) -> int | None:
        """Measured memory held by ONE engine subprocess — its process TREE
        (pid + descendants, summed: Windows venv pythons are launcher shims
        whose CHILD holds the memory; the single-pid probe read 4 MB where
        the child held 1131): dedicated device memory on discrete boxes
        (per-PID — exact attribution even while the runner loads
        concurrently; on Windows-WDDM the GPU Process Memory counter arm,
        where nvidia-smi answers N/A), resident set on one-pool boxes (UMA:
        the pool take IS system memory). None = unmeasurable — the caller
        falls back to the device-wide delta or books nothing."""
        pid = getattr(getattr(proc, "proc", None), "pid", None)
        if not pid:
            return None
        now = time.monotonic()
        key = f"pid:{pid}"
        if not fresh:
            hit = self._probe_cache.get(key)
            if hit is not None and now - hit[0] < PROBE_TTL_S:
                return hit[1]
        try:
            from llm_runner.runner.hardware import (
                mem_arch,
                process_tree_device_mem_mb,
                process_tree_rss_mb,
            )
        except Exception:  # noqa: BLE001 — no kit
            return None
        hw = self._hardware()
        if hw is not None and mem_arch(hw) != "discrete":
            val = process_tree_rss_mb(pid)
        else:
            val = process_tree_device_mem_mb(pid)
        self._probe_cache[key] = (now, val)
        return val

    def _prior_measured_mb(self, kind: str, engine_id: str) -> int:
        """The newest measured footprint of this engine on THIS box, from the
        shared measurement store (rows recorded by `_record_speech_load`
        under `kind:engine:variant` ids). Across variants the MAX wins —
        conservative until the exact variant has its own row. 0 = no
        evidence yet."""
        try:
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            mk = current_machine_key()
            prefix = f"{kind}:{engine_id}"
            best = 0
            for row in get_model_measurement_store().list(None):
                if (row.modelId == prefix or row.modelId.startswith(prefix + ":")) \
                        and row.machineKey == mk and row.vramModelMb > 0:
                    best = max(best, int(row.vramModelMb))
            return best
        except Exception:  # noqa: BLE001 — bare tests / store not wired
            return 0

    def _admit_memory(self, m: EngineManifest, kind: str, engine_id: str,
                      needed_mb: int) -> None:
        """Budget admission for a booking load whose PRIOR MEASURED footprint
        is known (the amended §10 chain — a first-ever load skips admission
        entirely: no invented number may evict anything). Prices on MEASURED
        free memory: free = budget pool − the measured used probe (what
        nvidia-smi would say), not ledger arithmetic — the ledger can't see
        other apps' usage. When free is short, `make_room`'s ledger target
        is inflated by the UNLEDGERED usage (measured used − committed), so
        evicting to ledger-room yields real room. An unmeasurable box falls
        back to the ledger-remaining arithmetic (the wiring's original
        behavior). Runs with NO manager locks held (cross-app lock-order
        rule); busy kinds are protected inside `make_room`; a refusal is
        HONEST and leaves the world exactly as it was."""
        needed = int(needed_mb)
        if needed <= 0:
            return
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001 — bare tests: nothing to admit against
            return
        arb = get_arbiter()
        hw = self._hardware()
        margin = self._safety_margin_mb()
        want = needed + margin
        used = self.pool_used_mb(fresh=True)
        total = 0
        if hw is not None:
            try:
                from llm_runner.runner.hardware import budget_total_mb

                total = int(budget_total_mb(hw))
            except Exception:  # noqa: BLE001
                total = 0
        if used is not None and total > 0:
            free = max(0, total - used)
            if want <= free:
                return
            committed = max(0, total - arb.remaining_mb(hw))
            foreign = max(0, used - committed)
            target = want + foreign
        else:
            free = None
            if want <= arb.remaining_mb(hw):
                return
            target = want
        if arb.make_room(target, exclude=f"{kind}:{engine_id}", hardware=hw,
                         reason=f"loading {engine_id}"):
            # Eviction frees device memory ASYNCHRONOUSLY (a terminated child
            # drains over ~a second). Wait briefly for the measured number to
            # agree; if it stays short, proceed — the ledger says room, and
            # the spawn OOM remains the last net.
            if free is not None:
                deadline = time.monotonic() + 4.0
                while time.monotonic() < deadline:
                    u = self.pool_used_mb(fresh=True)
                    if u is None or max(0, total - u) >= want:
                        break
                    time.sleep(0.4)
            return
        snap = arb.snapshot(hw)
        have = f"{free} MB free of {total} MB (measured)" if free is not None else \
            f"{snap['remaining_mb']} MB of {snap['vram_total_mb']} MB unbooked"
        resident = ", ".join(
            f"{r['key']} ({r['vram_mb']} MB)" for r in snap["reservations"]
        ) or "nothing"
        busy = ", ".join(snap["busy_kinds"]) or "none"
        raise RuntimeError(
            f"not enough memory to load {engine_id}: it needs ~{needed} MB "
            f"(+{margin} MB safety margin) but only {have} remain. "
            f"Resident: {resident}; busy: {busy}. "
            f"Wait for the current work to finish or unload something first."
        )

    def _reserve_engine(self, m: EngineManifest, kind: str, mb: int,
                        source: str) -> None:
        """Book the confirmed load at `mb` with its honest provenance —
        "measured" when a per-PID probe produced the number, "computed" when
        the estimate stands (§13.1: an estimate must never read as live
        truth). Key = "kind:engine_id"; kind maps to the arbiter's tts/stt
        vocabulary (never "llm" — the runner's count scope, P5-3);
        `evict_fn` is our any-thread evictor. A crashed engine's reservation
        lingers until its slot next loads/unloads — conservative."""
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001
            return
        arb_kind = "stt" if kind == "stt" else "tts"
        get_arbiter().reserve(
            f"{kind}:{m.id}", int(mb), kind=arb_kind,
            evict_fn=lambda k=kind, eid=m.id: self._evict_for_arbiter(k, eid),
            source=source,
        )

    def _record_speech_load(self, m: EngineManifest, kind: str,
                            variant: str | None, mb: int, device: str) -> None:
        """Persist a measured footprint as a source='load' row in the shared
        measurement store (id `kind:engine:variant`, kind-tagged tts/stt) —
        the evidence the estimate ladder reads on the next load. Best-effort:
        persistence must never fail a load."""
        try:
            from llm_runner.llm.stores import get_model_measurement_store
            from llm_runner.runner.hardware import current_machine_key

            get_model_measurement_store().record(
                f"{kind}:{m.id}:{variant or ''}".rstrip(":"),
                machine_key=current_machine_key(), source="load",
                label=f"speech load footprint ({device})",
                tokens_per_sec=0.0, vram_total_mb=0,
                at=int(time.time() * 1000), rows=[],
                vram_model_mb=int(mb), kind="stt" if kind == "stt" else "tts",
            )
        except Exception:  # noqa: BLE001
            log.debug("speech load-footprint persist failed for %s", m.id, exc_info=True)

    def bump_engine_reservation_async(self, kind: str) -> None:
        """Fire-and-forget high-water bump for the synthesis/transcription hot
        path — the probe can shell out for ~1 s (typeperf) and must never add
        latency to a render line. The TTL cache inside makes the thread a
        near-no-op when a probe ran recently."""
        threading.Thread(
            target=lambda: self.bump_engine_reservation(kind),
            name=f"{kind}-highwater", daemon=True,
        ).start()

    def bump_engine_reservation(self, kind: str, *, fresh: bool = False) -> None:
        """The raise-only HIGH-WATER re-probe (Opus finding 2): TTS allocates
        at generate(), not load — a post-load number misses render peak and
        would over-admit into it. Called when work completes (synth /
        transcribe / clone, TTL-absorbed so per-line calls collapse; the
        scheduler's busy→idle transition passes fresh=True for the settled
        peak); torch's caching allocator keeps freed memory in the process
        pool, so the probe sees ~peak even lazily. Never lowers a booking;
        best-effort."""
        with self._lock:
            proc = self._loaded.get(kind)
        if proc is None:
            return
        engine_id = proc.manifest.id
        mb = self._engine_proc_mb(proc, fresh=fresh)
        if not mb:
            return
        try:
            from llm_runner.runner.arbiter import get_arbiter

            arb = get_arbiter()
            cur = arb.reserved_mb(f"{kind}:{engine_id}")
            if cur is None or mb > cur:
                # Occupant re-check (hardening): the probe ran unlocked — the
                # slot may have swapped while it shelled out; never book for
                # an engine that no longer holds it.
                with self._lock:
                    occ = self._loaded.get(kind)
                    variant = self._current_variants.get(engine_id)
                    device = self._resolved_devices.get(engine_id, "")
                if occ is None or occ.manifest.id != engine_id:
                    return
                # cur is None = "not measured yet" (no per-process arm fired
                # at the load door). The first measured probe CREATES the
                # booking — but only when the resolved device books at all
                # (a CPU-placed engine on a discrete box books nothing).
                if cur is None and not self._books_memory(device):
                    return
                m = self.get_manifest(engine_id)
                if m is not None:
                    self._reserve_engine(m, kind, mb, "measured")
                    self._record_speech_load(m, kind, variant, mb, device)
        except Exception:  # noqa: BLE001
            pass

    def _release_engine(self, kind: str, engine_id: str) -> None:
        """Drop the booking (idempotent — `make_room` releases evicted rows
        itself; a second release is a no-op)."""
        try:
            from llm_runner.runner.arbiter import get_arbiter
        except Exception:  # noqa: BLE001
            return
        get_arbiter().release(f"{kind}:{engine_id}")

    def _evict_for_arbiter(self, kind: str, engine_id: str) -> None:
        """The evictor `make_room` executes for one of OUR reservations — safe
        from ANY thread (a runner admission calls it holding no JV locks; we
        never call `make_room` while holding ours). Terminates the slot ONLY if
        this engine still occupies it; the reservation itself is released by
        `make_room` on the attempt."""
        with self._activity(kind), self._lock:
            proc = self._loaded.get(kind)
            if proc is not None and proc.manifest.id == engine_id:
                try:
                    proc.terminate()
                except Exception:  # noqa: BLE001 — already dying is fine
                    pass
                self._loaded.pop(kind, None)
                self._current_variants.pop(engine_id, None)
                self._resolved_devices.pop(engine_id, None)

    def resolved_device_for(self, engine_id: str) -> str | None:
        """The device the last confirmed load of this engine actually resolved
        to (shown on the Speech-engines card — Q2: the resolved device is
        always visible, never hidden). None = not loaded this process."""
        with self._lock:
            return self._resolved_devices.get(engine_id)

    def current_variant_id(self, engine_id: str) -> str | None:
        with self._lock:
            return self._current_variants.get(engine_id)

    def resolved_default_variant(self, engine_id: str) -> str:
        """Public door for the API layer: what a no-variant load of this engine
        resolves to (user Set-as-default override → manifest → heuristics)."""
        m = self.get_manifest(engine_id)
        return self._resolved_default_variant(m) if m else ""

    @staticmethod
    def _user_default_variant(engine_id: str) -> str:
        """The operator's own default-model choice for this engine
        (settings.engines.engine_overrides[id].default_variant — written by the
        Speech-engines page's "Set as default" row action, parity batch
        2026-08-06). Best-effort: unit tests run without app state → ""."""
        try:
            from ..app_state import get_state

            ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
            return (ov.default_variant or "") if ov else ""
        except Exception:  # noqa: BLE001 — no state / mid-boot → manifest order
            return ""

    def _resolved_default_variant(self, m: EngineManifest) -> str:
        """What variant id a no-variant load actually resolves to, so the
        Engines page can highlight the right model row (user-hit twice:
        load via Voices → both rows said "Load model").

        Order: the USER's default_variant override (Set as default) → manifest
        DEFAULT_VARIANT_ID → sole catalog variant → the variant whose files are
        in the engine's models_dir (kokoro loads whatever's on disk; the
        tarball extracts into a variant-named subdir) → first catalog variant
        as best effort.
        """
        user = self._user_default_variant(m.id)
        if user:
            return user
        if m.default_variant_id:
            return m.default_variant_id
        try:
            from .model_catalog import models_for

            variants = models_for(m.id)
        except Exception:
            return ""
        if not variants:
            return ""
        if len(variants) > 1:
            try:
                for v in variants:
                    d = m.models_dir / v.id
                    if d.is_dir() and any(d.iterdir()):
                        return v.id
            except Exception:
                pass
        return variants[0].id

    def _ensure_variant_local(self, m: EngineManifest, variant_id: str | None,
                              progress, cancel_check) -> str | None:
        """The load door's acquisition step (phase ②, plan doc §12): make
        sure the variant's files are LOCAL before the subprocess exists, and
        return the local dir the engine should load from — or None, meaning
        "load your legacy way" (a pre-② HF-cache install under the engine's
        models/hf keeps working offline until a re-download; bare tests and
        URL-source engines whose files ride the legacy install steps also
        land here). Fetches ride the speech cache: plain files, the kit
        downloader, no hub code, no symlinks."""
        if not variant_id:
            return None
        try:
            from .. import speech_cache
            from ..app_state import get_state

            data_dir = get_state().data_dir
        except Exception:  # noqa: BLE001 — bare tests / no app state
            return None
        if speech_cache.variant_on_disk(data_dir, m.id, variant_id):
            return str(speech_cache.variant_dir(data_dir, m.id, variant_id))
        try:
            from ..api.engine_sources_api import resolve_source
            from ..hf_cache import is_hf_repo_cached

            src, _prov = resolve_source(m.id, variant_id)
        except Exception:  # noqa: BLE001 — no catalog row → legacy path
            return None
        repo = src.get("hf_repo")
        url = src.get("url")
        if not repo and url:
            # URL-source variant (kokoro-style tarball) — phase ④: the load
            # door's cold fetch lands in the speech cache too, so the legacy
            # engine-dir models location gets no new writes from any path.
            # A pre-④ tarball install under the engine dir keeps serving
            # (same contract as the HF legacy arm below) — probed by THE one
            # engine-visibility rule (see legacy_files_engine_visible: a
            # too-deep extract falls through to the speech-cache fetch).
            try:
                expected = [f for step in m.model_install_steps
                            for f in (step.get("expected_files") or [])]
                if legacy_files_engine_visible(m.models_dir, expected):
                    return None
            except Exception:  # noqa: BLE001 — probe must never block a load
                pass
            if progress:
                progress("downloading-model",
                         f"fetching {variant_id} into the speech cache")
            from ..installer import fetch_url_variant

            last_u = {"mb": -1}

            def _uprog(done: int) -> None:
                if progress:
                    mb = done // (1024 * 1024)
                    if mb // 16 != last_u["mb"]:
                        last_u["mb"] = mb // 16
                        progress("downloading-model",
                                 f"{variant_id}: {mb} MB downloaded")

            try:
                fetch_url_variant(
                    data_dir, m.id, variant_id, url,
                    on_progress=_uprog,
                    cancel_check=(lambda: bool(cancel_check())) if cancel_check else None,
                )
            except Exception as e:  # noqa: BLE001 — incl. _Cancelled
                if "cancel" in str(e).lower() or type(e).__name__ in ("_Cancelled", "DownloadCancelled"):
                    raise RuntimeError("cancelled by user") from e
                raise RuntimeError(
                    f"model download failed for {m.id}/{variant_id}: {e}") from e
            return str(speech_cache.variant_dir(data_dir, m.id, variant_id))
        if not repo:
            return None
        if is_hf_repo_cached(repo, root=m.models_dir / "hf" / "hub"):
            return None  # legacy install — the engine's own cache serves it
        if progress:
            progress("downloading-model",
                     f"fetching {variant_id} into the speech cache")
        last = {"pct": -1}

        def _prog(done: int, total: int) -> None:
            if progress and total:
                pct = int(done * 100 / total)
                if pct != last["pct"]:
                    last["pct"] = pct
                    progress("downloading-model",
                             f"{variant_id}: {pct}% of {total // (1024 * 1024)} MB")

        sources = src.get("sources") or [{
            "hf_repo": repo, "revision": src.get("hf_revision"),
            "files": src.get("files")}]
        try:
            speech_cache.fetch_hf_variant(
                data_dir, m.id, variant_id, sources,
                on_progress=_prog,
                cancel_check=(lambda: bool(cancel_check())) if cancel_check else None,
            )
        except Exception as e:  # noqa: BLE001 — incl. DownloadCancelled
            if "cancel" in str(e).lower() or type(e).__name__ == "DownloadCancelled":
                raise RuntimeError("cancelled by user") from e
            raise RuntimeError(
                f"model download failed for {m.id}/{variant_id}: {e}") from e
        return str(speech_cache.variant_dir(data_dir, m.id, variant_id))

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

        early_mb = 0  # a prior-measured booking made BEFORE the load confirms
        try:
            _maybe_cancel()

            # For shared engines (monolithic style), Load is the only
            # button — the shared venv builds here on first use.
            if m.isolation == "shared":
                # ... or the venv exists but was built under a different
                # install path (the app folder moved): setup_shared_venv
                # detects that through the health probe and rebuilds.
                if not shared_venv_exists() or not venv_origin_matches(SHARED_VENV_DIR):
                    if progress:
                        progress("setup-shared-venv", "first-time setup: creating shared venv…")
                    from . import shared_venv as sv
                    sv.setup_shared_venv(progress=progress, cancel_check=effective_cancel)
            else:
                # Isolated engine — needs its own venv built via the Install button.
                if not m.is_installed:
                    raise RuntimeError(
                        f"engine {engine_id} (isolated) is not installed yet. "
                        f"Click Install to build its venv."
                    )

            _maybe_cancel()

            target_kind = m.kind
            # Phase ② (plan doc §12): make the planned variant's files LOCAL
            # before the subprocess exists — network leaves the load path.
            # Skipped when this engine already holds the slot with the same
            # (or unspecified) variant: that path early-returns below and
            # must never trigger a fetch.
            cur0 = self.loaded_for(target_kind)
            _already = (
                cur0 is not None and cur0.manifest.id == engine_id
                and cur0.is_alive()
                and (variant in (None, "", "auto")
                     or self._current_variants.get(engine_id) == variant)
            )
            local_dir = None
            if not _already:
                planned = (variant if variant not in (None, "", "auto")
                           else (self._resolved_default_variant(m) or None))
                local_dir = self._ensure_variant_local(
                    m, planned, progress, effective_cancel)

            # Legacy model-step install (phase ④: AFTER the speech-cache
            # acquisition, and only when it couldn't serve) — engines whose
            # catalog rows carry no source, and the no-variant edge. Kokoro's
            # tarballs now land in the speech cache via the URL arm above, so
            # this no longer writes the legacy engine-dir models location on
            # any catalog-driven path. HF-cache engines with no
            # expected_files: still a no-op (engine pulls at load).
            if m.isolation == "shared" and local_dir is None and not m.is_installed:
                _maybe_cancel()
                if progress:
                    progress("downloading-model", f"first load of {engine_id} — fetching model files")
                _install_engine_shared(m, progress, effective_cancel)

            # The 2026-08-13 VRAM wiring (step 3): resolve the device at the ONE
            # load door and pass it down explicitly — the engine subprocess never
            # runs its own hidden greedy-cuda again. Admission (amended §10):
            # only a PRIOR MEASURED footprint on this box admits — and it books
            # EARLY, so the ledger covers the seconds between admission and the
            # post-200 true-up (a concurrent runner load can no longer admit
            # into the same memory). A FIRST-EVER load gets no arithmetic: no
            # admission, no invented number, no eviction on its behalf. A
            # refused admission leaves the world exactly as it was (the prior
            # engine keeps running); if an occupant must die to make room,
            # `make_room` evicts it through our own evictor. Skipped when this
            # very engine already holds the slot (it is resident and reserved).
            device = self._resolve_device(m, device)
            books = self._books_memory(device)
            cur = self.loaded_for(target_kind)
            if books and not (cur is not None and cur.manifest.id == engine_id):
                prior = self._prior_measured_mb(target_kind, engine_id)
                if prior > 0:
                    self._admit_memory(m, target_kind, engine_id, prior)
                    self._reserve_engine(m, target_kind, prior, "measured")
                    early_mb = prior
            # The device-delta fallback's BEFORE snapshot (boxes with no
            # per-process probe arm, e.g. AMD Linux) — taken after admission's
            # settle loop so an evicted victim's drain isn't charged to this
            # load. The delta is attributable only when nothing else loads
            # concurrently, which JV cannot guarantee → it books as "computed"
            # and is never persisted as measurement evidence.
            pool_before = self.pool_used_mb(fresh=True) if books else None

            # Activity lock first (lock order: activity → self._lock): a
            # terminate must wait for the slot's in-flight synth line.
            with self._activity(target_kind), self._lock:
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
                    self._release_engine(target_kind, prior.manifest.id)
                    self._resolved_devices.pop(prior.manifest.id, None)
                elif prior and prior.manifest.id == engine_id and prior.is_alive():
                    # Already loaded — just return current voices. Record the
                    # RESOLVED variant: "auto"/None must map to the default
                    # id or the Engines page can't tell which row is loaded
                    # (user-hit: load via Voices → both rows said "Load").
                    if variant not in (None, "", "auto"):
                        self._current_variants[engine_id] = variant
                    elif not self._current_variants.get(engine_id):
                        self._current_variants[engine_id] = self._resolved_default_variant(m)
                    return prior.get("/voices").json()

                if progress:
                    progress("loading", f"loading {engine_id}…")
                proc = EngineProcess(m)
                proc.spawn()
                self._loaded[target_kind] = proc

            _maybe_cancel()

            # A FRESH no-variant load resolves the default HERE (parity batch
            # 2026-08-06): the engine subprocess receives `variant` verbatim, so
            # the user's Set-as-default choice must be substituted before the
            # POST — otherwise it would only relabel a row while the engine
            # still loaded its own default. Deliberately AFTER the
            # already-loaded early-return above: a no-variant re-load of a
            # loaded engine keeps whatever is loaded (the Voices preview path —
            # pinned by test_already_loaded_reload_keeps_resolved_variant).
            if variant in (None, "", "auto"):
                variant = self._resolved_default_variant(m) or None

            # Now POST /load to the engine — this is where the model actually
            # comes into memory. `model_dir` (the speech-cache variant dir)
            # makes the engine load plain local files; None = its legacy way.
            if progress:
                progress("loading_weights", f"loading {engine_id} weights")
            r = proc.post("/load", json={"device": device, "variant": variant,
                                         "model_dir": local_dir})
            if r.status_code != 200:
                log.warning("engine %s /load failed: %s", engine_id, r.text[:400])
                with self._activity(target_kind), self._lock:
                    proc.terminate()
                    self._loaded.pop(target_kind, None)
                    self._resolved_devices.pop(engine_id, None)
                # Defensive — nothing is reserved before a 200, but a release
                # is idempotent and the F1 lesson (a reservation nobody
                # releases is a lying ledger) is worth the belt.
                self._release_engine(target_kind, engine_id)
                raise RuntimeError(f"engine load failed: {r.text}")
            with self._lock:
                self._current_variants[engine_id] = (
                    variant
                    if variant not in (None, "", "auto")
                    else self._resolved_default_variant(m)
                )
                self._resolved_devices[engine_id] = device
            # Book the CONFIRMED load at its MEASURED footprint — the per-PID
            # TREE probe (launcher shims: the child holds the memory), so a
            # concurrent runner load can't cross-charge. Probe miss on a box
            # with no per-process arm (AMD Linux) → the device-wide delta
            # across the load, honestly "computed" and never persisted as
            # evidence (a concurrent load could pollute it); an engine with
            # an EARLY prior-measured booking keeps that instead. Nothing
            # measurable at all → no booking — the strip says "not measured
            # yet" rather than displaying an invention.
            if books:
                measured = self._engine_proc_mb(proc, fresh=True)
                if measured:
                    self._reserve_engine(m, target_kind, measured, "measured")
                    self._record_speech_load(
                        m, target_kind, self._current_variants.get(engine_id),
                        measured, device,
                    )
                elif not early_mb:
                    after = self.pool_used_mb(fresh=True)
                    delta = (
                        max(0, after - pool_before)
                        if after is not None and pool_before is not None
                        else 0
                    )
                    if delta > 0:
                        self._reserve_engine(m, target_kind, delta, "computed")
            # (The qwen3-llm adapter hook died with the engine — F1 Phase 2:
            # the shared stack's bundled runner is THE local LLM.)
            if progress:
                progress("warming_up", f"{engine_id} ready")
            return r.json()
        except Exception:
            # Never leak the EARLY booking on a failed/cancelled load — the
            # non-200 arm already released; release is idempotent.
            if early_mb:
                self._release_engine(m.kind, engine_id)
            raise
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
        if kind is not None:
            return self._unload_kind(kind)
        with self._lock:
            kinds = list(self._loaded.keys())
        if not kinds:
            return {"previous_engine": None}
        # Back-compat: surface the first kind's previous engine.
        prev = None
        for k in kinds:
            out = self._unload_kind(k)
            if prev is None:
                prev = out.get("previous_engine")
        with self._lock:
            self._current_variants.clear()
        return {"previous_engine": prev}

    def _unload_kind(self, kind: str) -> dict:
        # Activity lock first: never terminate a slot mid-synth/transcribe.
        with self._activity(kind), self._lock:
            proc = self._loaded.get(kind)
            if not proc:
                return {"previous_engine": None}
            prev = proc.manifest.id
            try:
                proc.terminate()
            except Exception:
                pass
            self._loaded.pop(kind, None)
            self._current_variants.pop(prev, None)
            self._resolved_devices.pop(prev, None)
        # Free the booking with the memory (the 2026-08-13 wiring — every
        # unload path releases; idempotent beside make_room's own release).
        self._release_engine(kind, prev)
        return {"previous_engine": prev}

    # ─── Synth / voices / clone — HTTP proxy ─────────────────────────

    def voices(self, engine_id: str) -> list[dict]:
        proc = self._require_current(engine_id)
        r = proc.get("/voices")
        r.raise_for_status()
        return r.json().get("voices", [])

    def synth(self, engine_id: str, body: dict) -> tuple[bytes, dict]:
        """Returns (audio_bytes, headers_dict_for_re_export)."""
        m = self.get_manifest(engine_id)
        with self._activity(m.kind if m else "tts"):
            proc = self._require_current(engine_id)
            r = proc.post("/synth", json=body)
        # High-water true-up: generate() is where a TTS engine's memory peaks
        # (Opus finding 2) — async + TTL-absorbed, raise-only, never blocks
        # the line.
        self.bump_engine_reservation_async(m.kind if m else "tts")
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
        m = self.get_manifest(engine_id)
        with self._activity(m.kind if m else "tts"):
            proc = self._require_current(engine_id)
            r = proc.post("/clone", json=body)
        self.bump_engine_reservation_async(m.kind if m else "tts")
        if r.status_code != 200:
            raise RuntimeError(f"engine clone failed: {r.text}")
        return r.json()

    def chat(self, body: dict, *, timeout: float = 300.0) -> str:
        """Chat completion via the loaded llm-slot engine (G1 wiring).
        body matches the shim's ChatBody: prompt/system/max_tokens/
        temperature/examples."""
        proc = self.loaded_for("llm")
        if proc is None:
            raise RuntimeError(
                "no local LLM engine loaded — install + load 'qwen3-llm' on "
                "the Engines tab, or configure an external provider"
            )
        r = proc.post("/chat", json=body, timeout=timeout)
        if r.status_code != 200:
            raise RuntimeError(f"engine chat failed: {r.text}")
        return r.json().get("text", "")

    def transcribe(self, body: dict, *, timeout: float = 600.0) -> str:
        """Transcription via the loaded stt-slot engine (G2 wiring).
        body matches the shim's TranscribeBody: wav_b64/audio_path/language.
        stt-busy for the call's duration (the 2026-08-13 VRAM wiring, step 4 —
        Q1's never-evict-busy: a mid-transcription whisper is not a victim)."""
        with self._activity("stt"), _kind_busy("stt"):
            proc = self.loaded_for("stt")
            if proc is None:
                raise RuntimeError(
                    "no STT engine loaded — install + load 'whisper' on the "
                    "Engines tab first"
                )
            r = proc.post("/transcribe", json=body, timeout=timeout)
        self.bump_engine_reservation_async("stt")
        if r.status_code != 200:
            raise RuntimeError(f"engine transcribe failed: {r.text}")
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
_atexit_registered = False


def get_manager() -> EngineManager:
    """The process-wide engine manager, created on first use.

    Creating one also arms an `atexit` reaper. Engine subprocesses are children
    of this process and do NOT die with it on their own, and until now the only
    thing that killed them was FastAPI's `shutdown` event — so any exit that
    did not run it leaked a live `engine.py serve` holding a GPU and the venv
    interpreter open.

    That is not hypothetical or test-only: it made a shared-venv rebuild fail
    with `os error 32` (the leaked engine had the interpreter open), and in the
    test suite it accumulated silently, because 25 of 27 test files build
    `TestClient(app)` without entering it as a context manager, which is the
    only thing that runs lifespan.

    Registered lazily so importing this module has no side effect, and only
    once — `atexit` would otherwise call it repeatedly.

    LIMIT, stated so nobody trusts it too far: `atexit` runs on normal
    interpreter exit. It does NOT run on SIGKILL or Windows `TerminateProcess`,
    so a hard-killed host still orphans engines. Closing that needs OS-level
    lifetime binding (a Windows job object / POSIX process group), which is a
    bigger change than this.
    """
    global _manager, _atexit_registered
    with _manager_lock:
        if _manager is None:
            _manager = EngineManager()
        if not _atexit_registered:
            atexit.register(shutdown_manager)
            _atexit_registered = True
        return _manager


def shutdown_manager() -> None:
    """Called on JustVoice server shutdown — kill any running engine subprocess."""
    global _manager
    with _manager_lock:
        if _manager is None:
            return
        _manager.unload()
        _manager = None
