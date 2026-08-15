"""Lightweight DAC shim — provides Snake1d under every path TADA imports it.

The real descript-audio-codec package pulls onnx + tensorboard + matplotlib
via descript-audiotools (~500 MB of unrelated tooling) for one activation
function, so we register a fake `dac` package in sys.modules BEFORE TADA's
imports run.

hume-tada imports Snake1d from TWO different places, and covering only one
of them is a silent unloadable engine:

    tada/modules/encoder.py:  from dac.nn.layers import Snake1d
    tada/modules/decoder.py:  from dac.model.dac import Snake1d

`modules/__init__.py` imports the decoder, so ANY `from tada.modules...`
import hit the second path first and died with "No module named
'dac.model'; 'dac' is not a package" — which is also why the shim's own
`dac.nn.layers` fast-path could never be reached to short-circuit it.

Both names resolve to the same class. The math is the standard Snake
activation: x + (1/alpha) * sin(alpha*x)**2.
"""

from __future__ import annotations

import sys
import types


def install_dac_shim() -> None:
    """Register the fake `dac` package providing Snake1d. Idempotent.

    The guard checks the LAST name registered, so a partially-installed shim
    from an older build gets completed rather than skipped.
    """
    if "dac.model.dac" in sys.modules:
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

    def _pkg(name: str) -> types.ModuleType:
        """A module that can also hold submodules. `__path__` is what makes
        the import machinery treat it as a package instead of raising
        "'dac' is not a package" on the first dotted import."""
        mod = types.ModuleType(name)
        mod.__path__ = []  # type: ignore[attr-defined]
        return mod

    dac_pkg = _pkg("dac")
    dac_nn = _pkg("dac.nn")
    dac_model = _pkg("dac.model")

    dac_nn_layers = types.ModuleType("dac.nn.layers")
    dac_nn_layers.Snake1d = Snake1d
    dac_model_dac = types.ModuleType("dac.model.dac")
    dac_model_dac.Snake1d = Snake1d

    dac_nn.layers = dac_nn_layers
    dac_model.dac = dac_model_dac
    dac_pkg.nn = dac_nn
    dac_pkg.model = dac_model

    # Registering every dotted name is what lets `from dac.model.dac import X`
    # resolve without the machinery ever touching the filesystem.
    sys.modules["dac"] = dac_pkg
    sys.modules["dac.nn"] = dac_nn
    sys.modules["dac.nn.layers"] = dac_nn_layers
    sys.modules["dac.model"] = dac_model
    sys.modules["dac.model.dac"] = dac_model_dac
