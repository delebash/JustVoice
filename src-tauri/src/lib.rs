// SPDX-License-Identifier: GPL-3.0-or-later
//! JustVoice Tauri shell — webview wrapper around the Vue UI + sidecar spawn
//! for the Python FastAPI server.
//!
//! Responsibilities:
//! 1. Spawn the Python server as a sidecar process on startup
//! 2. Show the Vue UI in a webview (bundled dist/ in production, dev server in
//!    dev mode)
//! 3. System tray with menu (Show/Hide window, Start/Stop/Restart server,
//!    Start dictation, Toggle MCP, Open settings, Copy URL, Open logs, About,
//!    Quit)
//! 4. Keep-server-running-on-close toggle — close button minimizes to tray
//!    instead of quitting if enabled
//! 5. Tauri command surface for the renderer to drive OS-level features:
//!    - server lifecycle (start/stop/restart, keep-running flag)
//!    - audio device enumeration + routing
//!    - Mac TCC permission checks (accessibility, input monitoring) — stubbed
//!      on non-macOS
//!    - global hotkey registration — stubbed; full impl deferred
//!    - paste injection for dictation — stubbed; full impl deferred
//!
//! All actual TTS / business logic lives in the Python sidecar. The Rust
//! here is plumbing.
//!
//! Phase 3+ atomic license flip: file is GPL-3.0-or-later (was Apache-2.0
//! before pedalboard adoption). See DESIGN_FREEZE.md §3.1.

mod audio_capture;
mod hotkey_monitor;
mod permissions;
mod synthetic_keys;
mod system_audio;

use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

const SERVER_PORT: u16 = 17494;
const TRAY_ICON_LABEL: &str = "justvoice-tray";
const MAIN_WINDOW_LABEL: &str = "main";

// ── Sidecar lifecycle state ──────────────────────────────────────────────

struct SidecarState {
    child: Mutex<Option<Child>>,
    keep_running_on_close: Mutex<bool>,
}

impl SidecarState {
    fn new(child: Option<Child>) -> Self {
        Self {
            child: Mutex::new(child),
            keep_running_on_close: Mutex::new(false),
        }
    }

    fn store_child(&self, child: Option<Child>) {
        if let Ok(mut guard) = self.child.lock() {
            *guard = child;
        }
    }

    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

// ── Sidecar spawn helpers ────────────────────────────────────────────────

fn spawn_sidecar() -> std::io::Result<Option<Child>> {
    if std::env::var("JUSTTTS_DEV_NO_SIDECAR").is_ok() {
        return Ok(None);
    }

    if port_in_use(SERVER_PORT) {
        eprintln!(
            "[sidecar] port {SERVER_PORT} already in use — evicting the stale \
             listener before spawning a fresh server"
        );
        kill_listeners_on_port(SERVER_PORT);
        if !wait_for_port_free(SERVER_PORT, Duration::from_secs(5)) {
            eprintln!(
                "[sidecar] port {SERVER_PORT} still occupied after eviction; reusing \
                 the existing server — kill it manually if the UI shows stale data"
            );
            return Ok(None);
        }
        eprintln!("[sidecar] port {SERVER_PORT} freed");
    }

    // IMPORTANT: never spawn an unqualified `justtts` — the Tauri binary is
    // also `justtts.exe`, and Windows CreateProcessW searches the running
    // binary's directory first, so that name resolves to OUR binary,
    // spawning a new desktop window in an infinite loop.
    let cmd = if cfg!(debug_assertions) {
        match Command::new("justtts-server").arg("serve").spawn() {
            Ok(child) => child,
            Err(_) => Command::new("python")
                .args(["-m", "justtts.cli", "serve"])
                .spawn()?,
        }
    } else {
        let exe = std::env::current_exe()?;
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let bin = if cfg!(windows) {
            dir.join("justtts-server.exe")
        } else {
            dir.join("justtts-server")
        };
        Command::new(bin).spawn()?
    };

    std::thread::spawn(|| {
        if wait_for_port_up(SERVER_PORT, Duration::from_secs(15)) {
            eprintln!("[sidecar] server listening on {SERVER_PORT}");
        } else {
            eprintln!(
                "[sidecar] warning: server is not listening on {SERVER_PORT} after \
                 15s — the UI may show empty data. Check the server log."
            );
        }
    });

    Ok(Some(cmd))
}

fn port_in_use(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn wait_for_port_free(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !port_in_use(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    !port_in_use(port)
}

fn wait_for_port_up(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if port_in_use(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    port_in_use(port)
}

#[cfg(windows)]
fn kill_listeners_on_port(port: u16) {
    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[sidecar] netstat failed, cannot evict stale server: {e}");
            return;
        }
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");
    let mut pids = std::collections::HashSet::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "TCP" || !cols.contains(&"LISTENING") {
            continue;
        }
        if !cols[1].ends_with(&needle) {
            continue;
        }
        if let Ok(pid) = cols[cols.len() - 1].parse::<u32>() {
            if pid != 0 {
                pids.insert(pid);
            }
        }
    }
    for pid in pids {
        eprintln!("[sidecar] killing stale listener on :{port} (PID {pid})");
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }
}

#[cfg(not(windows))]
fn kill_listeners_on_port(port: u16) {
    let output = match Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[sidecar] lsof failed, cannot evict stale server: {e}");
            return;
        }
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for pid in text.lines().map(str::trim).filter(|p| !p.is_empty()) {
        eprintln!("[sidecar] killing stale listener on :{port} (PID {pid})");
        let _ = Command::new("kill").args(["-9", pid]).output();
    }
}

// ── Tauri commands (DESIGN_FREEZE.md §5 + §3.7 keep-server-running) ──────

#[tauri::command]
async fn server_health() -> Result<String, String> {
    let url = format!("http://127.0.0.1:{SERVER_PORT}/v1/health");
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn start_server(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    if port_in_use(SERVER_PORT) {
        return Ok(()); // already up
    }
    match spawn_sidecar() {
        Ok(child) => {
            state.store_child(child);
            Ok(())
        }
        Err(e) => Err(format!("Failed to spawn sidecar: {e}")),
    }
}

#[tauri::command]
fn stop_server(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    state.kill_child();
    Ok(())
}

#[tauri::command]
fn restart_server(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    state.kill_child();
    // Wait briefly for port free, then respawn.
    let _ = wait_for_port_free(SERVER_PORT, Duration::from_secs(5));
    match spawn_sidecar() {
        Ok(child) => {
            state.store_child(child);
            Ok(())
        }
        Err(e) => Err(format!("Failed to respawn sidecar: {e}")),
    }
}

#[tauri::command]
fn set_keep_server_running(
    keep_running: bool,
    state: tauri::State<'_, SidecarState>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.keep_running_on_close.lock() {
        *guard = keep_running;
    }
    Ok(())
}

// ── Audio device IPC (placeholders — full impl in Phase 4c follow-on) ────

#[tauri::command]
fn list_audio_output_devices() -> Result<Vec<serde_json::Value>, String> {
    // Returns [] on platforms without a cpal/coreaudio impl yet. Voicebox's
    // implementation uses cpal; we'll port that in a follow-on.
    Ok(vec![])
}

#[tauri::command]
fn play_audio_to_devices(
    _audio_b64: String,
    _device_ids: Vec<String>,
) -> Result<(), String> {
    Err("Native multi-device playback not yet implemented; falls back to default output via the renderer's AudioPlayer".to_string())
}

#[tauri::command]
fn stop_audio_playback() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn is_system_audio_supported() -> Result<bool, String> {
    Ok(system_audio::is_system_audio_supported())
}

#[tauri::command]
async fn start_system_audio_capture(
    state: tauri::State<'_, audio_capture::AudioCaptureState>,
) -> Result<(), String> {
    // Default max-duration: 5 minutes. The renderer can call stop_system_audio_capture
    // earlier to flush the buffer and get the WAV path.
    audio_capture::start_capture(&state, 300).await
}

#[tauri::command]
async fn stop_system_audio_capture(
    state: tauri::State<'_, audio_capture::AudioCaptureState>,
) -> Result<String, String> {
    // Returns base64-encoded WAV data. The renderer saves it to disk or passes
    // it directly to the Python server for transcription.
    audio_capture::stop_capture(&state).await
}

// ── macOS TCC permission stubs ───────────────────────────────────────────

#[tauri::command]
fn check_accessibility_permission() -> Result<bool, String> {
    Ok(permissions::check_accessibility())
}

#[tauri::command]
fn check_input_monitoring_permission() -> Result<bool, String> {
    Ok(permissions::check_input_monitoring())
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    permissions::open_accessibility()
}

#[tauri::command]
fn open_input_monitoring_settings() -> Result<(), String> {
    permissions::open_input_monitoring()
}

// ── Paste + hotkey commands ───────────────────────────────────────────────

#[tauri::command]
fn paste_final_text(text: String, _focus: serde_json::Value) -> Result<(), String> {
    // Write `text` to the clipboard, fire Ctrl/Cmd+V, clear after 500ms.
    // The `_focus` parameter carries the previously focused window handle
    // (populated by the renderer before the overlay shows); it's reserved for
    // a future "re-focus the original window before pasting" feature.
    #[cfg(target_os = "macos")]
    {
        if !permissions::check_accessibility() {
            return Err(
                "Accessibility permission required to post synthetic key events. \
                 Grant it in System Settings → Privacy & Security → Accessibility."
                    .to_string(),
            );
        }
    }
    synthetic_keys::paste_text_with_restore(&text, 500)
}

#[tauri::command]
fn enable_hotkey(
    app: tauri::AppHandle,
    hotkey_state: tauri::State<'_, hotkey_monitor::HotkeyState>,
) -> Result<(), String> {
    // Enable with empty bindings — the renderer must call update_chord_bindings
    // with the actual chord strings from the user's settings to arm the monitor.
    let bindings = std::collections::HashMap::new();
    let mut guard = hotkey_state.monitor.lock().unwrap();
    *guard = Some(hotkey_monitor::HotkeyMonitor::spawn(app, bindings));
    Ok(())
}

#[tauri::command]
fn disable_hotkey(
    hotkey_state: tauri::State<'_, hotkey_monitor::HotkeyState>,
) -> Result<(), String> {
    let mut guard = hotkey_state.monitor.lock().unwrap();
    *guard = None; // Drop triggers HotkeyMonitor::drop → shuts down the dispatcher
    Ok(())
}

#[tauri::command]
fn update_chord_bindings(
    push_to_talk: Vec<String>,
    toggle_to_talk: Vec<String>,
    app: tauri::AppHandle,
    hotkey_state: tauri::State<'_, hotkey_monitor::HotkeyState>,
) -> Result<(), String> {
    use hotkey_monitor::{ChordAction, HotkeyMonitor};

    let ptt_keys: std::collections::HashSet<_> = push_to_talk
        .iter()
        .flat_map(|s| hotkey_monitor::parse_chord_str(s))
        .collect();
    let toggle_keys: std::collections::HashSet<_> = toggle_to_talk
        .iter()
        .flat_map(|s| hotkey_monitor::parse_chord_str(s))
        .collect();

    let mut bindings = std::collections::HashMap::new();
    bindings.insert(ChordAction::PushToTalk, ptt_keys);
    bindings.insert(ChordAction::ToggleToTalk, toggle_keys);

    let mut guard = hotkey_state.monitor.lock().unwrap();
    match guard.as_mut() {
        Some(monitor) => monitor.update_bindings(bindings),
        None => {
            *guard = Some(HotkeyMonitor::spawn(app, bindings));
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_server_url() -> Result<String, String> {
    Ok(format!("http://127.0.0.1:{SERVER_PORT}"))
}

// ── System tray menu builder ─────────────────────────────────────────────

fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "📺 Show window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "🔵 Hide window", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    let server_start = MenuItem::with_id(app, "server_start", "▶️ Start server", true, None::<&str>)?;
    let server_stop = MenuItem::with_id(app, "server_stop", "⏹ Stop server", true, None::<&str>)?;
    let server_restart = MenuItem::with_id(app, "server_restart", "🔄 Restart server", true, None::<&str>)?;
    let server_submenu = Submenu::with_id_and_items(
        app,
        "server",
        "🖥 Server",
        true,
        &[&server_start, &server_stop, &server_restart],
    )?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    let dictate = MenuItem::with_id(app, "dictate_start", "🎙️ Start dictation (⌥⌘V)", true, None::<&str>)?;
    let mcp_toggle = MenuItem::with_id(app, "mcp_toggle", "🎚️ MCP server: toggle", true, None::<&str>)?;

    let sep3 = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, "open_settings", "⚙️ Open settings", true, None::<&str>)?;
    let copy_url = MenuItem::with_id(app, "copy_url", "📋 Copy server URL", true, None::<&str>)?;
    let open_logs = MenuItem::with_id(app, "open_logs", "📜 Open log file", true, None::<&str>)?;

    let sep4 = PredefinedMenuItem::separator(app)?;
    let about = MenuItem::with_id(app, "about", "ℹ️ About JustVoice", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "🚪 Quit JustVoice", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &sep1,
            &server_submenu,
            &sep2,
            &dictate,
            &mcp_toggle,
            &sep3,
            &settings,
            &copy_url,
            &open_logs,
            &sep4,
            &about,
            &quit,
        ],
    )
}

fn handle_tray_menu_event(app: &tauri::AppHandle, event_id: &str) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    match event_id {
        "show" => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        "hide" => {
            let _ = window.hide();
        }
        "server_start" => {
            if let Some(state) = app.try_state::<SidecarState>() {
                if !port_in_use(SERVER_PORT) {
                    if let Ok(child) = spawn_sidecar() {
                        state.store_child(child);
                    }
                }
            }
        }
        "server_stop" => {
            if let Some(state) = app.try_state::<SidecarState>() {
                state.kill_child();
            }
        }
        "server_restart" => {
            if let Some(state) = app.try_state::<SidecarState>() {
                state.kill_child();
                std::thread::sleep(Duration::from_millis(500));
                if let Ok(child) = spawn_sidecar() {
                    state.store_child(child);
                }
            }
        }
        "dictate_start" => {
            let _ = app.emit("tray:dictate-start", ());
        }
        "mcp_toggle" => {
            let _ = app.emit("tray:mcp-toggle", ());
        }
        "open_settings" => {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("tray:open-settings", ());
        }
        "copy_url" => {
            let _ = app.emit("tray:copy-url", format!("http://127.0.0.1:{SERVER_PORT}"));
        }
        "open_logs" => {
            let _ = app.emit("tray:open-logs", ());
        }
        "about" => {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("tray:about", ());
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

// ── Main entry ───────────────────────────────────────────────────────────

pub fn run() {
    let sidecar = match spawn_sidecar() {
        Ok(child) => SidecarState::new(child),
        Err(e) => {
            eprintln!("Failed to spawn Python sidecar: {e}");
            SidecarState::new(None)
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(sidecar)
        .manage(audio_capture::AudioCaptureState::new())
        .manage(hotkey_monitor::HotkeyState::new())
        .invoke_handler(tauri::generate_handler![
            server_health,
            start_server,
            stop_server,
            restart_server,
            set_keep_server_running,
            list_audio_output_devices,
            play_audio_to_devices,
            stop_audio_playback,
            is_system_audio_supported,
            start_system_audio_capture,
            stop_system_audio_capture,
            check_accessibility_permission,
            check_input_monitoring_permission,
            open_accessibility_settings,
            open_input_monitoring_settings,
            paste_final_text,
            enable_hotkey,
            disable_hotkey,
            update_chord_bindings,
            copy_server_url,
        ])
        .setup(|app| {
            // Build the system tray with the right-click menu (DESIGN_FREEZE
            // §6 + tasks #59 + #60).
            let menu = build_tray_menu(app.handle())?;
            let _tray = TrayIconBuilder::with_id(TRAY_ICON_LABEL)
                .tooltip("JustVoice — voice production studio")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    handle_tray_menu_event(app, event.id.as_ref());
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click → toggle window visibility
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // If keep-server-running-on-close is enabled, intercept the
                // close and hide-to-tray instead of quitting (the sidecar
                // stays alive). Otherwise let the close proceed; the regular
                // teardown will kill the sidecar.
                let app = window.app_handle();
                if let Some(state) = app.try_state::<SidecarState>() {
                    let keep_running = state
                        .keep_running_on_close
                        .lock()
                        .map(|g| *g)
                        .unwrap_or(false);
                    if keep_running {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                    // Default behavior: kill sidecar.
                    state.kill_child();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
