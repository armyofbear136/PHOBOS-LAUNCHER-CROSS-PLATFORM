'use strict';

const path = require('path');
const os   = require('os');

// ─── Root path resolution ────────────────────────────────────────────────────
// On Windows/Linux, process.cwd() or PORTABLE_EXECUTABLE_DIR is the launcher's directory.
// On macOS, process.cwd() returns '/' (read-only root) when launched from Finder/Dock.
// Use the directory containing the .app bundle so PHOBOS files live next to the launcher.
// If running from a DMG (read-only mount), fall back to ~/Library/Application Support/.
function resolveRootPath() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'PHOBOSLauncher');
  }
  return process.cwd();
}
const rootPath    = resolveRootPath();
const platformKey = `${process.platform}-${process.arch}`;

exports.ROOT_PATH = rootPath;

// ─── Release config ──────────────────────────────────────────────────────────
// PHOBOS-core builds are published as GitHub release assets.
// version.txt is a sibling asset that contains just the version string.
const RELEASE_TAG  = 'PHOBOS-CORE-LATEST';
const RELEASE_BASE = `https://github.com/armyofbear136/PHOBOS-BUILDS/releases/download/${RELEASE_TAG}`;

// Platform → archive name mapping (matches build:full output)
const ARCHIVE_MAP = {
  'win32-x64':    { name: 'phobos-win32-x64.7z',            pack: '7z'  },
  'darwin-arm64':  { name: 'phobos-darwin-arm64.tar.gz',     pack: 'tar' },
  'darwin-x64':    { name: 'phobos-darwin-x64.tar.gz',       pack: 'tar' },
  'linux-x64':     { name: 'phobos-linux-x64.tar.gz',       pack: 'tar' },
  'linux-arm64':   { name: 'phobos-linux-arm64.tar.gz',     pack: 'tar' },
};

const archive = ARCHIVE_MAP[platformKey] || ARCHIVE_MAP['win32-x64'];

exports.VERSION_URL   = `${RELEASE_BASE}/version.txt`;
exports.DOWNLOAD_URL  = `${RELEASE_BASE}/${archive.name}`;
exports.ARCHIVE_NAME  = archive.name;
exports.ARCHIVE_TYPE  = archive.pack;  // '7z' or 'tar'

// ─── Local paths ─────────────────────────────────────────────────────────────
exports.VERSION_FILE  = path.join(rootPath, 'phobos-version.txt');
exports.ARCHIVE_PATH  = path.join(rootPath, archive.name);
exports.CORE_DIR      = path.join(rootPath, 'PHOBOS');
exports.CORE_BINARY   = process.platform === 'win32'
  ? path.join(rootPath, 'PHOBOS', 'phobos-core.exe')
  : path.join(rootPath, 'PHOBOS', 'phobos-core');
exports.LOG_FILE      = path.join(rootPath, 'PHOBOS', 'phobos.log');

// ─── Status endpoint ─────────────────────────────────────────────────────────
exports.CORE_PORT       = 3001;
exports.STATUS_URL      = 'http://127.0.0.1:3001/api/status';
exports.STATUS_POLL_MS  = 3000;

// ─── Links ───────────────────────────────────────────────────────────────────
exports.DISCORD_URL = 'https://discord.gg/mDDB2Kfafa';
exports.WEBSITE_URL = 'https://autarch.net';
