# SPDX-License-Identifier: MIT
"""The Japanese dictionary — UniDic, fetched onto this machine when the user installs it.

audio.cpp reads Japanese through MeCab over a UniDic dictionary: Kokoro's five Japanese voices
and Chatterbox in Japanese (docs/plans/2026-10-03-gap-7-more-languages.md). The dictionary is
an optional download of about 250 MB (decided 2026-10-03, "its own row under the Speech runtime
row"); `runtime.py` names its folder to the runtime in AUDIOCPP_UNIDIC_DIR when it is here.
MeCab itself (libmecab) ships inside our runtime build.

unidic-lite 1.0.8 from PyPI (an MIT wrapper around UniDic 2.1.2, which is BSD / GPL / LGPL —
taken under BSD; its licence files travel with it), pinned and verified by the sdist's sha256
from PyPI's own record. It is UniDic 2.1.2 with the field layout audio.cpp's Kokoro port reads,
and the dictionary Kokoro was trained against. Only the dictionary folder and the licences are
kept; the Python wrapper is not.
"""

from __future__ import annotations

import hashlib
import shutil
import tarfile
from collections.abc import Callable
from pathlib import Path

VERSION = "1.0.8"
URL = ("https://files.pythonhosted.org/packages/55/2b/8cf7514cb57d028abcef625afa847d60ff1ffbf0049c36b78faa7c35046f/"
       f"unidic-lite-{VERSION}.tar.gz")
SHA256 = "db9d4572d9fdd4d00a97949d4b0741ec480ee05a7e7e2e32f547500dae27b245"
DOWNLOAD_BYTES = 47_356_746
INSTALLED_BYTES = 260_467_176     # the dictionary folder, measured 2026-10-03
_DICDIR = f"unidic-lite-{VERSION}/unidic_lite/dicdir/"
_LICENCES = (f"unidic-lite-{VERSION}/LICENSE", f"unidic-lite-{VERSION}/LICENSE.unidic")


def home(runtime_root: Path) -> Path:
    return runtime_root / "audiocpp" / f"unidic-lite-{VERSION}"


def dictionary_dir(runtime_root: Path) -> Path | None:
    """The installed dictionary folder (what AUDIOCPP_UNIDIC_DIR names), or None."""
    root = home(runtime_root)
    return root if (root / "dicrc").is_file() else None


def install(runtime_root: Path, on_progress: Callable[[int, int | None], None] | None = None,
            cancel_check: Callable[[], bool] | None = None) -> Path:
    """Download, verify and unpack the pinned dictionary (idempotent)."""
    got = dictionary_dir(runtime_root)
    if got:
        return got
    from llm_runner.runner.download import stream_download

    from ...speech_cache import _download_kwargs

    root = home(runtime_root)
    root.parent.mkdir(parents=True, exist_ok=True)
    tarball = root.with_name(root.name + ".tar.gz")
    stream_download(URL, tarball, on_progress=on_progress, cancel_check=cancel_check, **_download_kwargs())
    digest = hashlib.sha256()
    with tarball.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    if digest.hexdigest() != SHA256:
        tarball.unlink(missing_ok=True)
        raise RuntimeError(f"Japanese dictionary checksum mismatch ({digest.hexdigest()[:12]}…) — refusing it")
    staging = root.with_name(root.name + ".staging")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    with tarfile.open(tarball, "r:gz") as tf:
        for member in tf.getmembers():
            name = member.name.replace("\\", "/")
            if not member.isfile() or ".." in name.split("/"):
                continue
            if name.startswith(_DICDIR):
                dest = staging / name[len(_DICDIR):]
            elif name in _LICENCES:
                dest = staging / Path(name).name
            else:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            with tf.extractfile(member) as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)
    tarball.unlink(missing_ok=True)
    if not (staging / "dicrc").is_file():
        shutil.rmtree(staging, ignore_errors=True)
        raise RuntimeError("the Japanese dictionary unpacked without its dicrc")
    shutil.rmtree(root, ignore_errors=True)
    staging.rename(root)
    return root
