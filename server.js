const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { probeMedia, generateThumbnail, exportTimeline } = require('./ffmpeg-helper');

const PORT = parseInt(process.env.PORT || '4173', 10);
const BASE_DIR = __dirname;
const DATA_DIR = path.join(BASE_DIR, 'data');
const LIBRARY_DIR = path.join(DATA_DIR, 'library');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const EXPORTS_DIR = path.join(BASE_DIR, 'exports');
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const LIBRARY_JSON = path.join(DATA_DIR, 'library.json');

// Ensure portable directories exist
for (const dir of [DATA_DIR, LIBRARY_DIR, THUMBS_DIR, PROJECTS_DIR, EXPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(LIBRARY_JSON)) {
  fs.writeFileSync(LIBRARY_JSON, '[]', 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

function readLibrary() {
  try {
    const raw = fs.readFileSync(LIBRARY_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLibrary(items) {
  fs.writeFileSync(LIBRARY_JSON, JSON.stringify(items, null, 2), 'utf8');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function serveFileWithRange(req, res, filePath, downloadName = null) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  };
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/"/g, '')}"`;
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...headers,
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function detectMediaType(ext, probe) {
  const audioExts = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma']);
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
  if (imageExts.has(ext)) return 'image';
  if (audioExts.has(ext)) return 'audio';
  if (probe && probe.hasVideo) return 'video';
  if (probe && probe.hasAudio) return 'audio';
  return 'video';
}

// Track active export jobs and pending Explorer imports
const exportJobs = new Map();
const pendingImports = [];

async function finalizeLibraryFile(destPath, id, rawName, category = 'auto') {
  const ext = path.extname(rawName).toLowerCase() || '.mp4';
  const baseName = path.basename(rawName, ext).replace(/[^\w\s\-.()\[\]]+/g, '_').trim() || 'clip';
  const stat = fs.statSync(destPath);
  const probe = await probeMedia(destPath);
  const mediaType = detectMediaType(ext, probe);
  const resolvedCategory =
    category === 'auto'
      ? mediaType === 'audio'
        ? 'sfx'
        : mediaType === 'image'
        ? 'image'
        : 'footage'
      : category;

  let thumbFilename = null;
  if (mediaType === 'video' || mediaType === 'image') {
    const tName = `${id}.jpg`;
    const tPath = path.join(THUMBS_DIR, tName);
    const ok = await generateThumbnail(destPath, tPath, mediaType);
    if (ok) thumbFilename = tName;
  }

  const item = {
    id,
    name: baseName,
    originalName: rawName,
    filename: path.basename(destPath),
    thumb: thumbFilename,
    mediaType,
    category: resolvedCategory,
    duration: mediaType === 'image' ? 5 : probe.duration || 5,
    width: probe.width || 0,
    height: probe.height || 0,
    hasAudio: probe.hasAudio,
    hasVideo: probe.hasVideo,
    size: stat.size,
    favorite: false,
    createdAt: new Date().toISOString(),
  };

  const items = readLibrary();
  items.unshift(item);
  writeLibrary(items);
  return item;
}

function runReg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// Optional auto-shutdown when launched in app mode
const AUTO_EXIT = process.argv.includes('--auto-exit');
let shutdownTimer = null;

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  try {
    // --- API: Health / Shutdown ---
    if (req.method === 'POST' && pathname === '/api/ping') {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/shutdown') {
      sendJson(res, 200, { ok: true });
      if (AUTO_EXIT) {
        if (shutdownTimer) clearTimeout(shutdownTimer);
        shutdownTimer = setTimeout(() => process.exit(0), 1500);
      }
      return;
    }

    // --- API: Library ---
    if (req.method === 'GET' && pathname === '/api/library') {
      return sendJson(res, 200, { items: readLibrary() });
    }

    if (req.method === 'POST' && pathname === '/api/library/upload') {
      const rawName = decodeURIComponent(req.headers['x-filename'] || 'media.bin');
      const category = (req.headers['x-category'] || 'auto').toLowerCase();
      const ext = path.extname(rawName).toLowerCase() || '.mp4';
      const id = crypto.randomUUID().slice(0, 12);
      const storedFilename = `${id}${ext}`;
      const destPath = path.join(LIBRARY_DIR, storedFilename);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(destPath);
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });

      const item = await finalizeLibraryFile(destPath, id, rawName, category);
      return sendJson(res, 201, { item });
    }

    if (req.method === 'POST' && pathname === '/api/import-path') {
      const body = await readJsonBody(req);
      const srcPath = body.filePath;
      if (!srcPath || !fs.existsSync(srcPath)) {
        return sendJson(res, 400, { error: 'Source file does not exist' });
      }
      const rawName = path.basename(srcPath);
      const ext = path.extname(rawName).toLowerCase() || '.mp4';
      const id = crypto.randomUUID().slice(0, 12);
      const destPath = path.join(LIBRARY_DIR, `${id}${ext}`);
      fs.copyFileSync(srcPath, destPath);

      const item = await finalizeLibraryFile(destPath, id, rawName, 'auto');
      if (body.queue !== false) {
        pendingImports.push(item.id);
      }
      return sendJson(res, 201, { item });
    }

    if (req.method === 'GET' && pathname === '/api/pending-imports') {
      const ids = pendingImports.splice(0, pendingImports.length);
      return sendJson(res, 200, { ids });
    }

    if (req.method === 'GET' && pathname === '/api/context-menu') {
      if (process.platform !== 'win32') {
        return sendJson(res, 200, { installed: false });
      }
      try {
        await runReg(['query', 'HKCU\\Software\\Classes\\*\\shell\\LightAFEditor']);
        return sendJson(res, 200, { installed: true });
      } catch {
        return sendJson(res, 200, { installed: false });
      }
    }

    if (req.method === 'POST' && pathname === '/api/context-menu') {
      if (process.platform !== 'win32') {
        return sendJson(res, 400, { error: 'Windows only' });
      }
      const body = await readJsonBody(req);
      const exePath = path.join(BASE_DIR, 'LightAFEditor.exe');
      const iconPath = path.join(PUBLIC_DIR, 'logo.ico');
      const starKey = 'HKCU\\Software\\Classes\\*\\shell\\LightAFEditor';
      const appKey = 'HKCU\\Software\\Classes\\Applications\\LightAFEditor.exe';
      const oldKinds = ['video', 'audio', 'image'];

      if (body.action === 'uninstall') {
        await runReg(['delete', starKey, '/f']).catch(() => {});
        await runReg(['delete', appKey, '/f']).catch(() => {});
        for (const k of oldKinds) {
          await runReg(['delete', `HKCU\\Software\\Classes\\SystemFileAssociations\\${k}\\shell\\LightAFEditor`, '/f']).catch(() => {});
        }
        return sendJson(res, 200, { ok: true, installed: false });
      }

      const exts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
      const appliesTo = exts.map((e) => `System.FileExtension:="${e}"`).join(' OR ');

      await runReg(['add', starKey, '/ve', '/d', 'Edit with LightAF Editor', '/f']);
      await runReg(['add', starKey, '/v', 'Icon', '/d', iconPath, '/f']);
      await runReg(['add', starKey, '/v', 'Position', '/d', 'Top', '/f']);
      await runReg(['add', starKey, '/v', 'AppliesTo', '/d', appliesTo, '/f']);
      await runReg(['add', `${starKey}\\command`, '/ve', '/d', `"${exePath}" "%1"`, '/f']);

      // Register in "Open with ->"
      await runReg(['add', appKey, '/v', 'FriendlyAppName', '/d', 'LightAF Editor', '/f']);
      await runReg(['add', `${appKey}\\DefaultIcon`, '/ve', '/d', iconPath, '/f']);
      await runReg(['add', `${appKey}\\shell\\open\\command`, '/ve', '/d', `"${exePath}" "%1"`, '/f']);
      for (const ext of exts) {
        await runReg(['add', `${appKey}\\SupportedTypes`, '/v', ext, '/d', '', '/f']);
      }
      return sendJson(res, 200, { ok: true, installed: true });
    }

    if (req.method === 'PATCH' && pathname.startsWith('/api/library/')) {
      const id = pathname.slice('/api/library/'.length);
      const body = await readJsonBody(req);
      const items = readLibrary();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Item not found' });

      if (typeof body.name === 'string' && body.name.trim()) {
        items[idx].name = body.name.trim();
      }
      if (typeof body.category === 'string') {
        items[idx].category = body.category;
      }
      if (typeof body.favorite === 'boolean') {
        items[idx].favorite = body.favorite;
      }
      writeLibrary(items);
      return sendJson(res, 200, { item: items[idx] });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/library/')) {
      const id = pathname.slice('/api/library/'.length);
      const items = readLibrary();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Item not found' });

      const [removed] = items.splice(idx, 1);
      writeLibrary(items);

      const mediaPath = path.join(LIBRARY_DIR, removed.filename);
      if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
      if (removed.thumb) {
        const thumbPath = path.join(THUMBS_DIR, removed.thumb);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }

      return sendJson(res, 200, { ok: true });
    }

    // --- API: Projects ---
    if (req.method === 'GET' && pathname === '/api/projects') {
      const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json'));
      const projects = files
        .map((f) => {
          try {
            const p = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
            return {
              id: p.id || f.replace(/\.json$/, ''),
              name: p.name || f.replace(/\.json$/, ''),
              updatedAt: p.updatedAt || '',
              clipCount: Array.isArray(p.clips) ? p.clips.length : 0,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return sendJson(res, 200, { projects });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/projects/')) {
      const id = pathname.slice('/api/projects/'.length).replace(/[^\w\-]/g, '');
      const filePath = path.join(PROJECTS_DIR, `${id}.json`);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'Project not found' });
      const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return sendJson(res, 200, { project });
    }

    if (req.method === 'POST' && pathname === '/api/projects') {
      const body = await readJsonBody(req);
      const id = (body.id || crypto.randomUUID().slice(0, 10)).replace(/[^\w\-]/g, '');
      const project = {
        ...body,
        id,
        name: (body.name || 'Untitled Project').trim(),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(PROJECTS_DIR, `${id}.json`), JSON.stringify(project, null, 2), 'utf8');
      return sendJson(res, 200, { project });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/projects/')) {
      const id = pathname.slice('/api/projects/'.length).replace(/[^\w\-]/g, '');
      const filePath = path.join(PROJECTS_DIR, `${id}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return sendJson(res, 200, { ok: true });
    }

    // --- API: Export ---
    if (req.method === 'POST' && pathname === '/api/export') {
      const body = await readJsonBody(req);
      const items = readLibrary();
      const libraryMap = new Map(items.map((i) => [i.id, i]));

      const safeName = (body.name || 'export')
        .replace(/[^\w\s\-]+/g, '_')
        .trim()
        .replace(/\s+/g, '_') || 'export';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outFilename = `${safeName}_${stamp}.mp4`;
      const outPath = path.join(EXPORTS_DIR, outFilename);
      const jobId = crypto.randomUUID().slice(0, 10);

      const job = {
        id: jobId,
        status: 'running',
        progress: 0,
        message: 'Starting FFmpeg...',
        filename: outFilename,
        downloadUrl: `/exports/${encodeURIComponent(outFilename)}`,
        error: null,
      };
      exportJobs.set(jobId, job);

      exportTimeline(body, libraryMap, LIBRARY_DIR, outPath, (pct, msg) => {
        job.progress = pct;
        job.message = msg;
      })
        .then(() => {
          job.status = 'done';
          job.progress = 100;
          job.message = 'Export complete!';
        })
        .catch((err) => {
          job.status = 'error';
          job.error = err.message || 'Export failed';
          job.message = 'Export failed';
        });

      return sendJson(res, 202, { jobId });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/export/')) {
      const jobId = pathname.slice('/api/export/'.length);
      const job = exportJobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: 'Job not found' });
      return sendJson(res, 200, job);
    }

    if (req.method === 'POST' && pathname === '/api/open-exports') {
      if (process.platform === 'win32') {
        execFile('explorer.exe', [EXPORTS_DIR], { windowsHide: false }, () => {});
      }
      return sendJson(res, 200, { ok: true, path: EXPORTS_DIR });
    }

    // --- Media / Thumbs / Exports ---
    if (req.method === 'GET' && pathname.startsWith('/media/')) {
      const fname = path.basename(pathname.slice('/media/'.length));
      return serveFileWithRange(req, res, path.join(LIBRARY_DIR, fname));
    }

    if (req.method === 'GET' && pathname.startsWith('/thumbs/')) {
      const fname = path.basename(pathname.slice('/thumbs/'.length));
      return serveFileWithRange(req, res, path.join(THUMBS_DIR, fname));
    }

    if (req.method === 'GET' && pathname.startsWith('/exports/')) {
      const fname = path.basename(pathname.slice('/exports/'.length));
      return serveFileWithRange(req, res, path.join(EXPORTS_DIR, fname), fname);
    }

    // --- Static Public UI ---
    let relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, relPath);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LightAF Editor running at http://127.0.0.1:${PORT}`);
});
