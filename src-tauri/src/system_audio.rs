// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/audio_capture/mod.rs
// Translated/ported by JustVoice contributors. Modifications under GPL-3.0-or-later.
// Upstream MIT permission notice continues to apply.
//
// Thin wrapper that answers "is system audio capture supported on this
// platform / configuration?" — used by the `is_system_audio_supported`
// Tauri command so the renderer can gate the feature in the UI.

use crate::audio_capture;

/// Returns true if the current platform + system configuration supports
/// loopback / system audio capture.
///
/// - **Windows**: always true (WASAPI loopback is available on all modern
///   Windows versions).
/// - **macOS**: true when running 12.3+ (ScreenCaptureKit requirement).
/// - **Linux**: true when a PulseAudio/PipeWire monitor source is
///   discoverable via `pactl`, or a cpal device named "monitor" exists.
pub fn is_system_audio_supported() -> bool {
    audio_capture::is_supported()
}
