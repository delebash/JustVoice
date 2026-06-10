// Tauri shell entry point — a thin webview wrapper around the Vue UI.
// All real work happens in the Python FastAPI server (server/justvoice/)
// which the shell spawns as a sidecar process on startup and shuts down
// on exit.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    justvoice_lib::run()
}
