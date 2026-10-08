// SPDX-License-Identifier: MIT
// The JustVoice server's application factory (the port of justvoice/app.py).
//
// Boots the AppState (engine registry + stores), discovers the managed engines, registers any
// configured external engines, then mounts every router — JustVoice's own, the shared runner
// router, the whole shared LLM stack (installLlm), the family data/logs/disk routers and the MCP
// server. The GUI (the Vite-built Vue SPA) is served from `/` (with `/ui` redirecting there).
//
// The family shape (JustWrite's app.js, docgen's): problem+json errors (`createServer`), the
// kit's CSRF / CORS / bearer-auth hooks in Python's middleware order, a catch-all error
// envelope, and `@fastify/static` for the UI with Starlette's StaticFiles answers.

import path from "node:path";
import { statSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import { installLlm, router as runnerRouter } from "@delebash/llm-runner";
import {
  BearerAuthMiddleware,
  CorsMiddleware,
  CsrfOriginMiddleware,
  createServer,
  installFileLog,
  installLogRing,
  makeDiskRouter,
  makeLogsRouter,
} from "@delebash/llm-runner/platform";
import { purePath } from "@delebash/llm-runner/platform/data_paths";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { NotImplementedError, ValueError } from "@delebash/llm-runner/platform/py";
// ── The routers (registered below in app.py's order) ──
import { router as activeTasksRouter } from "./api/active_tasks_api.js";
import { router as alignRouter } from "./api/align_api.js";
import { router as bulkDeleteRouter } from "./api/bulk_delete_api.js";
import { router as analyzerRouter } from "./api/analyzer_api.js";
import { router as cacheRouter } from "./api/cache_api.js";
import { router as captureReadinessRouter } from "./api/capture_readiness_api.js";
import { router as capturesRouter } from "./api/captures_api.js";
import { router as channelsRouter } from "./api/channels_api.js";
import { router as effectPresetsRouter } from "./api/effect_presets_api.js";
import { router as engineSourcesRouter } from "./api/engine_sources_api.js";
import { router as enginesRouter } from "./api/engines_api.js";
import { router as enginesModelsRouter } from "./api/engines_models_api.js";
import { router as exportJobsRouter } from "./api/export_jobs_api.js";
import { router as externalRouter } from "./api/external_api.js";
import { router as extractionRouter } from "./api/extraction_api.js";
import { router as generateRouter } from "./api/generate_api.js";
import { router as healthRouter } from "./api/health_api.js";
import { router as lexiconsRouter } from "./api/lexicons_api.js";
import { router as masterRouter } from "./api/master_api.js";
import { router as mcpBindingsRouter } from "./api/mcp_bindings_api.js";
import { router as modelsRouter } from "./api/models_api.js";
import { router as personasRouter } from "./api/personas_api.js";
import { router as prefsRouter } from "./api/prefs_api.js";
import { router as projectExportRouter } from "./api/project_export_api.js";
import { router as projectsRouter } from "./api/projects_api.js";
import { router as pronunciationRouter } from "./api/pronunciation_api.js";
import { router as refineLabRouter } from "./api/refine_lab_api.js";
import { router as renderChapterRouter } from "./api/render_chapter_api.js";
import { router as renderJobsRouter } from "./api/render_jobs_api.js";
import { router as renderLinesRouter } from "./api/render_lines_api.js";
import { router as serverAuthRouter } from "./api/server_auth_api.js";
import { router as settingsRouter } from "./api/settings_api.js";
import { router as smartAssignRouter } from "./api/smart_assign_api.js";
import { router as speakersRouter } from "./api/speakers_api.js";
import { router as speechRuntimeRouter } from "./api/speech_runtime_api.js";
import { router as sseStreamsRouter } from "./api/sse_streams_api.js";
import { router as systemRouter } from "./api/system_api.js";
import { router as takesRouter } from "./api/takes_api.js";
import { router as voiceBundleRouter } from "./api/voice_bundle_api.js";
import { router as voicePreviewRouter } from "./api/voice_preview_api.js";
import { router as voicesRouter } from "./api/voices_api.js";
import { router as webhooksRouter } from "./api/webhooks_api.js";
import { AppState, setState } from "./app_state.js";
import * as dspClient from "./audio/dsp_client.js";
import { readAuth } from "./auth.js";
import { getDataRouter } from "./data_admin.js";
import { initDb, getDb } from "./database/session.js";
import * as runtime from "./engines/audiocpp/runtime.js";
import { ExternalOpenAiTtsBackend } from "./engines/external_openai.js";
import * as manager from "./engines/manager.js";
import { FEATURE_CATALOG, PREFER_LOCAL_FEATURES } from "./feature_catalog.js";
import * as lineTakes from "./line_takes.js";
import { mountInto as mountMcp } from "./mcp/index.js";
import { cacheRoot, defaultDataDir, SOURCE_ROOT, speechCacheRoot } from "./paths.js";
import * as renderJobs from "./render_jobs.js";
import { DEFAULT_FEATURE_PROMPTS } from "./seed_feature_prompts.js";
import {
  DEFAULT_ENGINE_PRESETS,
  DEFAULT_FEATURE_PRESETS,
  DEFAULT_PRESET_ID,
  DEFAULT_TEST_SAMPLES,
  JV_CLASS_TUNE_IDENTITY,
  JV_CLASS_TUNES,
  JV_MODEL_CATALOG,
} from "./seed_presets.js";
import { PRODUCT } from "./version.js";

const log = getLogger("justvoice.app");

export const TYPE_BASE = "https://justvoice.dev/errors/";

// The app's own page origins: the Vite dev server, and the Electron window (`app://justvoice`
// — the desktop shell loads the renderer from there; without it every mutating call from the
// desktop app would be refused 403 by the CSRF guard). The window's origin stays allowed when
// the user locks CORS down too — JustWrite's ruling for the Electron move (2026-10-08), the
// family-sameness law. The packaged Tauri origins are the kit's own CSRF defaults.
export const DESKTOP_ORIGIN = "app://justvoice";
export const APP_ORIGINS = ["http://localhost:1430", "http://127.0.0.1:1430", DESKTOP_ORIGIN];

/**
 * The catch-all error envelope: an unhandled exception becomes a JSON 500 that still carries
 * the CORS headers (stamped by the CORS hook before the route ran), so the browser sees a real
 * error instead of "blocked by CORS" (verified the hard way, 2026-06-12). The detail is
 * Python's `str(exc)[:300]`.
 */
function errorEnvelope(err, request, reply) {
  log.exception(`unhandled error on ${request.method} ${request.url.split("?")[0]}`, err);
  const detail = [...String(err instanceof Error ? err.message : err)].slice(0, 300).join("");
  return reply.code(500).type("application/json").send({ title: "Internal Server Error", detail });
}

/** Routes the kit builds that store a free-form body with Python's json.dumps. */
export const PY_FLOAT_ROUTES = new Set(["PATCH /v1/prefs"]);

/** Find the Vite build output (dist/) across dev + packaged layouts. */
export function locateUiDir() {
  const candidates = [];
  const override = process.env.JUSTVOICE_UI_DIR;
  if (override) candidates.push(override);
  // Source layout: server/src/app.js → the repo root holds dist/.
  candidates.push(path.join(SOURCE_ROOT, "dist"));
  // Packaged / cwd fallback.
  candidates.push(path.join(process.cwd(), "dist"));
  for (const c of candidates) if (isDir(c) && isFile(path.join(c, "index.html"))) return c;
  return null;
}

const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * Boot-time engine registration. Managed engines are the plugin manager's — discovery runs the
 * first time `getManager()` is called, triggered here so the catalog is populated before the
 * first request. The manager doesn't auto-LOAD anything; that's the user's explicit action via
 * /v1/engines/{id}/load. Every built-in engine is a catalog under engines/<id>/ whose models
 * run in the one audio.cpp speech runtime (the 2026-10-01 switch).
 */
export function _registerExistingEngines(_state, _dataDir) {
  const mgr = manager.getManager();
  const ids = [...mgr.manifests().keys()];
  log.info(`plugin manager discovered ${ids.length} managed engines: ${[...ids].sort().join(", ") || "(none)"}`);
}

/** Register every configured external TTS provider (`provider_type` picks the adapter). */
export async function _registerExternalEngines(state) {
  const settings = state.settings.get();
  for (const cfg of settings.engines.external) {
    try {
      state.engines.register(await _buildExternalEngine(cfg));
      log.info(`external TTS provider registered: id=${cfg.id} type=${cfg.provider_type}`);
    } catch (e) {
      log.warning(`external TTS provider ${cfg.id} skipped at boot: ${e?.message ?? e}`);
    }
  }
}

/** The right adapter class for `cfg.provider_type`. */
export async function _buildExternalEngine(cfg) {
  const pt = (cfg.provider_type || "openai-compat").toLowerCase();
  if (pt === "openai-compat" || pt === "openai-tts" || pt === "external-openai-tts") {
    // OpenAI TTS uses the same /v1/audio/speech shape as openai-compat; they're the same
    // adapter with a different default base_url.
    const baseUrl = cfg.base_url || (pt === "openai-tts" ? "https://api.openai.com" : "");
    if (!baseUrl) throw new ValueError(`${cfg.id}: openai-compat external engine needs a base_url`);
    return new ExternalOpenAiTtsBackend({
      id: cfg.id,
      name: cfg.name,
      baseUrl,
      apiKey: cfg.api_key,
      model: cfg.model || "tts-1",
      voices: cfg.voices,
      responseFormat: cfg.response_format,
    });
  }
  const providers = {
    elevenlabs: ["./engines/tts_providers/elevenlabs.js", "ElevenLabsBackend", "eleven_flash_v2_5"],
    speechify: ["./engines/tts_providers/speechify.js", "SpeechifyBackend", "simba-multilingual"],
    speechmatics: ["./engines/tts_providers/speechmatics.js", "SpeechmaticsBackend", "default"],
  };
  if (Object.hasOwn(providers, pt)) {
    const [file, cls, model] = providers[pt];
    const Backend = (await import(file))[cls];
    return new Backend({
      id: cfg.id,
      name: cfg.name,
      apiKey: cfg.api_key || "",
      model: cfg.model || model,
      voices: cfg.voices,
      baseUrl: cfg.base_url,
      responseFormat: cfg.response_format,
    });
  }
  if (pt === "edge-tts") throw new NotImplementedError("Edge TTS adapter requires Tauri-side msedge-tts wiring — deferred");
  throw new ValueError(`unknown TTS provider_type: '${pt}'`);
}

/**
 * The Fastify app (not yet listening). `dataDir` defaults to the family data-root ladder.
 * Seeding is NOT done here (serve.js runs `seedWorkspace()`): a test's createApp(tmp) starts
 * from an empty database — the family's named winner for the seeding call-site.
 */
export async function createApp(dataDir = null) {
  dataDir = dataDir ? purePath(String(dataDir)) : defaultDataDir();

  // Server logs → in-memory ring (Settings → Logs) + a per-day file that survives a
  // crash/boot-hang. Shared platform helpers, same in every app.
  installLogRing();
  installFileLog(path.join(dataDir, "logs", "justvoice.log"));

  // SQLite is the primary persistence layer: initDb runs the idempotent migrations and creates
  // net-new tables.
  initDb(dataDir);
  const state = new AppState(dataDir);
  setState(state);

  // Hardware detection is async in JavaScript, and the runtime's readers (installed build,
  // features, placement) read its memo — detected once, before anything reads them.
  const hw = await runtime.ensureHardware();
  log.debug(`boot: hardware detected (${hw.platform}, ${(hw.gpus || []).length} GPU(s), ${runtime.physicalCores()} cores)`);

  // Render jobs a dead server left queued/running become "paused" (their rows survive a
  // restart; resume re-runs the unfinished blocks).
  try {
    const swept = renderJobs.sweepStaleJobs();
    if (swept) log.info(`render jobs: ${swept} interrupted job(s) marked paused`);
  } catch (e) {
    log.warning(`render-job boot sweep failed: ${e?.message ?? e}`);
  }
  // A take's audio goes with it (Studio Slice 4): generations whose take was deleted with its
  // line, chapter or book — rows and files.
  const sweptTakes = lineTakes.sweepOrphanTakesNow();
  if (sweptTakes) log.info(`takes: ${sweptTakes} orphaned take generation(s) removed`);

  _registerExistingEngines(state, dataDir);
  await _registerExternalEngines(state);

  const settings = state.settings.get();
  // (FastAPI's /openapi.json, /docs and /redoc — `settings.server.docs_enabled` — have no
  // Fastify counterpart: the JavaScript server publishes no OpenAPI document.)
  // Request bodies keep Python's floats where a route opts in (the kit's float opt-in: `config:
  // {pyFloats: true}`, or a kit-built route named here), and every body as sent rides on
  // `req.sentBody` — what pydantic's `exclude_unset` reads (PATCH /v1/settings, PUT
  // /v1/speech-runtime).
  const app = createServer({ typeBase: TYPE_BASE, onUnhandled: errorEnvelope, pyFloats: { routes: PY_FLOAT_ROUTES } });
  // serve.js hands the app its server handle (Python's `app.state.uvicorn_server`) — what
  // POST /v1/shutdown stops.
  app.decorate("serverHandle", null);

  // Python's middleware order, outermost first: the MCP client-id stamp (mcp/index.js — an
  // onResponse hook), CSRF, then CORS, then bearer auth (Starlette ran the last-added first).
  // Fastify runs onRequest hooks in the order these root plugins load: a CSRF 403 carries no
  // CORS headers; CORS answers preflights before auth sees them and stamps auth's 401/403. All
  // three gate `/v1` paths only, so `/mcp` passes them as it did in Python.
  const corsOrigins = settings.cors.origins;
  const corsRegex = settings.cors.origin_regex;

  // CSRF: reject cross-site browser mutations to /v1 (no token — can never lock anyone out).
  // JustVoice reuses its CORS origins AND its loopback origin_regex as the one allowlist.
  app.register(CsrfOriginMiddleware, {
    appOrigins: APP_ORIGINS,
    extraOrigins: corsOrigins,
    originRegex: corsRegex,
    typeBase: TYPE_BASE,
  });

  // CORS — the bundled UI is a different origin than this loopback server; without these
  // headers the webview's fetch() calls are blocked. Operator-tunable; none configured → no
  // CORS answers at all (Python added the middleware only when one is set).
  if (corsOrigins.length || corsRegex) {
    app.register(CorsMiddleware, {
      allowOrigins: [DESKTOP_ORIGIN, ...corsOrigins.filter((o) => o !== DESKTOP_ORIGIN)],
      allowOriginRegex: corsRegex || null,
      allowCredentials: true,
      allowMethods: ["*"],
      allowHeaders: ["*"],
    });
  }

  // Auth — the desktop shell closes the server through /v1/shutdown and carries no token; with
  // "Require a token even on localhost" on, every close fell back to a hard kill (2026-09-30).
  // It stays refused from anywhere but this machine (system_api's own check, and auth).
  app.register(BearerAuthMiddleware, { readAuth, typeBase: TYPE_BASE, loopbackOpenPaths: ["/v1/shutdown"] });

  // ── Routes, in app.py's order ──────────────────────────────────────────────
  app.register(healthRouter);
  app.register(systemRouter);
  app.register(serverAuthRouter); // the auth door + lockout escape (family shape)
  app.register(settingsRouter);
  app.register(voicesRouter);
  app.register(voiceBundleRouter);
  app.register(personasRouter);
  app.register(speakersRouter);
  app.register(lexiconsRouter);
  app.register(enginesRouter);
  app.register(speechRuntimeRouter);
  app.register(modelsRouter);
  app.register(enginesModelsRouter);
  app.register(engineSourcesRouter);
  app.register(runnerRouter);

  // THE SHARED STACK, ONE CALL: the same installLlm JustWrite boots through — LLM tables in
  // JustVoice's SQLite, DB-backed provider CRUD, the routing/presets/tunes/knob-catalog
  // surface, the DB usage sink, the bundled runner wired to the DB catalog — and JustVoice's
  // own feature data: every action a template row, every tunable on a preset, per-row Lab
  // samples.
  await installLlm(app, {
    db: getDb(),
    featureCatalog: FEATURE_CATALOG,
    // Every JV action as a template row + the preset library the rows run on (one-source:
    // presets own every tunable) + per-row Lab samples. Insert-if-missing.
    featurePrompts: DEFAULT_FEATURE_PROMPTS,
    enginePresets: DEFAULT_ENGINE_PRESETS,
    featurePresets: DEFAULT_FEATURE_PRESETS,
    defaultPresetId: DEFAULT_PRESET_ID,
    testSamples: DEFAULT_TEST_SAMPLES,
    // The family's measured daily driver ONLY (user direction 2026-08-05), with its measured
    // class tunes + identity, so the family's launch configs apply here too.
    modelCatalogExtra: JV_MODEL_CATALOG,
    classTunesSeed: JV_CLASS_TUNES,
    classTuneIdentity: JV_CLASS_TUNE_IDENTITY,
    preferLocalFeatures: PREFER_LOCAL_FEATURES,
    dataDir,
    // Names JustVoice in the family cache registry so a sibling app's Quick Setup can offer to
    // SHARE the engine + model cache instead of re-downloading.
    product: PRODUCT,
    // allowKeyReveal stays OFF pending an explicit ruling.
  });
  // Workspace SEEDING (effect presets, JV's warm-OFF default, the legacy migrations, the
  // shared LLM seed, the provider registry boot) is database/seed.js `seedWorkspace()`, called
  // by serve.js AFTER createApp.

  app.register(generateRouter);
  app.register(renderChapterRouter);
  app.register(analyzerRouter);
  app.register(alignRouter);
  app.register(pronunciationRouter);
  app.register(externalRouter);
  app.register(cacheRouter);
  app.register(masterRouter);
  app.register(projectsRouter);
  // Phase 4a backend (DESIGN_FREEZE §5)
  app.register(takesRouter);
  app.register(renderJobsRouter);
  app.register(exportJobsRouter);
  app.register(renderLinesRouter);
  app.register(channelsRouter);
  app.register(mcpBindingsRouter);
  app.register(activeTasksRouter);
  app.register(captureReadinessRouter);
  app.register(capturesRouter);
  // The shared /v1/data backup/restore/reset (JW's donor wiring in data_admin.js).
  app.register(getDataRouter());
  // The shared platform log + disk surface (the kit's LogsPanel + Storage read these).
  app.register(makeLogsRouter(PRODUCT));
  // JustVoice's app-specific stores ride the disk router's extras: "Speech models" is the
  // speech cache (every downloaded speech model), the render cache its own row.
  app.register(makeDiskRouter(dataDir, { speechCache: [speechCacheRoot(dataDir)], renderCache: cacheRoot(dataDir) }));
  app.register(sseStreamsRouter);
  // Phase 4a addendum (gap-decision workflow v1.0 endpoints)
  app.register(webhooksRouter);
  app.register(bulkDeleteRouter);
  app.register(voicePreviewRouter);
  app.register(projectExportRouter);
  app.register(effectPresetsRouter);
  app.register(prefsRouter);
  app.register(extractionRouter);
  app.register(refineLabRouter);
  app.register(smartAssignRouter);

  // MCP server — justvoice.speak / list_voices / list_personas for local AI agents, at /mcp
  // (Streamable HTTP), before the root static catch-all. A failed mount must still boot the app.
  let mcp = null;
  try {
    mcp = mountMcp(app);
  } catch (e) {
    log.warning(`MCP server failed to mount (continuing without it): ${e?.message ?? e}`);
  }

  // Shutdown — every open MCP session, then the managed engines (their runtime processes), then
  // the DSP program. Without it, a stopped server would leave engine processes holding memory.
  app.addHook("onClose", async () => {
    if (mcp !== null) {
      try {
        await mcp.close();
      } catch (e) {
        log.warning(`MCP close raised: ${e?.message ?? e}`);
      }
    }
    try {
      await manager.shutdownManager();
    } catch (e) {
      log.warning(`manager shutdown raised: ${e?.message ?? e}`);
    }
    await dspClient.stop();
  });

  mountStatic(app);
  return app;
}

/**
 * The legacy reference UI at /legacy/ (in-repo only, when legacy-gui/ exists) and the Vite
 * build at / (the headless UI) — Starlette's StaticFiles(html=True) answers: "/" is
 * index.html; a missing file answers FastAPI's {"detail": "Not Found"}; any method but
 * GET/HEAD on an unrouted path answers 405 (measured on JustWrite's Python server).
 */
function mountStatic(app) {
  const legacyDir = path.join(SOURCE_ROOT, "legacy-gui");
  if (isDir(legacyDir) && isFile(path.join(legacyDir, "index.html"))) {
    app.get("/legacy", async (_req, reply) => reply.redirect("/legacy/", 307));
    app.register(fastifyStatic, {
      root: legacyDir,
      prefix: "/legacy/",
      wildcard: true,
      index: ["index.html"],
      redirect: false,
      cacheControl: false,
      decorateReply: false,
    });
    log.info(`Legacy reference UI served from ${legacyDir}`);
  }

  const uiDir = locateUiDir();
  if (uiDir !== null) {
    // /ui/ kept as a redirect for the documented headless URL.
    const toRoot = async (_req, reply) => reply.redirect("/", 307);
    app.get("/ui", toRoot);
    app.get("/ui/", toRoot);
    app.register(fastifyStatic, {
      root: uiDir,
      prefix: "/",
      wildcard: true,
      index: ["index.html"],
      redirect: false,
      cacheControl: false,
    });
    // StaticFiles raised Starlette's own HTTPException, which FastAPI's default handler
    // answers (not the problem+json handlers).
    app.route({
      method: ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      url: "/*",
      handler: async (_req, reply) => reply.code(405).send({ detail: "Method Not Allowed" }),
    });
    log.info(`UI served from ${uiDir}`);
  } else {
    log.warning("UI build not found — headless UI disabled. Run `npm run build:vite` to produce dist/, or set JUSTVOICE_UI_DIR.");
  }
}

