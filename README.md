# pi-codegraph

**A Pi-agent extension that wraps [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp).** It gives an agent *derived* knowledge — call graphs, blast radius, architecture — extracted from your code, so it stops re-greping the same repo every session. The companion to [pi-okf](https://github.com/renezander030/pi-okf) (which carries *authored* knowledge) and a sibling of [pi-gate](https://github.com/renezander030/pi-gate).

codebase-memory-mcp parses a repo into a persistent knowledge graph (tree-sitter, 158 languages) and exposes ~14 MCP tools. `pi-codegraph` is the deterministic, agent-first front end: it resolves and speaks MCP to that binary, normalizes the results to JSON (or a `-H` table), and puts a harness-owned trust boundary in front of it.

## Why a wrapper

Some knowledge an agent needs is already in the code: who calls a function, what a diff breaks, where the dead code is. No graph tool should be trusted blindly with your repo, and an agent should not be re-launching a third-party server with ad-hoc flags. `pi-codegraph` pins the binary, gates which repos it runs against, and gives the agent one stable, scriptable surface.

## Install

Requires **Node ≥ 18**. The wrapped engine is separate:

```sh
git clone https://github.com/renezander030/pi-codegraph
ln -s "$PWD/pi-codegraph/pi-codegraph" /usr/local/bin/pi-codegraph

# install the engine (see its repo), then point pi-codegraph at it:
pi-codegraph config-bin /path/to/codebase-memory-mcp   # or set PI_CODEGRAPH_BIN
pi-codegraph doctor                                     # confirm it's found
```

## Quick start

```sh
pi-codegraph doctor                       # is the engine installed?
pi-codegraph trust --repo . --label app   # register this repo as a codegraph source
pi-codegraph arch --repo . -H             # architecture overview
pi-codegraph trace ProcessOrder --direction inbound   # who calls it
pi-codegraph impact                       # blast radius of the current git diff
pi-codegraph search "auth middleware"     # semantic graph search
pi-codegraph query trace_path --args '{"function_name":"main","depth":3}'
```

`plan` shows the exact JSON-RPC it would send without launching anything:

```sh
pi-codegraph plan get_architecture --repo . -H
```

## CLI

| Command | Purpose |
|---|---|
| `doctor` | Resolve the binary (env / config / PATH); report presence + version. |
| `config-bin <path>` | Pin the engine binary path. |
| `trust [--label L]` | Register a repo as a trusted codegraph source. |
| `repos` | List trusted repos. |
| `tools` | List the live server's tools. |
| `trace <fn> [--direction] [--depth]` | Call chain into/out of a function. |
| `arch` / `impact` / `schema` | Architecture, git-diff blast radius, graph schema. |
| `search <q>` / `snippet <qname>` | Semantic search; source for one symbol. |
| `query <tool> [--args JSON]` | Call any of the engine's tools directly. |
| `plan <tool> [--args JSON]` | Print the JSON-RPC request (no spawn). |

JSON by default; `-H`/`--human` for a table.

## Trust model

Faithful to pi-gate:

| Invariant | How |
|---|---|
| The third-party binary is untrusted | we only resolve a path to it (env `PI_CODEGRAPH_BIN` > `~/.config/pi-codegraph/config.json` > PATH) and speak MCP over stdio |
| The record of which repos are queryable lives outside the agent tree | trusted-repo registry at `~/.config/pi-codegraph/repos.json`, state at `~/.local/state/pi-codegraph/` |
| Queries run only on a registered repo | the gate blocks unregistered repos; `--override "<reason>"` bypasses with an audit trail |
| Stable repo identity across moves | git root-commit sha, falling back to a path hash |

## How it talks to the engine

MCP stdio transport: spawn the server with `cwd` = the repo, `initialize`, `notifications/initialized`, then `tools/list` or `tools/call`, reading newline-delimited JSON-RPC. The test suite proves the full handshake against a mock server, so the wrap is verified without the Go binary installed.

## Roadmap

Auto-index on first `trust`, a streaming mode for large results, per-tool allow/deny in the registry, and a paired `pi-okf` exporter that turns the derived graph into an OKF bundle (derived knowledge seeding authored).

## License

MIT
