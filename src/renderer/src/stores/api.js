// SPDX-License-Identifier: GPL-3.0-or-later
// Reactive façade over services/serverApi.js. The transport (request,
// safeRequest, requestBlob, postForm, verbs) lives in the service per the app
// standard; this Pinia store only holds the reactive bits the UI binds to —
// server URL, bearer token, last error, auth flag — and the setters that
// persist them. `useApi().request(...)` etc. still work: they delegate.
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { SERVER_URL } from "../config.js";
import * as serverApi from "../services/serverApi.js";

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
    lastError: serverApi.lastError, // shared ref — set by the transport on failure
    setServer,
    setToken,
    request: serverApi.request,
    safeRequest: serverApi.safeRequest,
    get: serverApi.get,
    post: serverApi.post,
    patch: serverApi.patch,
    put: serverApi.put,
    del: serverApi.del,
    requestBlob: serverApi.requestBlob,
    postForm: serverApi.postForm,
    isAuthed: computed(() => !!token.value),
  };
});
