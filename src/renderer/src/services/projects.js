// SPDX-License-Identifier: GPL-3.0-or-later
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
    return withApi().request("PATCH", `/v1/projects/${id}`, body);
  },
  remove(id) {
    return withApi().request("DELETE", `/v1/projects/${id}`);
  },
  /** Legacy JustWrite-shaped import — JSON body to ?source=justwrite. Kept
   *  so JustWrite's existing client doesn't break. New code uses runImport(). */
  importJustWrite(book) {
    return withApi().post(`/v1/projects/import?source=justwrite`, book);
  },

  /** Multi-adapter import. {source, file, dryRun?} -> ImportRunResponse. */
  async runImport({ source, file, dryRun = false, projectId = null, includeScenes = null } = {}) {
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
    return withApi().request("PATCH", `/v1/blocks/${blockId}`, body);
  },
  removeBlock(blockId) {
    return withApi().request("DELETE", `/v1/blocks/${blockId}`);
  },
  getCast(projectId) {
    return withApi().get(`/v1/projects/${projectId}/cast`);
  },
  assignCast(projectId, body) {
    return withApi().post(`/v1/projects/${projectId}/cast`, body);
  },
  removeFromCast(projectId, personaId) {
    return withApi().request("DELETE", `/v1/projects/${projectId}/cast/${personaId}`);
  },
  exportZip(projectId, opts = {}) {
    const params = new URLSearchParams();
    params.set("include_audio", String(opts.includeAudio ?? true));
    params.set("include_masters", String(opts.includeMasters ?? true));
    return withApi().requestBlob("GET", `/v1/projects/${projectId}/export?${params}`);
  },
};

export const renderPresetsService = {
  list(projectId) {
    const q = projectId !== undefined ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return withApi().get(`/v1/presets${q}`);
  },
  create(body) {
    return withApi().post(`/v1/presets`, body);
  },
  update(id, body) {
    return withApi().request("PATCH", `/v1/presets/${id}`, body);
  },
  remove(id) {
    return withApi().request("DELETE", `/v1/presets/${id}`);
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
    return withApi().request("PATCH", `/v1/takes/${takeId}`, body);
  },
  remove(takeId) {
    return withApi().request("DELETE", `/v1/takes/${takeId}`);
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
    return withApi().request("PATCH", `/v1/channels/${id}`, body);
  },
  remove(id) {
    return withApi().request("DELETE", `/v1/channels/${id}`);
  },
  getProfileChannels(profileId) {
    return withApi().get(`/v1/profiles/${profileId}/channels`);
  },
  setProfileChannels(profileId, channelIds) {
    return withApi().request("PUT", `/v1/profiles/${profileId}/channels`, {
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
    return withApi().request("DELETE", `/v1/mcp/bindings/${clientId}`);
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
    return withApi().request("DELETE", `/v1/webhooks/${id}`);
  },
  test(id) {
    return withApi().post(`/v1/webhooks/${id}/test`);
  },
};

export const backupService = {
  download(includeGenerations = true) {
    return withApi().requestBlob(
      "GET",
      `/v1/backup?include_generations=${includeGenerations}`,
    );
  },
  async restore(file, mode = "replace", confirm = false) {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    form.append("confirm", String(confirm));
    return withApi().postForm(`/v1/restore`, form);
  },
};

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
    return withApi().request("DELETE", `/v1/generations?${params}`);
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
