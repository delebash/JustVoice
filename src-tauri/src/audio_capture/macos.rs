// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/tauri/src-tauri/src/audio_capture/macos.rs
// Translated/ported by JustVoice contributors. Modifications under MIT.
// Upstream MIT permission notice continues to apply.

// macOS system audio capture via ScreenCaptureKit.
// Requires macOS 12.3+. Gated behind the `screencapturekit` optional dep.
// On non-macOS the mod.rs re-exports a no-op stub or the correct platform impl.

use crate::audio_capture::AudioCaptureState;
use hound::{WavSpec, WavWriter};
use screencapturekit::{
    cm::CMSampleBuffer,
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration,
        content_filter::SCContentFilter,
        output_trait::SCStreamOutputTrait,
        output_type::SCStreamOutputType,
        sc_stream::SCStream,
    },
};
use std::io::Cursor;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub async fn start_capture(
    state: &AudioCaptureState,
    max_duration_secs: u32,
) -> Result<(), String> {
    if !is_supported() {
        return Err("System audio capture requires macOS 12.3 or newer.".to_string());
    }

    state.reset();

    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {}", e))?;

    let displays = content.displays();
    if displays.is_empty() {
        return Err("No displays available".to_string());
    }
    let display = &displays[0];

    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build();

    let mut config = SCStreamConfiguration::default();
    config.set_captures_audio(true);
    config.set_excludes_current_process_audio(false);
    config.set_sample_rate(48000);
    config.set_channel_count(2);

    let (tx, mut rx) = mpsc::channel::<()>(1);
    *state.stop_tx.lock().unwrap() = Some(tx);

    let samples = state.samples.clone();
    let sample_rate = state.sample_rate.clone();
    let channels = state.channels.clone();

    *sample_rate.lock().unwrap() = 48000;
    *channels.lock().unwrap() = 2;

    struct AudioHandler {
        samples: Arc<Mutex<Vec<f32>>>,
    }

    impl SCStreamOutputTrait for AudioHandler {
        fn did_output_sample_buffer(
            &self,
            sample: CMSampleBuffer,
            _type: SCStreamOutputType,
        ) {
            if _type == SCStreamOutputType::Audio {
                if let Ok(audio_samples) = extract_audio_samples(sample) {
                    let mut samples_guard = self.samples.lock().unwrap();
                    samples_guard.extend_from_slice(&audio_samples);
                }
            }
        }
    }

    let handler = AudioHandler {
        samples: samples.clone(),
    };

    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(handler, SCStreamOutputType::Audio);

    stream.start_capture().map_err(|e| format!("Failed to start capture: {}", e))?;

    let stream_clone = stream.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(max_duration_secs as u64)) => {}
            _ = rx.recv() => {}
        }
        let _ = stream_clone.stop_capture();
    });

    Ok(())
}

pub async fn stop_capture(state: &AudioCaptureState) -> Result<String, String> {
    if let Some(tx) = state.stop_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let samples = state.samples.lock().unwrap().clone();
    let sample_rate = *state.sample_rate.lock().unwrap();
    let channels = *state.channels.lock().unwrap();

    if samples.is_empty() {
        return Err("No audio samples captured".to_string());
    }

    let wav_data = samples_to_wav(&samples, sample_rate, channels)?;
    Ok(base64_encode(&wav_data))
}

pub fn is_supported() -> bool {
    macos_version_at_least(12, 3)
}

fn macos_version_at_least(required_major: u64, required_minor: u64) -> bool {
    let output = match Command::new("sw_vers").arg("-productVersion").output() {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };

    let version = String::from_utf8_lossy(&output.stdout);
    let mut parts = version.trim().split('.');

    let major = parts.next().and_then(|part| part.parse::<u64>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|part| part.parse::<u64>().ok()).unwrap_or(0);

    major > required_major || (major == required_major && minor >= required_minor)
}

fn extract_audio_samples(sample_buffer: CMSampleBuffer) -> Result<Vec<f32>, String> {
    let audio_buffer_list = sample_buffer
        .audio_buffer_list()
        .ok_or_else(|| "Failed to get audio buffer list".to_string())?;

    let buffers: Vec<_> = audio_buffer_list.iter().collect();
    let num_buffers = buffers.len();

    if num_buffers == 0 {
        return Ok(Vec::new());
    }

    if num_buffers == 1 {
        let buffer = &buffers[0];
        let data_bytes = buffer.data();
        let num_samples = data_bytes.len() / std::mem::size_of::<f32>();
        if num_samples > 0 {
            unsafe {
                let data_ptr = data_bytes.as_ptr() as *const f32;
                let data = std::slice::from_raw_parts(data_ptr, num_samples);
                return Ok(data.to_vec());
            }
        }
    } else {
        let mut channel_data: Vec<Vec<f32>> = Vec::new();
        let mut max_samples = 0;
        for buffer in &buffers {
            let data_bytes = buffer.data();
            let num_samples = data_bytes.len() / std::mem::size_of::<f32>();
            if num_samples > 0 {
                unsafe {
                    let data_ptr = data_bytes.as_ptr() as *const f32;
                    let data = std::slice::from_raw_parts(data_ptr, num_samples);
                    channel_data.push(data.to_vec());
                    max_samples = max_samples.max(num_samples);
                }
            }
        }
        let mut interleaved = Vec::with_capacity(max_samples * num_buffers);
        for i in 0..max_samples {
            for channel in &channel_data {
                interleaved.push(if i < channel.len() { channel[i] } else { 0.0 });
            }
        }
        return Ok(interleaved);
    }

    Ok(Vec::new())
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
