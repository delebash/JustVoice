# SPDX-License-Identifier: MIT
"""UTMOSv2's weights, fetched the way VERSA's tools/install_utmosv2.sh and
tools/activate_utmosv2.sh do it: a git-lfs clone of the UTMOSv2 fork VERSA uses, pointed
to by UTMOSV2_CHACHE.

The fork's own fallback download clones github.com/sarulab-speech/UTMOSv2 and reads its
`models/` folder, which upstream has since removed (commit 85675ed, "removed model weights
from github and changed the download source to huggingface"), so it finds no checkpoint.
"""

import json
import os
import subprocess
from importlib.metadata import distribution
from pathlib import Path

# The checkpoint VERSA loads: utmosv2.create_model(pretrained=True) is fusion_stage3, fold 0,
# seed 42 (utmosv2/_core/create.py). The fork holds folds 0-4 (818 MB each); only fold 0 is read.
CHECKPOINT = "models/fusion_stage3/fold0_s42_best_model.pth"


def _installed_source() -> tuple[str, str]:
    """The fork's URL and commit, as uv installed it (PEP 610 direct_url.json)."""
    info = json.loads(distribution("utmosv2").read_text("direct_url.json") or "{}")
    url, commit = info.get("url"), info.get("vcs_info", {}).get("commit_id")
    if not url or not commit:
        raise RuntimeError("utmosv2 was not installed from git; run `uv sync`")
    return url.removeprefix("git+"), commit


def ensure_weights(folder: Path) -> None:
    checkpoint = folder / CHECKPOINT
    # A git-lfs pointer file is ~130 bytes; the checkpoint is 818 MB.
    if checkpoint.is_file() and checkpoint.stat().st_size > 1_000_000:
        return
    url, commit = _installed_source()
    env = {**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"}
    if not (folder / ".git").is_dir():
        if folder.exists() and any(folder.iterdir()):
            raise RuntimeError(f"{folder} exists but is not a UTMOSv2 clone; remove it and run again")
        print(f"take-check: fetching UTMOSv2 weights into {folder} (818 MB, once) ...", flush=True)
        subprocess.run(["git", "clone", url, str(folder)], env=env, check=True)
    origin = subprocess.run(
        ["git", "-C", str(folder), "remote", "get-url", "origin"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if origin.removesuffix(".git") != url.removesuffix(".git"):
        raise RuntimeError(f"{folder} is a clone of {origin}, not {url}; remove it and run again")
    subprocess.run(["git", "-C", str(folder), "checkout", "--quiet", commit], env=env, check=True)
    subprocess.run(["git", "-C", str(folder), "lfs", "pull", "--include", CHECKPOINT], check=True)
