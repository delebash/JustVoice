// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/accessibility.rs
// and input_monitoring.rs — merged into a single permissions.rs for JustVoice.
// Translated/ported by JustVoice contributors. Modifications under GPL-3.0-or-later.
// Upstream MIT permission notice continues to apply.
//
// macOS TCC permission checks for Accessibility and Input Monitoring.
// On non-macOS platforms all functions are stubs returning `true` / Ok(()).

// ── Accessibility ─────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod ax_ffi {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        /// Returns true when the current process is listed in Accessibility.
        /// No prompt side-effect.
        pub fn AXIsProcessTrusted() -> bool;
    }
}

/// Returns whether the app has Accessibility permission.
///
/// macOS: calls `AXIsProcessTrusted()` — no prompt.
/// Other platforms: always true.
pub fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { ax_ffi::AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Open System Settings to the Accessibility pane on macOS.
/// No-op on other platforms.
pub fn open_accessibility() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility settings are macOS-specific".to_string())
    }
}

// ── Input Monitoring ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod hid_ffi {
    use std::os::raw::c_uint;

    /// `kIOHIDRequestTypeListenEvent`
    pub const REQUEST_TYPE_LISTEN_EVENT: c_uint = 1;
    /// `kIOHIDAccessTypeGranted`
    pub const ACCESS_TYPE_GRANTED: c_uint = 0;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        pub fn IOHIDCheckAccess(request_type: c_uint) -> c_uint;
        pub fn IOHIDRequestAccess(request_type: c_uint) -> bool;
    }
}

/// Returns whether the app has Input Monitoring permission.
///
/// macOS: calls `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)`.
/// Other platforms: always true.
pub fn check_input_monitoring() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            hid_ffi::IOHIDCheckAccess(hid_ffi::REQUEST_TYPE_LISTEN_EVENT)
                == hid_ffi::ACCESS_TYPE_GRANTED
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Fire the Input Monitoring TCC prompt (macOS only).
/// Returns the current grant state after queuing the prompt.
#[allow(dead_code)]
pub fn request_input_monitoring() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { hid_ffi::IOHIDRequestAccess(hid_ffi::REQUEST_TYPE_LISTEN_EVENT) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Open System Settings to the Input Monitoring pane on macOS.
/// No-op on other platforms.
pub fn open_input_monitoring() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Input Monitoring settings are macOS-specific".to_string())
    }
}
