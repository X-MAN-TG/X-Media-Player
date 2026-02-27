/**
 * player.js — X Stream & Play
 * Custom HTML5 video player: controls, stats panel, keyboard shortcuts,
 * HLS/DASH/MP4 playback. Real stats only — no fake data.
 */

// ── Module-level state ────────────────────────────────────────────────────
let hlsInstance   = null;  // Active HLS.js instance (if any)
let statsInterval = null;  // setInterval handle for stats updates
let hideTimer     = null;  // Timeout handle for controls auto-hide
let isDragging    = false; // Scrubber drag state
let lastTap       = 0;     // For double-tap detection on mobile

// DOM refs (assigned in initPlayer)
let video, container, controls, spinner, errorOverlay, errorMsg,
    playPauseBtn, seekBackBtn, seekFwdBtn, muteBtn, volumeSlider,
    speedSelect, pipBtn, fullscreenBtn,
    progressBar, bufferBar, playedBar, progressThumb, timeDisplay,
    statsToggleBtn, statsPanel, statsCloseBtn, statsBody,
    seekIndBack, seekIndFwd;

// ─────────────────────────────────────────────────────────────────────────
export function initPlayer() {
  // Gather DOM references
  video         = document.getElementById('videoPlayer');
  container     = document.getElementById('playerContainer');
  controls      = document.getElementById('playerControls');
  spinner       = document.getElementById('playerSpinner');
  errorOverlay  = document.getElementById('playerError');
  errorMsg      = document.getElementById('playerErrorMsg');
  playPauseBtn  = document.getElementById('playPauseBtn');
  seekBackBtn   = document.getElementById('seekBackBtn');
  seekFwdBtn    = document.getElementById('seekFwdBtn');
  muteBtn       = document.getElementById('muteBtn');
  volumeSlider  = document.getElementById('volumeSlider');
  speedSelect   = document.getElementById('speedSelect');
  pipBtn        = document.getElementById('pipBtn');
  fullscreenBtn = document.getElementById('fullscreenBtn');
  progressBar   = document.getElementById('progressBar');
  bufferBar     = document.getElementById('bufferBar');
  playedBar     = document.getElementById('playedBar');
  progressThumb = document.getElementById('progressThumb');
  timeDisplay   = document.getElementById('timeDisplay');
  statsToggleBtn= document.getElementById('statsToggleBtn');
  statsPanel    = document.getElementById('statsPanel');
  statsCloseBtn = document.getElementById('statsCloseBtn');
  statsBody     = document.getElementById('statsBody');
  seekIndBack   = document.getElementById('seekIndBack');
  seekIndFwd    = document.getElementById('seekIndFwd');

  // Show PiP button only if supported
  if (document.pictureInPictureEnabled) {
    pipBtn.style.display = 'flex';
  }

  _bindVideoEvents();
  _bindControlEvents();
  _bindKeyboard();
  _bindPointerControls();
  _bindMobileGestures();
}

// ─── Load a new video (called from library.js) ────────────────────────────
export function loadVideo(url, title) {
  _destroyHls();
  clearStats();
  hideError();
  showSpinner();

  document.getElementById('playerTitle').textContent = title || 'Untitled';
  const wrap = document.getElementById('playerWrap');
  wrap.classList.add('visible');
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const ext = _getExt(url);

  // Reset muted state for autoplay to work on mobile
  video.muted = true;
  video.volume = 1;

  if (ext === 'm3u8' || url.includes('.m3u8')) {
    _loadHls(url);
  } else if (ext === 'mpd' || url.includes('.mpd')) {
    // DASH: load natively (browser may support it)
    video.src = url;
    video.load();
    video.play().catch(() => {});
  } else {
    // Plain MP4 / WebM / etc.
    video.muted = false;
    video.volume = 1;
    video.src = url;
    video.load();
    video.play().catch(() => {});
  }

// ─── HLS loader ──────────────────────────────────────────────────────────
function _loadHls(url) {
  if (typeof Hls === 'undefined') {
    // Fallback: try native HLS (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    } else {
      showError('HLS.js failed to load. Check your connection.');
    }
    return;
  }

  if (!Hls.isSupported()) {
    // Safari native
    video.src = url;
    video.play().catch(() => {});
    return;
  }

  // Use hls-config.js if available (imported separately), else defaults
  const config = (window.HLS_CONFIG) ? window.HLS_CONFIG : {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 90,
  };

  hlsInstance = new Hls(config);
  hlsInstance.loadSource(url);
  hlsInstance.attachMedia(video);

  hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
    // Force audio track selection — fixes Android silent video bug
    if (hlsInstance.audioTracks && hlsInstance.audioTracks.length > 0) {
      hlsInstance.audioTrack = 0;
    }
    // Unmute explicitly before play — Android may auto-mute on programmatic play
    video.muted = false;
    video.volume = 1;
    video.play().catch(() => {});
  });

  hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hlsInstance.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hlsInstance.recoverMediaError();
          break;
        default:
          showError('HLS fatal error: ' + (data.details || 'unknown'));
          break;
      }
    }
  });
}

hlsInstance.on(Hls.Events.AUDIO_TRACK_LOADED, () => {
    if (hlsInstance.audioTrack < 0 && hlsInstance.audioTracks.length > 0) {
      hlsInstance.audioTrack = 0;
    }
  });

function _destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  video.removeAttribute('src');
  video.load();
}

// ─── Video element events ─────────────────────────────────────────────────
function _bindVideoEvents() {
  video.addEventListener('waiting',     showSpinner);
  video.addEventListener('playing',     () => { hideSpinner(); hideError(); _setPlayIcon(false); _scheduleUnmute(); });
  video.addEventListener('pause',       () => _setPlayIcon(true));
  video.addEventListener('play',        () => { _setPlayIcon(false); _scheduleUnmute(); });
  video.addEventListener('ended',       () => _setPlayIcon(true));
  video.addEventListener('error',       _onVideoError);
  video.addEventListener('canplay',     hideSpinner);
  video.addEventListener('loadeddata',  hideSpinner);

  video.addEventListener('timeupdate', _onTimeUpdate);
  video.addEventListener('progress',   _onProgress);
  video.addEventListener('volumechange', _onVolumeChange);

  // Fullscreen change
  document.addEventListener('fullscreenchange',       _onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', _onFullscreenChange);
}

function _onVideoError() {
  hideSpinner();
  const err = video.error;
  const msgs = {
    1: 'Playback aborted.',
    2: 'Network error. Check the URL and your connection.',
    3: 'Decoding error. Format may be unsupported.',
    4: 'Source not supported or URL is invalid.',
  };
  showError(err ? (msgs[err.code] || 'Unknown error.') : 'Could not load video.');
}

// ─── Time update → scrubber & time display ────────────────────────────────
function _onTimeUpdate() {
  if (isDragging || !video.duration) return;

  const pct = (video.currentTime / video.duration) * 100;
  playedBar.style.width  = pct + '%';
  progressThumb.style.left = pct + '%';
  timeDisplay.textContent = `${_fmt(video.currentTime)} / ${_fmt(video.duration)}`;
}

// Buffer bar
function _onProgress() {
  if (!video.duration || !video.buffered.length) return;
  const end = video.buffered.end(video.buffered.length - 1);
  bufferBar.style.width = (end / video.duration * 100) + '%';
}

// Volume icon
function _onVolumeChange() {
  const muted = video.muted || video.volume === 0;
  muteBtn.querySelector('.icon-vol-on').classList.toggle('hidden', muted);
  muteBtn.querySelector('.icon-vol-off').classList.toggle('hidden', !muted);
  if (!isDragging) volumeSlider.value = muted ? 0 : video.volume;
}

// Fullscreen icon swap
function _onFullscreenChange() {
  const fs = !!document.fullscreenElement || !!document.webkitFullscreenElement;
  fullscreenBtn.querySelector('.icon-fs-enter').classList.toggle('hidden', fs);
  fullscreenBtn.querySelector('.icon-fs-exit').classList.toggle('hidden', !fs);
}

// ─── Control button events ────────────────────────────────────────────────
function _bindControlEvents() {
  // Play/Pause
  playPauseBtn.addEventListener('click', togglePlayPause);

  // Click on video center → play/pause (not double-tap area)
  video.addEventListener('click', togglePlayPause);

  // Seek
  seekBackBtn.addEventListener('click', () => seek(-10));
  seekFwdBtn.addEventListener('click',  () => seek(+10));

  // Mute
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
  });

  // Volume
  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value);
    video.muted  = video.volume === 0;
  });

  // Speed
  speedSelect.addEventListener('change', () => {
    video.playbackRate = parseFloat(speedSelect.value);
  });

  // PiP
  pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (e) { /* unsupported */ }
  });

  // Fullscreen
  fullscreenBtn.addEventListener('click', toggleFullscreen);

  // Stats panel
  statsToggleBtn.addEventListener('click', toggleStats);
  statsCloseBtn.addEventListener('click', closeStats);

  // Scrubber (progress bar)
  progressBar.addEventListener('mousedown', _scrubStart);
  progressBar.addEventListener('touchstart', _scrubStart, { passive: true });
}

// ─── Scrubber drag ────────────────────────────────────────────────────────
function _scrubStart(e) {
  isDragging = true;
  _scrubMove(e);
  window.addEventListener('mousemove', _scrubMove);
  window.addEventListener('mouseup',   _scrubEnd);
  window.addEventListener('touchmove', _scrubMove, { passive: true });
  window.addEventListener('touchend',  _scrubEnd);
}

function _scrubMove(e) {
  if (!isDragging) return;
  const rect = progressBar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const pct = ratio * 100;
  playedBar.style.width    = pct + '%';
  progressThumb.style.left = pct + '%';
  if (video.duration) {
    timeDisplay.textContent = `${_fmt(ratio * video.duration)} / ${_fmt(video.duration)}`;
  }
}

function _scrubEnd(e) {
  if (!isDragging) return;
  isDragging = false;
  window.removeEventListener('mousemove', _scrubMove);
  window.removeEventListener('mouseup',   _scrubEnd);
  window.removeEventListener('touchmove', _scrubMove);
  window.removeEventListener('touchend',  _scrubEnd);

  const rect = progressBar.getBoundingClientRect();
  const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (video.duration) {
    video.currentTime = ratio * video.duration;
  }
}

// ─── Controls auto-hide on inactivity ────────────────────────────────────
function _bindPointerControls() {
  function revealControls() {
    controls.classList.remove('hidden');
    container.classList.remove('hide-cursor');
    clearTimeout(hideTimer);
    if (!video.paused) {
      hideTimer = setTimeout(() => {
        controls.classList.add('hidden');
        container.classList.add('hide-cursor');
      }, 3000);
    }
  }

  container.addEventListener('mousemove',  revealControls);
  container.addEventListener('touchstart', revealControls, { passive: true });
  container.addEventListener('mouseleave', () => {
    if (!video.paused) controls.classList.add('hidden');
  });

  // Keep controls visible when interacting with them
  controls.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  controls.addEventListener('mouseleave', revealControls);
}

// ─── Mobile double-tap seek ───────────────────────────────────────────────
function _bindMobileGestures() {
  container.addEventListener('touchend', (e) => {
    if (e.target.closest('.player-controls')) return;

    const now   = Date.now();
    const delta = now - lastTap;
    lastTap = now;

    if (delta < 300 && delta > 0) {
      // Double-tap detected
      const rect   = container.getBoundingClientRect();
      const touchX = e.changedTouches[0].clientX;
      const relX   = (touchX - rect.left) / rect.width;

      if (relX < 0.4) {
        seek(-10);
        _flashSeekInd(seekIndBack);
      } else if (relX > 0.6) {
        seek(+10);
        _flashSeekInd(seekIndFwd);
      }
      e.preventDefault();
    }
  }, { passive: false });
}

function _flashSeekInd(el) {
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 700);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────
function _bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in an input
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (!document.getElementById('playerWrap').classList.contains('visible')) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seek(+10);
        _flashSeekInd(seekIndFwd);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seek(-10);
        _flashSeekInd(seekIndBack);
        break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        volumeSlider.value = video.volume;
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        volumeSlider.value = video.volume;
        break;
      case 'KeyM':
        video.muted = !video.muted;
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyI':
        toggleStats();
        break;
    }
  });
}

// ─── Player actions ───────────────────────────────────────────────────────
export function togglePlayPause() {
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
}

export function seek(secs) {
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + secs));
}

export function toggleFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (container.requestFullscreen || container.webkitRequestFullscreen).call(container);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
}

// ─── Play/Pause icon swap ─────────────────────────────────────────────────
function _setPlayIcon(isPaused) {
  playPauseBtn.querySelector('.icon-play').classList.toggle('hidden', !isPaused);
  playPauseBtn.querySelector('.icon-pause').classList.toggle('hidden', isPaused);
}

// ─── Stats panel ─────────────────────────────────────────────────────────
export function toggleStats() {
  const isActive = statsPanel.classList.contains('active');
  if (isActive) {
    closeStats();
  } else {
    openStats();
  }
}

function openStats() {
  statsPanel.classList.add('active');
  statsToggleBtn.classList.add('active');
  updateStats();
  statsInterval = setInterval(updateStats, 1000);
}

export function closeStats() {
  statsPanel.classList.remove('active');
  statsToggleBtn.classList.remove('active');
  clearInterval(statsInterval);
  statsInterval = null;
}

function clearStats() {
  closeStats();
  statsBody.innerHTML = '';
}

// Build real-time stats rows from video element + HLS.js APIs
function updateStats() {
  const rows = [];

  // ── Provider (static) ─────────────────────────────────────────
  rows.push({ k: 'Provider', v: 'X Stream & Play' });
  rows.push({ divider: true });

  // ── Resolution ────────────────────────────────────────────────
  if (video.videoWidth && video.videoHeight) {
    rows.push({ k: 'Resolution', v: `${video.videoWidth} × ${video.videoHeight}` });
  }

  // ── Viewport size ─────────────────────────────────────────────
  rows.push({ k: 'Viewport', v: `${window.innerWidth} × ${window.innerHeight}` });

  // ── Playback rate ─────────────────────────────────────────────
  if (video.playbackRate != null) {
    rows.push({ k: 'Playback Rate', v: `${video.playbackRate}×` });
  }

  // ── Current time / duration ───────────────────────────────────
  if (video.duration) {
    rows.push({ k: 'Time', v: `${_fmt(video.currentTime)} / ${_fmt(video.duration)}` });
  }

  // ── Buffer health (seconds ahead) ────────────────────────────
  const bufferHealth = _getBufferAhead();
  if (bufferHealth !== null) {
    rows.push({ k: 'Buffer Health', v: `${bufferHealth.toFixed(1)} s` });
  }

  // ── Dropped frames (from getVideoPlaybackQuality) ─────────────
  if (typeof video.getVideoPlaybackQuality === 'function') {
    const q = video.getVideoPlaybackQuality();
    if (q.totalVideoFrames > 0) {
      rows.push({ divider: true });
      rows.push({ k: 'Total Frames',   v: q.totalVideoFrames });
      rows.push({ k: 'Dropped Frames', v: q.droppedVideoFrames });
      const dropPct = ((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2);
      rows.push({ k: 'Drop Rate',      v: `${dropPct}%` });
    }
  }

  // ── HLS-specific stats from HLS.js ────────────────────────────
  if (hlsInstance) {
    rows.push({ divider: true });

    const level = hlsInstance.levels?.[hlsInstance.currentLevel];
    if (level) {
      if (level.bitrate) {
        rows.push({ k: 'Bitrate',    v: _kbps(level.bitrate) });
      }
      if (level.width && level.height) {
        rows.push({ k: 'HLS Level',  v: `${level.width}×${level.height}` });
      }
      if (level.audioCodec) {
        rows.push({ k: 'Audio Codec', v: level.audioCodec });
      }
      if (level.videoCodec) {
        rows.push({ k: 'Video Codec', v: level.videoCodec });
      }
    }

    // HLS bandwidth estimate
    const bw = hlsInstance.bandwidthEstimate;
    if (bw && isFinite(bw)) {
      rows.push({ k: 'Est. Bandwidth', v: _kbps(bw) });
    }

    // Loader stats from latest fragment
    try {
      const fragStats = hlsInstance.mainForwardBufferInfo;
      if (fragStats && fragStats.len != null) {
        rows.push({ k: 'Frag Buffer', v: `${fragStats.len.toFixed(1)} s` });
      }
    } catch (_) {}
  }

  // ── Network downlink (if browser exposes it) ──────────────────
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    if (conn.downlink != null) {
      rows.push({ divider: true });
      rows.push({ k: 'Network Downlink', v: `${conn.downlink} Mbps` });
    }
    if (conn.effectiveType) {
      rows.push({ k: 'Connection Type', v: conn.effectiveType });
    }
  }

  // ── Render rows ───────────────────────────────────────────────
  statsBody.innerHTML = rows.map(r => {
    if (r.divider) return `<div class="stat-divider"></div>`;
    return `
      <div class="stat-row">
        <span class="stat-key">${escHtml(r.k)}</span>
        <span class="stat-val">${escHtml(String(r.v))}</span>
      </div>`;
  }).join('');
}

// ─── Buffer ahead helper ──────────────────────────────────────────────────
function _getBufferAhead() {
  if (!video.buffered || !video.buffered.length) return null;
  const ct = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= ct && ct <= video.buffered.end(i)) {
      return video.buffered.end(i) - ct;
    }
  }
  return null;
}

// ─── Spinner / Error helpers ──────────────────────────────────────────────
export function showSpinner() { spinner.classList.add('active'); }
export function hideSpinner() { spinner.classList.remove('active'); }

export function showError(msg) {
  hideSpinner();
  errorMsg.textContent = msg || 'Could not load video.';
  errorOverlay.classList.add('active');
}

function hideError() { errorOverlay.classList.remove('active'); }

// ─── Unmute helper ───────────────────────────────────────────────────────
let unmutePending = false;
function _scheduleUnmute() {
  if (unmutePending) return;
  unmutePending = true;
  
  // Wait a tiny bit for browser to trust user interaction, then unmute
  setTimeout(() => {
    try {
      if (!video.paused && video.currentTime > 0.1) {
        video.muted = false;
      }
    } catch (_) {}
    unmutePending = false;
  }, 100);
}

// ─── Utility ──────────────────────────────────────────────────────────────
function _fmt(sec) {
  if (!isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function _kbps(bps) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000)     return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps} bps`;
}

function _getExt(url) {
  try {
    const path = new URL(url).pathname;
    return path.split('.').pop().toLowerCase().split('?')[0];
  } catch(_) {
    return url.split('.').pop().toLowerCase().split('?')[0];
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
