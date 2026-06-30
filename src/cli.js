// cli.js — pi-codegraph command handlers. Built on cli-foundation (JSON default, -H).
//
// pi-codegraph is a Pi-agent extension that wraps the codebase-memory-mcp server:
// it gives an agent DERIVED knowledge — call graphs, blast radius, architecture —
// extracted from the code, so the agent stops re-greping the repo every session.
// Pairs with pi-okf (authored knowledge). The codebase-memory-mcp binary is a
// third-party, untrusted dependency; we only ever resolve a path to it and speak
// MCP to it. The trusted-repo registry is harness-owned, like pi-gate.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as fdn from '../vendor/foundation.js';
import { callTool, listTools, buildRequests } from './mcp.js';
import { resolveBin, setBin, repoTrust, trustRepo, readRegistry, CONFIG_PATH, REGISTRY_PATH } from './paths.js';

const repoOf = (flags) => path.resolve(flags.repo || process.cwd());

function parseArgsJson(flags) {
  if (!flags.args) return {};
  try { return JSON.parse(flags.args); }
  catch (e) { console.error(`--args is not valid JSON: ${e.message}`); process.exit(1); }
}

// Live calls require the repo to be a trusted/registered codegraph source, mirroring
// pi-gate's detect-only gate. --override "<reason>" bypasses with an audit trail.
function gateRepo(repo, flags) {
  const t = repoTrust(repo);
  const override = typeof flags.override === 'string' && flags.override.trim();
  if (!t.trusted && !override) {
    fdn.out({ ok: false, blocked: true, repo, repoId: t.id, trusted: false,
      hint: 'register the repo first: `pi-codegraph trust --repo <path>`, or pass --override "<reason>"' });
    process.exit(1);
  }
  return { ...t, override: override || null };
}

async function runTool(tool, toolArgs, flags, { human }) {
  const repo = repoOf(flags);
  const gate = gateRepo(repo, flags);
  const { bin } = resolveBin();
  try {
    const result = await callTool({ bin, cwd: repo, tool, toolArgs, timeoutMs: Number(flags.timeout) || 120000 });
    fdn.emit({ ok: true, tool, repo, repoId: gate.id, override: gate.override, result },
      { human, table: () => typeof result === 'string' ? result : JSON.stringify(result, null, 2) });
  } catch (e) {
    fdn.out({ ok: false, tool, repo, error: e.message,
      hint: 'is the codebase-memory-mcp binary installed? run `pi-codegraph doctor`' });
    process.exit(1);
  }
}

// pi-codegraph doctor — is the wrapped binary present, and what version?
function doctor(_flags, { human }) {
  const { bin, source } = resolveBin();
  let present = false, version = null, error = null;
  try { version = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); present = true; }
  catch (e) { error = e.code === 'ENOENT' ? 'binary not found' : e.message; }
  const data = { bin, binSource: source, present, version, error,
    config: CONFIG_PATH, registry: REGISTRY_PATH,
    install: present ? null : 'see https://github.com/DeusData/codebase-memory-mcp — then `pi-codegraph config-bin <path>` or set PI_CODEGRAPH_BIN' };
  fdn.emit(data, { human, table: () =>
    `binary:   ${bin}  (${source})\npresent:  ${present ? 'YES' : 'NO'}${version ? '  version=' + version : ''}` +
    (error ? `\nerror:    ${error}` : '') + (data.install ? `\ninstall:  ${data.install}` : '') });
  process.exit(present ? 0 : 1);
}

// pi-codegraph plan <tool> [--args JSON] — show the JSON-RPC we would send. No spawn.
function plan(args, flags, { human }) {
  const tool = args[0];
  if (!tool) { console.error('usage: pi-codegraph plan <tool> [--args JSON] [--repo PATH]'); process.exit(1); }
  const repo = repoOf(flags);
  const { bin, source } = resolveBin();
  const t = repoTrust(repo);
  const requests = buildRequests('tools/call', { name: tool, arguments: parseArgsJson(flags) });
  const data = { bin, binSource: source, repo, repoId: t.id, trusted: t.trusted, transport: 'stdio/jsonrpc', requests };
  fdn.emit(data, { human, table: () =>
    `bin: ${bin} (${source})  repo: ${repo}  trusted: ${t.trusted}\n--- would send (newline-delimited JSON-RPC) ---\n` +
    requests.map(r => JSON.stringify(r)).join('\n') });
}

// pi-codegraph tools — list the tools the live server exposes.
async function tools(flags, { human }) {
  const repo = repoOf(flags);
  gateRepo(repo, flags);
  const { bin } = resolveBin();
  try {
    const res = await listTools({ bin, cwd: repo });
    const list = (res.tools || []).map(t => ({ name: t.name, description: (t.description || '').split('\n')[0] }));
    fdn.emit(human ? list : { ok: true, repo, tools: list }, { human, table: () =>
      fdn.table(list, [{ key: 'name', label: 'TOOL', width: 22 }, { key: 'description', label: 'DESCRIPTION' }]) });
  } catch (e) { fdn.out({ ok: false, error: e.message, hint: 'run `pi-codegraph doctor`' }); process.exit(1); }
}

function trust(flags) {
  const repo = repoOf(flags);
  const { id, entry } = trustRepo(repo, typeof flags.label === 'string' ? flags.label : undefined);
  fdn.out({ ok: true, trusted: id, ...entry, registry: REGISTRY_PATH });
}
function repos(_flags, { human }) {
  const reg = readRegistry();
  const rows = Object.entries(reg).map(([id, e]) => ({ id, label: e.label, path: e.path, trustedAt: e.trustedAt }));
  fdn.emit(human ? rows : { registry: REGISTRY_PATH, repos: rows }, { human, table: () =>
    fdn.table(rows, [{ key: 'label', label: 'LABEL', width: 18 }, { key: 'id', label: 'ID', width: 18 }, { key: 'path', label: 'PATH' }]) });
}
function configBin(args) {
  const p = args[0];
  if (!p) { console.error('usage: pi-codegraph config-bin <path-to-codebase-memory-mcp>'); process.exit(1); }
  fdn.out({ ok: true, config: setBin(p), bin: p });
}

export const commands = {
  doctor(args, ctx) { return doctor(fdn.parseArgs(args, []).flags, ctx); },
  plan(args, ctx) { const { flags, positional } = fdn.parseArgs(args, ['args', 'repo']); return plan(positional, flags, ctx); },
  tools(args, ctx) { return tools(fdn.parseArgs(args, ['repo', 'override']).flags, ctx); },
  query(args, ctx) {
    const { flags, positional } = fdn.parseArgs(args, ['args', 'repo', 'override', 'timeout']);
    const tool = positional[0];
    if (!tool) { console.error('usage: pi-codegraph query <tool> [--args JSON] [--repo PATH] [--override R]'); process.exit(1); }
    return runTool(tool, parseArgsJson(flags), flags, ctx);
  },
  // convenience wrappers over codebase-memory-mcp's tools
  trace(args, ctx) {
    const { flags, positional } = fdn.parseArgs(args, ['repo', 'direction', 'depth', 'override']);
    if (!positional[0]) { console.error('usage: pi-codegraph trace <function> [--direction inbound|outbound] [--depth N]'); process.exit(1); }
    return runTool('trace_path', { function_name: positional[0], direction: flags.direction || 'inbound', depth: Number(flags.depth) || 2 }, flags, ctx);
  },
  arch(args, ctx) { return runTool('get_architecture', {}, fdn.parseArgs(args, ['repo', 'override']).flags, ctx); },
  impact(args, ctx) { return runTool('detect_changes', {}, fdn.parseArgs(args, ['repo', 'override']).flags, ctx); },
  schema(args, ctx) { return runTool('get_graph_schema', {}, fdn.parseArgs(args, ['repo', 'override']).flags, ctx); },
  search(args, ctx) {
    const { flags, positional } = fdn.parseArgs(args, ['repo', 'override']);
    if (!positional[0]) { console.error('usage: pi-codegraph search <query>'); process.exit(1); }
    return runTool('semantic_query', { query: positional.join(' ') }, flags, ctx);
  },
  snippet(args, ctx) {
    const { flags, positional } = fdn.parseArgs(args, ['repo', 'override']);
    if (!positional[0]) { console.error('usage: pi-codegraph snippet <qualified_name>'); process.exit(1); }
    return runTool('get_code_snippet', { qualified_name: positional[0] }, flags, ctx);
  },
  trust(args) { return trust(fdn.parseArgs(args, ['repo', 'label']).flags); },
  repos(args, ctx) { return repos(fdn.parseArgs(args, []).flags, ctx); },
  'config-bin'(args) { return configBin(fdn.parseArgs(args, []).positional); },

  help() {
    console.error(`pi-codegraph — Pi-agent wrapper around codebase-memory-mcp (derived code knowledge)

Usage: pi-codegraph <command> [--repo PATH] [--human]

  SETUP:
    doctor                 is the codebase-memory-mcp binary installed? version?
    config-bin <path>      pin the binary path (else PI_CODEGRAPH_BIN or PATH)
    trust [--label L]      register a repo as a trusted codegraph source
    repos                  list trusted repos

  QUERY (trust-gated; needs the binary):
    tools                  list the live server's tools
    trace <fn> [--direction inbound|outbound] [--depth N]   call chain
    arch                   architecture overview (languages, routes, hotspots)
    impact                 git-diff blast radius (detect_changes)
    search <query>         semantic graph search
    snippet <qname>        source for one symbol
    query <tool> [--args JSON]   call any of the 14 tools directly
    plan <tool> [--args JSON]    show the JSON-RPC we'd send (no spawn)

  --repo PATH              repo to query; default: cwd
  --override "<reason>"    run against an unregistered repo, with an audit trail
  -H, --human              table output instead of JSON

Trust model: the trusted-repo registry + binary config live outside the agent tree
(~/.config/pi-codegraph). The third-party binary is untrusted; queries run only on a
registered repo or with an explicit --override.`);
  },
};
