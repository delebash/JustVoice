# SPDX-License-Identifier: MIT
"""A development build of audio.cpp — what `npm run dev` runs instead of the pinned release.

`scripts/audiocpp-dev.js` builds our fork's checkout beside this one (`../audio.cpp`, into
`build/jv-dev`) before the app starts and names its bin folder in JUSTVOICE_AUDIOCPP_BUILD
(docs/dev/TASKS.md, "`npm run dev` always runs the latest audio.cpp"). With it set:
- `runtime.installed_exe` is that build's server, never a downloaded one;
- every feature in `release.FEATURES` is on, both what the app offers (`release.pinned_has`)
  and what the build answers for (`runtime.has_feature`) — the dev build is the fork's latest;
- its backend comes from the build's own CMake cache;
- the runtime row says it is the development build, and Install fetches only eSpeak NG.

A packaged (frozen) app ignores the variable. `python -m justvoice.engines.audiocpp.dev_build
--stop-leftovers` is the wrapper's check before it builds (decided D5): it stops a server a
crashed session left on this build, and exits 3 when one is still served by a running app.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

ENV = "JUSTVOICE_AUDIOCPP_BUILD"
TAG = "dev"   # what `runtime.installed_tag` answers for a development build
SERVER_EXE = "audiocpp_server.exe" if sys.platform == "win32" else "audiocpp_server"
DSP_EXE = "audiocpp_dsp.exe" if sys.platform == "win32" else "audiocpp_dsp"


@dataclass(frozen=True)
class DevBuild:
    bin_dir: Path
    exe: Path
    backend: str        # "cuda" | "vulkan" | "metal" | "cpu" — from the build's CMake cache
    commit: str         # the checkout's commit when it was built ("" when unknown)
    dirty: bool         # the checkout had uncommitted edits
    source: str         # the checkout, relative to this one ("..\\audio.cpp")

    @property
    def version(self) -> str:
        """The runtime row's version (decided D4): "dev · 6a2bb4c5 + local changes"."""
        out = f"dev · {self.commit}" if self.commit else "dev"
        return f"{out} + local changes" if self.dirty else out


def _backend(cache: Path) -> str:
    try:
        text = cache.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "cpu"
    on = {line.split(":", 1)[0] for line in text.splitlines() if line.endswith(":BOOL=ON")}
    for key, backend in (("ENGINE_ENABLE_CUDA", "cuda"), ("ENGINE_ENABLE_VULKAN", "vulkan"),
                         ("ENGINE_ENABLE_METAL", "metal"), ("GGML_METAL", "metal")):
        if key in on:
            return backend
    return "cpu"


@functools.cache
def current() -> DevBuild | None:
    """The development build `npm run dev` pointed this server at, or None."""
    raw = os.environ.get(ENV, "").strip()
    if not raw or getattr(sys, "frozen", False):
        return None
    bin_dir = Path(raw)
    exe = bin_dir / SERVER_EXE
    if not exe.is_file():
        log.warning("%s names %s, which has no %s — running the pinned release", ENV, bin_dir, SERVER_EXE)
        return None
    try:
        info = json.loads((bin_dir / "jv-dev-build.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        info = {}
    return DevBuild(bin_dir=bin_dir, exe=exe, backend=_backend(bin_dir.parent / "CMakeCache.txt"),
                    commit=str(info.get("commit") or ""), dirty=bool(info.get("dirty")),
                    source=str(info.get("source") or bin_dir.parent.parent.parent))


def is_dev_exe(exe: Path | None) -> bool:
    dev = current()
    return dev is not None and exe is not None and Path(exe) == dev.exe


def _stop_leftovers() -> int:
    """Stop this build's servers whose JustVoice is gone; 3 when one is still served. The
    DSP program counts too: a running one holds its exe, which the build replaces."""
    import psutil

    from ..leftovers import stop_leftover_engines

    dev = current()
    if dev is None:
        return 0
    # The app's own sweep: every audio.cpp server (this build's included) whose JustVoice is gone.
    if stopped := stop_leftover_engines("npm run dev"):
        print(f"[audio.cpp] stopped {len(stopped)} audio.cpp server(s) left by a closed JustVoice")
    want = {os.path.normcase(str(dev.exe)), os.path.normcase(str(dev.bin_dir / DSP_EXE))}
    for p in psutil.process_iter(["pid", "exe"]):
        try:
            if p.info.get("exe") and os.path.normcase(p.info["exe"]) in want:
                print(f"[audio.cpp] {os.path.basename(p.info['exe'])} (pid {p.pid}) is still running for an open JustVoice")
                return 3
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--stop-leftovers"]:
        sys.exit(_stop_leftovers())
    print(f"usage: python -m {__spec__.name if __spec__ else 'dev_build'} --stop-leftovers")
    sys.exit(2)
