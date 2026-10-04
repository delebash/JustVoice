# SPDX-License-Identifier: MIT
"""eSpeak NG for audio.cpp's Kokoro — fetched onto this machine, never shipped by us.

audio.cpp's Kokoro phonemizes English, Spanish, French, Hindi, Italian and Portuguese
with eSpeak NG, and KittenTTS phonemizes English with it, each loading it as a shared
library from a path we pass: Kokoro reads the runtime's environment
(`AUDIOCPP_ESPEAK_LIBRARY` / `AUDIOCPP_ESPEAK_DATA`, set by `runtime._child_env`), KittenTTS
its own session options (`kitten_tts.espeak_library_path` / `…_data_path`, set by
`slot._entries_for`). Without them each falls back to whatever eSpeak NG the system path
finds, or fails. eSpeak NG is GPL-3.0, so
JustVoice (MIT) never bundles it: like the Kokoro venv did before the cut, the user's
machine downloads it from PyPI — the `espeakng-loader` wheel, which carries the library
and its data — and only audio.cpp's process loads it.

Pinned to one version, verified by the wheel's sha256 from PyPI's own record.
"""

from __future__ import annotations

import hashlib
import json
import platform
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "0.2.4"
_SHA256 = {
    "win_amd64": "41f1e08ac9deda2efd1ea9de0b81dab9f5ae3c4b24284f76533d0a7b1dd7abd7",
    "win_arm64": "d7a2928843eaeb2df82f99a370f44e8a630f59b02f9b0d1f168a03c4eeb76b89",
    "manylinux_2_17_x86_64": "08721baf27d13d461f6be6eed9a65277e70d68234ff484fd8b9897b222cdcb6d",
    "manylinux_2_28_aarch64": "d1e798141b46a050cdb75fcf3c17db969bb2c40394f3f4a48910655d547508b9",
    "macosx_10_12_x86_64": "b77477ae2ddf62a748e04e49714eabb2f3a24f344166200b00539083bd669904",
    "macosx_11_0_arm64": "d27cdca31112226e7299d8562e889d3e38a1e48055c9ee381b45d669072ee59f",
}


def _wheel_tag() -> str:
    arm = platform.machine().lower() in ("arm64", "aarch64")
    if sys.platform == "win32":
        return "win_arm64" if arm else "win_amd64"
    if sys.platform == "darwin":
        return "macosx_11_0_arm64" if arm else "macosx_10_12_x86_64"
    return "manylinux_2_28_aarch64" if arm else "manylinux_2_17_x86_64"


def wheel_matches(filename: str, tag: str) -> bool:
    """Whether a wheel file serves `tag`. A wheel's last name field can carry several
    platform tags joined by dots — PyPI's Linux x86_64 file for 0.2.4 is
    `…-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`, which an exact suffix match missed,
    so the runtime install could never finish on Linux x86_64 (audit 2026-10-04 §5 A2)."""
    if not filename.endswith(".whl"):
        return False
    return tag in filename.removesuffix(".whl").rsplit("-", 1)[-1].split(".")


def home(runtime_root: Path) -> Path:
    return runtime_root / "audiocpp" / f"espeak-ng-{VERSION}"


def paths(runtime_root: Path) -> tuple[Path, Path] | None:
    """(library, data dir) when installed, else None."""
    root = home(runtime_root)
    libs = [p for p in root.glob("*") if p.suffix in (".dll", ".so", ".dylib") or ".so." in p.name]
    data = root / "espeak-ng-data"
    if libs and data.is_dir():
        return libs[0], data
    return None


def install(runtime_root: Path) -> tuple[Path, Path]:
    """Fetch and unpack the pinned wheel's library + data (idempotent)."""
    got = paths(runtime_root)
    if got:
        return got
    tag = _wheel_tag()
    meta = json.loads(urllib.request.urlopen(
        f"https://pypi.org/pypi/espeakng-loader/{VERSION}/json", timeout=60).read())
    entry = next((u for u in meta["urls"] if wheel_matches(u["filename"], tag)), None)
    if entry is None:
        raise RuntimeError(f"eSpeak NG {VERSION} has no build for {tag}")
    blob = urllib.request.urlopen(entry["url"], timeout=300).read()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != _SHA256[tag]:
        raise RuntimeError(f"eSpeak NG wheel checksum mismatch ({digest[:12]}…) — refusing it")
    root = home(runtime_root)
    staging = root.with_name(root.name + ".staging")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    import io

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            if not name.startswith("espeakng_loader/") or name.endswith(".py") or name.endswith("/"):
                continue
            dest = staging / name.removeprefix("espeakng_loader/")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(name))
    shutil.rmtree(root, ignore_errors=True)
    staging.rename(root)
    got = paths(runtime_root)
    if not got:
        raise RuntimeError("eSpeak NG wheel unpacked without its library or data")
    return got
