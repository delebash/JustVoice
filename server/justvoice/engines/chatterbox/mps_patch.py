# SPDX-License-Identifier: MIT
#
# Adapted from devnen/Chatterbox-TTS-Server's start.py
# (_patch_chatterbox_mps_float32), MIT. The fix itself is what his
# chatterbox-v2 fork carries built in.
"""The Apple-GPU fix for chatterbox: force float32 where the package moves
audio tensors to device.

MPS has no float64, so stock chatterbox crashes on Apple Silicon with
"Cannot convert a MPS Tensor to float64 dtype" (s3tokenizer and
voice_encoder move tensors with a bare `.to(self.device)`). Two independent
MIT projects ship the same three-line fix — devnen's server patches the
installed sources, the Jimmi42 Space wraps tensor conversion — so this is
the known-good repair, not an experiment. float32 on these audio tensors is
already the norm on CUDA, so applying it everywhere is safe and keeps the
platforms identical.

Must run BEFORE `chatterbox.tts_turbo` / `chatterbox.mtl_tts` are imported:
it edits source files, and an already-imported module keeps its old code.
Idempotent via a sentinel line, same as upstream's patcher.

UNMEASURED on real Apple hardware here — this machine is Windows/NVIDIA.
The behaviour it enables (Chatterbox on MPS) is devnen-verified, not
JV-verified; first Mac run tells the truth.
"""

from __future__ import annotations

import importlib.util
import logging
from pathlib import Path

log = logging.getLogger("justvoice.engines.chatterbox")

_SENTINEL = "# [patched by justvoice mps_patch: MPS float32 compatibility]"

# (relative file, bare call, patched call) — devnen's exact replacements.
_EDITS = [
    ("models/s3tokenizer/s3tokenizer.py",
     "wav = wav.to(self.device)",
     "wav = wav.to(self.device, dtype=torch.float32)"),
    ("models/s3tokenizer/s3tokenizer.py",
     "audio = audio.to(self.device)",
     "audio = audio.to(self.device, dtype=torch.float32)"),
    ("models/voice_encoder/voice_encoder.py",
     "mels.to(self.device)",
     "mels.to(self.device, dtype=torch.float32)"),
]


def apply() -> bool:
    """Patch the installed chatterbox package in place. Returns True when
    the package is present (patched now or already), False when absent."""
    spec = importlib.util.find_spec("chatterbox")
    if spec is None or not spec.submodule_search_locations:
        return False
    root = Path(list(spec.submodule_search_locations)[0])

    for rel in {e[0] for e in _EDITS}:
        path = root / rel
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if _SENTINEL in content:
            continue
        changed = False
        for erel, old, new in _EDITS:
            if erel != rel:
                continue
            # Skip if upstream (or a fork) already carries a dtype= there.
            if old in content and new not in content:
                content = content.replace(old, new)
                changed = True
        if changed:
            try:
                path.write_text(_SENTINEL + "\n" + content, encoding="utf-8")
                log.info("chatterbox %s: MPS float32 fix applied", rel)
            except OSError as e:
                log.warning("chatterbox %s: could not patch (%s)", rel, e)
    return True
