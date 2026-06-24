// SPDX-License-Identifier: GPL-3.0-or-later
// Reactive façade over the shared server transport (@delebash/llm-ui
// serverApi). The transport (request, safeRequest, requestBlob, postForm, verbs)
// lives in the kit; this Pinia store only holds the reactive bits the UI binds
// to — server URL, bearer token, last error, auth flag — and the setters that
// persist them. `useApi().request(...)` etc. still work: they delegate.
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { SERVER_URL } from "../config.js";
import {
  lastError, request, safeRequest, get, post, patch, put, del, requestBlob, postForm,
} from "@delebash/llm-ui";

export const useApi = defineStore("api", () => {
  const serverUrl = ref(localStorage.getItem("jt:server") || SERVER_URL);
  const token = ref(localStorage.getItem("jt:token") || "");

  function setServer(v) {
    serverUrl.value = v;
    localStorage.setItem("jt:server", v);
  }
  function setToken(v) {
    token.value = v;
    localStorage.setItem("jt:token", v);
  }

  return {
    serverUrl,
    token,
    lastError, // shared ref from the kit transport — set on failure
    setServer,
    setToken,
    request,
    safeRequest,
    get,
    post,
    patch,
    put,
    del,
    requestBlob,
    postForm,
    isAuthed: computed(() => !!token.value),
  };
});
