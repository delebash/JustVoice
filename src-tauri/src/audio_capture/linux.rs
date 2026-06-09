// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/audio_capture/linux.rs
// Translated/ported by JustVoice contributors. Modifications under GPL-3.0-or-later.
// Upstream MIT permission notice continues to apply.

use crate::audio_capture::AudioCaptureState;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use hound::{WavSpec, WavWriter};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

/// Try to find a PulseAudio/PipeWire monitor source using `pactl`.
fn find_monitor_source_via_pactl() -> Option<String> {
    let output = std::process::Command::new("pactl")
        .args(["list", "short", "sources"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let default_sink = std::process::Command::new("pactl")
        .args(["get-default-sink"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    if let Some(sink_name) = &default_sink {
        let monitor_name = format!("{}.monitor", sink_name);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 && parts[1] == monitor_name {
                return Some(monitor_name);
            }
        }
    }

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 && parts[1].ends_with(".monitor") {
            return Some(parts[1].to_string());
        }
    }

    None
}

pub async fn start_capture(
    state: &AudioCaptureState,
    max_duration_secs: u32,
) -> Result<(), String> {
    state.reset();

    let samples = state.samples.clone();
    let sample_rate_arc = state.sample_rate.clone();
    let channels_arc = state.channels.clone();
    let stop_tx = state.stop_tx.clone();
    let error_arc = state.error.clone();

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
    *stop_tx.lock().unwrap() = Some(tx);

    tokio::spawn(async move {
        rx.recv().await;
        stop_flag_clone.store(true, Ordering::Relaxed);
    });

    thread::spawn(move || {
        let monitor_source = find_monitor_source_via_pactl();
        if let Some(ref source_name) = monitor_source {
            std::env::set_var("PULSE_SOURCE", source_name);
        }

        let host = cpal::default_host();

        let device = if monitor_source.is_some() {
            match host.default_input_device() {
                Some(d) => d,
                None => {
                    let error_msg = "No audio input device available".to_string();
                    *error_arc.lock().unwrap() = Some(error_msg);
                    return;
                }
            }
        } else {
            let mut monitor_device = None;
            if let Ok(devices) = host.input_devices() {
                for d in devices {
                    if let Ok(name) = d.name() {
                        if name.to_lowercase().contains("monitor") {
                            monitor_device = Some(d);
                            break;
                        }
                    }
                }
            }
            match monitor_device {
                Some(d) => d,
                None => match host.default_input_device() {
                    Some(d) => d,
                    None => {
                        let error_msg = "No audio input device available".to_string();
                        *error_arc.lock().unwrap() = Some(error_msg);
                        return;
                    }
                },
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let error_msg = format!("Failed to get default input config: {}", e);
                *error_arc.lock().unwrap() = Some(error_msg);
                return;
            }
        };

        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        let sample_format = config.sample_format();

        *sample_rate_arc.lock().unwrap() = sample_rate;
        *channels_arc.lock().unwrap() = channels;

        let stream_config = StreamConfig {
            channels,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let samples_clone = samples.clone();
        let error_arc_clone = error_arc.clone();
        let stop_flag_for_stream = stop_flag.clone();

        let err_fn = {
            let error_arc = error_arc.clone();
            move |err: cpal::StreamError| {
                let error_msg = format!("Stream error: {}", err);
                *error_arc.lock().unwrap() = Some(error_msg);
            }
        };

        let stream = match sample_format {
            SampleFormat::F32 => {
                let samples = samples_clone.clone();
                let stop = stop_flag_for_stream.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut guard = samples.lock().unwrap();
                        guard.extend_from_slice(data);
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let samples = samples_clone.clone();
                let stop = stop_flag_for_stream.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut guard = samples.lock().unwrap();
                        for &s in data {
                            guard.push(s as f32 / 32768.0);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let samples = samples_clone.clone();
                let stop = stop_flag_for_stream.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let mut guard = samples.lock().unwrap();
                        for &s in data {
                            guard.push((s as f32 / 32768.0) - 1.0);
                        }
                    },
                    err_fn,
                    None,
                )
            }
            _ => {
                let error_msg = format!("Unsupported sample format: {:?}", sample_format);
                *error_arc_clone.lock().unwrap() = Some(error_msg);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                let error_msg = format!("Failed to build input stream: {}", e);
                *error_arc_clone.lock().unwrap() = Some(error_msg);
                return;
            }
        };

        if let Err(e) = stream.play() {
            let error_msg = format!("Failed to start stream: {}", e);
            *error_arc_clone.lock().unwrap() = Some(error_msg);
            return;
        }

        loop {
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    let stop_tx_clone = state.stop_tx.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(max_duration_secs as u64)).await;
        let tx = stop_tx_clone.lock().unwrap().take();
        if let Some(tx) = tx {
            let _ = tx.send(()).await;
        }
    });

    Ok(())
}

pub async fn stop_capture(state: &AudioCaptureState) -> Result<String, String> {
    if let Some(tx) = state.stop_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    if let Some(error) = state.error.lock().unwrap().as_ref() {
        return Err(error.clone());
    }

    let samples = state.samples.lock().unwrap().clone();
    let sample_rate = *state.sample_rate.lock().unwrap();
    let channels = *state.channels.lock().unwrap();

    if samples.is_empty() {
        return Err(
            "No audio samples captured. Make sure audio is playing on your system during recording."
                .to_string(),
        );
    }

    let wav_data = samples_to_wav(&samples, sample_rate, channels)?;
    Ok(base64_encode(&wav_data))
}

pub fn is_supported() -> bool {
    if find_monitor_source_via_pactl().is_some() {
        return true;
    }
    let host = cpal::default_host();
    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                if name.to_lowercase().contains("monitor") {
                    return true;
                }
            }
        }
    }
    host.default_input_device().is_some()
}

fn samples_to_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    let cursor = Cursor::new(&mut buffer);

    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer =
        WavWriter::new(cursor, spec).map_err(|e| format!("Failed to create WAV writer: {}", e))?;

    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let i16_sample = (clamped * 32767.0) as i16;
        writer
            .write_sample(i16_sample)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

    Ok(buffer)
}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((n >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(n & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}
