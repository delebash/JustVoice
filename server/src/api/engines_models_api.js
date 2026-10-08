// SPDX-License-Identifier: MIT
// Engine lifecycle — install / load / unload / uninstall + install jobs (the port of
// justvoice/api/engines_models_api.py).
//
// Dispatches between the plugin manager (engines with a manifest) and the legacy in-process
// registry (only external OpenAI-compatible engines). The branch lives in each route so the
// route shapes stay the same.

import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { isDict } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import { conflict, notFound, serviceUnavailable } from "../errors.js";
import * as installer from "../installer.js";
import { construct, InstallRequest, InstallResponse, JobStatus, LoadRequest, LoadResponse, UninstallResponse, UnloadResponse } from "../models.js";

const log = getLogger("justvoice.api.engines_models_api");

const _isManaged = (engineId) => manager.getManager().getManifest(engineId) !== null;
const msg = (e) => e?.message ?? String(e);

/** `UnloadRequest | None = None`: an optional body whose one field is `kind: str | None`. */
function unloadKind(body) {
  if (body === undefined || body === null) return null;
  if (!isDict(body)) {
    throw new RequestValidationError([{ loc: ["body"], msg: "Input should be a valid dictionary or object to extract fields from", type: "model_attributes_type" }]);
  }
  const kind = Object.hasOwn(body, "kind") ? body.kind : null;
  if (kind !== null && typeof kind !== "string") {
    throw new RequestValidationError([{ loc: ["body", "kind"], msg: "Input should be a valid string", type: "string_type" }]);
  }
  return kind;
}

export async function router(app) {
  /**
   * Install an engine, or download one of its models.
   *   - `model_variant` given → spawnPrefetch: that model's file(s) into the speech cache;
   *   - no `model_variant` → spawnManagedInstall: the shared speech runtime (audio.cpp + eSpeak
   *     NG) — once for every engine (the 2026-10-01 switch).
   */
  app.post("/v1/engines/:id/install", { schema: { body: InstallRequest } }, async (req, reply) => {
    const id = req.params.id;
    const st = getState();
    if (_isManaged(id)) {
      if (req.body.model_variant) {
        let jobId;
        try {
          jobId = await installer.spawnPrefetch(st, id, req.body.model_variant);
        } catch (e) {
          if (e?.name === "ValueError") throw notFound(msg(e));
          throw e;
        }
        reply.code(202);
        return construct(InstallResponse, { engine_id: id, model_variant: req.body.model_variant, job_id: jobId });
      }
      // Engine-wide setup: the speech runtime every engine shares.
      const jobId = installer.spawnManagedInstall(st, id, req.body.repair);
      reply.code(202);
      return construct(InstallResponse, { engine_id: id, model_variant: "managed", job_id: jobId });
    }
    throw notFound(`Unknown engine: ${id}`);
  });

  app.post("/v1/engines/:id/load", { schema: { body: LoadRequest } }, async (req) => {
    const id = req.params.id;
    const body = req.body;
    const st = getState();
    if (_isManaged(id)) {
      const mgr = manager.getManager();
      try {
        await mgr.load(id, { device: body.device, variant: body.model_variant });
      } catch (e) {
        throw serviceUnavailable(`engine load failed: ${msg(e)}`);
      }
      // Clear the in-process current marker so it doesn't conflict with the managed claim.
      st.engines.clearCurrent();
      return construct(LoadResponse, { engine_id: id, device: body.device, model_variant: body.model_variant });
    }
    // Legacy in-process path — used by external-openai-tts.
    const engine = st.engines.get(id);
    if (engine === null) throw notFound(`Engine '${id}' is not installed. POST /v1/engines/${id}/install first.`);
    // If a managed engine is loaded, unload it first — only one engine at a time.
    const mgr = manager.getManager();
    if (mgr.currentId()) await mgr.unload();
    try {
      await engine.load(body.device, body.model_variant);
    } catch (e) {
      throw serviceUnavailable(`engine load failed: ${msg(e)}`);
    }
    st.engines.setCurrent(id);
    return construct(LoadResponse, { engine_id: id, device: body.device, model_variant: body.model_variant });
  });

  /**
   * Signal an in-flight `POST /v1/engines/{id}/load` to abort. The load checks the cancel flag
   * at safe points (between the model download, the runtime start, and the model warm-up) and
   * fails 'cancelled by user' (a 503 to the original load). A model already in the runtime is
   * unloaded, so no VRAM keeps being consumed after the cancel.
   */
  app.post("/v1/engines/:id/cancel-load", async (req) => {
    const id = req.params.id;
    if (!_isManaged(id)) {
      // In-process engines (external-openai-tts) — load has nothing to interrupt.
      return { engine_id: id, cancelled: false, reason: "engine is not managed; nothing to cancel" };
    }
    const cancelled = await manager.getManager().requestCancelLoad(id);
    return { engine_id: id, cancelled };
  });

  /**
   * Optional body `{kind}`: when given (Phase 2 / Slice 1), only the engine in that kind's slot
   * is unloaded — other-kind slots stay loaded. No body or `{}` unloads every loaded engine.
   */
  app.post("/v1/engines/unload", async (req) => {
    const requestedKind = unloadKind(req.body);
    const st = getState();
    const mgr = manager.getManager();
    let previousManaged;
    let previousInproc;
    if (requestedKind) {
      previousManaged = mgr.currentFor(requestedKind);
      previousInproc = null;
    } else {
      previousManaged = mgr.currentId();
      previousInproc = st.engines.current();
    }
    const previous = previousManaged || previousInproc;
    if (previousManaged) await mgr.unload(requestedKind);
    if (previousInproc && !requestedKind) {
      const engine = st.engines.get(previousInproc);
      if (engine) {
        try {
          await engine.unload();
        } catch (e) {
          log.warning(`engine.unload() returned error: ${msg(e)}`);
        }
      }
      st.engines.clearCurrent();
    }
    return construct(UnloadResponse, { previous_engine: previous ?? null });
  });

  /** Delete every downloaded model of this engine (its speech-cache folder). The speech runtime
   * is shared and stays. 409 when a file is still held open. */
  app.delete("/v1/engines/:id", async (req) => {
    const id = req.params.id;
    if (_isManaged(id)) {
      let result;
      try {
        result = await manager.getManager().uninstall(id);
      } catch (e) {
        if (e instanceof manager.InstallError) throw conflict(msg(e));
        throw e;
      }
      return construct(UninstallResponse, { engine_id: id, model_files_removed: Boolean(result.removed) });
    }
    throw notFound(`Unknown engine: ${id}`);
  });

  app.get("/v1/jobs/:job_id", async (req) => {
    const jobId = req.params.job_id;
    const data = getState().jobGet(jobId);
    if (!data) throw notFound(`job ${jobId}`);
    return construct(JobStatus, data);
  });

  /** Signal an in-flight install job to abort at its next safe checkpoint. */
  app.delete("/v1/jobs/:job_id", async (req, reply) => {
    const jobId = req.params.job_id;
    if (!getState().jobGet(jobId)) throw notFound(`job ${jobId}`);
    installer.cancel(jobId);
    reply.code(202);
    return { cancelled: jobId };
  });
}
