const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');

/**
 * Probe media file using `ffmpeg -i` (avoids needing a separate ffprobe binary).
 * Returns { duration, width, height, hasVideo, hasAudio }.
 */
function probeMedia(filePath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true }, (_err, _stdout, stderr) => {
      const text = stderr || '';
      let duration = 0;
      const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durMatch) {
        duration =
          parseInt(durMatch[1], 10) * 3600 +
          parseInt(durMatch[2], 10) * 60 +
          parseFloat(durMatch[3]);
      }

      const hasVideo = /Stream\s+#\d+:\d+.*Video:/i.test(text);
      const hasAudio = /Stream\s+#\d+:\d+.*Audio:/i.test(text);

      let width = 0;
      let height = 0;
      const resMatch = text.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/);
      if (resMatch) {
        width = parseInt(resMatch[1], 10);
        height = parseInt(resMatch[2], 10);
      }

      resolve({
        duration: Number.isFinite(duration) ? duration : 0,
        width,
        height,
        hasVideo,
        hasAudio,
      });
    });
  });
}

/**
 * Generate a JPEG thumbnail for video or image files.
 */
function generateThumbnail(filePath, outThumbPath, mediaType) {
  return new Promise((resolve) => {
    const args =
      mediaType === 'image'
        ? ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-vf', 'scale=320:-1', '-frames:v', '1', outThumbPath]
        : ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', filePath, '-vf', 'scale=320:-1', '-frames:v', '1', outThumbPath];

    execFile(ffmpegPath, args, { windowsHide: true }, (err) => {
      if (err && mediaType === 'video') {
        // Retry at 0s in case video is shorter than 0.5s
        execFile(
          ffmpegPath,
          ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-vf', 'scale=320:-1', '-frames:v', '1', outThumbPath],
          { windowsHide: true },
          (err2) => resolve(!err2 && fs.existsSync(outThumbPath))
        );
        return;
      }
      resolve(!err && fs.existsSync(outThumbPath));
    });
  });
}

/**
 * Chain FFmpeg atempo filters (each in [0.5, 2.0]) for any speed in [0.1, 100].
 */
function buildAtempoFilters(speed) {
  const filters = [];
  let rem = speed;
  while (rem > 2.0) {
    filters.push('atempo=2.0');
    rem /= 2.0;
  }
  while (rem < 0.5) {
    filters.push('atempo=0.5');
    rem /= 0.5;
  }
  if (Math.abs(rem - 1.0) > 0.0001) {
    filters.push(`atempo=${rem.toFixed(4)}`);
  }
  return filters;
}

/**
 * Render the timeline project to an MP4 file using FFmpeg.
 * @param {Object} project - { width, height, fps, clips: [...] }
 * @param {Map<string, Object>} libraryMap - id -> library item
 * @param {string} libraryDir - path to data/library
 * @param {string} outputPath - destination mp4 path
 * @param {Function} onProgress - callback(percent: number, statusText: string)
 */
function exportTimeline(project, libraryMap, libraryDir, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const width = project.width || 1280;
    const height = project.height || 720;
    const fps = project.fps || 30;
    const clips = Array.isArray(project.clips) ? project.clips : [];

    if (clips.length === 0) {
      return reject(new Error('Timeline has no clips to export.'));
    }

    // Compute total duration
    let totalDuration = 0;
    for (const c of clips) {
      const end = (c.start || 0) + (c.duration || 0);
      if (end > totalDuration) totalDuration = end;
    }
    if (totalDuration <= 0.05) {
      return reject(new Error('Timeline duration is too short.'));
    }

    // Sort visual clips by track layer (V1 bottom, V2 top) then start time
    const trackOrder = { V1: 1, V2: 2, V3: 3 };
    const visualClips = clips
      .filter((c) => {
        const item = libraryMap.get(c.libraryId);
        return item && (item.mediaType === 'video' || item.mediaType === 'image') && c.track && c.track.startsWith('V');
      })
      .sort((a, b) => (trackOrder[a.track] || 1) - (trackOrder[b.track] || 1) || a.start - b.start);

    const audioClips = clips.filter((c) => {
      const item = libraryMap.get(c.libraryId);
      if (!item) return false;
      if (c.muted || (c.volume !== undefined && c.volume <= 0)) return false;
      if (item.mediaType === 'audio') return true;
      if (item.mediaType === 'video' && item.hasAudio) return true;
      return false;
    });

    const args = ['-y', '-hide_banner'];
    // Input 0: base black canvas
    args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${totalDuration.toFixed(3)}`);

    // Map unique clip inputs
    const inputFiles = [];
    const clipInputIdx = new Map();

    for (const c of clips) {
      const item = libraryMap.get(c.libraryId);
      if (!item) continue;
      const filePath = path.join(libraryDir, item.filename);
      if (!fs.existsSync(filePath)) continue;

      const idx = inputFiles.length + 1; // 0 is base canvas
      inputFiles.push({ clip: c, item, filePath });
      clipInputIdx.set(c.id, idx);

      if (item.mediaType === 'image') {
        args.push('-loop', '1', '-t', (c.duration || 3).toFixed(3), '-i', filePath);
      } else {
        args.push('-i', filePath);
      }
    }

    const filterParts = [];
    let currentVideoLabel = '[0:v]';
    let vStep = 0;

    for (const c of visualClips) {
      const idx = clipInputIdx.get(c.id);
      if (idx === undefined) continue;
      const item = libraryMap.get(c.libraryId);
      const start = Math.max(0, c.start || 0);
      const dur = Math.max(0.05, c.duration || 1);
      const speed = Math.max(0.1, Math.min(100, c.speed || 1));
      const srcDur = dur * speed;
      const inPt = Math.max(0, c.inPoint || 0);
      const end = start + dur;

      // Overlay transform (defaults to full fit)
      const scalePct = c.scale !== undefined ? c.scale : 100;
      const targetW = Math.max(2, Math.round((width * scalePct) / 100 / 2) * 2);
      const targetH = Math.max(2, Math.round((height * scalePct) / 100 / 2) * 2);
      const posX = c.x !== undefined ? c.x : 0; // offset from center in %
      const posY = c.y !== undefined ? c.y : 0;

      const rawLabel = `[v_raw_${vStep}]`;
      const nextLabel = `[v_out_${vStep}]`;

      const opacity = Math.max(0, Math.min(1, (c.opacity !== undefined ? c.opacity : 100) / 100));
      const fadeIn = Math.min(dur, Math.max(0, c.fadeIn || 0));
      const fadeOut = Math.min(dur, Math.max(0, c.fadeOut || 0));

      const vFilters = [];
      if (item.mediaType === 'image') {
        vFilters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`, 'format=rgba');
      } else {
        vFilters.push(
          `trim=start=${inPt.toFixed(3)}:duration=${srcDur.toFixed(3)}`,
          speed !== 1 ? `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}` : 'setpts=PTS-STARTPTS',
          `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
          'format=rgba'
        );
      }

      if (opacity < 1) {
        vFilters.push(`colorchannelmixer=aa=${opacity.toFixed(3)}`);
      }
      if (fadeIn > 0) {
        vFilters.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}:alpha=1`);
      }
      if (fadeOut > 0) {
        vFilters.push(`fade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`);
      }
      vFilters.push(`setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`);

      filterParts.push(`[${idx}:v]${vFilters.join(',')}${rawLabel}`);

      const overlayX = `(W-w)/2+(W*${(posX / 100).toFixed(3)})`;
      const overlayY = `(H-h)/2+(H*${(posY / 100).toFixed(3)})`;

      filterParts.push(
        `${currentVideoLabel}${rawLabel}overlay=x=${overlayX}:y=${overlayY}:eof_action=pass:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${nextLabel}`
      );

      currentVideoLabel = nextLabel;
      vStep++;
    }

    // Ensure final video format is yuv420p
    const finalVideoLabel = '[v_final]';
    filterParts.push(`${currentVideoLabel}format=yuv420p${finalVideoLabel}`);

    // Audio chain
    const audioLabels = [];
    let aStep = 0;
    for (const c of audioClips) {
      const idx = clipInputIdx.get(c.id);
      if (idx === undefined) continue;
      const start = Math.max(0, c.start || 0);
      const dur = Math.max(0.05, c.duration || 1);
      const speed = Math.max(0.1, Math.min(100, c.speed || 1));
      const srcDur = dur * speed;
      const inPt = Math.max(0, c.inPoint || 0);
      const vol = c.volume !== undefined ? c.volume / 100 : 1;
      const delayMs = Math.round(start * 1000);
      const fadeIn = Math.min(dur, Math.max(0, c.fadeIn || 0));
      const fadeOut = Math.min(dur, Math.max(0, c.fadeOut || 0));

      const aFilters = [
        `atrim=start=${inPt.toFixed(3)}:duration=${srcDur.toFixed(3)}`,
        'asetpts=PTS-STARTPTS',
        ...buildAtempoFilters(speed),
        `volume=${vol.toFixed(3)}`,
      ];
      if (fadeIn > 0) {
        aFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      }
      if (fadeOut > 0) {
        aFilters.push(`afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
      }
      aFilters.push(`adelay=${delayMs}|${delayMs}`);

      const aLabel = `[a_${aStep}]`;
      filterParts.push(`[${idx}:a]${aFilters.join(',')}${aLabel}`);
      audioLabels.push(aLabel);
      aStep++;
    }

    if (audioLabels.length > 0) {
      filterParts.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0[a_final]`
      );
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', finalVideoLabel);

    if (audioLabels.length > 0) {
      args.push('-map', '[a_final]');
      args.push('-c:a', 'aac', '-b:a', '192k');
    } else {
      args.push('-an');
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-t',
      totalDuration.toFixed(3),
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      outputPath
    );

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderrLog = '';

    proc.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      const match = str.match(/out_time_ms=(\d+)/);
      if (match) {
        const outSec = parseInt(match[1], 10) / 1_000_000;
        const pct = Math.min(99, Math.max(1, Math.round((outSec / totalDuration) * 100)));
        if (onProgress) onProgress(pct, `Rendering... ${pct}%`);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrLog += chunk.toString();
      if (stderrLog.length > 8000) stderrLog = stderrLog.slice(-8000);
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        if (onProgress) onProgress(100, 'Export complete!');
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrLog.slice(-600)}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = {
  probeMedia,
  generateThumbnail,
  exportTimeline,
};
