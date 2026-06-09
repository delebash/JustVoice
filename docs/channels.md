# Audio output channels

Route specific voices to specific OS audio devices. The **Channels** tab is where you bind a voice (or persona, or profile) to an output device — useful for stream-deck-style multi-output rigs, DAW routing, or accessibility setups.

## When you'd use channels

- **Streaming / production rigs** — send the narrator to your speakers, send a chat-companion voice to OBS audio source 2, send a "warning bell" to a separate monitor.
- **Accessibility** — route TTS to a different device than system audio so screen-reader output stays separate.
- **DAW workflows** — bind each character voice to a different virtual audio cable (BlackHole / VB-Cable / Loopback) so they show up as discrete tracks in Ableton / Reaper / Logic.
- **Dictation** — route the dictate-window's confirmation tone to a specific device so it doesn't interrupt the active call's audio.

## How it works

JustVoice enumerates OS audio devices on startup (PortAudio under the hood — same enumeration as voicebox). Each device gets:
- Name (`Realtek Audio`, `BlackHole 2ch`, `BT Headset`)
- Default flag (the system default)
- Sample rate
- Channels (mono / stereo)

Channels tab shows the device list + a "Bind a voice" form:
- Pick a voice / persona / profile
- Pick an output device
- Save the binding

Subsequent renders for that voice route audio to the bound device automatically. If the device disappears (Bluetooth headset disconnects, USB unplugged), the binding falls back to the system default until the device returns.

## Bindings

Bindings live in SQLite. They're cross-session — once you bind Mara to BlackHole 2ch, every render of Mara routes there until you change it.

API:

| Endpoint | Purpose |
|---|---|
| `GET /v1/channels/devices` | List audio devices |
| `GET /v1/channels/bindings` | List current bindings |
| `POST /v1/channels/bindings` | Bind a voice/persona/profile to a device |
| `DELETE /v1/channels/bindings/{id}` | Remove a binding |

## Routing precedence

When a render's audio is ready, JustVoice routes via:

1. **Per-take override** — if the render request specified an `output_device`, use that.
2. **Persona binding** — if the persona attribution has a channel binding, use that device.
3. **Profile binding** — fallback to the profile's device.
4. **System default** — fallback to OS default output.

## Why not just OS-level routing?

You could route OS audio to BlackHole and split there. Two reasons we do it in JustVoice instead:

1. **Per-character granularity** — OS routing routes ALL of JustVoice's audio. Channels routes per-render based on the speaker.
2. **Survives device changes** — when a Bluetooth headset reconnects, JustVoice picks it up by name (`BT Headset`). OS-level routing would lose the binding.

## Audio keep-alive (macOS)

On Mac, CoreAudio tears down idle audio sessions. JustVoice runs a silent looping WAV in the background to keep the session open so the first render after idle doesn't pop. See [system-tray.md](system-tray.md) for the AudioKeepAlive setup.

## Troubleshooting

- **No devices listed** — PortAudio failed to enumerate. Restart the app + check the server log for `portaudio: ...` errors. Common on first-launch macOS where mic/audio permission hasn't been granted yet.
- **Binding doesn't route audio** — The device may have disconnected. Check the device dropdown — disconnected devices show as italic-grayed. Reconnect → JustVoice picks up automatically.
- **DAW doesn't see JustVoice audio** — Most DAWs need a virtual audio cable as the bridge. Install BlackHole (Mac) / VB-Cable (Win) → bind JustVoice voices to it → set it as the DAW's input.
- **Latency too high** — JustVoice uses the device's default sample rate + 256-frame buffer. For low-latency monitoring, use a virtual cable with a smaller buffer rather than asking JustVoice to render at a non-default rate.
