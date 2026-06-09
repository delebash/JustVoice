# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared pytest fixtures.

Spins up the FastAPI app rooted at an isolated tmp data dir so tests
don't tread on a developer's real $APPDATA/justtts directory.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from justtts.app import create_app


@pytest.fixture()
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture()
def client(data_dir: Path) -> TestClient:
    app = create_app(data_dir=data_dir)
    return TestClient(app)
