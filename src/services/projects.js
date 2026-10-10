// SPDX-License-Identifier: MIT
/**
 * Projects API client — Project/Scene/Block CRUD + JustWrite import.
 * Backed by /v1/projects/* endpoints (DESIGN_FREEZE §5).
 */
import { useApi } from "../stores/api.js";

function withApi() {
  return useApi();
}

export const projectsService = {
  list(projectType) {
    const api = withApi();
    const q = projectType ? `?project_type=${encodeURIComponent(projectType)}` : "";
    return api.get(`/v1/projects${q}`);
  },
  get(id) {
    return withApi().get(`/v1/projects/${id}`);
  },
  create(body) {
    return withApi().post(`/v1/projects`, body);
  },
  update(id, body) {
    return withApi().patch(`/v1/projects/${id}`, body);
  },
  remove(id) {
    return withApi().del(`/v1/projects/${id}`);
  },
  /** Multi-adapter import. {source, file, dryRun?} -> ImportRunResponse. `create` carries New
   *  project's choices — {name, project_type, language} — which win over what the file says. */
  async runImport({ source, file, dryRun = false, projectId = null, includeScenes = null, splitOn = null, create = null } = {}) {
    if (!source) throw new Error("runImport: source is required");
    if (!file) throw new Error("runImport: file is required");
    const form = new FormData();
    form.append("source", source);
    form.append("file", file);
    if (dryRun) form.append("dry_run", "true");
    if (projectId) form.append("project_id", projectId);  // update-in-place merge
    if (Array.isArray(includeScenes)) {
      form.append("include_scenes", includeScenes.join(","));
    }
    if (splitOn) form.append("split_on", splitOn);  // book_prose chapter-split strategy
    if (create?.name) form.append("name", create.name);
    if (create?.project_type) form.append("project_type", create.project_type);
    if (create?.language) form.append("language", create.language);
    return withApi().postForm(`/v1/projects/import`, form);
  },

  /** Lists available import adapters for the format picker. */
  listImportAdapters() {
    return withApi().get(`/v1/projects/import/adapters`);
  },
  listScenes(projectId) {
    return withApi().get(`/v1/projects/${projectId}/scenes`);
  },
  createScene(projectId, body) {
    return withApi().post(`/v1/projects/${projectId}/scenes`, body);
  },
  listBlocks(sceneId) {
    return withApi().get(`/v1/scenes/${sceneId}/blocks`);
  },
  createBlock(sceneId, body) {
    return withApi().post(`/v1/scenes/${sceneId}/blocks`, body);
  },
  updateBlock(blockId, body) {
    return withApi().patch(`/v1/blocks/${blockId}`, body);
  },
  removeBlock(blockId) {
    return withApi().del(`/v1/blocks/${blockId}`);
  },
  // The people in a book — its speakers; each is cast by giving it a persona
  // (the voice). The project ↔ persona cast link died 2026-09-29.
  listSpeakers(projectId) {
    return withApi().get(`/v1/projects/${projectId}/speakers`);
  },
  addSpeaker(projectId, body) {
    return withApi().post(`/v1/projects/${projectId}/speakers`, body);
  },
  updateSpeaker(speakerId, body) {
    return withApi().patch(`/v1/speakers/${speakerId}`, body);
  },
  removeSpeaker(speakerId) {
    return withApi().del(`/v1/speakers/${speakerId}`);
  },
  uncastAll(projectId) {
    return withApi().post(`/v1/projects/${projectId}/speakers/uncast`, {});
  },
  setNarrator(projectId, speakerId) {
    return withApi().put(`/v1/projects/${projectId}/narrator`, { speaker_id: speakerId });
  },
  addNarrator(projectId) {
    return withApi().post(`/v1/projects/${projectId}/narrator`, {});
  },
  exportZip(projectId, opts = {}) {
    const params = new URLSearchParams();
    params.set("include_audio", String(opts.includeAudio ?? true));
    return withApi().requestBlob(`/v1/projects/${projectId}/export?${params}`);
  },
};

export const takesService = {
  byBlock(blockId) {
    return withApi().get(`/v1/takes/by_block/${blockId}`);
  },
  setDefault(takeId) {
    return withApi().post(`/v1/takes/${takeId}/set_default`);
  },
  update(takeId, body) {
    return withApi().patch(`/v1/takes/${takeId}`, body);
  },
  remove(takeId) {
    return withApi().del(`/v1/takes/${takeId}`);
  },
};

export const channelsService = {
  list() {
    return withApi().get(`/v1/channels`);
  },
  create(body) {
    return withApi().post(`/v1/channels`, body);
  },
  update(id, body) {
    return withApi().patch(`/v1/channels/${id}`, body);
  },
  remove(id) {
    return withApi().del(`/v1/channels/${id}`);
  },
  // Persona↔channel routing. These hit /v1/personas/… — the old
  // /v1/profiles/… spelling 404s post-persona-rename (wiring-audit W6).
  getPersonaChannels(personaId) {
    return withApi().get(`/v1/personas/${personaId}/channels`);
  },
  setPersonaChannels(personaId, channelIds) {
    return withApi().put(`/v1/personas/${personaId}/channels`, {
      channel_ids: channelIds,
    });
  },
};

export const mcpBindingsService = {
  list() {
    return withApi().get(`/v1/mcp/bindings`);
  },
  upsert(body) {
    return withApi().post(`/v1/mcp/bindings`, body);
  },
  remove(clientId) {
    return withApi().del(`/v1/mcp/bindings/${clientId}`);
  },
};

export const webhooksService = {
  list() {
    return withApi().get(`/v1/webhooks`);
  },
  create(body) {
    return withApi().post(`/v1/webhooks`, body);
  },
  remove(id) {
    return withApi().del(`/v1/webhooks/${id}`);
  },
  test(id) {
    return withApi().post(`/v1/webhooks/${id}/test`);
  },
};

// (backupService died with the bespoke /v1/backup + /v1/restore — the kit
// DataManagement over the shared /v1/data router is the one backup surface,
// parity batch 2026-08-06.)

export const voicePreviewService = {
  preview(body) {
    return withApi().post(`/v1/voices/preview`, body);
  },
  save(previewId, body) {
    return withApi().post(`/v1/voices/preview/${previewId}/save`, body);
  },
};

export const bulkDeleteService = {
  generations(filters, confirm = false) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) {
      if (v != null) params.set(k, String(v));
    }
    params.set("confirm", String(confirm));
    return withApi().del(`/v1/generations?${params}`);
  },
};

export const activeTasksService = {
  get() {
    return withApi().get(`/v1/active_tasks`);
  },
};

export const captureReadinessService = {
  get() {
    return withApi().get(`/v1/capture/readiness`);
  },
};
