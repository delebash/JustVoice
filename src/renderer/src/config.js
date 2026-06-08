// Backend base URL. Tauri-packaged build launches the Python server on
// 17494 locally (see src-tauri/src/main.rs sidecar spawn). Web/Vite dev
// hits the same port. Override via VITE_SERVER_URL during development.
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:17494";
