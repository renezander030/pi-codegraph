// mcp.js — minimal MCP stdio JSON-RPC client for the codebase-memory-mcp server.
//
// Transport: newline-delimited JSON-RPC over the child's stdin/stdout (the MCP
// stdio transport). We spawn the server with cwd set to the repo, run the
// initialize handshake, then `tools/list` or `tools/call`, and return the result.
// Zero deps — Node's child_process + a line splitter is all we need.
import { spawn } from 'node:child_process';

export const CLIENT_INFO = { name: 'pi-codegraph', version: '0.1.0' };
export const PROTOCOL_VERSION = '2024-11-05';

// buildRequests(tool, args) — the JSON-RPC sequence we WOULD send. Pure, so `plan`
// can show it without launching anything (and tests can assert it).
export function buildRequests(method, params) {
  return [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method, ...(params ? { params } : {}) },
  ];
}

// rpc({ bin, args, cwd, method, params, timeoutMs }) -> result object.
// Spawns the server, does the handshake, issues one request, resolves its result.
export function rpc({ bin, args = [], cwd, method, params, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return reject(new Error(`failed to launch ${bin}: ${e.message}`)); }

    let buf = '', stderr = '', done = false, nextId = 1;
    const pending = new Map();
    const finish = (fn, val) => { if (done) return; done = true; clearTimeout(timer); try { child.kill('SIGTERM'); } catch {} fn(val); };
    const timer = setTimeout(() => finish(reject, new Error(`codegraph ${method} timed out after ${timeoutMs}ms`)), timeoutMs);

    const send = (m, p) => {
      const id = nextId++;
      return new Promise((res) => { pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, ...(p ? { params: p } : {}) }) + '\n'); });
    };
    const notify = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: m }) + '\n');

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) { const r = pending.get(msg.id); pending.delete(msg.id); r(msg); }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => finish(reject, new Error(`failed to launch ${bin}: ${e.message}`)));
    child.on('exit', (code) => finish(reject, new Error(`server exited (code ${code}) before completing${stderr ? ': ' + stderr.slice(0, 300) : ''}`)));

    (async () => {
      try {
        const init = await send('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
        if (init.error) throw new Error('initialize failed: ' + JSON.stringify(init.error));
        notify('notifications/initialized');
        const resp = await send(method, params);
        if (resp.error) return finish(reject, new Error(`${method} error: ${JSON.stringify(resp.error)}`));
        finish(resolve, resp.result);
      } catch (e) { finish(reject, e); }
    })();
  });
}

export const callTool = ({ bin, args, cwd, tool, toolArgs = {}, timeoutMs }) =>
  rpc({ bin, args, cwd, method: 'tools/call', params: { name: tool, arguments: toolArgs }, timeoutMs });

export const listTools = ({ bin, args, cwd, timeoutMs }) =>
  rpc({ bin, args, cwd, method: 'tools/list', timeoutMs });
