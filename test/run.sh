#!/usr/bin/env bash
# pi-codegraph test harness. Hermetic: isolated XDG dirs, a mock MCP server stands
# in for the real codebase-memory-mcp binary. No external deps (no jq).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/pi-codegraph"
MOCK="$ROOT/test/mock-cms.js"
TMP="$(mktemp -d)"
export XDG_CONFIG_HOME="$TMP/config"
export XDG_STATE_HOME="$TMP/state"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass+1)); }
bad() { printf '  FAIL %s\n' "$1"; fail=$((fail+1)); }
assert_exit() { local exp="$1" label="$2"; shift 3; "$@" >/tmp/co.$$ 2>/tmp/ce.$$; local rc=$?; [ "$rc" = "$exp" ] && ok "$label" || { bad "$label (exit $rc != $exp)"; sed 's/^/      /' /tmp/ce.$$; }; }
assert_has()  { local needle="$1" label="$2"; shift 3; local out; out="$("$@" 2>/dev/null)"; case "$out" in *"$needle"*) ok "$label";; *) bad "$label (missing: $needle)"; printf '      %s\n' "$out";; esac; }

REPO="$TMP/repo"; mkdir -p "$REPO"; echo "x" > "$REPO/a.txt"  # non-git -> path-hash id

echo "pi-codegraph tests"

# --- doctor: binary missing vs present (via mock) ---------------------------
assert_exit 1 "doctor exits 1 when binary missing" -- env PI_CODEGRAPH_BIN=/nonexistent/codebase-memory-mcp node "$BIN" doctor
assert_has 'binary not found' "doctor reports missing binary" -- env PI_CODEGRAPH_BIN=/nonexistent/codebase-memory-mcp node "$BIN" doctor
# doctor needs an executable; wrap the mock as an executable shim
SHIM="$TMP/cms"; printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$MOCK" > "$SHIM"; chmod +x "$SHIM"
assert_exit 0 "doctor exits 0 with mock present" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" doctor
assert_has 'mock' "doctor reports mock version" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" doctor

# --- plan: pure request construction, no spawn, no binary needed ------------
assert_has '"method":"initialize"' "plan shows initialize request" -- node "$BIN" plan get_architecture --repo "$REPO"
assert_has '"name":"trace_path"' "plan embeds tool call" -- node "$BIN" plan trace_path --args '{"function_name":"Foo"}' --repo "$REPO"

# --- trust gate -------------------------------------------------------------
assert_has '"blocked":true' "query blocked on unregistered repo" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" arch --repo "$REPO"
assert_exit 1 "blocked query exits 1" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" arch --repo "$REPO"
assert_exit 0 "trust registers the repo" -- node "$BIN" trust --repo "$REPO" --label myrepo
assert_has 'myrepo' "repo appears in registry" -- node "$BIN" repos

# --- live wrap against the mock server (handshake + tools/call) -------------
assert_has '"ok":true' "arch succeeds once trusted" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" arch --repo "$REPO"
assert_has 'hotspots' "arch returns tool result" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" arch --repo "$REPO"
assert_has 'callers' "trace returns call chain" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" trace Foo --direction inbound --repo "$REPO"
assert_has 'trace_path' "tools lists server tools" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" tools --repo "$REPO"
# override path: unregistered repo + --override runs anyway
REPO2="$TMP/repo2"; mkdir -p "$REPO2"
assert_has '"override":"adhoc"' "override runs on unregistered repo" -- env PI_CODEGRAPH_BIN="$SHIM" node "$BIN" arch --repo "$REPO2" --override adhoc

echo
printf 'pi-codegraph: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
