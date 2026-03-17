# MCP Integration

Rex and SourceVision expose [Model Context Protocol](https://modelcontextprotocol.io/) servers for AI tool integration. This lets Claude Code (or any MCP client) query your codebase and manage your PRD directly.

## HTTP Transport (Recommended)

Start the unified server, then register the MCP endpoints:

```sh
# 1. Start the server (dashboard + MCP on one port)
ndx start .

# 2. Add HTTP MCP servers to Claude Code
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

The server runs on port 3117 by default. Custom port: `--port=N` or `ndx config web.port N .`

HTTP transport uses Streamable HTTP with session management. Sessions are created automatically and identified by the `Mcp-Session-Id` header.

## stdio Transport

stdio spawns a separate process per MCP server. No `ndx start` required:

```sh
# Using standalone binaries
claude mcp add rex -- rex mcp .
claude mcp add sourcevision -- sv mcp .

# Or using node directly
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

## Migrating from stdio to HTTP

```sh
# 1. Start the server
ndx start --background .

# 2. Remove old stdio servers
claude mcp remove rex
claude mcp remove sourcevision

# 3. Add HTTP servers
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

**Benefits of HTTP:** single process, shared port with dashboard, session management, no per-tool process overhead.

## Rex MCP Tools

| Tool | Description |
|------|-------------|
| `rex_status` | PRD tree with completion stats |
| `rex_next` | Next actionable task |
| `rex_add` | Add epic/feature/task/subtask |
| `rex_update` | Update item status/priority/title |
| `rex_validate` | Check PRD integrity |
| `rex_analyze` | Scan project and propose PRD items |
| `rex_recommend` | Get SourceVision-based recommendations |

## SourceVision MCP Tools

| Tool | Description |
|------|-------------|
| `sv_inventory` | File listing with metadata |
| `sv_imports` | Dependency graph for a file |
| `sv_zones` | Architectural zone map |
| `sv_components` | React component catalog |
| `sv_context` | Full CONTEXT.md contents |
