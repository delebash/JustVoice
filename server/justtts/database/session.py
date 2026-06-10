# SPDX-License-Identifier: GPL-3.0-or-later
"""SQLAlchemy engine + session factory for the JustVoice SQLite database.

Init flow lifted from an upstream MIT codebase with per-file attribution
(see SPDX header above plus `voicebox-pin.txt`). JustVoice modifications:
schema includes Books/Chapters/Personas/Lexicons that the upstream lacked;
seed flow seeds JustVoice's own built-in effect presets.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..paths import default_data_dir
from .migrations import run_migrations
from .models import Base


logger = logging.getLogger(__name__)


engine: Optional[Engine] = None
SessionLocal: Optional[sessionmaker] = None
_db_path: Optional[Path] = None


def init_db(data_dir: Optional[Path] = None) -> None:
    """Initialize the database engine, run migrations, create tables.

    Idempotent — safe to call multiple times (e.g. across hot reload).

    Args:
        data_dir: override the resolved data directory (mostly for tests).
            Defaults to `paths.default_data_dir()`.
    """
    global engine, SessionLocal, _db_path

    if engine is not None:
        return

    if data_dir is None:
        data_dir = default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    _db_path = data_dir / "justvoice.db"

    engine = create_engine(
        f"sqlite:///{_db_path}",
        connect_args={"check_same_thread": False},
        # Foreign keys must be turned on per-connection for SQLite.
        # SQLAlchemy doesn't do this by default.
    )

    # Enable foreign keys for every new connection.
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Run idempotent column-existence migrations BEFORE create_all so any
    # schema-change migrations land on the existing tables (and create_all
    # is a no-op for tables that already exist with the right shape).
    run_migrations(engine)

    # Then ensure any net-new tables exist.
    Base.metadata.create_all(bind=engine)

    logger.info("Database: %s", _db_path)


def get_db() -> Session:
    """FastAPI dependency: yield a session, close on exit."""
    if SessionLocal is None:
        raise RuntimeError(
            "Database not initialized. Call init_db() during app startup."
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_path() -> Optional[Path]:
    """Return the resolved DB path, or None if init_db() hasn't run yet."""
    return _db_path
