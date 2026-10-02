# SPDX-License-Identifier: MIT
"""audio.cpp — the one native speech runtime (docs/plans/2026-10-01-audiocpp-switch.md).

Not an engine plugin (there is no manifest.py here, so `discover_engines` skips it): the
engines in `engines/<id>/manifest.py` declare WHICH models exist; this package is the
program that runs them — the pinned binary, its process, and the HTTP calls into it.
"""
