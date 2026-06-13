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
        # Idempotent for the same target; re-init when a DIFFERENT data_dir
        # is explicitly requested (tests). Without this, the first boot in a
        # pytest process pins EVERY later create_app(tmp_path) to the first
        # dir — endpoint tests were silently sharing the developer's real DB.
        if data_dir is None or (_db_path is not None and _db_path.parent == Path(data_dir)):
            return
        engine.dispose()
        engine = None
        SessionLocal = None

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

    # One-shot backfill: every audiobook/podcast project that pre-dates
    # the builtin-Narrator landing gets one created retroactively so the
    # Studio Cast view always opens with the slot populated.
    _backfill_narrator_personas(engine)

    logger.info("Database: %s", _db_path)


def _backfill_narrator_personas(eng) -> None:
    """For every audiobook + podcast project without a linked Narrator
    persona, create one and link it. Idempotent — safe to run on every
    boot. New projects already get a narrator at create_project time."""
    from .models import Persona, Project, ProjectPersona

    with sessionmaker(autocommit=False, autoflush=False, bind=eng)() as db:
        try:
            projects = (
                db.query(Project)
                .filter(Project.project_type.in_(["audiobook", "podcast"]))
                .all()
            )
            created = 0
            for proj in projects:
                has_narrator = (
                    db.query(ProjectPersona)
                    .join(Persona, Persona.id == ProjectPersona.persona_id)
                    .filter(
                        ProjectPersona.project_id == proj.id,
                        Persona.name.ilike("narrator"),
                    )
                    .first()
                )
                if has_narrator:
                    continue
                narrator = Persona(
                    name="Narrator",
                    bio="The voice of everything that isn't spoken.",
                    personality=(
                        "Steady, clear, unhurried — carries the prose between dialogue."
                    ),
                    is_builtin=True,
                )
                db.add(narrator)
                db.flush()
                db.add(
                    ProjectPersona(
                        project_id=proj.id,
                        persona_id=narrator.id,
                        role_label="narrator",
                    )
                )
                created += 1
            if created:
                db.commit()
                logger.info("Backfilled %d narrator personas", created)
        except Exception as e:  # noqa: BLE001 — boot must not die on this
            logger.warning("Narrator backfill failed: %s", e)
            db.rollback()


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
