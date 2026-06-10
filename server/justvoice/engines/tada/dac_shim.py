"""Lightweight DAC shim — provides only `dac.nn.layers.Snake1d`.

TADA's encoder/decoder import `from dac.nn.layers import Snake1d`. The
real descript-audio-codec package pulls onnx + tensorboard + matplotlib
via descript-audiotools (~500 MB of unrelated tooling). This shim
provides only the Snake1d class TADA actually uses, installed into
sys.modules BEFORE TADA's imports run.

The math is the standard Snake activation:
x + (1/alpha) * sin(alpha*x)**2.
"""

from __future__ import annotations

import sys
import types


def install_dac_shim() -> None:
    """Install fake `dac.nn.layers` module providing Snake1d. Idempotent."""
    if "dac.nn.layers" in sys.modules:
        return

    import torch
    import torch.nn as nn

    class Snake1d(nn.Module):
        def __init__(self, channels: int):
            super().__init__()
            self.alpha = nn.Parameter(torch.ones(1, channels, 1))

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            # x + (1/alpha) * sin(alpha*x)**2 — keeps the alpha branch
            # numerically stable via the small-epsilon guard.
            shape = x.shape
            x = x.reshape(shape[0], shape[1], -1)
            x = x + (self.alpha + 1e-9).reciprocal() * torch.sin(self.alpha * x) ** 2
            return x.reshape(shape)

    dac_pkg = types.ModuleType("dac")
    dac_nn = types.ModuleType("dac.nn")
    dac_nn_layers = types.ModuleType("dac.nn.layers")
    dac_nn_layers.Snake1d = Snake1d
    dac_nn.layers = dac_nn_layers
    dac_pkg.nn = dac_nn
    sys.modules["dac"] = dac_pkg
    sys.modules["dac.nn"] = dac_nn
    sys.modules["dac.nn.layers"] = dac_nn_layers
