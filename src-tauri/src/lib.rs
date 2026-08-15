// SPDX-License-Identifier: MIT
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
//! License history: Apache-2.0 → GPL-3.0-or-later (2026-06-08, when pedalboard
//! was adopted) → MIT (2026-07-29, when pedalboard was replaced and the last
//! copyleft dependency left the tree). See NOTICE.md.

mod audio_capture;
mod hotkey_monitor;
mod permissions;
mod synthetic_keys;
mod system_audio;

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

const SERVER_PORT: u16 = 17494;
const TRAY_ICON_LABEL: &str = "justvoice-tray";
const MAIN_WINDOW_LABEL: &str = "main";
const DATA_DIR_ENV: &str = "JUSTVOICE_DATA_DIR";

// ─── Data root (the portable, user-settable location for ALL app data) ──────
// Resolved by the shell BEFORE the server spawns; the server honors the env var
// (justvoice/paths.py). Family §5 shape (docgen's donor) with ONE deliberate
// difference: the DEFAULT is the server's own platformdirs location — JV
// installs predate this machinery and their data already lives there, so a
// portable-beside-the-exe default would silently point an upgraded install at
// an empty root. Portable mode is one Change-folder click away; the pointer
// (dataroot.txt, kept OUTSIDE the relocatable root) records the choice.

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf()))
}

fn dir_is_writable(dir: &std::path::Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".jv_write_probe");
    match fs::write(&probe, b"x") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

// The FAMILY portable default (user ruling 2026-08-14; JW's shell is the
// precedent, kept in lock-step verbatim): a `data/` folder beside the app
// (dev: src-tauri/target/debug/data). Nothing lands anywhere the user did
// not decide — the user's choice (dataroot.txt via Change folder, or
// JUSTVOICE_DATA_DIR) always wins; the OS app-data dir is ONLY the
// unwritable-install fallback (Program Files / read-only bundle), never
// the default. paths.py's default_data_dir mirrors this shape for headless.
fn default_data_root(app: &AppHandle) -> PathBuf {
    if let Some(dir) = exe_dir() {
        if dir_is_writable(&dir) {
            return dir.join("data");
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("JustVoice-data"))
}

fn pointer_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(dir) = exe_dir() {
        v.push(dir.join("dataroot.txt"));
    }
    if let Ok(cfg) = app.path().app_config_dir() {
        v.push(cfg.join("dataroot.txt"));
    }
    v
}

// The pre-portable defaults — what old first-run pointer locks may contain
// (the Roaming original, and briefly the platformdirs Local shape from
// earlier on 2026-08-14). Kept ONLY so resolve_data_root can recognize
// stale locks; never used as resolution targets.
fn legacy_default_data_roots() -> Vec<PathBuf> {
    let mut v = Vec::new();
    #[cfg(windows)]
    {
        v.push(
            PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
                .join("justvoice")
                .join("justvoice"),
        );
        v.push(
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
                .join("JustVoice")
                .join("JustVoice"),
        );
    }
    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
        v.push(home.join("Library/Application Support/justvoice"));
        v.push(home.join("Library/Application Support/JustVoice"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
        v.push(home.join(".local/share/justvoice"));
        v.push(home.join(".local/share/JustVoice"));
    }
    v
}

fn resolve_data_root(app: &AppHandle) -> PathBuf {
    for p in pointer_candidates(app) {
        if let Ok(s) = fs::read_to_string(&p) {
            let root = PathBuf::from(s.trim());
            if root.as_os_str().is_empty() {
                continue;
            }
            // The 2026-08-14 portable heal. The old setup() locked the
            // DEFAULT into the pointer on first run, so every pre-portable
            // install carries a pointer pinning an OS app-data folder —
            // which would silently veto the portable default forever.
            // Under the ruling (the user picks the location; the default is
            // beside the app) the pointer exists ONLY as the record of an
            // explicit Change-folder choice — so a pointer holding exactly a
            // former DEFAULT is residue of the removed first-run lock, not a
            // choice: delete it and fall through to the computed default.
            // A folder the user actually picked never equals a former
            // default and keeps winning. Pre-release no-migration rule: the
            // old data stays on disk untouched (JUSTVOICE_DATA_DIR reaches it).
            if root == default_data_root(app) || legacy_default_data_roots().contains(&root) {
                let _ = fs::remove_file(&p);
                continue;
            }
            return root;
        }
    }
    default_data_root(app)
}

fn write_data_root_pointer(app: &AppHandle, root: &std::path::Path) -> std::io::Result<()> {
    let pointer = pointer_candidates(app)
        .into_iter()
        .find(|p| p.parent().map(dir_is_writable).unwrap_or(false))
        .unwrap_or_else(|| PathBuf::from("dataroot.txt"));
    if let Some(parent) = pointer.parent() {
        fs::create_dir_all(parent)?;
    }
    // Atomic: temp sibling + rename, so a torn write can never strand the app
    // on a half-written path.
    let tmp = pointer.with_extension("tmp");
    fs::write(&tmp, root.to_string_lossy().as_bytes())?;
    fs::rename(&tmp, &pointer)
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

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

    // Replace the running sidecar (storage_relocate: stop → move → respawn).
    fn set_child(&self, child: Option<Child>) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
            }
            *guard = child;
        }
    }
}

// ── Sidecar spawn helpers ────────────────────────────────────────────────

fn spawn_sidecar(data_root: &std::path::Path) -> std::io::Result<Option<Child>> {
    if std::env::var("JUSTVOICE_DEV_NO_SIDECAR").is_ok() {
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

    // IMPORTANT: never spawn an unqualified `justvoice` — the Tauri binary is
    // also `justvoice.exe`, and Windows CreateProcessW searches the running
    // binary's directory first, so that name resolves to OUR binary,
    // spawning a new desktop window in an infinite loop.
    let cmd = if cfg!(debug_assertions) {
        // Prefer the repo's OWN venv entry point, resolved from the compile-time
        // crate path (repo root = CARGO_MANIFEST_DIR/..) — `npm run dev` must
        // work from ANY shell, not only one with the venv activated (§5's
        // pattern; a PATH-stale justvoice-server was the audit's named failure).
        let venv_server = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|repo| {
                if cfg!(windows) {
                    repo.join("server").join(".venv").join("Scripts").join("justvoice-server.exe")
                } else {
                    repo.join("server").join(".venv").join("bin").join("justvoice-server")
                }
            })
            .filter(|p| p.exists());
        let venv_child = venv_server.and_then(|p| {
            Command::new(p).arg("serve").env(DATA_DIR_ENV, data_root).spawn().ok()
        });
        match venv_child {
            Some(child) => child,
            None => match Command::new("justvoice-server")
                .arg("serve")
                .env(DATA_DIR_ENV, data_root)
                .spawn()
            {
                Ok(child) => child,
                Err(_) => Command::new("python")
                    .args(["-m", "justvoice.serve", "serve"])
                    .env(DATA_DIR_ENV, data_root)
                    .spawn()?,
            },
        }
    } else {
        let exe = std::env::current_exe()?;
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let bin = if cfg!(windows) {
            dir.join("justvoice-server.exe")
        } else {
            dir.join("justvoice-server")
        };
        // `serve` is REQUIRED. The CLI is a Typer app built with
        // `no_args_is_help=True` (cli.py), so spawning the sidecar with no
        // arguments prints usage and exits — the app would come up with no
        // backend and no error to explain it. The debug branch above has always
        // passed `serve`; this branch had not.
        Command::new(bin).arg("serve").env(DATA_DIR_ENV, data_root).spawn()?
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
fn start_server(app: AppHandle, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    if port_in_use(SERVER_PORT) {
        return Ok(()); // already up
    }
    match spawn_sidecar(&resolve_data_root(&app)) {
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
fn restart_server(app: AppHandle, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    state.kill_child();
    // Wait briefly for port free, then respawn.
    let _ = wait_for_port_free(SERVER_PORT, Duration::from_secs(5));
    match spawn_sidecar(&resolve_data_root(&app)) {
        Ok(child) => {
            state.store_child(child);
            Ok(())
        }
        Err(e) => Err(format!("Failed to respawn sidecar: {e}")),
    }
}

// ─── Storage commands (the portable data root, user-relocatable) ─────

// JW parity: the panel needs {root, default, portable} — camelCase off the
// wire like every family payload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageRoot {
    root: String,
    default: String,
    portable: bool,
}

// The family folder picker (2026-08-14), byte-identical in all three shells.
// JustVoice reached for `@tauri-apps/plugin-dialog` in the renderer instead —
// a third way to do what JustWrite and i18n-docgen both did with this command,
// and the reason a native dialog lived at two different layers of the family.
#[tauri::command]
async fn pick_directory(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Option<String> {
    let mut dlg = app
        .dialog()
        .file()
        .set_title(&title.unwrap_or_else(|| "Choose a folder".to_string()));
    if let Some(p) = default_path.as_deref().filter(|s| !s.is_empty()) {
        dlg = dlg.set_directory(p);
    }
    let picked = dlg.blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.display().to_string())
}

#[tauri::command]
fn storage_get_root(app: AppHandle) -> StorageRoot {
    let root = resolve_data_root(&app);
    let portable = exe_dir().map(|d| root.starts_with(&d)).unwrap_or(false);
    StorageRoot {
        default: default_data_root(&app).to_string_lossy().into_owned(),
        portable,
        root: root.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
fn storage_relocate(app: AppHandle, new_root: String) -> Result<(), String> {
    let old_root = resolve_data_root(&app);
    let new_root = PathBuf::from(new_root.trim());
    if new_root == old_root {
        return Ok(());
    }
    if !dir_is_writable(new_root.parent().unwrap_or(&new_root)) {
        return Err(format!("cannot write to {}", new_root.display()));
    }
    // Stop the server so nothing holds the DB open during the move.
    if let Some(state) = app.try_state::<SidecarState>() {
        state.kill_child();
    }
    wait_for_port_free(SERVER_PORT, Duration::from_secs(5));

    let outcome = relocate_data(&app, &old_root, &new_root);

    // ALWAYS bring a server back up — the new root on success, the old on
    // failure — so a failed move never leaves the app serverless.
    let serve_root = if outcome.is_ok() { &new_root } else { &old_root };
    if let Some(state) = app.try_state::<SidecarState>() {
        state.set_child(spawn_sidecar(serve_root).ok().flatten());
    }
    outcome
}

// Crash-safe move. Data is never lost: old_root is deleted only AFTER the
// pointer commit, so a crash before the commit leaves the old root intact.
fn relocate_data(
    app: &AppHandle,
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> Result<(), String> {
    let name = new_root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "data".to_string());
    let staging = new_root.with_file_name(format!("{name}.jv_moving"));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    copy_dir_all(old_root, &staging).map_err(|e| format!("copy failed: {e}"))?;
    fs::rename(&staging, new_root).map_err(|e| format!("finalize failed: {e}"))?;
    // THE commit point — atomic pointer write (tmp + rename inside).
    write_data_root_pointer(app, new_root).map_err(|e| format!("pointer write failed: {e}"))?;
    let _ = fs::remove_dir_all(old_root);
    Ok(())
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
                    if let Ok(child) = spawn_sidecar(&resolve_data_root(app)) {
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
                if let Ok(child) = spawn_sidecar(&resolve_data_root(app)) {
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
            // Show first: a focused webview's clipboard write is reliable; a
            // hidden one's is not (the family fix, 2026-08-05 — this emit had
            // no listener at all before; App.vue carries it now).
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("tray:copy-url", format!("http://127.0.0.1:{SERVER_PORT}"));
        }
        "open_logs" => {
            // REAL behavior (the dead emit had zero listeners — audit
            // 2026-08-05): open the server's logs folder. The server keeps it
            // under its data dir (justvoice/paths.py: platformdirs
            // user_data_dir("JustVoice") — the JW family shape); honor
            // JUSTVOICE_DATA_DIR like the CLI does.
            // The SAME resolution the spawn uses (pointer → platform default),
            // so the tray always opens the logs the server actually writes.
            let data = resolve_data_root(app);
            let logs = data.join("logs");
            let target = if logs.exists() { logs } else { data };
            // The family opener (2026-08-14). This was three hand-rolled
            // per-platform spawns — the same three lines JW wrote as
            // `open::that` and docgen as `open_path`. One call now, all three.
            let _ = tauri_plugin_opener::open_path(&target, None::<String>);
        }
        "about" => {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("tray:about", ());
        }
        "quit" => {
            // Kill the sidecar FIRST — quitting from the tray orphaned the
            // Python server (audit 2026-08-05; the family kill-then-exit rule).
            if let Some(state) = app.try_state::<SidecarState>() {
                state.kill_child();
            }
            app.exit(0);
        }
        _ => {}
    }
}

// ── Main entry ───────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        // THE plugin baseline, identical in all three apps (2026-08-15): opener,
        // dialog, window-state — every one of them actually used. `http`, `fs` and
        // `process` were removed the same day: each appeared ONLY in its own
        // init() call, with no Rust caller and no JS import.
        .plugin(tauri_plugin_dialog::init())
        // THE family opener (2026-08-14): one plugin for "open a URL" and "open a
        // folder", in all three apps. It replaced tauri-plugin-shell here — that
        // was JV's third implementation of a job JW and docgen each did their own
        // way, and its open() scope admits http(s)/mailto/tel only, so it could
        // never have opened a folder.
        .plugin(tauri_plugin_opener::init())
        // Remember the window size + position across launches (family parity).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(audio_capture::AudioCaptureState::new())
        .manage(hotkey_monitor::HotkeyState::new())
        .invoke_handler(tauri::generate_handler![
            server_health,
            start_server,
            stop_server,
            restart_server,
            set_keep_server_running,
            pick_directory,
            storage_get_root,
            storage_relocate,
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
            // Resolve the (portable, user-settable) data root with Tauri's OWN
            // path resolver, then bring the server up UNDER that root before
            // the webview's first probe. NO first-run pointer lock any more
            // (user ruling 2026-08-14: no scattered state files — the default
            // is COMPUTED, never persisted): dataroot.txt exists only after
            // an explicit Change-folder, written by storage_relocate. The one
            // datum that can't live in the DB is the DB's own address.
            let handle = app.handle().clone();
            let root = resolve_data_root(&handle);
            let sidecar = match spawn_sidecar(&root) {
                Ok(child) => SidecarState::new(child),
                Err(e) => {
                    eprintln!("Failed to spawn Python sidecar: {e}");
                    SidecarState::new(None)
                }
            };
            app.manage(sidecar);

            // Build the system tray with the right-click menu (DESIGN_FREEZE
            // §6 + tasks #59 + #60).
            let menu = build_tray_menu(app.handle())?;
            let _tray = TrayIconBuilder::with_id(TRAY_ICON_LABEL)
                // The app icon IS the tray icon — without one Windows shows a
                // blank square (audit 2026-08-05; docgen/JW set it from day one).
                .icon(app.default_window_icon().cloned().expect("app icon"))
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
