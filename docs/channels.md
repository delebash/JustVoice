# Audio output channels

**Settings → Channels** lists your channels and adds them. Routing a persona's audio to an
output device of your computer is not built yet, so this page no longer describes it (since
2026-10-15).

**Not built yet:** JustVoice doesn't list your computer's audio outputs yet, so the channel form
has no device field for now — a channel you add holds its name and the default flag.

## Audio keep-alive (macOS)

On Mac, CoreAudio tears down idle audio sessions. JustVoice runs a silent looping WAV in the background to keep the session open so the first render after idle doesn't pop. There is nothing to set up: the app window starts it on its own, and if the system blocks audio until you interact with the window, it starts on your first click or key press. (It lives in the app window itself — `src/components/AudioKeepAlive.vue`, mounted once by the main shell.)
