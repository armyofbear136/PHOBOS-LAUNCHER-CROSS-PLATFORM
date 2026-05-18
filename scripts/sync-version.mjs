#!/usr/bin/env node
// scripts/sync-version.mjs — Sync package.json version from version.txt
//
// electron-builder reads the version from package.json to name artifacts and
// populate app.getVersion(). This script patches it in-place before every build
// so the artifact names and self-update check always reflect the version.txt value.
//
// version.txt is the single source of truth — edit that file to bump
// the launcher version, then rebuild. package.json version is considered derived.

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verFile   = path.join(root, 'version.txt');
const pkgFile   = path.join(root, 'package.json');

const version = fs.readFileSync(verFile, 'utf8').trim();
if (!version) { console.error('❌ version.txt is empty'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.version === version) {
  console.log(`✅ package.json already at v${version}`);
  process.exit(0);
}

pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✅ package.json version → ${version}`);
