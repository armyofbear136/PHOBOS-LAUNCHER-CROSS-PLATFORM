'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const { spawn, execFile } = require('child_process');

const cfg = require('./config');

let mainWindow = null;
let coreProc   = null;
let polling    = null;

const isDev = process.argv.includes('--dev');

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480, height: 680,
    resizable: false, frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // Check for updates on launch (no auto-download — user must click)
  setImmediate(() => checkVersion());
});

app.on('window-all-closed', () => { stopCore(); stopPolling(); app.quit(); });
app.on('before-quit', () => { stopCore(); stopPolling(); });

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('window:close',    () => { stopCore(); app.quit(); });
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('shell:openUrl',   (_, url) => shell.openExternal(url));
ipcMain.handle('core:start',      () => startCore());
ipcMain.handle('core:stop',       () => { stopCore(); send('status', { state: 'stopped', message: 'Stopped' }); });
ipcMain.handle('core:checkUpdate',() => checkVersion());
ipcMain.handle('core:download',   () => downloadAndInstall());

function send(ch, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
}

// ─── Version check (no download — just reports state) ────────────────────────
let _remoteVer = null;

async function checkVersion() {
  send('status', { state: 'checking', message: 'Checking for updates…' });

  let localVer = null;
  try { localVer = fs.readFileSync(cfg.VERSION_FILE, 'utf8').trim(); } catch {}

  try { _remoteVer = (await fetchText(cfg.VERSION_URL)).trim(); } catch {
    // Offline
    if (fs.existsSync(cfg.CORE_BINARY)) {
      send('version', { local: localVer, remote: null });
      send('status', { state: 'ready', message: 'Offline — ready to launch' });
    } else {
      send('status', { state: 'no-install', message: 'No internet and no local install' });
    }
    return;
  }

  send('version', { local: localVer, remote: _remoteVer });

  if (localVer === _remoteVer && fs.existsSync(cfg.CORE_BINARY)) {
    send('status', { state: 'ready', message: 'Up to date' });
    return;
  }

  if (fs.existsSync(cfg.CORE_BINARY)) {
    // Update available
    send('status', { state: 'update-available', message: `Update available: v${_remoteVer}` });
  } else {
    // Fresh install needed
    send('status', { state: 'needs-download', message: 'PHOBOS Core not installed' });
  }
}

// ─── Download + install (user-triggered) ──────────────────────────────────────
async function downloadAndInstall() {
  const remoteVer = _remoteVer;
  if (!remoteVer) { send('status', { state: 'error', message: 'No version info — check update first' }); return; }

  const action = fs.existsSync(cfg.CORE_BINARY) ? 'Updating…' : 'Downloading…';
  send('status', { state: 'downloading', message: action, progress: 0 });

  try {
    await downloadFile(cfg.DOWNLOAD_URL, cfg.ARCHIVE_PATH, (pct, received, total, speed, eta) => {
      send('status', {
        state: 'downloading', message: action, progress: pct,
        received: fmtBytes(received), total: fmtBytes(total),
        speed: fmtBytes(speed) + '/s', eta: fmtEta(eta),
      });
    });

    send('status', { state: 'extracting', message: 'Extracting…' });
    await extractArchive(cfg.ARCHIVE_PATH, cfg.CORE_DIR, cfg.ARCHIVE_TYPE);
    try { fs.unlinkSync(cfg.ARCHIVE_PATH); } catch {}

    if (process.platform !== 'win32' && fs.existsSync(cfg.CORE_BINARY)) {
      fs.chmodSync(cfg.CORE_BINARY, 0o755);
    }

    fs.writeFileSync(cfg.VERSION_FILE, remoteVer, 'utf8');
    send('version', { local: remoteVer, remote: remoteVer });
    send('status', { state: 'ready', message: 'Ready' });
  } catch (err) {
    send('status', { state: 'error', message: err.message });
  }
}

// ─── Extract ─────────────────────────────────────────────────────────────────
async function extractArchive(archivePath, destDir, type) {
  fs.mkdirSync(destDir, { recursive: true });

  if (type === '7z') {
    // Windows: use 7z.exe if available, fall back to tar, then AdmZip
    try {
      await execFileP('7z', ['x', `-o${destDir}`, '-y', archivePath], { timeout: 300000 });
      return;
    } catch {}
    try {
      await execFileP('tar', ['xf', archivePath, '-C', destDir], { timeout: 300000 });
      return;
    } catch {}
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destDir, true);
  } else {
    // tar.gz on macOS/Linux
    try {
      await execFileP('tar', ['xzf', archivePath, '-C', destDir], { timeout: 300000 });
    } catch (err) {
      console.error('[Launcher] tar extraction failed:', err.message);
      throw new Error(`Extraction failed: ${err.message}`);
    }
  }

  // macOS: chmod all executables in the extracted directory
  if (process.platform !== 'win32') {
    try {
      const entries = fs.readdirSync(destDir);
      for (const entry of entries) {
        const full = path.join(destDir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && !entry.includes('.')) {
          fs.chmodSync(full, 0o755);
        }
      }
    } catch {}
  }
}

// ─── Core process management ─────────────────────────────────────────────────
function startCore() {
  if (coreProc) { send('status', { state: 'running', message: 'Already running' }); return; }
  if (!fs.existsSync(cfg.CORE_BINARY)) {
    send('status', { state: 'error', message: 'PHOBOS Core not installed' });
    return;
  }

  send('status', { state: 'starting', message: 'Starting PHOBOS Core…' });

  // Pipe stdout/stderr to log file
  const logStream = fs.createWriteStream(cfg.LOG_FILE, { flags: 'a' });

  coreProc = spawn(cfg.CORE_BINARY, [], {
    cwd: cfg.CORE_DIR, detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  coreProc.stdout.pipe(logStream);
  coreProc.stderr.pipe(logStream);
  coreProc.on('exit', (code) => {
    coreProc = null;
    stopPolling();
    send('status', { state: 'stopped', message: code === 0 ? 'Stopped' : `Exited (code ${code})` });
  });
  coreProc.on('error', (err) => {
    coreProc = null;
    stopPolling();
    send('status', { state: 'error', message: err.message });
  });

  // Start polling /api/status
  startPolling();
}

function stopCore() {
  if (!coreProc) return;
  try { coreProc.kill('SIGTERM'); } catch {}
  coreProc = null;
  stopPolling();
}

// ─── Status polling ──────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  const startedAt = Date.now();
  const STARTUP_TIMEOUT = 60000; // 60s — phobos-core can take a while to init

  polling = setInterval(async () => {
    try {
      const data = await fetchLocalJson(cfg.STATUS_URL);
      send('status', {
        state: 'running',
        message: 'Running',
        coordinator: data.coordinatorModel || null,
        engine: data.engineModel || null,
        coordinatorStatus: data.coordinator || 'disconnected',
        engineStatus: data.engine || 'disconnected',
      });
    } catch {
      // Still starting — phobos-core takes time to bind the port
      const elapsed = Date.now() - startedAt;
      if (elapsed < STARTUP_TIMEOUT) {
        send('status', { state: 'starting', message: 'Starting PHOBOS Core…' });
      } else if (coreProc) {
        // Process is alive but not responding — keep trying but show warning
        send('status', { state: 'starting', message: 'Waiting for PHOBOS Core to respond…' });
      } else {
        // Process died — stop polling
        stopPolling();
        send('status', { state: 'error', message: 'PHOBOS Core failed to start' });
      }
    }
  }, cfg.STATUS_POLL_MS);
}

function stopPolling() {
  if (polling) { clearInterval(polling); polling = null; }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetchText(res.headers.location).then(resolve).catch(reject);
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchLocalJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad json')); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let lastBytes = 0, lastTime = Date.now();
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const fail = (err) => { if (!resolved) { resolved = true; reject(err); } };

    const doGet = (u) => {
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location);
        if (res.statusCode !== 200) return fail(new Error(`HTTP ${res.statusCode}`));
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          const now = Date.now(), elapsed = (now - lastTime) / 1000;
          if (elapsed >= 0.5 || received === total) {
            const speed = elapsed > 0 ? (received - lastBytes) / elapsed : 0;
            const eta = speed > 0 ? (total - received) / speed : 0;
            lastBytes = received; lastTime = now;
            const pct = total > 0 ? Math.round(received / total * 100) : 0;
            if (onProgress) onProgress(pct, received, total, speed, eta);
          }
        });
        res.pipe(out);
        out.on('finish', done);
        out.on('close', done);   // safety — macOS sometimes fires close but not finish
        out.on('error', fail);
        res.on('error', fail);
      }).on('error', fail);
    };
    doGet(url);
  });
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout, stderr });
    });
  });
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtEta(s) {
  if (!s || s <= 0) return '';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
