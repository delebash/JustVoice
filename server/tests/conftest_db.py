# SPDX-License-Identifier: GPL-3.0-or-later
"""DB-aware fixtures — spin up an in-memory SQLite for the new ORM tests.

Separate from conftest.py so the existing audio/format tests don't pull
sqlalchemy into their import graph.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from justtts.database.models import Base
from justtts.database import migrations as migrations_mod


@pytest.fixture
def tmp_db(tmp_path: Path):
    """Fresh SQLite DB in a tmp dir; yields a Session factory + the engine."""
    db_path = tmp_path / "justvoice.test.db"
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    migrations_mod.run_migrations(engine)
    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    yield SessionFactory, engine
    engine.dispose()


@pytest.fixture
def db_session(tmp_db):
    SessionFactory, _ = tmp_db
    s = SessionFactory()
    try:
        yield s
    finally:
        s.close()
