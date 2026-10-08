// SPDX-License-Identifier: MIT
// DELETE /v1/generations — bulk-delete generations matching filter criteria (the port of
// justvoice/api/bulk_delete_api.py).
//
// Dry-run by default (confirm=false returns the would-be-deleted count). At least one filter
// required to prevent an accidental nuke-all.

import { statSync, unlinkSync } from "node:fs";
import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { Generation, Persona } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest } from "../errors.js";
import { mediaFile } from "../media_paths.js";
import { construct } from "../models.js";

export const OkStatus = literal("ok", "failed");

export const BulkDeleteResult = T.Object({ deleted_count: T.Integer(), freed_bytes: T.Integer(), dry_run: T.Boolean() });

const Query = T.Object({
  voice_id: opt(nullable(T.String()), null),
  engine: opt(nullable(T.String()), null),
  scope: opt(nullable(T.String()), null),
  status: opt(nullable(OkStatus), null),
  older_than: opt(nullable(T.String()), null),
  chapter_id: opt(nullable(T.String()), null),
  project_id: opt(nullable(T.String()), null),
  confirm: opt(T.Boolean(), false),
});

const DATE_ERR = "Input should be a valid datetime or date";

/**
 * pydantic's `datetime` from a query string → the stored form SQLAlchemy binds
 * ("YYYY-MM-DD HH:MM:SS.ffffff", the wall-clock time, any offset dropped). Accepts what pydantic
 * 2.13 accepts in lax mode: an ISO date-time (`T`, `t`, `_` or a space between, seconds and a
 * fraction optional, `Z` or ±HH[:MM]), a date alone (midnight), or a number as Unix time
 * (seconds, milliseconds past 2e10). The refusal words are pydantic's for the common cases.
 * Candidate for platform/models.js.
 */
export function _queryDatetime(raw) {
  const fail = (why) => {
    throw new RequestValidationError([{ loc: ["query", "older_than"], msg: `${DATE_ERR}, ${why}`, type: "datetime_from_date_parsing" }]);
  };
  const s = String(raw);
  if (/^[-+]?\d+(\.\d*)?$/.test(s)) {
    let n = Number(s);
    if (Math.abs(n) > 2e10) n /= 1000;
    const micros = Math.round(n * 1e6);
    const iso = new Date(Math.floor(micros / 1e6) * 1000).toISOString();
    const frac = String(((micros % 1e6) + 1e6) % 1e6).padStart(6, "0");
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${frac}`;
  }
  if (s.length < 10) fail("input is too short");
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!date) {
    if (!/^\d{4}/.test(s)) fail("invalid character in year");
    if (s[4] !== "-") fail("invalid date separator, expected `-`");
    if (!/^\d{4}-\d{2}/.test(s)) fail("invalid character in month");
    if (s[7] !== "-") fail("invalid date separator, expected `-`");
    fail("invalid character in day");
  }
  const [, y, mo, da] = date;
  if (Number(mo) < 1 || Number(mo) > 12) fail("month value is outside expected range of 1-12");
  const days = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
  if (Number(da) < 1 || Number(da) > days) fail("day value is outside expected range");
  if (s.length === 10) return `${y}-${mo}-${da} 00:00:00.000000`;
  const t = /^[Tt _](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6})\d*)?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s.slice(10));
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59 || Number(t[3] ?? 0) > 59) fail("unexpected extra characters at the end of the input");
  return `${y}-${mo}-${da} ${t[1]}:${t[2]}:${t[3] ?? "00"}.${(t[4] ?? "").padEnd(6, "0")}`;
}

export async function router(app) {
  /**
   * Bulk-delete generations matching filter criteria. Filters compose with AND. At least one
   * filter required (400 otherwise) to prevent an accidental nuke-all. confirm=false (default)
   * returns the dry-run count WITHOUT deleting; pass confirm=true to actually delete.
   */
  app.delete("/v1/generations", { schema: { querystring: Query } }, async (req) => {
    const h = session.getDb();
    const q = req.query;
    const olderThan = q.older_than === null ? null : _queryDatetime(q.older_than);
    const present = [q.voice_id, q.engine, q.scope, q.status, olderThan, q.chapter_id, q.project_id].some((v) => v !== null);
    if (!present) {
      throw badRequest(
        "At least one filter required to prevent accidental nuke-all. Use voice_id / engine / scope / status / older_than / chapter_id / project_id.",
      );
    }

    const where = [];
    const params = [];
    if (q.voice_id !== null) {
      // A generation knows its voice two ways: legacy rows wrote the voice id into profile_id
      // verbatim; persona-era rows carry persona_id and the persona binds the voice. Match both
      // or the filter silently misses everything written since the persona flip.
      where.push(`(profile_id = ? or persona_id in (select id from ${Persona} where voice_id = ?))`);
      params.push(q.voice_id, q.voice_id);
    }
    if (q.engine !== null) {
      where.push("engine = ?");
      params.push(q.engine);
    }
    // scope is the cache_scope from the old storage layer; not in the table — accepted as a
    // no-op for forward compat with the docs.
    if (q.status !== null) {
      where.push("ok_status = ?");
      params.push(q.status);
    }
    if (olderThan !== null) {
      where.push("created_at < ?");
      params.push(olderThan);
    }
    if (q.chapter_id !== null) {
      where.push("chapter_id = ?");
      params.push(q.chapter_id);
    }
    if (q.project_id !== null) {
      where.push("project_id = ?");
      params.push(q.project_id);
    }
    const rows = h.all(`select * from ${Generation}${where.length ? ` where ${where.join(" and ")}` : ""}`, params, Generation);

    // Count + measure disk usage before delete.
    const count = rows.length;
    let freedBytes = 0;
    const audioPaths = [];
    for (const r of rows) {
      if (!r.audio_path) continue;
      const p = mediaFile(r.audio_path);
      try {
        const st = statSync(p, { throwIfNoEntry: false });
        if (st?.isFile()) {
          freedBytes += st.size;
          audioPaths.push(p);
        }
      } catch {
        /* OSError */
      }
    }

    if (!q.confirm) return construct(BulkDeleteResult, { deleted_count: count, freed_bytes: freedBytes, dry_run: true });

    // Actually delete: DB rows first (cascades), then audio files.
    h.tx(() => {
      for (const r of rows) h.delete(Generation, { id: r.id });
    });
    for (const p of audioPaths) {
      try {
        unlinkSync(p);
      } catch {
        /* OSError */
      }
    }
    return construct(BulkDeleteResult, { deleted_count: count, freed_bytes: freedBytes, dry_run: false });
  });
}
