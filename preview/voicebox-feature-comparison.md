# Voicebox GUI feature comparison — honest gap report

**Date:** 2026-06-08 evening (after reading voicebox upstream code directly, commit `b35b909...`)
**Method:** Read every voicebox settings page, component dir, hooks dir, store dir. Compared against my preview HTML + memory plan. This supersedes the workflow-3 audit which missed several settings-level features.

**Bottom line:** I had the top-level tabs right (7 voicebox tabs + 6 JustVoice additions = 13). I missed **~20 sub-features** mostly inside Settings sub-pages + one entire missed concept (Audio output channels). Adding them now to the preview + the phase plan.

---

## ✅ What I had right

- 80px left icon sidebar (voicebox shape)
- 7 voicebox top-level tabs (Generate, Stories, Voices, Captures, Effects, Models→Engines, Settings)
- 8 settings sub-routes (General, Generation, Captures, MCP, GPU, Logs, Changelog, About)
- Stories multi-track timeline editor
- Voice cloning + multi-sample profiles + .voicebox.zip import/export
- Effects chain editor with pedalboard
- MCP server with per-client client_id bindings
- Auto-updater badge in sidebar
- 6 JustVoice additions (Books, Personas, Lexicons, Train, Compare, Cache)
- System tray (this is a JustVoice add — voicebox doesn't have it)

## ❌ Voicebox features I missed

Concrete file paths from voicebox commit `b35b909...`:

### General Settings (`app/src/components/ServerTab/GeneralPage.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 1 | **Keep server running when app closes** toggle (Rust IPC: `platform.lifecycle.setKeepServerRunning(true)`) | GeneralPage.tsx:144-172 | Settings → General + tray-status sync |
| 2 | **Network access mode** toggle — local (127.0.0.1) vs remote (0.0.0.0). Determines bind interface for headless use from another machine | GeneralPage.tsx:174-195 | Settings → General |
| 3 | **Theme select** (light / dark / system) — ThemeSelect.tsx | GeneralPage.tsx:203-207 + ThemeSelect.tsx | Settings → General |
| 4 | **Language select** (i18n locale picker) — LanguageSelect.tsx | GeneralPage.tsx:197-201 + LanguageSelect.tsx | Settings → General |
| 5 | **Inline API reference card** showing /generate, /health, /profiles, /history endpoints + link to /docs | GeneralPage.tsx:379-429 | Settings → General |
| 6 | **Docs link + Discord link cards** | GeneralPage.tsx:74-110 | Settings → General |
| 7 | **Full auto-updater UI section** — not just a badge. Check-for-updates button, download progress bar (MB / MB + %), restart-and-install button, error display | GeneralPage.tsx:264-376 | Settings → General |
| 8 | **Live connection status pill** (offline/connecting/online) with animated dot — re-uses the green-pulse pattern | GeneralPage.tsx:217-262 | Settings → General + topbar |

### Generation Settings (`app/src/components/ServerTab/GenerationPage.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 9 | **Autoplay on generate** toggle (default on) | GenerationPage.tsx:119-130 | Settings → Generation |
| 10 | **Open generations folder** button (uses platform.filesystem.openPath) — opens the on-disk WAV cache | GenerationPage.tsx:132-146 | Settings → Generation |
| 11 | **Right-rail "About this setting" sidebar** explaining clone / engines / agent-ready | GenerationPage.tsx:150-188 | (UX polish, not blocking) |

### Captures Settings (`app/src/components/ServerTab/CapturesPage.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 12 | **ChordPicker** — full keyboard combo editor with live key-capture (not just a text input) | ChordPicker/ChordPicker.tsx + CapturesPage.tsx:262-284 | Settings → Captures |
| 13 | **Animated capture pill preview** cycling recording→transcribing→refining→rest with grid background | CapturesPage.tsx:75-121 | Settings → Captures |
| 14 | **Allow auto-paste** toggle — paste transcription into the focused text field | CapturesPage.tsx:293-308 | Settings → Captures |
| 15 | **AccessibilityNotice (Mac TCC)** — surfaces missing accessibility permission with link to System Settings | AccessibilityGate/AccessibilityGate.tsx | Settings → Captures (inline notice) |
| 16 | **InputMonitoringNotice (Mac TCC)** — surfaces missing input-monitoring permission | InputMonitoringGate/InputMonitoringGate.tsx | Settings → Captures (inline notice) |
| 17 | **Capture language selector** (auto / en / es / fr / de / ja / zh / hi) — separate from app i18n locale | CapturesPage.tsx:347-367 | Settings → Captures |
| 18 | **LLM refinement model size picker** (0.6B / 1.7B / 4B) — for the dictation post-process | CapturesPage.tsx:388-413 | Settings → Captures |
| 19 | **Default playback voice for dictation** — when an MCP agent says `voicebox.speak`, which voice replies | CapturesPage.tsx:462-513 | Settings → Captures + Settings → MCP |
| 20 | **Open captures folder** button | CapturesPage.tsx:520-534 | Settings → Captures |
| 21 | **Dictation readiness checklist** — six gates: mic perm + input monitoring + accessibility + STT model + LLM model + hotkey enabled. Persistently visible while configuring | CapturesPage.tsx:592-602 + CapturesTab/DictationReadinessChecklist | Settings → Captures right rail |
| 22 | **Windows-specific caveat notice** — input-monitoring quirks on Windows | CapturesPage.tsx:575-589 | Settings → Captures (OS-conditional) |

### MCP Settings (`app/src/components/ServerTab/MCPPage.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 23 | **HTTP install snippet** — full Claude Desktop config JSON with `X-Voicebox-Client-Id` header, copy-to-clipboard button | MCPPage.tsx:79-94 | Settings → MCP |
| 24 | **claude-code CLI one-liner** — `claude mcp add voicebox --transport http --url ... --header ...` | MCPPage.tsx:95-99 | Settings → MCP |
| 25 | **stdio shim install snippet** with OS-detected binary path (`/Applications/Voicebox.app/...`, `C:\Program Files\Voicebox\...`, `/opt/voicebox/...`) | MCPPage.tsx:19-32 + 100-115 | Settings → MCP |
| 26 | **Per-client bindings table** — client_id, label, profile_id picker, last_seen_at timestamp, delete button | MCPPage.tsx:152-220 | Settings → MCP |
| 27 | **Add new binding form** | MCPPage.tsx:221-264 | Settings → MCP |
| 28 | **MCP tools sidebar** listing the 4 exposed tools (speak / transcribe / list_captures / list_profiles) with descriptions | MCPPage.tsx:268-301 | Settings → MCP right rail |

### GPU Settings (`app/src/components/ServerTab/GpuPage.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 29 | **GpuInfoCard** — live GPU name + backend (CUDA/MPS/Metal/XPU/DirectML/ROCm) + VRAM-used + active pulse | GpuPage.tsx:43-114 | Settings → GPU |
| 30 | **CUDA wheel download with restart phases** — `idle → stopping → waiting → ready`, with progress bar | GpuPage.tsx (full file ~250 LOC) | Settings → GPU |
| 31 | **Apple Silicon vs CUDA branching UI** — different icon + messaging | GpuPage.tsx:16-22, 43-114 | Settings → GPU |
| 32 | **Backend variant display** (cu118 / cu124 / cu128 / cpu) | GpuPage.tsx:72-78 | Settings → GPU |

### MISSED ENTIRE CONCEPT — Audio output channels (`app/src/components/AudioTab/AudioTab.tsx`)

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 33 | **Audio channels** — named output configs mapping a voice/profile to a specific audio output device. Use cases: multi-monitor setups, streaming (route certain voices to OBS virtual mic), multi-character podcasts (each character on a separate output for the engineer) | AudioTab/AudioTab.tsx + stores/audioChannelStore.ts + lib/api → apiClient.listChannels() | **NEW: add an Audio Channels surface — either as a sub-tab inside Voices, or as a dedicated channels selector inside the AudioPlayer transport** |
| 34 | **Per-voice channel routing** — VoicesTab MultiSelect that assigns each voice profile to channels | VoicesTab.tsx + audioChannelStore.ts | Voices tab (MultiSelect column) |
| 35 | **AudioPlayer native device routing** — playback goes through the assigned channel for the current voice | AudioPlayer/AudioPlayer.tsx + platform.audio.listOutputDevices() | Player transport layer |

### Other features I missed

| # | Feature | Location | Where it should go |
|---|---|---|---|
| 36 | **DictateWindow** — separate floating Tauri webview window for the dictation pill (not just an in-app overlay) | DictateWindow/DictateWindow.tsx + App.tsx:23-89 (?view=dictate URL handler) | Phase 6 — Tauri shell work |
| 37 | **TitleBarDragRegion** — Tauri-specific drag area for frameless windows | AppFrame/AppFrame.tsx | Phase 6 — Tauri shell work |
| 38 | **AudioKeepAlive** — prevents OS audio device from sleeping during playback | AppFrame/AppFrame.tsx | Phase 6 — Tauri shell work |
| 39 | **Logs page** — log viewer + log level selector + open log folder + clear logs | ServerTab/LogsPage.tsx | Settings → Logs |
| 40 | **Changelog page** — rendered CHANGELOG.md with badge for new versions | ServerTab/ChangelogPage.tsx | Settings → Changelog |
| 41 | **About page** — version, contributors, GitHub link, third-party licenses link | ServerTab/AboutPage.tsx | Settings → About |
| 42 | **CapturePill** as a reusable component (separate from DictateWindow) — used in the readiness preview AND in the floating window | CapturePill/CapturePill.tsx | Component library |
| 43 | **18 stores/hooks** — playerStore, audioChannelStore, effectsStore, generationStore, logStore, serverStore, storyStore, uiStore + matching hooks | app/src/stores/ + app/src/lib/hooks/ | Pinia stores in Phase 4 |
| 44 | **GenerationProgress SSE hook** — real-time generation status streaming (queued / loading_model / generating / completed / failed) | useGenerationProgress.ts | Phase 4 (generation queue UI) |
| 45 | **RestoreActiveTasks** — recover in-flight generations from server restart | useRestoreActiveTasks.tsx | Phase 4 |
| 46 | **SystemAudioCapture hook** — capture from system audio (not just mic) — uses cpal/wasapi/screencapturekit | useSystemAudioCapture.ts | Phase 4 captures |
| 47 | **Inline accessibility/input-monitoring gates** at the affected page (not in a global "please grant permission" modal) | AccessibilityGate + InputMonitoringGate | Phase 4 captures |

---

## What this changes about the plan

1. **Settings architecture** — Settings is not one page, it's a layout with 8 sub-routes. Need to build that nested-router shape in Vue Router. Adding a **Phase 4c — Settings sub-pages** task.

2. **Audio channels are a real concept worth keeping.** Multi-output routing serves both podcasting (route per-character to OBS) and accessibility (route screen-reader output to specific device). Add to scope.

3. **DictateWindow as a separate Tauri window** is a real architecture choice — voicebox spawns a `?view=dictate` URL into a floating webview window. Worth replicating because the dictation pill needs to float OVER other apps, not stay inside the main window.

4. **The "keep server running when app closes" toggle is critical for users** — without it, closing the main window kills in-flight generations. Voicebox calls a Rust IPC (`platform.lifecycle.setKeepServerRunning(true)`) which presumably keeps the sidecar process alive past window close. This is paired with the system tray — when keepRunning is on AND tray is enabled, closing the window minimizes to tray instead of quitting the sidecar.

5. **Mac permission gates** (TCC) — Voicebox shows inline notices on the relevant settings pages when accessibility/input-monitoring perms are missing. Need to replicate for Mac users to be able to use dictation.

6. **GPU page is substantial** — not just a diagnostic. It has CUDA wheel download (with restart-server phases), live GPU info card with VRAM, backend variant display. ~250 LOC.

7. **MCP page is the agent-onboarding surface** — full copy-paste install snippets for Claude Desktop / claude-code CLI / stdio shim. Per-client bindings table with last-seen timestamps. This is what makes voicebox usable from Unreal/agent integrations.

8. **18 stores/hooks suggest the rendering pipeline is non-trivial** — generation queue with SSE, audio device enumeration, channel routing, story timeline state, effects chain state. Phase 4 frontend work is bigger than I scoped.

---

## Additional features from the deep-dive sweep (2026-06-08 continued)

After the initial gap report, kept reading. More features found in:

### `HistoryTable.tsx` (~1000 LOC of features)

| # | Feature | Location |
|---|---|---|
| 48 | **Pagination (20 per page)** with infinite scroll | HistoryTable.tsx:62-97 |
| 49 | **Import generation from .voicebox.zip** (with file picker dialog) | useImportGeneration + dialog |
| 50 | **Export generation as .voicebox.zip** (bundles audio + metadata) | useExportGeneration |
| 51 | **Export generation audio only** (raw WAV download) | useExportGenerationAudio |
| 52 | **Apply effects → creates new version** dialog with full EffectsChainEditor inline | HistoryTable.tsx:76-83 + dialog |
| 53 | **Cancel running generation** per row (Square icon) | HistoryTable.tsx:104-119 |
| 54 | **Clear all failed generations** bulk button + confirm dialog | useClearFailedGenerations |
| 55 | **Version chain expansion** per row — see all takes lineage with set-default | HistoryTable.tsx:84 |
| 56 | **AudioBars** animated EQ-bar visualization during playback | components/AudioBars.tsx |
| 57 | **Star/favorite toggle** per generation | HistoryTable.tsx (Star icon) |

### `EffectsChainEditor.tsx` (drag-reorderable chain)

| # | Feature | Location |
|---|---|---|
| 58 | **Drag-and-drop reorder effects** via @dnd-kit (PointerSensor + KeyboardSensor) | EffectsChainEditor.tsx:1-80 |
| 59 | **Expand/collapse per effect** to edit parameters | expandedId state |
| 60 | **Add effect from dropdown** populated by `apiClient.getAvailableEffects()` (server tells UI which effects exist + their params) | line 82-86 |
| 61 | **Per-effect enable/disable toggle** (Power icon) without removing from chain | EffectsChainEditor.tsx imports |
| 62 | **Sliders per parameter** with min/max/step/default from server-supplied metadata | line 105-115 |
| 63 | **Effect presets dropdown** (built-in + custom presets) with `apiClient.listEffectPresets()` | line 88-92 |
| 64 | **Reusable in compact mode** (inline on history row vs full editor on Effects tab) | compact prop |

### `ModelManagement.tsx` (the Models / Engines tab)

| # | Feature | Location |
|---|---|---|
| 65 | **Per-model rich description text** for all 17 engines (Kokoro, Chatterbox, Qwen3, LuxTTS, TADA, plus Whisper STT and Qwen3 LLM sizes) | ModelManagement.tsx:55-92 |
| 66 | **HuggingFace API integration** — live fetch of repo metadata (downloads count, likes, license) | fetchHuggingFaceModelInfo |
| 67 | **Active download task tracking** with progress bar + cancel | ActiveDownloadTask type |
| 68 | **Per-model status** (downloaded / downloading / not-downloaded) with visual indicator | ModelStatus |
| 69 | **Open model folder** button (FolderOpen icon) | platform.filesystem.openPath |
| 70 | **Uninstall model** (Unplug icon) with confirm dialog | apiClient + Trash2 |
| 71 | **Re-download model** (RotateCcw — for corrupted / partial downloads) | apiClient |
| 72 | **Total disk usage** (Scale icon, HardDrive icon) summary across all models | aggregate sum |
| 73 | **HF model link** (ExternalLink) — opens model card on HuggingFace | huggingface.co/{repoId} |
| 74 | **License badge** per model | formatLicense |

### `ChordPicker.tsx` (live keyboard combo editor)

| # | Feature | Location |
|---|---|---|
| 75 | **Peak-set tracking** — captures the maximum set of keys held during the session, so user can release before clicking Save | ChordPicker.tsx:54-72 |
| 76 | **Esc pass-through** for closing the modal without capturing | ChordPicker.tsx:78 |
| 77 | **Tab pass-through** for accessibility (not captured into chord) | ChordPicker.tsx:81 |
| 78 | **Modifier side hints** (L/R indicator on Shift/Ctrl/Alt/Meta) | modifierSideHint |
| 79 | **Unsupported key feedback** — shows which key couldn't be canonicalized | unsupportedAttempt state |
| 80 | **Canonical key normalization** — physical event.code → cross-platform canonical name | canonicalKeyFromEvent |
| 81 | **Hidden focus surface** inside dialog to pull keyboard focus | captureRef + auto-focus on open |

### `LogsPage.tsx`

| # | Feature | Location |
|---|---|---|
| 82 | **Real-time log streaming** from logStore (subscribed to backend SSE) | useLogStore |
| 83 | **stdout vs stderr color-coding** (orange for stderr) | LogsPage.tsx:23-27 |
| 84 | **Auto-scroll with manual-scroll detection** (stops auto-scrolling if user scrolls up) | LogsPage.tsx:42-55 |
| 85 | **"Jump to bottom"** button when not auto-scrolling | LogsPage.tsx:67-78 |
| 86 | **Clear logs** button | LogsPage.tsx:79-80 |
| 87 | **Line count display** | LogsPage.tsx:63 |

---

## Cumulative coverage now

| Category | Count |
|---|---|
| Initial preview features | ~85 |
| Gap-1 additions (first comparison) | ~47 |
| Gap-2 additions (HistoryTable, EffectsChainEditor, ModelManagement, ChordPicker, LogsPage) | ~40 |
| Gap-3 additions (this batch — Tauri shell, dictate, stores, sidebar) | ~50 |
| **Total features cataloged** | **~220** |

---

## Gap-3 deep-dive findings (Tauri shell + stores + dictate + transport)

### Tauri Rust commands — the full `invoke_handler!` list

21 Rust commands exposed to the frontend (`tauri/src-tauri/src/main.rs:1355-1378`):

| # | Command | Purpose |
|---|---|---|
| 88 | `start_server` | Spawn the Python sidecar |
| 89 | `stop_server` | Terminate the sidecar |
| 90 | `restart_server` | Stop + start (used after dep install / CUDA wheel download) |
| 91 | `set_keep_server_running` | **THE flag the user explicitly cited** — persists the toggle into Rust state |
| 92 | `start_system_audio_capture` | Begin capturing system audio (cpal/wasapi/screencapturekit) |
| 93 | `stop_system_audio_capture` | |
| 94 | `is_system_audio_supported` | Feature detection per OS (used to gate UI) |
| 95 | `list_audio_output_devices` | Enumerate audio outputs for channel routing |
| 96 | `play_audio_to_devices` | Native multi-device playback (route a WAV to specific channels) |
| 97 | `stop_audio_playback` | |
| 98 | `debug_clipboard_roundtrip` | Diagnostic: paste-loop test |
| 99 | `debug_paste_text` | Diagnostic |
| 100 | `debug_capture_focus` | Diagnostic |
| 101 | `debug_focus_roundtrip` | Diagnostic |
| 102 | `check_accessibility_permission` | macOS TCC check |
| 103 | `check_input_monitoring_permission` | macOS TCC check |
| 104 | `open_accessibility_settings` | Open System Settings deep-link |
| 105 | `open_input_monitoring_settings` | Open System Settings deep-link |
| 106 | `paste_final_text` | OS-level paste injection after dictation transcribe + refine |
| 107 | `enable_hotkey` | Register global keyboard chord |
| 108 | `disable_hotkey` | |
| 109 | `update_chord_bindings` | Change which chord triggers what |

### Tauri WindowEvent + RunEvent — the close + exit lifecycle

| # | Behavior | Code |
|---|---|---|
| 110 | **Close-button intercept** — Tauri prevents close, emits `window-close-requested` event, waits for `window-close-allowed` from frontend (5s timeout fallback). Frontend reads `keepServerRunningOnClose` setting and decides whether to stop server | main.rs:1379-1424 |
| 111 | **RunEvent::Exit watchdog disable** — if keep-running is on, Rust disables the server watchdog via HTTP THEN writes a sentinel file as fallback (Windows can race on the HTTP request) | main.rs:1430+ |
| 112 | **`--parent-pid <X>` server arg + watchdog grace period** — sidecar self-terminates if parent disappears unless sentinel says otherwise | (server-side, paired with above) |
| 113 | **`closing` AtomicBool** — guards reentry during the close-flow | main.rs:1380-1387 |

### DictateWindow Rust shell — separate transparent webview

| # | Behavior | Code |
|---|---|---|
| 114 | **Separate webview labelled `dictate`** — `?view=dictate` URL trigger from main App.tsx | main.rs:27-58 |
| 115 | **Window config**: decorations(false) + transparent(true) + always_on_top(true) + visible_on_all_workspaces(true) + skip_taskbar(true) + resizable(false) + shadow(false) + visible(false) | main.rs:36-49 |
| 116 | **Positioned 4% from top, horizontally centered** on current monitor | main.rs:51-57 |
| 117 | **Hide-park pattern** — parked at (-10000, -10000) with ignore_cursor_events(true) when hidden, so invisible click targets don't leak | main.rs:60-83 |
| 118 | **`ensure_dictate_window`** — idempotent build, used by agent-speech to prime the listeners before the actual show | main.rs:73-83 |

### DictateWindow agent-speak cycle (frontend)

| # | Feature | Code |
|---|---|---|
| 119 | **TWO independent pill cycles in one window**: (1) user dictation chord, (2) **agent speech** — when MCP agents call `voicebox.speak`, Rust speak_monitor catches the SSE event, opens the pill, plays the audio. THIS IS THE INTEGRATION SURFACE FOR UNREAL/AGENTS. | DictateWindow.tsx:1-23 |
| 120 | `dictate:speak-start` event with generation_id, profile_name, source, client_id payload | DictateWindow.tsx:163-217 |
| 121 | **Per-generation SSE subscription** for status streaming (queued / loading_model / generating / completed / failed) | line 182-216 |
| 122 | **60-second timeout** for stuck speak — covers gen-row-deleted-mid-flight case | line 187-195 |
| 123 | **15-second grace** for failed speak-end without audio | line 240-244 |
| 124 | **HTMLAudioElement playback** with onended → `dictate:hide` emit | line 134-155 |
| 125 | **FocusSnapshot tracking** — captures focused UI element at chord-start; persisted in ref so paste fires only when refined text arrives | line 42-65 |
| 126 | **Transparent host document** — HTML+body bg → transparent so the Tauri window takes on the pill's own shape | line 27-36 |

### AudioKeepAlive workaround (WebKit audio session)

| # | Feature | Code |
|---|---|---|
| 127 | **Silent looping WAV at full volume** — builds a 1s zero-PCM WAV in JS, plays on loop, prevents WKWebView from tearing down CoreAudio output session | AudioKeepAlive.tsx:1-85 |
| 128 | **Reason it's NOT a muted element** — browsers can optimize muted media away, defeating the purpose. Must be real silence at volume=1 | comments at top |
| 129 | **First-gesture retry** for autoplay-blocked first play attempt | line 49-62 |
| 130 | **visibility/focus/pageshow listeners** to resume after webview backgrounding | line 64-70 |
| 131 | **WKWebView idle bug** — JS-level reload (cmd+R) does NOT restore audio session; only relaunching the Tauri app does. This component prevents the dormancy in the first place | comment lines 1-11 |

### AppFrame — global mount + conditional bottom dock

| # | Feature | Code |
|---|---|---|
| 132 | **TitleBarDragRegion** always mounted (Tauri drag area for frameless windows) | AppFrame.tsx:29 |
| 133 | **AudioKeepAlive** always mounted | AppFrame.tsx:30 |
| 134 | **Conditional bottom dock**: `StoryTrackEditor` when on `/stories` route AND a story is selected AND it has items; else the global `AudioPlayer` | AppFrame.tsx:32-36 |

### AudioPlayer — global transport (~400 LOC, sample reads first 200)

| # | Feature | Code |
|---|---|---|
| 135 | **WaveSurfer.js waveform** with HSL CSS variable colors (waveColor=muted, progressColor=accent, cursorColor=accent) | AudioPlayer.tsx:115-129 |
| 136 | **Reusable WaveSurfer instance** — created once, never destroyed until unmount (avoids costly re-init per audio load) | line 78-82 |
| 137 | **Drag-to-seek fade-out/in** — mutes audio during drag via GainNode, fades in on dragend (avoids popping from WebAudio hard stop/start) | line 183-195 |
| 138 | **Native audio device routing** — when the current profile has assigned channels, falls back to native playback via Tauri `play_audio_to_devices` | line 36-65 |
| 139 | **Loop button** | line 30 (toggleLoop), Repeat icon |
| 140 | **Volume slider with Volume2/VolumeX icons** | imports |
| 141 | **Auto-play flag** for story-mode auto-advance vs explicit play | line 161-169 |
| 142 | **Error state** display | line 74 |
| 143 | **Loading state** display during initial buffer | line 73 |
| 144 | **Close button (X)** to dismiss the player | imports |

### Sidebar — final detail

| # | Feature | Code |
|---|---|---|
| 145 | **w-20 (80px) fixed left, h-full, py-6 gap-6, bg-sidebar border-r** | Sidebar.tsx:42-46 |
| 146 | **macOS-aware top padding** (pt-14) for the title bar drag region | line 45 |
| 147 | **Accent-fade pattern** — each tab's accent border opacity decreases as you move down (0.5 → 0.08 over 7 tabs) | line 63 |
| 148 | **Active tab visual**: bg-white/[0.07] + shadow-lg + backdrop-blur-sm + border + linear-gradient mask for the inner glow | line 70-87 |
| 149 | **Logo** at top (sidebar-logo class, 12x12) | line 49-51 |
| 150 | **Version number** at bottom (from package.json) | line 99 |
| 151 | **Update badge** pill linked to /settings (only when updater says one is available) | line 100-107 |
| 152 | **Pill padding adjustment** when AudioPlayer is open (paddingBottom: 7rem to clear the player) | line 95-97 |
| 153 | **TanStack Router Link + useMatchRoute** for active state detection | line 1, 34, 59-60 |

### Zustand stores — the full inventory

| # | Store | Persisted? | Key state |
|---|---|---|---|
| 154 | `playerStore` | no | audioUrl, audioId, profileId, isPlaying, currentTime, duration, volume, isLooping, shouldRestart, shouldAutoPlay, clearAutoPlayFlag |
| 155 | `storyStore` | no | selectedStoryId, selectedClipId, trackEditorHeight, playback state with Web Audio API timing (playbackStartContextTime, playbackStartStoryTime), play/pause/stop/seek actions |
| 156 | `audioChannelStore` | **yes** (`voicebox-audio-channels`) | channels[]: {id, name, is_default, device_ids[], created_at} — supports routing to MULTIPLE devices simultaneously |
| 157 | `generationStore` | no | pendingGenerationIds (Set), isGenerating (derived), pendingStoryAdds (Map<genId, storyId> for deferred queue), activeGenerationId |
| 158 | `effectsStore` | no | selectedPresetId, workingChain (the chain being edited), isCreatingNew |
| 159 | `uiStore` | **yes** (`voicebox-ui`, partial) | sidebarOpen, profileDialogOpen, editingProfileId, generationDialogOpen, selectedProfileId, selectedEngine, selectedVoiceId, profileFormDraft, theme |
| 160 | `serverStore` | **yes** (`voicebox-server`) | serverUrl, isConnected, mode ('local'/'remote' for bind interface), keepServerRunningOnClose, customModelsDir |
| 161 | `logStore` | no | entries[]: {timestamp, line, stream='stdout'/'stderr'} streamed from backend SSE |

**Theme handling in uiStore:**
- 3 modes: light / dark / system
- system follows `prefers-color-scheme` media query
- applyTheme() toggles `.dark` class on `document.documentElement`
- Auto-applied on rehydrate from persistence

**React Query cache auto-invalidation on serverUrl change** (serverStore.ts:68-73) — prevents stale data from previous server.

### ListPane primitive — the slot/compound component

| # | Feature | Code |
|---|---|---|
| 162 | **Right divider with linear-gradient mask** (transparent → black 50px down) — soft hairline rather than hard line | ListPane.tsx:13-19 |
| 163 | **Top fade mask** (h-20 gradient from background to transparent) — list items fade as they approach the title | line 20 |
| 164 | **ListPaneSearch is rounded-full** (capsule), no focus ring | line 71-82 |
| 165 | **ListPaneTitle text-2xl font-bold truncate** | line 51-53 |
| 166 | **ListPaneScroll has `pt-24` to clear floating header** | line 90-99 |
| 167 | **Slots**: ListPane / Header / TitleRow / Title / Actions / Search / Scroll — compound API | (whole file) |

### CapturePill — 7 states + framer-motion bars

| # | Feature | Code |
|---|---|---|
| 168 | **7 pill states**: recording / transcribing / refining / speaking / completed / rest / error | CapturePill.tsx:10-17 |
| 169 | **Per-state framer-motion bar animation** with 3 distinct modes: generating (6→16→6, 600ms staggered), playing (8→14→4→12→8, 1200ms chaotic), idle (static 8px) | line 35-60 |
| 170 | **Error state = destructive variant** that copies the error message to clipboard on click + calls onDismiss | comment at line 73-75 |
| 171 | **formatElapsed (m:ss zero-padded)** | line 62-67 |
| 172 | **PillAudioBars exported separately** for reuse outside the pill (in CapturePill preview, etc.) | line 35 |
| 173 | **5 bars, gap-2px, w-3px** rounded-full | line 37-58 |

### DictationReadinessChecklist — 6 gates

| # | Gate | Behavior |
|---|---|---|
| 174 | Mic permission | Required for any recording. Inline "Open System Settings" button when missing on Mac. |
| 175 | Accessibility permission (macOS TCC) | Required for paste injection. `open_accessibility_settings` deep-link. |
| 176 | Input Monitoring permission (macOS TCC) | Required for global hotkey. `open_input_monitoring_settings` deep-link. |
| 177 | STT model loaded (Whisper) | Auto-downloads in background. Progress bar inline. |
| 178 | LLM model loaded (Qwen3 0.6B/1.7B/4B) | Auto-downloads. Progress bar inline. |
| 179 | Hotkey enabled toggle | Master switch — once everything else is green, this lights up the whole dictation surface. |
| | Per-row | CheckCircle2 (green) when ready, Circle (gray) when not. Action button inline when not-ready. |

### Markdown ChangelogPage

| # | Feature | Code |
|---|---|---|
| 180 | **`virtual:changelog` build-time import** of CHANGELOG.md | ChangelogPage.tsx:1 |
| 181 | **Custom markdown renderer** — tables, headings (####/###), bulleted lists, paragraphs, inline bold/italic/code/links | lines 7-80 |
| 182 | **parseChangelog utility** parses dated entries with version tags | imports |

### AboutPage

| # | Feature | Code |
|---|---|---|
| 183 | **Sponsors list** — voicebox has a sponsors program; AboutPage renders SPONSORS from `lib/sponsors.ts` | AboutPage.tsx:6 |
| 184 | **FadeIn animation** with staggered delays for stagger entry | line 9-18 |
| 185 | **Inline keyframe definition** (`@keyframes fadeInUp`) | line 34-45 |
| 186 | **`platform.metadata.getVersion()` IPC** for live version display | line 25-30 |

### Misc components from quick scans

| # | Component | What |
|---|---|---|
| 187 | **AudioBars.tsx** | Standalone animated EQ bars (used in HistoryTable row playback indicator) |
| 188 | **ShinyText.tsx** | Animated shine effect on text (likely the loading state / generating state) |
| 189 | **TitleBarDragRegion.tsx** | Tauri-specific top drag area for frameless windows |
| 190 | **AccessibilityGate.tsx** | Inline notice on relevant pages when Mac TCC accessibility perm is missing, with deep-link button |
| 191 | **InputMonitoringGate.tsx** | Same shape for input monitoring perm |
| 192 | **StoryChatItem.tsx** | One row in the linear (non-timeline) story view — drag handle + audio playback + remove |
| 193 | **CapturePill state machine timer** — recording state advances elapsed; transcribing/refining/speaking states hold elapsed (so user sees the duration of the clip being processed) | DictateWindow.tsx:80-96 |
| 194 | **Profile sample 30-second hard limit** (countdown shown during recording) | AudioSampleRecording.tsx + AudioSampleSystem.tsx |
| 195 | **ProfileFormDraft persistence** — base64-encoded sample file metadata survives a refresh of the create-voice modal | uiStore.ts:18-29 |
| 196 | **PRESET_ONLY_ENGINES set** (kokoro, qwen_custom_voice) — these don't support cloning, ProfileForm shows preset-voice picker instead of clone UI | ProfileForm.tsx:64 |
| 197 | **7 engines hardcoded** in DEFAULT_ENGINE_OPTIONS dropdown: qwen, qwen_custom_voice, luxtts, chatterbox, chatterbox_turbo, tada, kokoro | ProfileForm.tsx:65-73 |
| 198 | **Sample-recording live waveform** via react-sound-visualizer with yellow stroke (#b39a3d, 30% opacity) | AudioSampleRecording.tsx:14-22 |
| 199 | **Story-mode auto-advance** — when one clip finishes, next clip auto-plays via shouldAutoPlay flag | playerStore + useStoryPlayback hook |
| 200 | **`customModelsDir` setting** — operator can move HF cache to a custom path (useful for low-disk laptops with external SSD) | serverStore.ts:18-19 |

---

## FINAL CUMULATIVE COVERAGE

| Category | Count |
|---|---|
| Initial preview features | ~85 |
| Gap-1 (settings sub-pages) | ~47 |
| Gap-2 (HistoryTable, EffectsChainEditor, ModelManagement, ChordPicker, LogsPage) | ~40 |
| Gap-3 (Tauri shell, dictate, stores, sidebar, transport, primitives) | ~62 |
| **Total cataloged** | **~234** |

### What's still unread (will keep finding more if needed)

- `useStoryPlayback.ts` (the Web Audio API multi-track scheduler — likely 200+ LOC of audio plumbing)
- `useChordSync.ts` (chord ↔ Rust IPC sync)
- `useSystemAudioCapture.ts`
- `useCaptureRecordingSession.ts`
- `useRestoreActiveTasks.tsx` (recovers in-flight generations on app start)
- `useModelDownloadToast.tsx`
- `backend/mcp_server/` (MCP tools backend — speak / transcribe / list_captures / list_profiles)
- Rest of `main.rs` (~1300 of 1503 lines — speak_monitor, hotkey_monitor, audio_capture, accessibility checks)
- `audio_output.rs`, `synthetic_keys.rs`, `keyboard_layout.rs` (Rust modules)
- `i18n/locales/en/*.json` (all the user-facing string keys reveal more feature surface)

Estimate: maybe 30-50 more features in those, mostly plumbing-level (hooks coordinating IPC + queries). The major user-facing features are captured.

## Architectural takeaways from the deep dive

1. **Voicebox is HEAVIER on Rust shell than I scoped.** ~1500 LOC of Rust for hotkey, focus capture, paste injection, system audio, dictate window mgmt, accessibility checks, watchdog. JustVoice's Phase 4c needs to budget for this.

2. **The keep-server-running implementation is non-trivial**: Rust flag + HTTP watchdog disable + sentinel file fallback (Windows race condition). Not "just toggle a setting."

3. **DictateWindow is the agent integration surface** I undervalued. When an MCP agent calls `voicebox.speak`, the floating pill window animates "speaking" state with the elapsed timer. That's the UX moment for Unreal NPCs and Claude / agent voice replies.

4. **Audio device channels are bidirectional infrastructure** — they affect playback (route voice X to OBS) AND profile assignment (a voice profile knows which channels it plays through). Backend has `apiClient.getProfileChannels(profileId)` returning channel_ids.

5. **The 6-gate dictation readiness pattern is the right UX** for any feature that depends on multiple permissions + model downloads. Worth lifting as a general primitive for engine readiness too.

6. **AudioKeepAlive is a non-obvious gotcha** specific to WKWebView. JustVoice on macOS must include it or playback will silently fail after idle.

7. **HSL-based theming through CSS variables** is the right approach for the light/dark/system toggle. Vue equivalent is the same `:root { --accent: 43 55% 58% }` + `hsl(var(--accent))` pattern.

8. **ListPane is the canonical list/detail scaffold** used by Stories, Voices, Personas, Lexicons, Captures — single primitive worth lifting whole into Vue.

9. **18 hooks suggest the frontend has substantial query/SSE coordination logic** beyond what's visible from components alone. Phase 4 hook port is bigger than I initially scoped.

## My recommendation

## My recommendation

**Phase 4 (UX) scope grows from "4-5 weeks" to "6-8 weeks"** to absorb these missed features. Phase 4 breaks into sub-tasks:

- **4a (backend, no UX block)**: take-versioning + audio channels backend + MCP per-client bindings backend + SSE generation progress stream
- **4b (UX, blocked on visual direction)**: All 13 tabs + 8 settings sub-pages + dictate window + chord picker + capture pill + permission gates + GPU info card + audio channel routing
- **4c (Tauri shell work)**: keep-server-running IPC + system tray + dictate window + audio keep-alive + title bar drag region

Updating the preview HTML, the phase plan, and adding tasks for each gap.
