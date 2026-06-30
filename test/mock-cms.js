#!/usr/bin/env node
// mock-cms.js — a minimal MCP stdio server standing in for codebase-memory-mcp,
// so pi-codegraph's wrap (handshake + tools/list + tools/call) is tested without
// the real Go binary. Speaks newline-delimited JSON-RPC, like the real transport.
//
// `--version` prints a fake version and exits (for the doctor test).
if (process.argv.includes('--version')) { console.log('codebase-memory-mcp mock 0.0.0'); process.exit(0); }

import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

const TOOLS = [
  { name: 'get_architecture', description: 'Codebase overview' },
  { name: 'trace_path', description: 'Who calls a function' },
  { name: 'get_graph_schema', description: 'Node/edge counts' },
];

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock-cms', version: '0.0.0' } } });
  }
  if (msg.method === 'notifications/initialized') return; // notification, no reply
  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: a = {} } = msg.params || {};
    if (name === 'trace_path') {
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ function: a.function_name, direction: a.direction, callers: ['main', 'handler'] }) }] } });
    }
    if (name === 'get_architecture') {
      return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ languages: ['go'], routes: 3, hotspots: ['cli.js'] }) }] } });
    }
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown tool: ${name}` } });
  }
  if (msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } });
});
