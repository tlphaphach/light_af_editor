(() => {
  'use strict';

  const DEFAULT_TRACKS = [
    { id: 'V2', name: 'Overlay / Meme', type: 'visual', muted: false, color: '#8b5cf6' },
    { id: 'V1', name: 'Main Video', type: 'visual', muted: false, color: '#3b82f6' },
    { id: 'A1', name: 'SFX / Sound', type: 'audio', muted: false, color: '#f59e0b' },
    { id: 'A2', name: 'Music / Audio', type: 'audio', muted: false, color: '#0d9488' },
  ];

  function getTrackDefaultColor(track) {
    if (track.id === 'V2') return '#8b5cf6';
    if (track.id === 'V1') return '#3b82f6';
    if (track.id === 'A1') return '#f59e0b';
    if (track.id === 'A2') return '#0d9488';
    return track.type === 'audio' ? '#0d9488' : '#8b5cf6';
  }

  function cloneDefaultTracks() {
    return DEFAULT_TRACKS.map((t) => ({ ...t }));
  }

  // --- State ---
  const state = {
    library: [],
    filter: 'all',
    search: '',
    selectedLibIds: [],
    lastSelectedLibId: null,
    project: {
      id: null,
      name: 'Untitled Video',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: cloneDefaultTracks(),
      clips: [],
    },
    selectedClipId: null,
    selectedClipIds: [],
    selectedTrackIds: [],
    lastSelectedTrackId: null,
    playhead: 0,
    isPlaying: false,
    pxPerSec: 50,
    snap: true,
    editingLibId: null,
  };

  // Hit-test bounds for preview canvas dragging
  let previewClipBounds = [];

  // Media element pool keyed by clip.id
  const mediaPool = new Map();
  let rafId = null;
  let lastFrameTime = 0;

  // --- Undo / Redo History ---
  const MAX_HISTORY = 100;
  const undoStack = [];
  const redoStack = [];
  let pendingInspectorSnapshot = null;

  function setSelectedClips(ids) {
    const valid = Array.from(new Set(ids)).filter((id) => state.project.clips.some((c) => c.id === id));
    state.selectedClipIds = valid;
    state.selectedClipId = valid.length ? valid[valid.length - 1] : null;
  }

  function ensureProjectTracks(project) {
    if (!Array.isArray(project.tracks) || !project.tracks.length) {
      project.tracks = cloneDefaultTracks();
    }
    const existing = new Set(project.tracks.map((t) => t.id));
    for (const c of project.clips || []) {
      if (c.track && !existing.has(c.track)) {
        const type = c.track.startsWith('A') ? 'audio' : 'visual';
        const trackObj = { id: c.track, name: c.track, type, muted: false };
        if (type === 'visual') project.tracks.unshift(trackObj);
        else project.tracks.push(trackObj);
        existing.add(c.track);
      }
    }
  }

  function createSnapshot() {
    return {
      tracks: JSON.parse(JSON.stringify(state.project.tracks)),
      clips: JSON.parse(JSON.stringify(state.project.clips)),
      width: state.project.width,
      height: state.project.height,
      selectedClipIds: [...state.selectedClipIds],
      selectedTrackIds: [...state.selectedTrackIds],
    };
  }

  function updateUndoRedoButtons() {
    const btnUndo = $('btnUndo');
    const btnRedo = $('btnRedo');
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }

  function pushHistory(snapshot = createSnapshot()) {
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    pendingInspectorSnapshot = null;
    updateUndoRedoButtons();
  }

  function applySnapshot(snap) {
    state.project.tracks = snap.tracks ? JSON.parse(JSON.stringify(snap.tracks)) : cloneDefaultTracks();
    state.project.clips = JSON.parse(JSON.stringify(snap.clips));
    state.project.width = snap.width;
    state.project.height = snap.height;
    setSelectedClips(snap.selectedClipIds || (snap.selectedClipId ? [snap.selectedClipId] : []));
    const validTracks = new Set(state.project.tracks.map((t) => t.id));
    state.selectedTrackIds = (snap.selectedTrackIds || []).filter((id) => validTracks.has(id));

    const aspectVal = `${state.project.width}x${state.project.height}`;
    const aspectEl = $('aspectSelect');
    if (aspectEl && [...aspectEl.options].some((o) => o.value === aspectVal)) {
      aspectEl.value = aspectVal;
    }

    renderTimeline();
    renderInspector();
    syncMediaToPlayhead(state.isPlaying);
    drawPreviewFrame();
  }

  function undo() {
    if (!undoStack.length) return;
    pendingInspectorSnapshot = null;
    redoStack.push(createSnapshot());
    applySnapshot(undoStack.pop());
    updateUndoRedoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    pendingInspectorSnapshot = null;
    undoStack.push(createSnapshot());
    applySnapshot(redoStack.pop());
    updateUndoRedoButtons();
  }

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

  function formatSpeed(speed) {
    const s = Math.max(0.1, Math.min(100, speed || 1));
    if (s >= 10) return `${s.toFixed(1).replace(/\.0$/, '')}x`;
    if (s >= 1) return `${s.toFixed(2).replace(/0$/, '')}x`;
    return `${s.toFixed(2)}x`;
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

  function getFilteredLibraryItems() {
    const q = state.search.trim().toLowerCase();
    return state.library.filter((item) => {
      if (state.filter === 'fav' && !item.favorite) return false;
      if (state.filter !== 'all' && state.filter !== 'fav' && item.category !== state.filter) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function updateLibSelectionBar() {
    const valid = new Set(state.library.map((i) => i.id));
    state.selectedLibIds = state.selectedLibIds.filter((id) => valid.has(id));
    const bar = $('libSelectionBar');
    if (!bar) return;
    const count = state.selectedLibIds.length;
    bar.classList.toggle('hidden', count === 0);
    if (count > 0) {
      $('libSelCount').textContent = `${count} selected`;
    }
  }

  async function deleteLibraryItemsByIds(ids) {
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) return;
    await Promise.all(uniqueIds.map((id) => fetch(`/api/library/${id}`, { method: 'DELETE' })));
    const delSet = new Set(uniqueIds);
    state.library = state.library.filter((i) => !delSet.has(i.id));
    state.project.clips = state.project.clips.filter((c) => !delSet.has(c.libraryId));
    for (const snap of undoStack) {
      snap.clips = snap.clips.filter((c) => !delSet.has(c.libraryId));
    }
    for (const snap of redoStack) {
      snap.clips = snap.clips.filter((c) => !delSet.has(c.libraryId));
    }
    state.selectedLibIds = state.selectedLibIds.filter((id) => !delSet.has(id));
    setSelectedClips(state.selectedClipIds.filter((cid) => state.project.clips.some((c) => c.id === cid)));
    renderLibrary();
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
    showToast(`Deleted ${uniqueIds.length} item(s) from Library`);
  }

  function renderLibrary() {
    libraryCount.textContent = String(state.library.length);
    const filtered = getFilteredLibraryItems();
    updateLibSelectionBar();

    libraryGrid.innerHTML = '';
    for (const item of filtered) {
      const isSelected = state.selectedLibIds.includes(item.id);
      const card = document.createElement('div');
      card.className = `lib-card ${isSelected ? 'selected' : ''}`;
      card.draggable = true;
      card.dataset.libId = item.id;

      const thumbHtml = item.thumb
        ? `<img src="/thumbs/${item.thumb}" alt="${escapeHtml(item.name)}" loading="lazy" />`
        : `<div class="lib-audio-icon">${item.mediaType === 'audio' ? '🔊' : '🎬'}</div>`;

      card.innerHTML = `
        <div class="lib-thumb">
          ${thumbHtml}
          <input type="checkbox" class="lib-select-cb" ${isSelected ? 'checked' : ''} title="Select media" />
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

      const cb = card.querySelector('.lib-select-cb');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          if (!state.selectedLibIds.includes(item.id)) state.selectedLibIds.push(item.id);
        } else {
          state.selectedLibIds = state.selectedLibIds.filter((id) => id !== item.id);
        }
        state.lastSelectedLibId = item.id;
        renderLibrary();
      });

      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target === cb) return;
        if (e.shiftKey && state.lastSelectedLibId) {
          const ids = filtered.map((i) => i.id);
          const a = ids.indexOf(state.lastSelectedLibId);
          const b = ids.indexOf(item.id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            const rangeIds = ids.slice(lo, hi + 1);
            if (e.ctrlKey || e.metaKey) {
              state.selectedLibIds = Array.from(new Set([...state.selectedLibIds, ...rangeIds]));
            } else {
              state.selectedLibIds = rangeIds;
            }
          }
        } else if (e.ctrlKey || e.metaKey) {
          if (state.selectedLibIds.includes(item.id)) {
            state.selectedLibIds = state.selectedLibIds.filter((id) => id !== item.id);
          } else {
            state.selectedLibIds = [...state.selectedLibIds, item.id];
          }
          state.lastSelectedLibId = item.id;
        } else {
          state.selectedLibIds = [item.id];
          state.lastSelectedLibId = item.id;
        }
        renderLibrary();
      });

      // Drag start from library
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-lightaf-lib', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      // Double click adds to timeline
      card.addEventListener('dblclick', (e) => {
        if (e.target === cb) return;
        addLibraryItemToTimeline(item);
      });

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
    for (const snap of undoStack) {
      snap.clips = snap.clips.filter((c) => c.libraryId !== id);
    }
    for (const snap of redoStack) {
      snap.clips = snap.clips.filter((c) => c.libraryId !== id);
    }
    setSelectedClips(state.selectedClipIds.filter((cid) => state.project.clips.some((c) => c.id === cid)));
    $('libEditModal').classList.add('hidden');
    renderLibrary();
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
    showToast('Removed from Library');
  });

  // --- Custom Layers & Track Helpers ---
  function getVisualTrackOrderMap() {
    const map = {};
    const visualTracks = state.project.tracks.filter((t) => t.type === 'visual');
    // Top-most visual track in array draws last (foreground)
    const count = visualTracks.length;
    visualTracks.forEach((t, idx) => {
      map[t.id] = count - idx;
    });
    return map;
  }

  function getTrackObj(trackId) {
    return state.project.tracks.find((t) => t.id === trackId) || null;
  }

  function addCustomLayer(type) {
    const prefix = type === 'audio' ? 'A' : 'V';
    let maxNum = 0;
    for (const t of state.project.tracks) {
      if (t.id.startsWith(prefix)) {
        const n = parseInt(t.id.slice(1), 10);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }
    }
    const id = `${prefix}${maxNum + 1}`;
    const name = type === 'audio' ? `Audio ${maxNum + 1}` : `Layer ${maxNum + 1}`;
    const color = type === 'audio' ? '#0d9488' : '#8b5cf6';
    const trackObj = { id, name, type, muted: false, color };

    pushHistory();
    if (type === 'visual') {
      state.project.tracks.unshift(trackObj);
    } else {
      state.project.tracks.push(trackObj);
    }
    state.selectedTrackIds = [id];
    state.lastSelectedTrackId = id;
    renderTimeline();
    showToast(`Added ${type === 'audio' ? 'Audio' : 'Video'} layer "${name}" (${id})`);
  }

  function deleteTracks(trackIds) {
    const toDelete = new Set(trackIds);
    const remainingVisual = state.project.tracks.filter((t) => t.type === 'visual' && !toDelete.has(t.id));
    const remainingAudio = state.project.tracks.filter((t) => t.type === 'audio' && !toDelete.has(t.id));
    if (remainingVisual.length < 1 || remainingAudio.length < 1) {
      return showToast('Must keep at least 1 visual layer and 1 audio layer');
    }

    pushHistory();
    state.project.tracks = state.project.tracks.filter((t) => !toDelete.has(t.id));
    state.project.clips = state.project.clips.filter((c) => !toDelete.has(c.track));
    setSelectedClips(state.selectedClipIds);
    state.selectedTrackIds = state.selectedTrackIds.filter((id) => !toDelete.has(id));
    renderTimeline();
    renderInspector();
    syncMediaToPlayhead(state.isPlaying);
    drawPreviewFrame();
    showToast(`Deleted ${toDelete.size} layer(s)`);
  }

  function toggleTracksMute(trackIds) {
    const targets = state.project.tracks.filter((t) => trackIds.includes(t.id));
    if (!targets.length) return;
    const anyUnmuted = targets.some((t) => !t.muted);
    pushHistory();
    for (const t of targets) {
      t.muted = anyUnmuted;
    }
    renderTimeline();
    syncMediaToPlayhead(state.isPlaying);
    drawPreviewFrame();
  }

  // --- Timeline Clip Creation ---
  function addLibraryItemToTimeline(item, trackOverride = null, startOverride = null) {
    const visualTracks = state.project.tracks.filter((t) => t.type === 'visual');
    const audioTracks = state.project.tracks.filter((t) => t.type === 'audio');
    const defaultVisual = visualTracks.find((t) => t.id === 'V1')?.id || visualTracks[visualTracks.length - 1]?.id || 'V1';
    const defaultOverlay = visualTracks[0]?.id || defaultVisual;
    const defaultAudio = audioTracks[0]?.id || 'A1';

    let track = trackOverride;
    if (!track) {
      if (item.mediaType === 'audio') track = defaultAudio;
      else if (item.category === 'meme' || item.mediaType === 'image') track = defaultOverlay;
      else track = defaultVisual;
    }

    // Validate track compatibility
    const targetTrack = getTrackObj(track);
    if (item.mediaType === 'audio' && (!targetTrack || targetTrack.type !== 'audio')) track = defaultAudio;
    if (item.mediaType !== 'audio' && (!targetTrack || targetTrack.type !== 'visual')) track = defaultVisual;

    const start = startOverride !== null ? Math.max(0, startOverride) : Math.max(0, state.playhead);
    const clip = {
      id: uid(),
      clipType: 'media',
      libraryId: item.id,
      track,
      start,
      duration: Math.max(0.2, item.duration || 5),
      inPoint: 0,
      volume: 100,
      muted: false,
      scale: item.category === 'meme' && track !== defaultVisual ? 60 : 100,
      x: 0,
      y: 0,
      opacity: 100,
      fadeIn: 0,
      fadeOut: 0,
      speed: 1,
    };

    pushHistory();
    state.project.clips.push(clip);
    setSelectedClips([clip.id]);
    renderTimeline();
    renderInspector();
    seekPlayhead(state.playhead);
  }

  function addTextClip() {
    const visualTracks = state.project.tracks.filter((t) => t.type === 'visual');
    const selectedVisual = state.selectedTrackIds.find((id) => getTrackObj(id)?.type === 'visual');
    const track = selectedVisual || visualTracks[0]?.id || 'V2';
    const start = Math.max(0, state.playhead);

    const clip = {
      id: uid(),
      clipType: 'text',
      track,
      start,
      duration: 5,
      text: 'Your Text Here',
      fontFamily: 'Arial',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 3,
      bgColor: '#000000',
      bgOpacity: 0,
      bold: true,
      italic: false,
      x: 0,
      y: 0,
      opacity: 100,
      fadeIn: 0,
      fadeOut: 0,
    };

    pushHistory();
    state.project.clips.push(clip);
    setSelectedClips([clip.id]);
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
    showToast(`Added text clip on ${track}`);
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
    const trackOrder = getVisualTrackOrderMap();
    const activeVisual = state.project.clips
      .filter((c) => {
        const tr = getTrackObj(c.track);
        const isVisual = tr ? tr.type === 'visual' && !tr.muted : c.track.startsWith('V');
        return isVisual && t >= c.start && t < c.start + c.duration;
      })
      .sort((a, b) => (trackOrder[a.track] || 1) - (trackOrder[b.track] || 1));

    previewEmptyHint.classList.toggle('hidden', state.project.clips.length > 0);
    previewClipBounds = [];

    for (const clip of activeVisual) {
      if (clip.clipType === 'text') {
        const bounds = drawTextLayer(clip, w, h);
        if (bounds) previewClipBounds.push({ clip, ...bounds });
        continue;
      }

      const item = getLibItem(clip.libraryId);
      if (!item) continue;
      const { el } = getMediaElement(clip, item);

      if (item.mediaType === 'image') {
        if (!el.complete || !el.naturalWidth) continue;
        const bounds = drawScaledLayer(el, el.naturalWidth, el.naturalHeight, clip, w, h);
        if (bounds) previewClipBounds.push({ clip, ...bounds });
      } else {
        if (el.readyState < 2) continue;
        const bounds = drawScaledLayer(el, el.videoWidth || w, el.videoHeight || h, clip, w, h);
        if (bounds) previewClipBounds.push({ clip, ...bounds });
      }
    }

    // Draw selection outline for selected text clip (when paused)
    if (!state.isPlaying && state.selectedClipIds.length === 1) {
      const sel = previewClipBounds.find((b) => b.clip.id === state.selectedClipId && b.clip.clipType === 'text');
      if (sel) {
        ctx.save();
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = Math.max(2, w / 400);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(sel.x - 6, sel.y - 6, sel.w + 12, sel.h + 12);
        ctx.restore();
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
    if (effectiveOpacity <= 0) return null;

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
    return { x: dx, y: dy, w: drawW, h: drawH };
  }

  function drawTextLayer(clip, canvasW, canvasH) {
    const textStr = clip.text !== undefined ? String(clip.text) : 'Text';
    if (!textStr.trim()) return null;

    const baseOpacity = Math.max(0, Math.min(1, (clip.opacity !== undefined ? clip.opacity : 100) / 100));
    const effectiveOpacity = baseOpacity * getClipFadeFactor(clip, state.playhead);
    if (effectiveOpacity <= 0) return null;

    const fontSize = Math.max(10, clip.fontSize || 64);
    const fontFamily = clip.fontFamily || 'Arial';
    const fontWeight = clip.bold !== false ? 'bold' : 'normal';
    const fontStyle = clip.italic ? 'italic' : 'normal';
    const lines = textStr.split('\n');
    const lineHeight = fontSize * 1.2;

    ctx.save();
    ctx.globalAlpha = effectiveOpacity;
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let maxLineW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line || ' ');
      if (m.width > maxLineW) maxLineW = m.width;
    }

    const totalH = lines.length * lineHeight;
    const cx = canvasW / 2 + ((clip.x || 0) / 100) * canvasW;
    const cy = canvasH / 2 + ((clip.y || 0) / 100) * canvasH;
    const boxPadX = 16;
    const boxPadY = 10;
    const boxX = cx - maxLineW / 2 - boxPadX;
    const boxY = cy - totalH / 2 - boxPadY;
    const boxW = maxLineW + boxPadX * 2;
    const boxH = totalH + boxPadY * 2;

    const bgOpacity = Math.max(0, Math.min(1, (clip.bgOpacity || 0) / 100));
    if (bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = effectiveOpacity * bgOpacity;
      ctx.fillStyle = clip.bgColor || '#000000';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.restore();
    }

    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    const strokeW = clip.strokeWidth !== undefined ? clip.strokeWidth : 3;
    ctx.fillStyle = clip.color || '#ffffff';
    ctx.strokeStyle = clip.strokeColor || '#000000';
    ctx.lineWidth = strokeW * 2;
    ctx.lineJoin = 'round';

    for (let i = 0; i < lines.length; i++) {
      const ly = startY + i * lineHeight;
      if (strokeW > 0) {
        ctx.strokeText(lines[i], cx, ly);
      }
      ctx.fillText(lines[i], cx, ly);
    }

    ctx.restore();
    return { x: boxX, y: boxY, w: boxW, h: boxH };
  }

  function initPreviewCanvasDrag() {
    previewCanvas.addEventListener('mousemove', (e) => {
      const rect = previewCanvas.getBoundingClientRect();
      const scaleX = previewCanvas.width / rect.width;
      const scaleY = previewCanvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const hit = [...previewClipBounds]
        .reverse()
        .find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
      previewCanvas.style.cursor = hit ? 'move' : 'default';
    });

    previewCanvas.addEventListener('mousedown', (e) => {
      const rect = previewCanvas.getBoundingClientRect();
      const scaleX = previewCanvas.width / rect.width;
      const scaleY = previewCanvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      // Prefer text clips if overlapping, otherwise top-most visual clip
      const reversed = [...previewClipBounds].reverse();
      const hit =
        reversed.find((b) => b.clip.clipType === 'text' && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) ||
        reversed.find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);

      if (!hit) return;
      e.preventDefault();
      const clip = hit.clip;
      setSelectedClips([clip.id]);
      renderTimeline();
      renderInspector();
      drawPreviewFrame();

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const origX = clip.x || 0;
      const origY = clip.y || 0;
      const beforeSnapshot = createSnapshot();

      const onMove = (ev) => {
        const dxPct = (((ev.clientX - startClientX) * scaleX) / previewCanvas.width) * 100;
        const dyPct = (((ev.clientY - startClientY) * scaleY) / previewCanvas.height) * 100;
        clip.x = Math.round(Math.max(-50, Math.min(50, origX + dxPct)));
        clip.y = Math.round(Math.max(-50, Math.min(50, origY + dyPct)));
        renderInspector();
        drawPreviewFrame();
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (clip.x !== origX || clip.y !== origY) {
          pushHistory(beforeSnapshot);
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function syncMediaToPlayhead(playing) {
    const t = state.playhead;
    for (const clip of state.project.clips) {
      if (clip.clipType === 'text') continue;
      const item = getLibItem(clip.libraryId);
      if (!item || item.mediaType === 'image') continue;
      const { el } = getMediaElement(clip, item);
      const trackObj = getTrackObj(clip.track);
      const trackMuted = trackObj ? !!trackObj.muted : false;
      const isActive = t >= clip.start && t < clip.start + clip.duration;

      if (isActive) {
        const speed = Math.max(0.1, Math.min(100, clip.speed || 1));
        const targetTime = Math.max(0, (t - clip.start) * speed + (clip.inPoint || 0));
        el.muted = !!clip.muted || trackMuted || speed > 16;
        const baseVol = Math.min(1, Math.max(0, (clip.volume !== undefined ? clip.volume : 100) / 100));
        el.volume = baseVol * getClipFadeFactor(clip, t);

        const clampedRate = Math.min(16, Math.max(0.1, speed));
        if (Math.abs(el.playbackRate - clampedRate) > 0.001) {
          try {
            el.playbackRate = clampedRate;
          } catch {}
        }

        const driftThreshold = playing ? (speed > 16 ? 0.05 : 0.18 * speed) : 0.04;
        if (Math.abs(el.currentTime - targetTime) > driftThreshold) {
          el.currentTime = targetTime;
          if (!playing) {
            el.onseeked = () => drawPreviewFrame();
          }
        }
        if (playing && el.paused && speed <= 16) {
          el.play().catch(() => {});
        } else if ((!playing || speed > 16) && !el.paused) {
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
  function updateTrackSelectionBar() {
    const bar = $('trackSelectionBar');
    if (!bar) return;
    const count = state.selectedTrackIds.length;
    bar.classList.toggle('hidden', count === 0);
    if (count > 0) {
      $('trackSelCount').textContent = `${count} track${count > 1 ? 's' : ''}`;
      const renameBtn = $('btnRenameSelectedTrack');
      if (renameBtn) renameBtn.classList.toggle('hidden', count !== 1);
      const firstTrack = getTrackObj(state.selectedTrackIds[0]);
      if (firstTrack && $('trackSelColor')) {
        $('trackSelColor').value = firstTrack.color || getTrackDefaultColor(firstTrack);
      }
    }
  }

  function startTrackRename(track, nameEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'insp-input';
    input.value = track.name;
    input.style.height = '24px';
    input.style.padding = '2px 5px';
    input.style.fontSize = '11px';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const next = input.value.trim();
      if (next && next !== track.name) {
        pushHistory();
        track.name = next;
      }
      renderTimeline();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = track.name;
        input.blur();
      }
    });
  }

  function renderTimeline() {
    cleanupMediaPool();
    ensureProjectTracks(state.project);

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

    // Render Track Headers dynamically
    const headersEl = $('timelineHeaders');
    headersEl.querySelectorAll('.track-header').forEach((el) => el.remove());

    const lanesContainer = $('trackLanesContainer');
    lanesContainer.innerHTML = '';

    const visualCount = state.project.tracks.filter((t) => t.type === 'visual').length;
    const audioCount = state.project.tracks.filter((t) => t.type === 'audio').length;

    for (const track of state.project.tracks) {
      const isSelected = state.selectedTrackIds.includes(track.id);
      const hdr = document.createElement('div');
      hdr.className = `track-header ${isSelected ? 'selected' : ''} ${track.muted ? 'track-muted' : ''}`;
      hdr.dataset.track = track.id;

      const badgeClass =
        track.id === 'V2'
          ? 'track-v2'
          : track.id === 'V1'
            ? 'track-v1'
            : track.id === 'A1'
              ? 'track-a1'
              : track.id === 'A2'
                ? 'track-a2'
                : track.type === 'visual'
                  ? 'track-visual'
                  : 'track-audio';

      const canDelete = (track.type === 'visual' && visualCount > 1) || (track.type === 'audio' && audioCount > 1);
      const muteIcon = track.type === 'visual' ? (track.muted ? '🚫' : '👁') : track.muted ? '🔇' : '🔊';
      const trackColor = track.color || getTrackDefaultColor(track);

      hdr.style.borderLeft = `3px solid ${trackColor}`;
      hdr.innerHTML = `
        <span class="track-badge ${badgeClass}" style="background:${escapeHtml(trackColor)}">${escapeHtml(track.id)}</span>
        <span class="track-name" title="${escapeHtml(track.name)} (Double-click to rename)">${escapeHtml(track.name)}</span>
        <div class="track-hdr-actions">
          <button class="track-hdr-btn" data-act="rename" title="Rename Layer">✎</button>
          <input type="color" class="track-color-input" data-act="color" value="${escapeHtml(trackColor)}" title="Recolor Layer" />
          <button class="track-hdr-btn ${track.muted ? 'active' : ''}" data-act="mute" title="${track.type === 'visual' ? 'Hide/Show Layer' : 'Mute/Unmute Track'}">${muteIcon}</button>
          ${canDelete ? '<button class="track-hdr-btn" data-act="del" title="Delete Layer">✕</button>' : ''}
        </div>
      `;

      hdr.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
        if (e.shiftKey && state.lastSelectedTrackId) {
          const ids = state.project.tracks.map((t) => t.id);
          const a = ids.indexOf(state.lastSelectedTrackId);
          const b = ids.indexOf(track.id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a <= b ? [a, b] : [b, a];
            const rangeIds = ids.slice(lo, hi + 1);
            if (e.ctrlKey || e.metaKey) {
              state.selectedTrackIds = Array.from(new Set([...state.selectedTrackIds, ...rangeIds]));
            } else {
              state.selectedTrackIds = rangeIds;
            }
          }
        } else if (e.ctrlKey || e.metaKey) {
          if (state.selectedTrackIds.includes(track.id)) {
            state.selectedTrackIds = state.selectedTrackIds.filter((id) => id !== track.id);
          } else {
            state.selectedTrackIds = [...state.selectedTrackIds, track.id];
          }
          state.lastSelectedTrackId = track.id;
        } else {
          state.selectedTrackIds = [track.id];
          state.lastSelectedTrackId = track.id;
        }
        renderTimeline();
      });

      hdr.querySelector('.track-name').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startTrackRename(track, e.currentTarget);
      });

      hdr.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        startTrackRename(track, hdr.querySelector('.track-name'));
      });

      const colorInput = hdr.querySelector('[data-act="color"]');
      let beforeColorSnap = null;
      colorInput.addEventListener('click', (e) => e.stopPropagation());
      colorInput.addEventListener('input', (e) => {
        if (!beforeColorSnap) beforeColorSnap = createSnapshot();
        track.color = e.target.value;
        hdr.style.borderLeft = `3px solid ${track.color}`;
        hdr.querySelector('.track-badge').style.background = track.color;
        const laneEl = lanesContainer.querySelector(`.track-lane[data-track="${track.id}"]`);
        if (laneEl) laneEl.style.boxShadow = `inset 3px 0 0 ${track.color}`;
      });
      colorInput.addEventListener('change', (e) => {
        track.color = e.target.value;
        if (beforeColorSnap) {
          pushHistory(beforeColorSnap);
          beforeColorSnap = null;
        }
        renderTimeline();
      });

      hdr.querySelector('[data-act="mute"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTracksMute([track.id]);
      });

      const delBtn = hdr.querySelector('[data-act="del"]');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteTracks([track.id]);
        });
      }

      headersEl.appendChild(hdr);

      // Track Lane
      const lane = document.createElement('div');
      lane.className = 'track-lane';
      lane.dataset.track = track.id;
      lane.dataset.accept = track.type;
      lane.style.boxShadow = `inset 3px 0 0 ${trackColor}`;
      lanesContainer.appendChild(lane);
    }

    // Render Clips
    for (const clip of state.project.clips) {
      const isText = clip.clipType === 'text';
      const item = isText ? null : getLibItem(clip.libraryId);
      if (!isText && !item) continue;
      const lane = lanesContainer.querySelector(`.track-lane[data-track="${clip.track}"]`);
      if (!lane) continue;

      const el = document.createElement('div');
      let typeClass = 'type-video';
      if (isText) typeClass = 'type-text';
      else if (item.mediaType === 'audio') typeClass = 'type-audio';
      else if (item.mediaType === 'image') typeClass = 'type-image';
      else if (item.category === 'meme') typeClass = 'type-meme';

      const isSelected = state.selectedClipIds.includes(clip.id);
      el.className = `tl-clip ${typeClass} ${isSelected ? 'selected' : ''}`;
      el.style.left = `${clip.start * state.pxPerSec}px`;
      el.style.width = `${Math.max(18, clip.duration * state.pxPerSec)}px`;
      el.dataset.clipId = clip.id;

      const labelText = isText ? `T: ${(clip.text || 'Text').replace(/\n/g, ' ')}` : item.name;
      el.innerHTML = `
        <div class="trim-handle trim-left" data-trim="left"></div>
        <span class="tl-clip-label">${escapeHtml(labelText)}</span>
        <div class="trim-handle trim-right" data-trim="right"></div>
      `;

      el.addEventListener('mousedown', (e) => onClipMouseDown(e, clip, item));
      lane.appendChild(el);
    }

    updateTrackSelectionBar();
    updatePlayheadVisual(false);
  }

  function getSnapPoints(excludeClipIds) {
    const excluded = excludeClipIds instanceof Set ? excludeClipIds : new Set([excludeClipIds]);
    const pts = [0, state.playhead];
    for (const c of state.project.clips) {
      if (excluded.has(c.id)) continue;
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
    const isToggle = e.ctrlKey || e.metaKey || e.shiftKey;
    if (isToggle) {
      if (state.selectedClipIds.includes(clip.id)) {
        setSelectedClips(state.selectedClipIds.filter((id) => id !== clip.id));
      } else {
        setSelectedClips([...state.selectedClipIds, clip.id]);
      }
      renderTimeline();
      renderInspector();
      drawPreviewFrame();
      return;
    }

    if (!state.selectedClipIds.includes(clip.id)) {
      setSelectedClips([clip.id]);
      renderTimeline();
      renderInspector();
      drawPreviewFrame();
    }

    const trimSide = e.target.dataset.trim;
    const startX = e.clientX;
    const origStart = clip.start;
    const origDur = clip.duration;
    const origIn = clip.inPoint || 0;
    const origTrack = clip.track;
    const speed = Math.max(0.1, Math.min(100, clip.speed || 1));
    const beforeSnapshot = createSnapshot();
    const isText = clip.clipType === 'text';
    const maxSrcDur = isText || (item && item.mediaType === 'image') ? 3600 : (item && item.duration) || 60;

    // Multi-clip drag support
    const movingClips = state.project.clips.filter((c) => state.selectedClipIds.includes(c.id));
    const movingIds = new Set(movingClips.map((c) => c.id));
    const origStarts = new Map(movingClips.map((c) => [c.id, c.start]));
    const minOrigStart = Math.min(...movingClips.map((c) => c.start));
    const snapPts = getSnapPoints(movingIds);

    const onMove = (ev) => {
      const dxSec = (ev.clientX - startX) / state.pxPerSec;

      if (trimSide === 'left') {
        const maxDelta = origDur - 0.15;
        const minDelta = isText ? -origStart : -origIn / speed;
        const clamped = Math.max(minDelta, Math.min(maxDelta, dxSec));
        let newStart = Math.max(0, origStart + clamped);
        newStart = applySnap(newStart, snapPts);
        const appliedDelta = newStart - origStart;
        clip.start = newStart;
        if (!isText) {
          clip.inPoint = Math.max(0, origIn + appliedDelta * speed);
        }
        clip.duration = Math.max(0.15, origDur - appliedDelta);
      } else if (trimSide === 'right') {
        const maxDur = (maxSrcDur - origIn) / speed;
        let newEnd = Math.max(origStart + 0.15, origStart + Math.min(maxDur, origDur + dxSec));
        newEnd = applySnap(newEnd, snapPts);
        clip.duration = Math.max(0.15, Math.min(maxDur, newEnd - origStart));
      } else {
        let delta = dxSec;
        if (minOrigStart + delta < 0) delta = -minOrigStart;
        const snappedPrimary = applySnap(origStart + delta, snapPts);
        delta = snappedPrimary - origStart;
        if (minOrigStart + delta < 0) delta = -minOrigStart;

        for (const mc of movingClips) {
          mc.start = Math.max(0, origStarts.get(mc.id) + delta);
        }

        // Allow moving clicked clip between compatible tracks
        const targetLane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.track-lane');
        if (targetLane) {
          const tName = targetLane.dataset.track;
          const targetTrack = getTrackObj(tName);
          const isAudio = !isText && item && item.mediaType === 'audio';
          if (targetTrack && ((isAudio && targetTrack.type === 'audio') || (!isAudio && targetTrack.type === 'visual'))) {
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
      const changed =
        clip.start !== origStart ||
        clip.duration !== origDur ||
        (clip.inPoint || 0) !== origIn ||
        clip.track !== origTrack ||
        movingClips.some((mc) => mc.start !== origStarts.get(mc.id));
      if (changed) {
        pushHistory(beforeSnapshot);
      }
      syncMediaToPlayhead(state.isPlaying);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function initTimelineMarquee() {
    const lanesContainer = $('trackLanesContainer');
    const marqueeBox = $('marqueeBox');
    if (!lanesContainer || !marqueeBox) return;

    lanesContainer.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tl-clip') || e.button !== 0) return;
      const canvasRect = timelineCanvas.getBoundingClientRect();
      const startX = e.clientX - canvasRect.left;
      const startY = e.clientY - canvasRect.top;
      const keepExisting = e.ctrlKey || e.metaKey || e.shiftKey;
      const baseSelection = keepExisting ? [...state.selectedClipIds] : [];
      let moved = false;

      const onMove = (ev) => {
        const curX = ev.clientX - canvasRect.left;
        const curY = ev.clientY - canvasRect.top;
        if (!moved && Math.abs(curX - startX) < 5 && Math.abs(curY - startY) < 5) return;
        moved = true;

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);

        marqueeBox.classList.remove('hidden');
        marqueeBox.style.left = `${left}px`;
        marqueeBox.style.top = `${top}px`;
        marqueeBox.style.width = `${width}px`;
        marqueeBox.style.height = `${height}px`;

        const boxClientLeft = canvasRect.left + left;
        const boxClientRight = boxClientLeft + width;
        const boxClientTop = canvasRect.top + top;
        const boxClientBottom = boxClientTop + height;

        const hitIds = [...baseSelection];
        lanesContainer.querySelectorAll('.tl-clip').forEach((clipEl) => {
          const r = clipEl.getBoundingClientRect();
          const intersects =
            r.left < boxClientRight && r.right > boxClientLeft && r.top < boxClientBottom && r.bottom > boxClientTop;
          if (intersects) hitIds.push(clipEl.dataset.clipId);
        });
        setSelectedClips(hitIds);
        lanesContainer.querySelectorAll('.tl-clip').forEach((clipEl) => {
          clipEl.classList.toggle('selected', state.selectedClipIds.includes(clipEl.dataset.clipId));
        });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        marqueeBox.classList.add('hidden');
        if (!moved && !keepExisting) {
          setSelectedClips([]);
        }
        renderTimeline();
        renderInspector();
        drawPreviewFrame();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
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
    const targets = state.project.clips.filter((c) => state.selectedClipIds.includes(c.id));
    if (!targets.length) return showToast('Select a clip first');
    const t = state.playhead;
    const splittable = targets.filter((c) => t > c.start + 0.08 && t < c.start + c.duration - 0.08);
    if (!splittable.length) {
      return showToast('Move playhead inside the selected clip(s) to split');
    }

    pushHistory();
    const newIds = [];
    for (const clip of splittable) {
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
        inPoint: (clip.inPoint || 0) + leftDur * (clip.speed || 1),
        fadeIn: 0,
        fadeOut: origFadeOut,
      };
      state.project.clips.push(rightClip);
      newIds.push(rightClip.id);
    }

    setSelectedClips(newIds);
    renderTimeline();
    renderInspector();
  }

  function duplicateSelectedClip() {
    const targets = state.project.clips.filter((c) => state.selectedClipIds.includes(c.id));
    if (!targets.length) return showToast('Select a clip first');
    pushHistory();
    const newIds = [];
    for (const clip of targets) {
      const copy = {
        ...clip,
        id: uid(),
        start: clip.start + clip.duration + 0.1,
      };
      state.project.clips.push(copy);
      newIds.push(copy.id);
    }
    setSelectedClips(newIds);
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
  }

  function deleteSelectedClip() {
    if (!state.selectedClipIds.length) return;
    pushHistory();
    const delSet = new Set(state.selectedClipIds);
    state.project.clips = state.project.clips.filter((c) => !delSet.has(c.id));
    setSelectedClips([]);
    renderTimeline();
    renderInspector();
    drawPreviewFrame();
  }

  // --- Inspector ---
  function renderInspector() {
    const empty = $('inspectorEmpty');
    const form = $('inspectorForm');
    const multi = $('inspectorMulti');

    if (state.selectedClipIds.length > 1) {
      empty.classList.add('hidden');
      form.classList.add('hidden');
      multi.classList.remove('hidden');
      $('inspMultiCount').textContent = `${state.selectedClipIds.length} clips selected`;
      return;
    }

    multi.classList.add('hidden');
    const clip = state.project.clips.find((c) => c.id === state.selectedClipId);
    if (!clip) {
      empty.classList.remove('hidden');
      form.classList.add('hidden');
      return;
    }

    const isText = clip.clipType === 'text';
    const item = isText ? null : getLibItem(clip.libraryId);
    empty.classList.add('hidden');
    form.classList.remove('hidden');

    $('inspClipName').textContent = isText
      ? `Text (${clip.track})`
      : item
        ? `${item.name} (${clip.track})`
        : clip.track;
    $('inspStart').value = clip.start.toFixed(2);
    $('inspDuration').value = clip.duration.toFixed(2);
    $('inspFadeIn').value = (clip.fadeIn || 0).toFixed(1);
    $('inspFadeOut').value = (clip.fadeOut || 0).toFixed(1);
    $('inspVolume').value = clip.volume !== undefined ? clip.volume : 100;
    $('inspVolumeVal').textContent = `${$('inspVolume').value}%`;
    $('inspMuted').checked = !!clip.muted;

    const trackObj = getTrackObj(clip.track);
    const isVisual = isText || (trackObj ? trackObj.type === 'visual' : clip.track.startsWith('V'));
    const isImage = !isText && item && item.mediaType === 'image';

    $('inspTextSection').classList.toggle('hidden', !isText);
    $('inspTransformSection').classList.toggle('hidden', !isVisual);
    $('inspScaleGroup').classList.toggle('hidden', isText);
    $('btnResetPosition').classList.toggle('hidden', !isText);
    $('inspSpeedSection').classList.toggle('hidden', isText || isImage);
    $('inspAudioSection').classList.toggle('hidden', isText || isImage);
    $('inspMediaPropsGroup').classList.toggle('hidden', isText);

    if (isText) {
      $('inspTextContent').value = clip.text !== undefined ? clip.text : 'Your Text Here';
      $('inspFontFamily').value = clip.fontFamily || 'Arial';
      const fs = clip.fontSize || 64;
      $('inspFontSize').value = fs;
      $('inspFontSizeVal').textContent = `${fs}px`;
      $('inspTextBold').checked = clip.bold !== false;
      $('inspTextItalic').checked = !!clip.italic;
      $('inspTextColor').value = clip.color || '#ffffff';
      $('inspStrokeColor').value = clip.strokeColor || '#000000';
      const sw = clip.strokeWidth !== undefined ? clip.strokeWidth : 3;
      $('inspStrokeWidth').value = sw;
      $('inspStrokeWidthVal').textContent = `${sw}px`;
      $('inspBgColor').value = clip.bgColor || '#000000';
      const bo = clip.bgOpacity || 0;
      $('inspBgOpacity').value = bo;
      $('inspBgOpacityVal').textContent = `${bo}%`;
    } else if (!isImage) {
      const speed = Math.max(0.1, Math.min(100, clip.speed || 1));
      $('inspSpeed').value = Math.log10(speed).toFixed(3);
      $('inspSpeedVal').textContent = formatSpeed(speed);
    }

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

    if (!isText) {
      renderMediaProps($('inspMediaProps'), item);
    }
  }

  function bindInspectorInputs() {
    const getSelected = () => state.project.clips.find((c) => c.id === state.selectedClipId);
    const capturePending = () => {
      if (!pendingInspectorSnapshot) pendingInspectorSnapshot = createSnapshot();
    };
    const commitPending = () => {
      if (pendingInspectorSnapshot) {
        pushHistory(pendingInspectorSnapshot);
        pendingInspectorSnapshot = null;
      }
    };

    $('inspStart').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.start = Math.max(0, parseFloat(e.target.value) || 0);
      renderTimeline();
      drawPreviewFrame();
    });

    $('inspDuration').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.duration = Math.max(0.1, parseFloat(e.target.value) || 0.1);
      renderTimeline();
      drawPreviewFrame();
    });

    $('inspFadeIn').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.fadeIn = Math.max(0, parseFloat(e.target.value) || 0);
      syncMediaToPlayhead(state.isPlaying);
      drawPreviewFrame();
    });
    $('inspFadeIn').addEventListener('change', commitPending);

    $('inspFadeOut').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.fadeOut = Math.max(0, parseFloat(e.target.value) || 0);
      syncMediaToPlayhead(state.isPlaying);
      drawPreviewFrame();
    });
    $('inspFadeOut').addEventListener('change', commitPending);

    const applyClipSpeed = (c, newSpeed) => {
      const oldSpeed = Math.max(0.1, Math.min(100, c.speed || 1));
      const clampedSpeed = Math.round(Math.max(0.1, Math.min(100, newSpeed)) * 100) / 100;
      const sourceSpan = c.duration * oldSpeed;
      c.speed = clampedSpeed;
      c.duration = Math.max(0.1, sourceSpan / clampedSpeed);
      $('inspSpeedVal').textContent = formatSpeed(clampedSpeed);
      $('inspDuration').value = c.duration.toFixed(2);
      renderTimeline();
      syncMediaToPlayhead(state.isPlaying);
      drawPreviewFrame();
    };

    $('inspSpeed').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      const rawLog = parseFloat(e.target.value);
      const snappedLog = Math.abs(rawLog) < 0.025 ? 0 : rawLog;
      if (snappedLog === 0) e.target.value = '0';
      const newSpeed = snappedLog === 0 ? 1 : Math.pow(10, snappedLog);
      applyClipSpeed(c, newSpeed);
    });
    $('inspSpeed').addEventListener('change', commitPending);

    $('btnResetSpeed').addEventListener('click', () => {
      const c = getSelected();
      if (!c || (c.speed || 1) === 1) return;
      pushHistory();
      $('inspSpeed').value = '0';
      applyClipSpeed(c, 1);
    });

    $('inspVolume').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.volume = parseInt(e.target.value, 10);
      $('inspVolumeVal').textContent = `${c.volume}%`;
      syncMediaToPlayhead(state.isPlaying);
    });
    $('inspVolume').addEventListener('change', commitPending);

    $('inspMuted').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.muted = e.target.checked;
      syncMediaToPlayhead(state.isPlaying);
    });

    $('inspScale').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.scale = parseInt(e.target.value, 10);
      $('inspScaleVal').textContent = `${c.scale}%`;
      drawPreviewFrame();
    });
    $('inspScale').addEventListener('change', commitPending);

    $('inspX').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.x = parseInt(e.target.value, 10);
      $('inspXVal').textContent = `${c.x}%`;
      drawPreviewFrame();
    });
    $('inspX').addEventListener('change', commitPending);

    $('inspY').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.y = parseInt(e.target.value, 10);
      $('inspYVal').textContent = `${c.y}%`;
      drawPreviewFrame();
    });
    $('inspY').addEventListener('change', commitPending);

    $('inspOpacity').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.opacity = parseInt(e.target.value, 10);
      $('inspOpacityVal').textContent = `${c.opacity}%`;
      drawPreviewFrame();
    });
    $('inspOpacity').addEventListener('change', commitPending);

    $('btnResetTransform').addEventListener('click', () => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.scale = 100;
      c.x = 0;
      c.y = 0;
      c.opacity = 100;
      renderInspector();
      drawPreviewFrame();
    });

    $('btnResetPosition').addEventListener('click', () => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.x = 0;
      c.y = 0;
      renderInspector();
      drawPreviewFrame();
    });

    // Text Inspector Inputs
    $('inspTextContent').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.text = e.target.value;
      renderTimeline();
      drawPreviewFrame();
    });
    $('inspTextContent').addEventListener('change', commitPending);

    $('inspFontFamily').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.fontFamily = e.target.value;
      drawPreviewFrame();
    });

    $('inspFontSize').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.fontSize = parseInt(e.target.value, 10) || 64;
      $('inspFontSizeVal').textContent = `${c.fontSize}px`;
      drawPreviewFrame();
    });
    $('inspFontSize').addEventListener('change', commitPending);

    $('inspTextBold').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.bold = e.target.checked;
      drawPreviewFrame();
    });

    $('inspTextItalic').addEventListener('change', (e) => {
      const c = getSelected();
      if (!c) return;
      pushHistory();
      c.italic = e.target.checked;
      drawPreviewFrame();
    });

    $('inspTextColor').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.color = e.target.value;
      drawPreviewFrame();
    });
    $('inspTextColor').addEventListener('change', commitPending);

    $('inspStrokeColor').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.strokeColor = e.target.value;
      drawPreviewFrame();
    });
    $('inspStrokeColor').addEventListener('change', commitPending);

    $('inspStrokeWidth').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.strokeWidth = parseInt(e.target.value, 10) || 0;
      $('inspStrokeWidthVal').textContent = `${c.strokeWidth}px`;
      drawPreviewFrame();
    });
    $('inspStrokeWidth').addEventListener('change', commitPending);

    $('inspBgColor').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.bgColor = e.target.value;
      drawPreviewFrame();
    });
    $('inspBgColor').addEventListener('change', commitPending);

    $('inspBgOpacity').addEventListener('input', (e) => {
      const c = getSelected();
      if (!c) return;
      capturePending();
      c.bgOpacity = parseInt(e.target.value, 10) || 0;
      $('inspBgOpacityVal').textContent = `${c.bgOpacity}%`;
      drawPreviewFrame();
    });
    $('inspBgOpacity').addEventListener('change', commitPending);

    // Multi-Clip Inspector Inputs
    const getMultiSelected = () => state.project.clips.filter((c) => state.selectedClipIds.includes(c.id));
    $('inspMultiVolume').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      $('inspMultiVolVal').textContent = `${val}%`;
      capturePending();
      for (const c of getMultiSelected()) c.volume = val;
      syncMediaToPlayhead(state.isPlaying);
    });
    $('inspMultiVolume').addEventListener('change', commitPending);

    $('inspMultiMuted').addEventListener('change', (e) => {
      pushHistory();
      for (const c of getMultiSelected()) c.muted = e.target.checked;
      syncMediaToPlayhead(state.isPlaying);
    });

    $('inspMultiOpacity').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      $('inspMultiOpacityVal').textContent = `${val}%`;
      capturePending();
      for (const c of getMultiSelected()) c.opacity = val;
      drawPreviewFrame();
    });
    $('inspMultiOpacity').addEventListener('change', commitPending);

    $('btnMultiDup').addEventListener('click', duplicateSelectedClip);
    $('btnMultiDelete').addEventListener('click', deleteSelectedClip);
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

    // Drop onto Timeline tracks (event delegation for dynamic custom layers)
    const lanesContainer = $('trackLanesContainer');
    lanesContainer.addEventListener('dragover', (e) => {
      const lane = e.target.closest('.track-lane');
      if (!lane) return;
      e.preventDefault();
      lanesContainer.querySelectorAll('.track-lane.drop-target').forEach((l) => {
        if (l !== lane) l.classList.remove('drop-target');
      });
      lane.classList.add('drop-target');
    });
    lanesContainer.addEventListener('dragleave', (e) => {
      const lane = e.target.closest('.track-lane');
      if (lane && !lane.contains(e.relatedTarget)) {
        lane.classList.remove('drop-target');
      }
    });
    lanesContainer.addEventListener('drop', async (e) => {
      const lane = e.target.closest('.track-lane');
      if (!lane) return;
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
            ensureProjectTracks(state.project);
            setSelectedClips([]);
            state.selectedTrackIds = [];
            clearHistory();
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

    $('btnSelectAllLib').addEventListener('click', () => {
      state.selectedLibIds = getFilteredLibraryItems().map((i) => i.id);
      renderLibrary();
    });
    $('btnClearLibSel').addEventListener('click', () => {
      state.selectedLibIds = [];
      state.lastSelectedLibId = null;
      renderLibrary();
    });
    $('btnDeleteSelectedLib').addEventListener('click', () => {
      if (!state.selectedLibIds.length) return;
      deleteLibraryItemsByIds(state.selectedLibIds);
    });

    $('aspectSelect').addEventListener('change', (e) => {
      const [w, h] = e.target.value.split('x').map(Number);
      if (state.project.width !== w || state.project.height !== h) {
        pushHistory();
      }
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
        tracks: cloneDefaultTracks(),
        clips: [],
      };
      setSelectedClips([]);
      state.selectedTrackIds = [];
      clearHistory();
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

    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnSplit').addEventListener('click', splitSelectedClip);
    $('btnDuplicate').addEventListener('click', duplicateSelectedClip);
    $('btnDeleteClip').addEventListener('click', deleteSelectedClip);

    $('snapToggle').addEventListener('change', (e) => {
      state.snap = e.target.checked;
    });

    $('btnAddText').addEventListener('click', addTextClip);
    $('btnAddVideoLayer').addEventListener('click', () => addCustomLayer('visual'));
    $('btnAddAudioLayer').addEventListener('click', () => addCustomLayer('audio'));

    $('btnSelectTrackClips').addEventListener('click', () => {
      if (!state.selectedTrackIds.length) return;
      const trackSet = new Set(state.selectedTrackIds);
      const ids = state.project.clips.filter((c) => trackSet.has(c.track)).map((c) => c.id);
      setSelectedClips(ids);
      renderTimeline();
      renderInspector();
      drawPreviewFrame();
      showToast(`Selected ${ids.length} clip(s) across ${state.selectedTrackIds.length} track(s)`);
    });

    $('btnMuteSelectedTracks').addEventListener('click', () => {
      if (!state.selectedTrackIds.length) return;
      toggleTracksMute(state.selectedTrackIds);
    });

    $('btnRenameSelectedTrack').addEventListener('click', () => {
      if (state.selectedTrackIds.length !== 1) return;
      const track = getTrackObj(state.selectedTrackIds[0]);
      const nameEl = document.querySelector(`.track-header[data-track="${state.selectedTrackIds[0]}"] .track-name`);
      if (track && nameEl) startTrackRename(track, nameEl);
    });

    let beforeSelColorSnap = null;
    $('trackSelColor').addEventListener('input', (e) => {
      if (!state.selectedTrackIds.length) return;
      if (!beforeSelColorSnap) beforeSelColorSnap = createSnapshot();
      for (const id of state.selectedTrackIds) {
        const t = getTrackObj(id);
        if (t) t.color = e.target.value;
      }
      renderTimeline();
    });
    $('trackSelColor').addEventListener('change', (e) => {
      if (!state.selectedTrackIds.length) return;
      for (const id of state.selectedTrackIds) {
        const t = getTrackObj(id);
        if (t) t.color = e.target.value;
      }
      if (beforeSelColorSnap) {
        pushHistory(beforeSelColorSnap);
        beforeSelColorSnap = null;
      }
      renderTimeline();
    });

    $('btnDeleteSelectedTracks').addEventListener('click', () => {
      if (!state.selectedTrackIds.length) return;
      deleteTracks(state.selectedTrackIds);
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
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))
      ) {
        e.preventDefault();
        redo();
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
  initTimelineMarquee();
  initPreviewCanvasDrag();
  updateUndoRedoButtons();
  loadLibrary().then(handleInitialImportParam);
  renderTimeline();
  drawPreviewFrame();
})();
