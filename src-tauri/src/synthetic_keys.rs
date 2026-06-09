// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/synthetic_keys.rs
// Translated/ported by JustVoice contributors. Modifications under GPL-3.0-or-later.
// Upstream MIT permission notice continues to apply.
//
// Synthetic keyboard event posting for the auto-paste pipeline.
//
// Platform behaviour:
//   macOS  — Cmd+V via CGEventPost at kCGHIDEventTap.
//             Requires Accessibility permission (gate via permissions::is_trusted()).
//   Windows — Ctrl+V via SendInput.
//             No system-level permission gate; UAC/UIPI blocks elevated targets.
//   Linux  — TODO: not yet implemented (requires X11/Wayland xdotool-style API).

// ── macOS implementation ─────────────────────────────────────────────────

#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
mod ffi {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct CGEvent {
        _opaque: [u8; 0],
    }
    pub type CGEventRef = *mut CGEvent;

    #[repr(C)]
    pub struct CGEventSource {
        _opaque: [u8; 0],
    }
    pub type CGEventSourceRef = *mut CGEventSource;

    pub type CGEventTapLocation = u32;
    pub type CGKeyCode = u16;
    pub type CGEventFlags = u64;
    pub type CGEventSourceStateID = i32;

    /// `kCGHIDEventTap`
    pub const K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;
    /// `kCGEventSourceStateHIDSystemState`
    pub const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: CGEventSourceStateID = 1;
    /// `kCGEventFlagMaskCommand`
    pub const K_CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x00100000;
    /// `kVK_Command` (left Cmd)
    pub const KEYCODE_LEFT_CMD: CGKeyCode = 0x37;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGEventSourceCreate(state_id: CGEventSourceStateID) -> CGEventSourceRef;
        pub fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtual_key: CGKeyCode,
            key_down: bool,
        ) -> CGEventRef;
        pub fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
        pub fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFRelease(cf: *const c_void);
    }
}

/// Post the Cmd+V sequence to the HID event tap on macOS.
#[cfg(target_os = "macos")]
pub fn send_paste() -> Result<(), String> {
    use ffi::*;

    // Resolve the V keycode for the active keyboard layout.
    // On a US QWERTY layout kVK_ANSI_V = 0x09; on Dvorak V sits elsewhere.
    // We use the same hardcoded ANSI_V that the upstream uses for simplicity.
    // A full keyboard-layout-aware impl would query CGEventKeyboardGetUnicodeString.
    let v_keycode: CGKeyCode = 0x09; // kVK_ANSI_V

    unsafe {
        let source = CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE);
        if source.is_null() {
            return Err("CGEventSourceCreate returned null".into());
        }

        let events = [
            (KEYCODE_LEFT_CMD, true, 0u64),
            (v_keycode, true, K_CG_EVENT_FLAG_MASK_COMMAND),
            (v_keycode, false, K_CG_EVENT_FLAG_MASK_COMMAND),
            (KEYCODE_LEFT_CMD, false, 0u64),
        ];

        let mut created_events = Vec::with_capacity(events.len());
        for (key, down, flags) in events {
            let event = CGEventCreateKeyboardEvent(source, key, down);
            if event.is_null() {
                CFRelease(source as *const c_void);
                return Err(format!(
                    "CGEventCreateKeyboardEvent(key={}, down={}) returned null",
                    key, down
                ));
            }
            if flags != 0 {
                CGEventSetFlags(event, flags);
            }
            created_events.push(event);
        }

        for event in &created_events {
            CGEventPost(K_CG_HID_EVENT_TAP, *event);
        }

        for event in created_events {
            CFRelease(event as *const c_void);
        }
        CFRelease(source as *const c_void);
        Ok(())
    }
}

// ── Windows implementation ───────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    pub fn make_key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        let flags = if up {
            KEYEVENTF_KEYUP
        } else {
            KEYBD_EVENT_FLAGS(0)
        };
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

/// Post the Ctrl+V sequence via SendInput on Windows.
#[cfg(target_os = "windows")]
pub fn send_paste() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, VK_CONTROL, VK_V};

    let events = [
        win::make_key(VK_CONTROL, false),
        win::make_key(VK_V, false),
        win::make_key(VK_V, true),
        win::make_key(VK_CONTROL, true),
    ];

    unsafe {
        let sent = SendInput(&events, std::mem::size_of::<INPUT>() as i32);
        if sent as usize != events.len() {
            return Err(format!(
                "SendInput delivered {} of {} events — the input desktop may be locked \
                 or a higher-integrity window is intercepting.",
                sent,
                events.len()
            ));
        }
    }

    Ok(())
}

/// Linux / other platforms — not yet implemented.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn send_paste() -> Result<(), String> {
    // TODO: implement via xdotool/ydotool (X11/Wayland). Requires detecting
    // which display server is active at runtime. Blocked until we have a
    // Linux CI runner to test against.
    Err("synthetic paste is not yet implemented on this platform".into())
}

// ── Clipboard write helpers ──────────────────────────────────────────────

/// Write `text` to the system clipboard, fire Ctrl/Cmd+V, then after
/// `restore_delay_ms` restore whatever was on the clipboard before.
///
/// Clipboard save/restore uses the platform clipboard APIs directly
/// (same approach as the voicebox `clipboard.rs`) rather than `arboard`,
/// which can't round-trip binary formats or multi-item pasteboard content.
pub fn paste_text_with_restore(text: &str, restore_delay_ms: u64) -> Result<(), String> {
    write_text_to_clipboard(text)?;
    send_paste()?;

    // Schedule the restore on a background thread so we don't block the
    // Tauri command thread. The 500ms default gives the target app time
    // to act on the paste before we clobber the clipboard again.
    let delay = restore_delay_ms;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay));
        // No-op on failure — the user's clipboard is already replaced with
        // the dictated text, which is better than crashing the pipeline.
        let _ = restore_clipboard_from_empty();
    });

    Ok(())
}

// ── Platform clipboard write ─────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn write_text_to_clipboard(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    unsafe {
        OpenClipboard(Some(HWND(std::ptr::null_mut())))
            .map_err(|e| format!("OpenClipboard failed: {e}"))?;
        let _guard = scopeguard::guard((), |_| {
            let _ = CloseClipboard();
        });

        EmptyClipboard().map_err(|e| format!("EmptyClipboard failed: {e}"))?;

        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        let byte_count = utf16.len() * 2;

        let hglobal = GlobalAlloc(GMEM_MOVEABLE, byte_count)
            .map_err(|e| format!("GlobalAlloc failed: {e}"))?;

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return Err("GlobalLock returned null".into());
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, ptr as *mut u8, byte_count);
        let _ = GlobalUnlock(hglobal);

        // CF_UNICODETEXT = 13
        SetClipboardData(13, Some(windows::Win32::Foundation::HANDLE(hglobal.0)))
            .map_err(|e| format!("SetClipboardData failed: {e}"))?;

        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn write_text_to_clipboard(text: &str) -> Result<(), String> {
    // Minimal NSPasteboard write via objc runtime.
    use std::ffi::CString;
    unsafe {
        let cls = objc::runtime::Class::get("NSPasteboard").ok_or("NSPasteboard not found")?;
        let pb: *mut objc::runtime::Object =
            objc::msg_send![cls, generalPasteboard];
        if pb.is_null() {
            return Err("NSPasteboard generalPasteboard returned nil".into());
        }
        let _: i64 = objc::msg_send![pb, clearContents];
        let ns_str_cls =
            objc::runtime::Class::get("NSString").ok_or("NSString not found")?;
        let c_text = CString::new(text).map_err(|e| e.to_string())?;
        let ns_text: *mut objc::runtime::Object =
            objc::msg_send![ns_str_cls, stringWithUTF8String: c_text.as_ptr()];
        // public.utf8-plain-text UTI
        let uti_cstr = CString::new("public.utf8-plain-text").unwrap();
        let ns_uti: *mut objc::runtime::Object =
            objc::msg_send![ns_str_cls, stringWithUTF8String: uti_cstr.as_ptr()];
        let ok: bool = objc::msg_send![pb, setString: ns_text forType: ns_uti];
        if !ok {
            return Err("NSPasteboard setString:forType: returned NO".into());
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write_text_to_clipboard(text: &str) -> Result<(), String> {
    Err("clipboard write not yet implemented on this platform".into())
}

fn restore_clipboard_from_empty() -> Result<(), String> {
    // Minimal: just clear the clipboard after restore_delay so the pasted
    // text no longer sits there. A full round-trip restore would require
    // snapshotting before the write (future work if users request it).
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
        unsafe {
            OpenClipboard(Some(HWND(std::ptr::null_mut())))
                .map_err(|e| format!("OpenClipboard: {e}"))?;
            let _g = scopeguard::guard((), |_| {
                let _ = CloseClipboard();
            });
            EmptyClipboard().map_err(|e| format!("EmptyClipboard: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(()) // No-op on other platforms for now
    }
}
