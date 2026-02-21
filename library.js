/**
 * library.js — X Stream & Play
 * Video library management: localStorage persistence, compact card rendering,
 * real metadata loading (duration via hidden video, file size via HEAD request).
 */

import { loadVideo } from './player.js';

// ── State ──────────────────────────────────────────────────────────────────
let videos      = JSON.parse(localStorage.getItem('xstream_videos') || '[]');
let unknownCount = parseInt(localStorage.getItem('xstream_unk') || '0', 10);
let activeId    = null;

// Cache for fetched metadata: id → { duration, size, hasLoaded }
const metaCache = {};

// ── DOM Refs ───────────────────────────────────────────────────────────────
let urlInput, addBtn, videoList, countBadge, clearAllBtn;

// ─────────────────────────────────────────────────────────────────────────
export function initLibrary() {
  urlInput    = document.getElementById('urlInput');
  addBtn      = document.getElementById('addBtn');
  videoList   = document.getElementById('videoList');
  countBadge  = document.getElementById('countBadge');
  clearAllBtn = document.getElementById('clearAllBtn');

  addBtn.addEventListener('click', addVideo);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addVideo(); });
  clearAllBtn.addEventListener('click', clearAll);

  render();
}

// ─── Add video ─────────────────────────────────────────────────────────────
function addVideo() {
  const url = urlInput.value.trim();
  if (!url) { showToast('Please enter a video URL.', 'error'); return; }

  // Duplicate guard
  if (videos.some(v => v.url === url)) {
    showToast('This URL is already in your library.', 'error');
    return;
  }

  let title = extractTitle(url);
  if (!title || title.length < 2) {
    unknownCount++;
    title = 'Untitled Stream ' + unknownCount;
  }

  const entry = {
    id: Date.now(),
    title,
    url,
    addedAt: Date.now(),
  };

  videos.unshift(entry);
  _save();
  urlInput.value = '';
  render();
  showToast('Added: ' + title, 'success');

  // Asynchronously fetch metadata for the new card
  _loadMeta(entry.id, url);
}

// ─── Delete video ──────────────────────────────────────────────────────────
function deleteVideo(id) {
  if (activeId === id) {
    document.getElementById('videoPlayer').src = '';
    document.getElementById('playerWrap').classList.remove('visible');
    activeId = null;
  }
  videos = videos.filter(v => v.id !== id);
  delete metaCache[id];
  _save();
  render();
  showToast('Video removed.');
}

// ─── Play video ────────────────────────────────────────────────────────────
function playVideo(id) {
  const v = videos.find(v => v.id === id);
  if (!v) return;
  activeId = id;
  loadVideo(v.url, v.title);
  render(); // update active state on cards
}

// ─── Clear all ─────────────────────────────────────────────────────────────
function clearAll() {
  if (!videos.length) return;
  if (!confirm('Remove all videos from the library?')) return;
  videos = [];
  unknownCount = 0;
  activeId = null;
  document.getElementById('playerWrap').classList.remove('visible');
  document.getElementById('videoPlayer').src = '';
  _save();
  render();
  showToast('Library cleared.');
}

// ─── Render the compact library list ──────────────────────────────────────
function render() {
  const n = videos.length;
  countBadge.textContent = `${n} video${n !== 1 ? 's' : ''}`;
  clearAllBtn.style.display = n > 0 ? '' : 'none';

  if (!n) {
    videoList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
        </div>
        <h3>Your library is empty</h3>
        <p>Paste a direct video URL above to get started.</p>
      </div>`;
    return;
  }

  videoList.innerHTML = videos.map((v, idx) => {
    const meta     = metaCache[v.id] || {};
    const duration = meta.duration ? _fmtDur(meta.duration) : '–';
    const size     = meta.size     ? _fmtSize(meta.size)    : '';
    const isActive = v.id === activeId;
    const format   = _guessFormat(v.url);

    const sizeChip = size
      ? `<span class="card-meta-chip">${size}</span>`
      : '';

    return `
      <div class="video-card${isActive ? ' active' : ''}"
           data-id="${v.id}"
           style="animation-delay:${Math.min(idx * 0.04, 0.3)}s"
           onclick="window.__xLib.play(${v.id})">

        <div class="card-thumb">
          <div class="thumb-play-ring">
            <svg width="10" height="12" viewBox="0 0 12 14">
              <path d="M1 1l10 6L1 13V1z"/>
            </svg>
          </div>
        </div>

        <div class="card-info">
          <div class="card-title" title="${escHtml(v.title)}">${escHtml(v.title)}</div>
          <div class="card-meta">
            <span class="card-badge">${escHtml(format)}</span>
            <span class="card-meta-chip">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${duration}
            </span>
            ${sizeChip}
          </div>
        </div>

        <div class="card-actions" onclick="event.stopPropagation()">
          <button class="card-btn card-btn-play" onclick="window.__xLib.play(${v.id})" title="Play">
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><path d="M1 1l10 6L1 13V1z"/></svg>
          </button>
          <button class="card-btn card-btn-del" onclick="window.__xLib.del(${v.id})" title="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  // Expose library actions to inline onclick handlers
  window.__xLib = { play: playVideo, del: deleteVideo };

  // Load metadata for any card that hasn't been fetched yet
  videos.forEach(v => {
    if (!metaCache[v.id]) _loadMeta(v.id, v.url);
  });
}

// ─── Asynchronously fetch duration + file size ────────────────────────────
function _loadMeta(id, url) {
  metaCache[id] = metaCache[id] || {};
  if (metaCache[id].hasLoaded) return;
  metaCache[id].hasLoaded = true;

  // 1. File size via HEAD request (works for direct files, not for HLS/DASH)
  const ext = _getExt(url);
  if (!['m3u8','mpd'].includes(ext)) {
    fetch(url, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('content-length');
        if (cl && parseInt(cl, 10) > 0) {
          metaCache[id].size = parseInt(cl, 10);
          _updateCard(id);
        }
      })
      .catch(() => { /* HEAD requests may fail due to CORS — skip */ });
  }

  // 2. Duration via hidden video element with src preload=metadata
  // Only for direct video files (not HLS/DASH to avoid heavy loading)
  if (!['m3u8','mpd'].includes(ext)) {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted   = true;
    probe.style.display = 'none';
    probe.src = url;

    probe.addEventListener('loadedmetadata', () => {
      if (probe.duration && isFinite(probe.duration)) {
        metaCache[id].duration = probe.duration;
        _updateCard(id);
      }
      probe.src = '';
      probe.remove();
    });
    probe.addEventListener('error', () => {
      probe.src = '';
      probe.remove();
    });

    // Self-cleanup after 15s to avoid leaks
    setTimeout(() => { probe.src = ''; probe.remove(); }, 15000);
    document.body.appendChild(probe);
  }
}

// Update a single card in the DOM without full re-render
function _updateCard(id) {
  const card = videoList.querySelector(`[data-id="${id}"]`);
  if (!card) return;

  const meta = metaCache[id] || {};
  const metaEl = card.querySelector('.card-meta');
  if (!metaEl) return;

  // Update duration chip
  const chips = metaEl.querySelectorAll('.card-meta-chip');
  if (chips[0] && meta.duration) {
    chips[0].innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.5">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      ${_fmtDur(meta.duration)}`;
  }

  // Append size chip if not already present
  if (meta.size && chips.length < 2) {
    const sizeChip = document.createElement('span');
    sizeChip.className = 'card-meta-chip';
    sizeChip.textContent = _fmtSize(meta.size);
    metaEl.appendChild(sizeChip);
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────
function _save() {
  localStorage.setItem('xstream_videos',  JSON.stringify(videos));
  localStorage.setItem('xstream_unk',     String(unknownCount));
}

// ─── Title extraction (preserved from original) ───────────────────────────
function extractTitle(url) {
  try {
    const u = new URL(url);
    const disp = u.searchParams.get('response-content-disposition');
    if (disp) {
      const decoded = decodeURIComponent(disp);
      const m = decoded.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)/i);
      if (m && m[1].trim()) return _clean(m[1].trim());
      const bare = decoded.replace(/^(attachment|inline);\s*/i, '').trim();
      if (bare && !bare.includes('=') && bare.length > 1) return _clean(bare);
    }
    const seg = decodeURIComponent(u.pathname).split('/').filter(Boolean).pop();
    if (seg && seg.length > 2) return _clean(seg);
  } catch (_) {}
  return null;
}

function _clean(raw) {
  return raw
    .replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mpeg|mpg|ogv|3gp|rmvb|vob|divx|m3u8|mpd)$/i, '')
    .replace(/[._-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Utility ──────────────────────────────────────────────────────────────
function _fmtDur(sec) {
  if (!isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function _fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

function _getExt(url) {
  try {
    const path = new URL(url).pathname;
    return path.split('.').pop().toLowerCase().split('?')[0];
  } catch (_) {
    return url.split('.').pop().toLowerCase().split('?')[0];
  }
}

function _guessFormat(url) {
  const ext = _getExt(url);
  const map  = {
    'm3u8': 'HLS', 'mpd': 'DASH',
    'mp4': 'MP4',  'mkv': 'MKV',
    'webm': 'WebM', 'avi': 'AVI',
    'mov': 'MOV',  'ts': 'TS',
    'flv': 'FLV',  'm4v': 'M4V',
  };
  return map[ext] || ext.toUpperCase() || 'VIDEO';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Toast ────────────────────────────────────────────────────────────────
export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3500);
}
