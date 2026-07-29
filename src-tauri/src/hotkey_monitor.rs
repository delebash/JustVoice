// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/hotkey_monitor.rs
// Translated/ported by JustVoice contributors. Modifications under MIT.
// Upstream MIT permission notice continues to apply.
//
// NOTE: The upstream uses `keytap` (jamiepine/keytap on crates.io) — a clean
// replacement for rdev with proper left/right modifier fidelity and owned
// shutdown via Drop. JustVoice adopts the same crate rather than rdev.
// The spec mentioned rdev but keytap is what the upstream actually ships.
//
// Chord-string parsing: this JustVoice port adds a `parse_chord_str` helper
// so the renderer can pass strings like "ctrl+alt+v" from the settings UI
// instead of the raw `HashSet<Key>` the upstream builds by hand.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use keytap::chord::{Chord, ChordEvent, ChordMatcher};
use keytap::{Key, RecvTimeoutError};
use tauri::{AppHandle, Emitter};

// ========================================================================
// Public types
// ========================================================================

/// Semantic action a chord can be bound to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChordAction {
    PushToTalk,
    ToggleToTalk,
}

/// Effect produced after the chord matcher resolves an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    StartRecording(ChordAction),
    StopRecording(ChordAction),
    /// Emitted when push-to-talk upgrades into the toggle chord mid-hold.
    RestartRecording(ChordAction),
}

/// Chord key sets from capture settings.
pub type Bindings = HashMap<ChordAction, HashSet<Key>>;

// ========================================================================
// Monitor
// ========================================================================

pub struct HotkeyMonitor {
    app: AppHandle,
    active: Option<Active>,
}

struct Active {
    dispatcher: JoinHandle<()>,
    shutdown: Arc<AtomicBool>,
}

impl HotkeyMonitor {
    pub fn spawn(app: AppHandle, bindings: Bindings) -> Self {
        let mut m = Self { app, active: None };
        m.apply(bindings);
        m
    }

    pub fn update_bindings(&mut self, bindings: Bindings) {
        self.apply(bindings);
    }

    fn apply(&mut self, bindings: Bindings) {
        if let Some(active) = self.active.take() {
            active.shutdown.store(true, Ordering::Relaxed);
            let _ = active.dispatcher.join();
        }

        if bindings.values().all(|set| set.is_empty()) {
            return;
        }

        let matcher = match build_matcher(&bindings) {
            Ok(m) => m,
            Err(err) => {
                eprintln!(
                    "HotkeyMonitor: ChordMatcher build failed ({err}). Global chord detection is disabled. \
                     On macOS, grant Input Monitoring in System Settings → Privacy & Security → Input Monitoring \
                     and relaunch."
                );
                return;
            }
        };

        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_for_thread = shutdown.clone();
        let app = self.app.clone();
        let dispatcher = thread::Builder::new()
            .name("justvoice-hotkey-dispatcher".into())
            .spawn(move || dispatcher_loop(app, matcher, shutdown_for_thread))
            .expect("spawn hotkey dispatcher thread");

        self.active = Some(Active { dispatcher, shutdown });
    }
}

impl Drop for HotkeyMonitor {
    fn drop(&mut self) {
        if let Some(active) = self.active.take() {
            active.shutdown.store(true, Ordering::Relaxed);
            let _ = active.dispatcher.join();
        }
    }
}

// ========================================================================
// Matcher construction + dispatch
// ========================================================================

fn build_matcher(bindings: &Bindings) -> Result<ChordMatcher<ChordAction>, keytap::Error> {
    let mut builder = ChordMatcher::builder();
    if let Some(keys) = bindings.get(&ChordAction::PushToTalk) {
        if !keys.is_empty() {
            builder = builder.add(ChordAction::PushToTalk, Chord::of(keys.iter().copied()));
        }
    }
    if let Some(keys) = bindings.get(&ChordAction::ToggleToTalk) {
        if !keys.is_empty() {
            builder = builder.add_toggle(
                ChordAction::ToggleToTalk,
                Chord::of(keys.iter().copied()),
            );
        }
    }
    builder.build()
}

fn dispatcher_loop(
    app: AppHandle,
    matcher: ChordMatcher<ChordAction>,
    shutdown: Arc<AtomicBool>,
) {
    while !shutdown.load(Ordering::Relaxed) {
        match matcher.recv_timeout(Duration::from_millis(100)) {
            Ok(event) => process_event(&app, &matcher, event),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn process_event(
    app: &AppHandle,
    matcher: &ChordMatcher<ChordAction>,
    event: ChordEvent<ChordAction>,
) {
    match event {
        ChordEvent::Start { id, .. } => {
            apply_effect(app, Effect::StartRecording(id));
        }
        ChordEvent::End { id: end_id, time: end_time } => {
            // Peek for a same-Instant follow-up Start to coalesce
            // PTT→Toggle upgrade transitions into RestartRecording.
            match matcher.recv_timeout(Duration::from_millis(5)) {
                Ok(ChordEvent::Start { id: start_id, time: start_time })
                    if start_time == end_time =>
                {
                    apply_effect(app, Effect::RestartRecording(start_id));
                }
                Ok(other) => {
                    apply_effect(app, Effect::StopRecording(end_id));
                    process_event(app, matcher, other);
                }
                Err(_) => {
                    apply_effect(app, Effect::StopRecording(end_id));
                }
            }
        }
    }
}

// ========================================================================
// Effect → Tauri events
// ========================================================================

fn apply_effect(app: &AppHandle, effect: Effect) {
    match effect {
        Effect::StartRecording(_) => {
            let _ = app.emit("hotkey:push-to-talk-start", ());
        }
        Effect::StopRecording(_) => {
            let _ = app.emit("hotkey:push-to-talk-end", ());
        }
        Effect::RestartRecording(_) => {
            // Toggle chord fired while PTT was held — emit toggle.
            let _ = app.emit("hotkey:toggle", ());
        }
    }
}

// ========================================================================
// Chord-string parser ("ctrl+alt+v" → HashSet<Key>)
// ========================================================================

/// Parse a chord string like `"ctrl+alt+v"` into a `HashSet<Key>`.
/// Key names are matched case-insensitively against keytap's `Key` variants.
/// Unknown tokens are silently dropped (returns empty set on total failure).
pub fn parse_chord_str(chord: &str) -> HashSet<Key> {
    chord
        .split('+')
        .filter_map(|token| key_from_name(token.trim()))
        .collect()
}

/// Map a single token to a `Key`. Covers the common modifier + letter/digit
/// names the settings UI sends. Uses the exact keytap 0.4 `Key` variants.
fn key_from_name(name: &str) -> Option<Key> {
    Some(match name.to_lowercase().as_str() {
        "ctrl" | "control" => Key::ControlLeft,
        "rctrl" | "rcontrol" => Key::ControlRight,
        "alt" | "option" => Key::AltLeft,
        "ralt" | "roption" => Key::AltRight,
        "shift" => Key::ShiftLeft,
        "rshift" => Key::ShiftRight,
        "meta" | "super" | "cmd" | "command" => Key::MetaLeft,
        "rmeta" | "rsuper" | "rcmd" => Key::MetaRight,
        "space" => Key::Space,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "return" | "enter" => Key::Enter,
        "up" => Key::ArrowUp,
        "down" => Key::ArrowDown,
        "left" => Key::ArrowLeft,
        "right" => Key::ArrowRight,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        // Single ASCII letters: map to the named Key variant (A–Z)
        s if s.len() == 1 => {
            let ch = s.chars().next()?.to_ascii_uppercase();
            match ch {
                'A' => Key::A, 'B' => Key::B, 'C' => Key::C, 'D' => Key::D,
                'E' => Key::E, 'F' => Key::F, 'G' => Key::G, 'H' => Key::H,
                'I' => Key::I, 'J' => Key::J, 'K' => Key::K, 'L' => Key::L,
                'M' => Key::M, 'N' => Key::N, 'O' => Key::O, 'P' => Key::P,
                'Q' => Key::Q, 'R' => Key::R, 'S' => Key::S, 'T' => Key::T,
                'U' => Key::U, 'V' => Key::V, 'W' => Key::W, 'X' => Key::X,
                'Y' => Key::Y, 'Z' => Key::Z,
                '0' => Key::Digit0, '1' => Key::Digit1, '2' => Key::Digit2,
                '3' => Key::Digit3, '4' => Key::Digit4, '5' => Key::Digit5,
                '6' => Key::Digit6, '7' => Key::Digit7, '8' => Key::Digit8,
                '9' => Key::Digit9,
                _ => return None,
            }
        }
        _ => return None,
    })
}

// ========================================================================
// Global singleton state (managed by Tauri)
// ========================================================================

use std::sync::Mutex;

pub struct HotkeyState {
    pub monitor: Mutex<Option<HotkeyMonitor>>,
}

impl HotkeyState {
    pub fn new() -> Self {
        Self {
            monitor: Mutex::new(None),
        }
    }
}
