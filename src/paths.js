// paths.js — harness-owned locations, OUTSIDE any agent-writable repo.
// pi-codegraph wraps the codebase-memory-mcp server. The record of which repos are
// trusted/indexed, and the path to the (untrusted, third-party) binary, live under
// the user's XDG dirs — never inside the repo being indexed. Mirrors pi-gate.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const XDG_STATE = process.env.XDG_STATE_HOME || path.join(HOME, '.local', 'state');
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

const CONFIG_ROOT = path.join(XDG_CONFIG, 'pi-codegraph');
const STATE_ROOT = path.join(XDG_STATE, 'pi-codegraph');
export const CONFIG_PATH = path.join(CONFIG_ROOT, 'config.json');   // { bin }
export const REGISTRY_PATH = path.join(CONFIG_ROOT, 'repos.json');  // repoId -> { path,label,trustedAt }

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

// Resolve the codebase-memory-mcp binary: env override > config.json > PATH default.
// The binary is third-party and untrusted; we only ever resolve a path to it here.
export function resolveBin() {
  if (process.env.PI_CODEGRAPH_BIN) return { bin: process.env.PI_CODEGRAPH_BIN, source: 'env' };
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.bin) return { bin: cfg.bin, source: 'config' };
  } catch { /* no config yet */ }
  return { bin: 'codebase-memory-mcp', source: 'PATH-default' };
}

export function setBin(binPath) {
  ensureDir(CONFIG_ROOT);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* fresh */ }
  cfg.bin = binPath;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return CONFIG_PATH;
}

// Stable repo identity = git root-commit sha, falling back to a path hash.
export function repoIdentity(repoDir) {
  try {
    const root = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'],
      { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    if (root) return { id: root, kind: 'root-commit' };
  } catch { /* not git */ }
  const h = crypto.createHash('sha256').update(path.resolve(repoDir)).digest('hex').slice(0, 16);
  return { id: `path-${h}`, kind: 'path-hash' };
}

export function stateDir(repoId) { return ensureDir(path.join(STATE_ROOT, repoId)); }

export function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return {}; }
}
export function writeRegistry(reg) {
  ensureDir(CONFIG_ROOT);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
  return REGISTRY_PATH;
}
export function repoTrust(repoDir) {
  const { id, kind } = repoIdentity(repoDir);
  const reg = readRegistry();
  return { trusted: !!reg[id], id, kind, entry: reg[id] || null };
}
export function trustRepo(repoDir, label) {
  const { id, kind } = repoIdentity(repoDir);
  const reg = readRegistry();
  reg[id] = { path: path.resolve(repoDir), label: label || path.basename(path.resolve(repoDir)), kind, trustedAt: new Date().toISOString() };
  writeRegistry(reg);
  return { id, entry: reg[id] };
}
