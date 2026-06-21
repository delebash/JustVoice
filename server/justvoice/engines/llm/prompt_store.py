# SPDX-License-Identifier: GPL-3.0-or-later
"""JustVoice's FeaturePromptStore — the per-feature prompt rows in the
`feature_prompts` SQLite table (DB-seeded, Lab-editable; the source of truth).

Mirrors JustWrite's `llm/prompt_store.py`: a short-lived session per call. The
seed (`database/seed.py:seed_feature_prompts`) populates defaults on boot; the
server reads prompts from here at request time — no hardcoded prompt text, no
runtime code fallback (a missing key is a 404). See
docs/plans/2026-06-21-feature-prompts-db-seed.md.
"""

from __future__ import annotations

from dataclasses import dataclass

from ...database import session as _db_session
from ...database.models import FeaturePrompt


@dataclass
class FeaturePromptRow:
    key: str
    feature: str
    system: str
    user_template: str
    temperature: float
    think: bool
    built_in: bool


def _to_row(r: FeaturePrompt) -> FeaturePromptRow:
    return FeaturePromptRow(
        key=r.key,
        feature=r.feature,
        system=r.system,
        user_template=r.user_template,
        temperature=r.temperature,
        think=r.think,
        built_in=r.built_in,
    )


class FeaturePromptStore:
    """CRUD over the `feature_prompts` table (mirrors JustWrite's store)."""

    def _session(self):
        if _db_session.SessionLocal is None:
            raise RuntimeError("Database not initialized — call init_db() during boot")
        return _db_session.SessionLocal()

    def get(self, key: str) -> FeaturePromptRow | None:
        db = self._session()
        try:
            row = db.get(FeaturePrompt, key)
            return _to_row(row) if row is not None else None
        finally:
            db.close()

    def list(self) -> list[FeaturePromptRow]:
        db = self._session()
        try:
            rows = db.query(FeaturePrompt).order_by(FeaturePrompt.key).all()
            return [_to_row(r) for r in rows]
        finally:
            db.close()

    def upsert(self, row: FeaturePromptRow) -> None:
        db = self._session()
        try:
            existing = db.get(FeaturePrompt, row.key)
            if existing is None:
                db.add(FeaturePrompt(
                    key=row.key,
                    feature=row.feature,
                    system=row.system,
                    user_template=row.user_template,
                    temperature=row.temperature,
                    think=row.think,
                    built_in=row.built_in,
                ))
            else:
                existing.feature = row.feature
                existing.system = row.system
                existing.user_template = row.user_template
                existing.temperature = row.temperature
                existing.think = row.think
            db.commit()
        finally:
            db.close()

    def reset(self, key: str) -> bool:
        db = self._session()
        try:
            row = db.get(FeaturePrompt, key)
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()


_store = FeaturePromptStore()


def get_prompt_store() -> FeaturePromptStore:
    return _store
