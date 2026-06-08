//! JustTTS Tauri shell — webview wrapper around the Vue UI + sidecar
//! spawn for the Python FastAPI server.
//!
//! The shell does three things:
//! 1. Spawn the Python server as a sidecar process on startup
//! 2. Show the Vue UI in a webview pointing at the bundled dist/
//!    (production) or http://localhost:1420 (dev)
//! 3. Stop the sidecar on exit
//!
//! All actual TTS logic lives in the Python server. The Rust here is
//! pure plumbing — same role as JustWrite's tauri shell.

use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

struct SidecarState {
    child: Mutex<Option<Child>>,
}

/// Spawn the Python sidecar (the FastAPI server). In dev mode we
/// expect the developer to have started it themselves so this is a
/// no-op when JUSTTTS_DEV_NO_SIDECAR is set or the port is already
/// in use.
fn spawn_sidecar() -> std::io::Result<Option<Child>> {
    if std::env::var("JUSTTTS_DEV_NO_SIDECAR").is_ok() {
        return Ok(None);
    }
    // In a packaged Tauri build, the Python interpreter + the
    // bundled justtts package live alongside the binary. PyInstaller-
    // built sidecar at <resources>/justtts-server. For dev, use the
    // installed `justtts` console script.
    // IMPORTANT: never spawn an unqualified `justtts` — the Tauri binary
    // is also `justtts.exe`, and Windows CreateProcessW searches the
    // running binary's directory first, so that name resolves to OUR
    // binary, spawning a new desktop window in an infinite loop.
    let cmd = if cfg!(debug_assertions) {
        // Dev: assume the Python package is installed (`pip install -e
        // server/`) and its console script `justtts-server` is on PATH.
        // Fall back to `python -m justtts.cli` if the script isn't found.
        match Command::new("justtts-server").arg("serve").spawn() {
            Ok(child) => child,
            Err(_) => Command::new("python")
                .args(["-m", "justtts.cli", "serve"])
                .spawn()?,
        }
    } else {
        // Look for the PyInstaller-bundled `justtts-server` next to the exe.
        let exe = std::env::current_exe()?;
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let bin = if cfg!(windows) {
            dir.join("justtts-server.exe")
        } else {
            dir.join("justtts-server")
        };
        Command::new(bin).spawn()?
    };
    Ok(Some(cmd))
}

/// Tauri command — health check that the Python server is reachable.
/// The Vue frontend can also hit /v1/health directly; this command
/// exists for the desktop-only "are we connected" UI states.
#[tauri::command]
async fn server_health() -> Result<String, String> {
    let resp = reqwest::get("http://127.0.0.1:17494/v1/health")
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

pub fn run() {
    let sidecar = match spawn_sidecar() {
        Ok(child) => SidecarState {
            child: Mutex::new(child),
        },
        Err(e) => {
            eprintln!("Failed to spawn Python sidecar: {e}");
            SidecarState {
                child: Mutex::new(None),
            }
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(sidecar)
        .invoke_handler(tauri::generate_handler![server_health])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
