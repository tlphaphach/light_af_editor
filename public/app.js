(() => {
  'use strict';

  // --- State ---
  const state = {
    library: [],
    filter: 'all',
    search: '',
    project: {
      id: null,
      name: 'Untitled Video',
      width: 1280,
      height: 720,
      fps: 30,
      clips: [],
    },
    selectedClipId: null,
    playhead: 0,
    isPlaying: false,
    pxPerSec: 50,
    snap: true,
    editingLibId: null,
  };

  // Media element pool keyed by clip.id
  const mediaPool = new Map();
  let rafId = null;
  let lastFrameTime = 0;

  // --- DOM Refs ---
  const $ = (id) => document.getElementById(id);
  const previewCanvas = $('previewCanvas');
  const ctx = previewCanvas.getContext('2d');
  const previewEmptyHint = $('previewEmptyHint');
  const timecodeDisplay = $('timecodeDisplay');
  const playheadEl = $('playhead');
  const timelineCanvas = $('timelineCanvas');
  const timelineScroll = $('timelineScroll');
  const timeRuler = $('timeRuler');
  const libraryGrid = $('libraryGrid');
  const libraryCount = $('libraryCount');
  const libraryDropzone = $('libraryDropzone');

  // --- Helpers ---
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function formatTime(sec) {
    const s = Math.max(0, sec || 0);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${rem}`;
  }

  function showToast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function getLibItem(id) {
    return state.library.find((i) => i.id === id) || null;
  }

  function getProjectDuration() {
    let max = 0;
    for (const c of state.project.clips) {
      const end = c.start + c.duration;
      if (end > max) max = end;
    }
    return max;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderMediaProps(container, item) {
    if (!container || !item) {
      if (container) container.innerHTML = '';
      return;
    }
    const ext = (item.originalName || item.filename || '').split('.').pop().toUpperCase() || item.mediaType.toUpperCase();
    const res = item.width && item.height ? `${item.width} × ${item.height}` : '—';
    const streams = [item.hasVideo ? 'Video' : null, item.hasAudio ? 'Audio' : null].filter(Boolean).join(' + ') || item.mediaType;
    container.innerHTML = `
      <div class="prop-row"><span class="prop-key">Format</span><span class="prop-val">${escapeHtml(ext)} (${escapeHtml(item.mediaType)})</span></div>
      <div class="prop-row"><span class="prop-key">Resolution</span><span class="prop-val">${escapeHtml(res)}</span></div>
      <div class="prop-row"><span class="prop-key">Duration</span><span class="prop-val">${formatTime(item.duration)}</span></div>
      <div class="prop-row"><span class="prop-key">Size</span><span class="prop-val">${formatBytes(item.size)}</span></div>
      <div class="prop-row"><span class="prop-key">Streams</span><span class="prop-val">${escapeHtml(streams)}</span></div>
    `;
  }

  // --- Heartbeat & Pending Explorer Imports ---
  fetch('/api/ping', { method: 'POST' }).catch(() => {});
  setInterval(() => {
    fetch('/api/ping', { method: 'POST' }).catch(() => {});
  }, 5000);
  setInterval(async () => {
    try {
      const r = await fetch('/api/pending-imports');
      if (!r.ok) return;
      const { ids } = await r.json();
      if (ids && ids.length) {
        await loadLibrary();
        for (const id of ids) {
          const item = getLibItem(id);
          if (item) {
            addLibraryItemToTimeline(item);
            showToast(`Imported "${item.name}" from Explorer!`);
          }
        }
      }
    } catch {}
  }, 2000);
  window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/shutdown');
  });

  // --- Library API & Rendering ---
  async function loadLibrary() {
    const res = await fetch('/api/library');
    const data = await res.json();
    state.library = data.items || [];
    renderLibrary();
  }

  async function handleInitialImportParam() {
    const params = new URLSearchParams(window.location.search);
    const importId = params.get('import');
    if (!importId) return;
    const item = getLibItem(importId);
    if (item) {
      addLibraryItemToTimeline(item, null, 0);
      showToast(`Loaded "${item.name}" from Explorer!`);
    }
    history.replaceState(null, '', '/');
  }

  async function uploadFilesToLibrary(files, defaultCategory = 'auto') {
    const list = Array.from(files || []);
    if (!list.length) return [];
    const uploaded = [];
    showToast(`Adding ${list.length} file(s) to Library...`, 4000);

    for (const file of list) {
      try {
        const res = await fetch('/api/library/upload', {
          method: 'POST',
          headers: {
            'X-Filename': encodeURIComponent(file.name),
            'X-Category': defaultCategory,
          },
          body: file,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        state.library.unshift(data.item);
        uploaded.push(data.item);
      } catch (err) {
        console.error(err);
        showToast(`Failed to add ${file.name}`);
      }
    }

    renderLibrary();
    if (uploaded.length) {
      showToast(`Saved ${uploaded.length} item(s) to persistent Library!`);
    }
    return uploaded;
  }

  function renderLibrary() {
    libraryCount.textContent = String(state.library.length);
    const q = state.search.trim().toLowerCase();

    const filtered = state.library.filter((item) => {
      if (state.filter === 'fav' && !item.favorite) return false;
      if (state.filter !== 'all' && state.filter !== 'fav' && item.category !== state.filter) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
      return true;
    });

    libraryGrid.innerHTML = '';
    for (const item of filtered) {
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.draggable = true;
      card.dataset.libId = item.id;

      const thumbHtml = item.thumb
        ? `<img src="/thumbs/${item.thumb}" alt="${escapeHtml(item.name)}" loading="lazy" />`
        : `<div class="lib-audio-icon">${item.mediaType === 'audio' ? '🔊' : '🎬'}</div>`;

      card.innerHTML = `
        <div class="lib-thumb">
          ${thumbHtml}
          <span class="lib-cat-tag">${escapeHtml(item.category)}</span>
          <button class="lib-fav-btn ${item.favorite ? 'active' : ''}" title="Favorite">★</button>
          <span class="lib-dur">${formatTime(item.duration)}</span>
        </div>
        <div class="lib-meta">
          <div class="lib-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="lib-actions">
            <button data-act="preview" title="Quick Preview">▶</button>
            <button data-act="add" title="Add to Timeline at Playhead">+ Add</button>
            <button data-act="edit" title="Rename / Category / Delete">⋯</button>
          </div>
        </div>
      `;

      // Drag start from library
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-lightaf-lib', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      // Double click adds to timeline
      card.addEventListener('dblclick', () => addLibraryItemToTimeline(item));

      // Favorite toggle
      card.querySelector('.lib-fav-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextFav = !item.favorite;
        item.favorite = nextFav;
        renderLibrary();
        await fetch(`/api/library/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorite: nextFav }),
        });
      });

      // Card buttons
      card.querySelector('[data-act="preview"]').addEventListener('click', (e) => {
        e.stopPropagation();
        previewLibraryItem(item);
      });
      card.querySelector('[data-act="add"]').addEventListener('click', (e) => {
        e.stopPropagation();
        addLibraryItemToTimeline(item);
      });
      card.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openLibEditModal(item);
      });

      libraryGrid.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Library Quick Preview ---
  function previewLibraryItem(item) {
    const bar = $('libPreviewBar');
    const vid = $('libPreviewVideo');
    const aud = $('libPreviewAudio');
    $('libPreviewName').textContent = item.name;
    bar.classList.remove('hidden');

    vid.pause();
    aud.pause();

    if (item.mediaType === 'audio') {
      vid.classList.add('hidden');
      aud.src = `/media/${item.filename}`;
      aud.currentTime = 0;
      aud.play().catch(() => {});
    } else if (item.mediaType === 'video') {
      vid.classList.remove('hidden');
      vid.src = `/media/${item.filename}`;
      vid.currentTime = 0;
      vid.play().catch(() => {});
    } else {
      vid.classList.add('hidden');
    }
  }

  function stopLibraryPreview() {
    $('libPreviewVideo').pause();
    $('libPreviewAudio').pause();
    $('libPreviewBar').classList.add('hidden');
  }

  // --- Library Edit Modal ---
  function openLibEditModal(item) {
    state.editingLibId = item.id;
    $('libEditName').value = item.name;
    $('libEditCategory').value = item.category;
    renderMediaProps($('libEditProps'), item);
    $('libEditModal').classList.remove('hidden');
  }

  $('btnCloseLibEdit').addEventListener('click', () => $('libEditModal').classList.add('hidden'));
  $('btnLibEditSave').addEventListener('click', async () => {
    const id = state.editingLibId;
    if (!id) return;
    const name = $('libEditName').value.trim();
    const category = $('libEditCategory').value;
    const res = await fetch(`/api/library/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category }),
    });
    if (res.ok) {
      const { item } = await res.json();
      const idx = state.library.findIndex((i) => i.id === id);
      if (idx !== -1) state.library[idx] = item;
      renderLibrary();
      renderTimeline();
    }
    $('libEditModal').classList.add('hidden');
  });

  $('btnLibEditDelete').addEventListener('click', async () => {
    const id = state.editingLibId;
    if (!id) return;
    await fetch(`/api/library/${id}`, { method: 'DELETE' });
    state.library = state.library.filter((i) => i.id !== id);
    state.project.clips = state.project.clips.filter((c) => c.libraryId !== id);
    if (state.selectedClipId && !state.project.clips.some((c) => c.id === state.selectedClipId)) {
      state.selectedClipId = null;
    }
    $('libEditModal').classList.add('hidden');
    renderLibrary();
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
    showToast('Removed from Library');
  });

  // --- Timeline Clip Creation ---
  function addLibraryItemToTimeline(item, trackOverride = null, startOverride = null) {
    let track = trackOverride;
    if (!track) {
      if (item.mediaType === 'audio') track = 'A1';
      else if (item.category === 'meme' || item.mediaType === 'image') track = 'V2';
      else track = 'V1';
    }

    // Validate track compatibility
    if (item.mediaType === 'audio' && track.startsWith('V')) track = 'A1';
    if (item.mediaType !== 'audio' && track.startsWith('A')) track = 'V1';

    const start = startOverride !== null ? Math.max(0, startOverride) : Math.max(0, state.playhead);
    const clip = {
      id: uid(),
      libraryId: item.id,
      track,
      start,
      duration: Math.max(0.2, item.duration || 5),
      inPoint: 0,
      volume: 100,
      muted: false,
      scale: item.category === 'meme' && track === 'V2' ? 60 : 100,
      x: 0,
      y: 0,
      opacity: 100,
      fadeIn: 0,
      fadeOut: 0,
    };

    state.project.clips.push(clip);
    state.selectedClipId = clip.id;
    renderTimeline();
    renderInspector();
    seekPlayhead(state.playhead);
  }

  // --- Media Pool for Real-time Preview ---
  function getMediaElement(clip, item) {
    let entry = mediaPool.get(clip.id);
    if (entry && entry.libraryId === item.id) return entry;

    let el;
    if (item.mediaType === 'image') {
      el = new Image();
      el.src = `/media/${item.filename}`;
    } else if (item.mediaType === 'audio') {
      el = document.createElement('audio');
      el.src = `/media/${item.filename}`;
      el.preload = 'auto';
    } else {
      el = document.createElement('video');
      el.src = `/media/${item.filename}`;
      el.preload = 'auto';
      el.playsInline = true;
    }

    entry = { el, libraryId: item.id, mediaType: item.mediaType };
    mediaPool.set(clip.id, entry);
    return entry;
  }

  function cleanupMediaPool() {
    const validIds = new Set(state.project.clips.map((c) => c.id));
    for (const [id, entry] of mediaPool.entries()) {
      if (!validIds.has(id)) {
        if (entry.el && typeof entry.el.pause === 'function') {
          entry.el.pause();
          entry.el.src = '';
        }
        mediaPool.delete(id);
      }
    }
  }

  // --- Preview Compositor ---
  function drawPreviewFrame() {
    const w = state.project.width;
    const h = state.project.height;
    if (previewCanvas.width !== w || previewCanvas.height !== h) {
      previewCanvas.width = w;
      previewCanvas.height = h;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const t = state.playhead;
    const trackOrder = { V1: 1, V2: 2 };
    const activeVisual = state.project.clips
      .filter((c) => c.track.startsWith('V') && t >= c.start && t < c.start + c.duration)
      .sort((a, b) => (trackOrder[a.track] || 1) - (trackOrder[b.track] || 1));

    previewEmptyHint.classList.toggle('hidden', state.project.clips.length > 0);

    for (const clip of activeVisual) {
      const item = getLibItem(clip.libraryId);
      if (!item) continue;
      const { el } = getMediaElement(clip, item);

      if (item.mediaType === 'image') {
        if (!el.complete || !el.naturalWidth) continue;
        drawScaledLayer(el, el.naturalWidth, el.naturalHeight, clip, w, h);
      } else {
        if (el.readyState < 2) continue;
        drawScaledLayer(el, el.videoWidth || w, el.videoHeight || h, clip, w, h);
      }
    }

    const total = getProjectDuration();
    timecodeDisplay.textContent = `${formatTime(t)} / ${formatTime(total)}`;
  }

  function getClipFadeFactor(clip, t) {
    const dur = Math.max(0.05, clip.duration || 0);
    const elapsed = t - clip.start;
    const remaining = clip.start + dur - t;
    const fadeIn = Math.max(0, clip.fadeIn || 0);
    const fadeOut = Math.max(0, clip.fadeOut || 0);
    let factor = 1;
    if (fadeIn > 0 && elapsed < fadeIn) {
      factor = Math.min(factor, elapsed / fadeIn);
    }
    if (fadeOut > 0 && remaining < fadeOut) {
      factor = Math.min(factor, remaining / fadeOut);
    }
    return Math.max(0, Math.min(1, factor));
  }

  function drawScaledLayer(el, srcW, srcH, clip, canvasW, canvasH) {
    const baseOpacity = Math.max(0, Math.min(1, (clip.opacity !== undefined ? clip.opacity : 100) / 100));
    const effectiveOpacity = baseOpacity * getClipFadeFactor(clip, state.playhead);
    if (effectiveOpacity <= 0) return;

    const scalePct = (clip.scale !== undefined ? clip.scale : 100) / 100;
    const maxW = canvasW * scalePct;
    const maxH = canvasH * scalePct;
    const ratio = Math.min(maxW / srcW, maxH / srcH);
    const drawW = srcW * ratio;
    const drawH = srcH * ratio;
    const offsetX = ((clip.x || 0) / 100) * canvasW;
    const offsetY = ((clip.y || 0) / 100) * canvasH;
    const dx = (canvasW - drawW) / 2 + offsetX;
    const dy = (canvasH - drawH) / 2 + offsetY;
    ctx.save();
    ctx.globalAlpha = effectiveOpacity;
    ctx.drawImage(el, dx, dy, drawW, drawH);
    ctx.restore();
  }

  function syncMediaToPlayhead(playing) {
    const t = state.playhead;
    for (const clip of state.project.clips) {
      const item = getLibItem(clip.libraryId);
      if (!item || item.mediaType === 'image') continue;
      const { el } = getMediaElement(clip, item);
      const isActive = t >= clip.start && t < clip.start + clip.duration;

      if (isActive) {
        const targetTime = Math.max(0, t - clip.start + (clip.inPoint || 0));
        el.muted = !!clip.muted;
        const baseVol = Math.min(1, Math.max(0, (clip.volume !== undefined ? clip.volume : 100) / 100));
        el.volume = baseVol * getClipFadeFactor(clip, t);

        if (Math.abs(el.currentTime - targetTime) > (playing ? 0.18 : 0.04)) {
          el.currentTime = targetTime;
          if (!playing) {
            el.onseeked = () => drawPreviewFrame();
          }
        }
        if (playing && el.paused) {
          el.play().catch(() => {});
        } else if (!playing && !el.paused) {
          el.pause();
        }
      } else {
        if (!el.paused) el.pause();
      }
    }
  }

  function seekPlayhead(t) {
    state.playhead = Math.max(0, t);
    updatePlayheadVisual();
    syncMediaToPlayhead(state.isPlaying);
    drawPreviewFrame();
  }

  function togglePlay() {
    if (state.isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    const total = getProjectDuration();
    if (total <= 0) return;
    if (state.playhead >= total) state.playhead = 0;

    state.isPlaying = true;
    $('btnPlayPause').textContent = '⏸';
    lastFrameTime = performance.now();
    syncMediaToPlayhead(true);

    const tick = (now) => {
      if (!state.isPlaying) return;
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      state.playhead += dt;

      if (state.playhead >= getProjectDuration()) {
        state.playhead = getProjectDuration();
        pausePlayback();
        return;
      }

      updatePlayheadVisual();
      syncMediaToPlayhead(true);
      drawPreviewFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function pausePlayback() {
    state.isPlaying = false;
    $('btnPlayPause').textContent = '▶';
    if (rafId) cancelAnimationFrame(rafId);
    syncMediaToPlayhead(false);
    drawPreviewFrame();
  }

  function updatePlayheadVisual(autoScroll = true) {
    const x = state.playhead * state.pxPerSec;
    playheadEl.style.left = `${x}px`;

    if (autoScroll && timelineScroll) {
      const viewLeft = timelineScroll.scrollLeft;
      const viewWidth = timelineScroll.clientWidth;
      const margin = 36;
      if (x > viewLeft + viewWidth - margin) {
        timelineScroll.scrollLeft = x - viewWidth * 0.25;
      } else if (x < viewLeft) {
        timelineScroll.scrollLeft = Math.max(0, x - margin);
      }
    }
  }

  // --- Timeline Rendering & Interactions ---
  function renderTimeline() {
    cleanupMediaPool();
    const totalDur = Math.max(20, getProjectDuration() + 8);
    const widthPx = Math.max(timelineScroll.clientWidth, Math.ceil(totalDur * state.pxPerSec));
    timelineCanvas.style.width = `${widthPx}px`;

    // Ruler ticks
    timeRuler.innerHTML = '';
    const step = state.pxPerSec >= 80 ? 1 : state.pxPerSec >= 35 ? 2 : 5;
    for (let s = 0; s <= totalDur; s += step) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = `${s * state.pxPerSec}px`;
      tick.textContent = formatTime(s);
      timeRuler.appendChild(tick);
    }

    // Clear lanes
    document.querySelectorAll('.track-lane').forEach((lane) => {
      lane.innerHTML = '';
    });

    for (const clip of state.project.clips) {
      const item = getLibItem(clip.libraryId);
      if (!item) continue;
      const lane = document.querySelector(`.track-lane[data-track="${clip.track}"]`);
      if (!lane) continue;

      const el = document.createElement('div');
      let typeClass = 'type-video';
      if (item.mediaType === 'audio') typeClass = 'type-audio';
      else if (item.mediaType === 'image') typeClass = 'type-image';
      else if (item.category === 'meme') typeClass = 'type-meme';

      el.className = `tl-clip ${typeClass} ${clip.id === state.selectedClipId ? 'selected' : ''}`;
      el.style.left = `${clip.start * state.pxPerSec}px`;
      el.style.width = `${Math.max(18, clip.duration * state.pxPerSec)}px`;
      el.dataset.clipId = clip.id;

      el.innerHTML = `
        <div class="trim-handle trim-left" data-trim="left"></div>
        <span class="tl-clip-label">${escapeHtml(item.name)}</span>
        <div class="trim-handle trim-right" data-trim="right"></div>
      `;

      // Select & drag/trim
      el.addEventListener('mousedown', (e) => onClipMouseDown(e, clip, item));
      lane.appendChild(el);
    }

    updatePlayheadVisual(false);
  }

  function getSnapPoints(excludeClipId) {
    const pts = [0, state.playhead];
    for (const c of state.project.clips) {
      if (c.id === excludeClipId) continue;
      pts.push(c.start, c.start + c.duration);
    }
    return pts;
  }

  function applySnap(val, pts) {
    if (!state.snap) return val;
    const threshold = 8 / state.pxPerSec;
    let best = val;
    let bestDist = threshold;
    for (const p of pts) {
      const d = Math.abs(val - p);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  function onClipMouseDown(e, clip, item) {
    e.stopPropagation();
    state.selectedClipId = clip.id;
    renderTimeline();
    renderInspector();

    const trimSide = e.target.dataset.trim;
    const startX = e.clientX;
    const origStart = clip.start;
    const origDur = clip.duration;
    const origIn = clip.inPoint || 0;
    const maxSrcDur = item.mediaType === 'image' ? 3600 : item.duration || 60;
    const snapPts = getSnapPoints(clip.id);

    const onMove = (ev) => {
      const dxSec = (ev.clientX - startX) / state.pxPerSec;

      if (trimSide === 'left') {
        const maxDelta = origDur - 0.15;
        const minDelta = -origIn;
        const clamped = Math.max(minDelta, Math.min(maxDelta, dxSec));
        let newStart = Math.max(0, origStart + clamped);
        newStart = applySnap(newStart, snapPts);
        const appliedDelta = newStart - origStart;
        clip.start = newStart;
        clip.inPoint = Math.max(0, origIn + appliedDelta);
        clip.duration = Math.max(0.15, origDur - appliedDelta);
      } else if (trimSide === 'right') {
        const maxDur = maxSrcDur - origIn;
        let newEnd = Math.max(origStart + 0.15, origStart + Math.min(maxDur, origDur + dxSec));
        newEnd = applySnap(newEnd, snapPts);
        clip.duration = Math.max(0.15, Math.min(maxDur, newEnd - origStart));
      } else {
        let newStart = Math.max(0, origStart + dxSec);
        newStart = applySnap(newStart, snapPts);
        clip.start = newStart;

        // Allow moving between compatible tracks (V1<->V2, A1<->A2)
        const targetLane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.track-lane');
        if (targetLane) {
          const tName = targetLane.dataset.track;
          const isAudio = item.mediaType === 'audio';
          if ((isAudio && tName.startsWith('A')) || (!isAudio && tName.startsWith('V'))) {
            clip.track = tName;
          }
        }
      }

      renderTimeline();
      renderInspector();
      drawPreviewFrame();
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      syncMediaToPlayhead(state.isPlaying);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Ruler scrubbing
  function initRulerScrub() {
    const scrubFromEvent = (e) => {
      const rect = timelineCanvas.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left);
      seekPlayhead(x / state.pxPerSec);
    };

    const startScrub = (e) => {
      e.preventDefault();
      scrubFromEvent(e);
      const onMove = (ev) => scrubFromEvent(ev);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    timeRuler.addEventListener('mousedown', startScrub);
    playheadEl.querySelector('.playhead-head').addEventListener('mousedown', startScrub);
  }

  // --- Clip Actions (Split, Duplicate, Delete) ---
  function splitSelectedClip() {
    const clip = state.project.clips.find((c) => c.id === state.selectedClipId);
    if (!clip) return showToast('Select a clip first');
    const t = state.playhead;
    if (t <= clip.start + 0.08 || t >= clip.start + clip.duration - 0.08) {
      return showToast('Move playhead inside the selected clip to split');
    }

    const leftDur = t - clip.start;
    const rightDur = clip.duration - leftDur;
    const origFadeOut = clip.fadeOut || 0;
    clip.duration = leftDur;
    clip.fadeOut = 0;

    const rightClip = {
      ...clip,
      id: uid(),
      start: t,
      duration: rightDur,
      inPoint: (clip.inPoint || 0) + leftDur,
      fadeIn: 0,
      fadeOut: origFadeOut,
    };

    state.project.clips.push(rightClip);
    state.selectedClipId = rightClip.id;
    renderTimeline();
    renderInspector();
  }

  function duplicateSelectedClip() {
    const clip = state.project.clips.find((c) => c.id === state.selectedClipId);
    if (!clip) return showToast('Select a clip first');
    const copy = {
      ...clip,
      id: uid(),
      start: clip.start + clip.duration + 0.1,
    };
    state.project.clips.push(copy);
    state.selectedClipId = copy.id;
    renderTimeline();
    renderInspector();
  }

  function deleteSelectedClip() {
    if (!state.selectedClipId) return;
    state.project.clips = state.project.clips.filter((c) => c.id !== state.selectedClipId);
    state.selectedClipId = null;
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
  }

  // --- Inspector ---
  function renderInspector() {
    const clip = state.project.clips.find((c) => c.id === state.selectedClipId);
    const empty = $('inspectorEmpty');
    const form = $('inspectorForm');

    if (!clip) {
      empty.classList.remove('hidden');
      form.classList.add('hidden');
      return;
    }

    const item = getLibItem(clip.libraryId);
    empty.classList.add('hidden');
    form.classList.remove('hidden');

    $('inspClipName').textContent = item ? `${item.name} (${clip.track})` : clip.track;
    $('inspStart').value = clip.start.toFixed(2);
    $('inspDuration').value = clip.duration.toFixed(2);
    $('inspFadeIn').value = (clip.fadeIn || 0).toFixed(1);
    $('inspFadeOut').value = (clip.fadeOut || 0).toFixed(1);
    $('inspVolume').value = clip.volume !== undefined ? clip.volume : 100;
    $('inspVolumeVal').textContent = `${$('inspVolume').value}%`;
    $('inspMuted').checked = !!clip.muted;

    const isVisual = clip.track.startsWith('V');
    $('inspTransformSection').classList.toggle('hidden', !isVisual);
    $('inspAudioSection').classList.toggle('hidden', item && item.mediaType === 'image');

    if (isVisual) {
      $('inspScale').value = clip.scale !== undefined ? clip.scale : 100;
      $('inspScaleVal').textContent = `${$('inspScale').value}%`;
      $('inspX').value = clip.x || 0;
      $('inspXVal').textContent = `${$('inspX').value}%`;
      $('inspY').value = clip.y || 0;
      $('inspYVal').textContent = `${$('inspY').value}%`;
      $('inspOpacity').value = clip.opacity !== undefined ? clip.opacity : 100;
      $('inspOpacityVal').textContent = `${$('inspOpacity').value}%`;
    }
    renderMediaProps($('inspMediaProps'), item);
  }

  function bindInspectorInputs() {
    const getSelected = () => state.project.clips.find((c) => c.id === state.selectedClipId);

    $('inspStart').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      c.start = Math.max(0, parseFloat(e.target.value) || 0);
      renderTimeline();
      drawPreviewFrame();
    });

    $('inspDuration').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      c.duration = Math.max(0.1, parseFloat(e.target.value) || 0.1);
      renderTimeline();
      drawPreviewFrame();
    });

    $('inspFadeIn').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.fadeIn = Math.max(0, parseFloat(e.target.value) || 0);
      syncMediaToPlayhead(state.isPlaying);
      drawPreviewFrame();
    });

    $('inspFadeOut').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.fadeOut = Math.max(0, parseFloat(e.target.value) || 0);
      syncMediaToPlayhead(state.isPlaying);
      drawPreviewFrame();
    });

    $('inspVolume').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.volume = parseInt(e.target.value, 10);
      $('inspVolumeVal').textContent = `${c.volume}%`;
      syncMediaToPlayhead(state.isPlaying);
    });

    $('inspMuted').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      c.muted = e.target.checked;
      syncMediaToPlayhead(state.isPlaying);
    });

    $('inspScale').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.scale = parseInt(e.target.value, 10);
      $('inspScaleVal').textContent = `${c.scale}%`;
      drawPreviewFrame();
    });

    $('inspX').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.x = parseInt(e.target.value, 10);
      $('inspXVal').textContent = `${c.x}%`;
      drawPreviewFrame();
    });

    $('inspY').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.y = parseInt(e.target.value, 10);
      $('inspYVal').textContent = `${c.y}%`;
      drawPreviewFrame();
    });

    $('inspOpacity').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      c.opacity = parseInt(e.target.value, 10);
      $('inspOpacityVal').textContent = `${c.opacity}%`;
      drawPreviewFrame();
    });

    $('btnResetTransform').addEventListener('click', () => {
      const c = getSelected();
      if (!c) return;
      c.scale = 100;
      c.x = 0;
      c.y = 0;
      c.opacity = 100;
      renderInspector();
      drawPreviewFrame();
    });
  }

  // --- Drag & Drop (Library + Timeline) ---
  function initDragAndDrop() {
    // Drop files onto Library
    libraryDropzone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        libraryDropzone.classList.add('drag-over');
      }
    });
    libraryDropzone.addEventListener('dragleave', () => {
      libraryDropzone.classList.remove('drag-over');
    });
    libraryDropzone.addEventListener('drop', async (e) => {
      libraryDropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        await uploadFilesToLibrary(e.dataTransfer.files, 'auto');
      }
    });

    // Drop onto Timeline tracks (from Library OR OS files)
    document.querySelectorAll('.track-lane').forEach((lane) => {
      lane.addEventListener('dragover', (e) => {
        e.preventDefault();
        lane.classList.add('drop-target');
      });
      lane.addEventListener('dragleave', () => {
        lane.classList.remove('drop-target');
      });
      lane.addEventListener('drop', async (e) => {
        e.preventDefault();
        lane.classList.remove('drop-target');
        const rect = timelineCanvas.getBoundingClientRect();
        const dropTime = Math.max(0, (e.clientX - rect.left) / state.pxPerSec);
        const track = lane.dataset.track;

        const libId = e.dataTransfer.getData('application/x-lightaf-lib');
        if (libId) {
          const item = getLibItem(libId);
          if (item) addLibraryItemToTimeline(item, track, dropTime);
          return;
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const items = await uploadFilesToLibrary(e.dataTransfer.files, 'auto');
          let cursor = dropTime;
          for (const item of items) {
            addLibraryItemToTimeline(item, track, cursor);
            cursor += item.duration || 3;
          }
        }
      });
    });
  }

  // --- Projects & Export ---
  async function saveProject() {
    state.project.name = $('projectName').value.trim() || 'Untitled Video';
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.project),
    });
    if (res.ok) {
      const data = await res.json();
      state.project.id = data.project.id;
      showToast('Project saved!');
    }
  }

  async function openProjectsModal() {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const list = $('projectsList');
    list.innerHTML = '';

    if (!data.projects.length) {
      list.innerHTML = '<div style="color:var(--muted)">No saved projects yet.</div>';
    } else {
      for (const p of data.projects) {
        const row = document.createElement('div');
        row.className = 'project-row';
        row.innerHTML = `
          <div>
            <div style="font-weight:600">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${p.clipCount} clips</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-xs" data-load="${p.id}">Load</button>
            <button class="btn btn-ghost btn-xs btn-danger-text" data-del="${p.id}">✕</button>
          </div>
        `;
        row.querySelector('[data-load]').addEventListener('click', async () => {
          const r = await fetch(`/api/projects/${p.id}`);
          const d = await r.json();
          if (d.project) {
            pausePlayback();
            state.project = d.project;
            state.selectedClipId = null;
            $('projectName').value = state.project.name;
            $('aspectSelect').value = `${state.project.width}x${state.project.height}`;
            $('projectsModal').classList.add('hidden');
            renderTimeline();
            renderInspector();
            seekPlayhead(0);
            showToast(`Loaded "${state.project.name}"`);
          }
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
          openProjectsModal();
        });
        list.appendChild(row);
      }
    }
    $('projectsModal').classList.remove('hidden');
  }

  async function startExport() {
    if (!state.project.clips.length) {
      return showToast('Add at least one clip to the timeline before exporting.');
    }
    pausePlayback();
    state.project.name = $('projectName').value.trim() || 'Untitled Video';

    const modal = $('exportModal');
    const bar = $('exportProgressBar');
    const statusText = $('exportStatusText');
    const doneActions = $('exportDoneActions');
    bar.style.width = '3%';
    statusText.textContent = 'Starting FFmpeg render...';
    doneActions.classList.add('hidden');
    modal.classList.remove('hidden');

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.project),
    });
    if (!res.ok) {
      statusText.textContent = 'Failed to start export.';
      return;
    }
    const { jobId } = await res.json();

    const poll = setInterval(async () => {
      const r = await fetch(`/api/export/${jobId}`);
      const job = await r.json();
      bar.style.width = `${job.progress || 0}%`;
      statusText.textContent = job.message || 'Rendering...';

      if (job.status === 'done') {
        clearInterval(poll);
        const dl = $('btnDownloadExport');
        dl.href = job.downloadUrl;
        dl.download = job.filename;
        doneActions.classList.remove('hidden');
      } else if (job.status === 'error') {
        clearInterval(poll);
        statusText.textContent = `Error: ${job.error || 'Export failed'}`;
      }
    }, 500);
  }

  // --- Wire UI Controls ---
  function initControls() {
    $('btnAddLibrary').addEventListener('click', () => $('libraryFileInput').click());
    $('libraryFileInput').addEventListener('change', async (e) => {
      await uploadFilesToLibrary(e.target.files, 'auto');
      e.target.value = '';
    });

    $('librarySearch').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderLibrary();
    });

    $('libraryFilters').addEventListener('click', (e) => {
      const btn = e.target.closest('.pill');
      if (!btn) return;
      document.querySelectorAll('#libraryFilters .pill').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderLibrary();
    });

    $('btnStopLibPreview').addEventListener('click', stopLibraryPreview);

    $('aspectSelect').addEventListener('change', (e) => {
      const [w, h] = e.target.value.split('x').map(Number);
      state.project.width = w;
      state.project.height = h;
      drawPreviewFrame();
    });

    $('btnNewProject').addEventListener('click', () => {
      pausePlayback();
      state.project = {
        id: null,
        name: 'Untitled Video',
        width: 1280,
        height: 720,
        fps: 30,
        clips: [],
      };
      state.selectedClipId = null;
      $('projectName').value = state.project.name;
      $('aspectSelect').value = '1280x720';
      renderTimeline();
      renderInspector();
      seekPlayhead(0);
      showToast('Started new timeline (Library kept intact)');
    });

    $('btnSaveProject').addEventListener('click', saveProject);
    $('btnProjectsModal').addEventListener('click', openProjectsModal);
    $('btnCloseProjects').addEventListener('click', () => $('projectsModal').classList.add('hidden'));

    $('btnExport').addEventListener('click', startExport);
    $('btnCloseExport').addEventListener('click', () => $('exportModal').classList.add('hidden'));
    $('btnOpenExportsFolder').addEventListener('click', () => fetch('/api/open-exports', { method: 'POST' }));

    // Transport
    $('btnPlayPause').addEventListener('click', togglePlay);
    $('btnJumpStart').addEventListener('click', () => seekPlayhead(0));
    $('btnStepBack').addEventListener('click', () => seekPlayhead(state.playhead - 0.5));
    $('btnStepFwd').addEventListener('click', () => seekPlayhead(state.playhead + 0.5));

    $('btnSplit').addEventListener('click', splitSelectedClip);
    $('btnDuplicate').addEventListener('click', duplicateSelectedClip);
    $('btnDeleteClip').addEventListener('click', deleteSelectedClip);

    $('snapToggle').addEventListener('change', (e) => {
      state.snap = e.target.checked;
    });

    const applyTheme = (theme) => {
      const isLight = theme === 'light';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('lightaf_theme', theme);
      const btn = $('btnThemeToggle');
      btn.classList.toggle('active', isLight);
      btn.setAttribute('aria-pressed', String(isLight));
      $('themeToggleLabel').textContent = isLight ? '☀ Light' : '🌙 Dark';
      const logoSrc = isLight ? '/logo-light.png' : '/logo.png';
      const brandLogo = document.querySelector('.brand-logo');
      if (brandLogo) brandLogo.src = logoSrc;
      const favicon = document.querySelector('link[rel="icon"]');
      if (favicon) favicon.href = logoSrc;
    };
    applyTheme(localStorage.getItem('lightaf_theme') || 'dark');
    $('btnThemeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });

    const syncContextMenuToggle = (installed) => {
      const btn = $('btnContextMenu');
      btn.classList.toggle('active', !!installed);
      btn.setAttribute('aria-pressed', String(!!installed));
      localStorage.setItem('lightaf_ctx_menu', installed ? '1' : '0');
    };

    fetch('/api/context-menu')
      .then((r) => r.json())
      .then((d) => syncContextMenuToggle(!!d.installed))
      .catch(() => {});

    $('btnContextMenu').addEventListener('click', async () => {
      const isInstalled = $('btnContextMenu').classList.contains('active');
      const action = isInstalled ? 'uninstall' : 'install';
      const res = await fetch('/api/context-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        syncContextMenuToggle(data.installed);
        showToast(
          data.installed
            ? 'Added "Edit with LightAF Editor" to Windows Explorer right-click menu!'
            : 'Removed from Windows Explorer right-click menu.'
        );
      } else {
        showToast('Failed to update Explorer context menu.');
      }
    });

    const setZoom = (val, anchorClientX = null) => {
      const oldPx = state.pxPerSec;
      const newPx = Math.max(15, Math.min(160, val));
      if (newPx === oldPx) return;

      let anchorTime = state.playhead;
      let offsetInView = 0;
      if (anchorClientX !== null) {
        const rect = timelineScroll.getBoundingClientRect();
        offsetInView = anchorClientX - rect.left;
        anchorTime = (timelineScroll.scrollLeft + offsetInView) / oldPx;
      }

      state.pxPerSec = newPx;
      $('zoomSlider').value = state.pxPerSec;
      renderTimeline();

      if (anchorClientX !== null) {
        timelineScroll.scrollLeft = Math.max(0, anchorTime * newPx - offsetInView);
      }
    };
    $('zoomSlider').addEventListener('input', (e) => setZoom(parseInt(e.target.value, 10)));
    $('btnZoomIn').addEventListener('click', () => setZoom(state.pxPerSec + 15));
    $('btnZoomOut').addEventListener('click', () => setZoom(state.pxPerSec - 15));

    // Ctrl + Scroll to zoom timeline instead of zooming the whole app
    window.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 10 : -10;
        const rect = timelineScroll.getBoundingClientRect();
        const overTimeline = e.clientY >= rect.top && e.clientY <= rect.bottom;
        setZoom(state.pxPerSec + delta, overTimeline ? e.clientX : null);
      },
      { passive: false }
    );

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        splitSelectedClip();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedClip();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSelectedClip();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekPlayhead(state.playhead - 0.5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekPlayhead(state.playhead + 0.5);
      } else if (e.key === 'Home') {
        e.preventDefault();
        seekPlayhead(0);
      }
    });
  }

  // --- Boot ---
  initControls();
  bindInspectorInputs();
  initRulerScrub();
  initDragAndDrop();
  loadLibrary().then(handleInitialImportParam);
  renderTimeline();
  drawPreviewFrame();
})();
