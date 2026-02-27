/**
 * hls-config.js — X Stream & Play
 * HLS.js configuration exposed as window.HLS_CONFIG.
 * player.js reads this before initialising HLS.js.
 *
 * Tuned for smooth adaptive-bitrate playback across mobile and desktop.
 * Adjust values as needed for your CDN / network environment.
 */

window.HLS_CONFIG = {
  // Worker thread for faster demux
  enableWorker: true,

  // Buffer goal: try to keep 30s ahead (reduces stalls on fast connections)
  maxBufferLength: 30,
  maxMaxBufferLength: 60,

  // Back buffer (seconds to keep behind current position)
  backBufferLength: 30,

  // Bandwidth estimation: bias toward picking lower quality initially (0 = conservative, 1 = aggressive)
  abrBandWidthFactor: 0.95,
  abrBandWidthUpFactor: 0.7,

  // Error recovery
  fragLoadingMaxRetry: 6,
  manifestLoadingMaxRetry: 4,
  levelLoadingMaxRetry: 4,

  // Start at lowest quality level for fast initial load, then ramp up
  startLevel: -1,   // -1 = auto

  // Cap level selection to avoid unnecessary resolution jumps
  capLevelToPlayerSize: true,

  // Low-latency disabled by default (enable for live streams if needed)
  lowLatencyMode: false,

  // Debug logging (set true to see HLS.js logs in console)
  debug: false,
};
