// SPDX-License-Identifier: MIT
/**
 * playerStore — global audio playback state.
 * AudioPlayer.vue (when built) reads from here; any view can trigger playback
 * via setAudioWithAutoPlay().
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export const usePlayerStore = defineStore("player", () => {
  const audioUrl = ref(null);
  const audioId = ref(null);
  const profileId = ref(null);
  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const volume = ref(1);
  const isLooping = ref(false);
  const shouldAutoPlay = ref(false);
  const shouldRestart = ref(false);

  function setAudio({ url, id, profile_id = null }) {
    audioUrl.value = url;
    audioId.value = id;
    profileId.value = profile_id;
    shouldAutoPlay.value = false;
    currentTime.value = 0;
    duration.value = 0;
  }
  function setAudioWithAutoPlay({ url, id, profile_id = null }) {
    setAudio({ url, id, profile_id });
    shouldAutoPlay.value = true;
  }
  function clearAutoPlayFlag() {
    shouldAutoPlay.value = false;
  }
  function setIsPlaying(v) {
    isPlaying.value = v;
  }
  function setCurrentTime(v) {
    currentTime.value = v;
  }
  function setDuration(v) {
    duration.value = v;
  }
  function setVolume(v) {
    volume.value = v;
  }
  function toggleLoop() {
    isLooping.value = !isLooping.value;
  }
  function reset() {
    audioUrl.value = null;
    audioId.value = null;
    profileId.value = null;
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    shouldAutoPlay.value = false;
    shouldRestart.value = false;
  }

  return {
    audioUrl,
    audioId,
    profileId,
    isPlaying,
    currentTime,
    duration,
    volume,
    isLooping,
    shouldAutoPlay,
    shouldRestart,
    setAudio,
    setAudioWithAutoPlay,
    clearAutoPlayFlag,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    toggleLoop,
    reset,
  };
});
