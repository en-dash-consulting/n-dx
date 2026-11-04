# Sidecar connections

The Sidecar reaches external MCP servers the operator adds — a tracker, a docs
server, a local tool — through n-dx, never through a vendor CLI's own MCP
config. n-dx is the MCP client; the Sidecar session sees the servers' tools
through its broker, under each server's namespace.

## Three layers

| Layer | Where | Job |
|-------|-------|-----|
| Config | `.n-dx.local.json` → `connections` (`connection-config.ts`) | Which servers exist and how to reach them. No secrets. |
| Credentials | per-user store entry `connection:<id>` (`connection-credentials.ts`) | The token sent to an HTTP server. Never in a project file. |
| Gateway | `ConnectionService` (`connection-service.ts`) | One live MCP client per connection; tool listing and calls. |

All three live in `packages/web/src/server/connections/`. The broker
(`src/server/sidecar/`) sits on top of the gateway and adds the read/write
class, the run/ask/never policy and the form card for writes.

## Config

```json
{
  "connections": {
    "docs": { "transport": "http", "url": "https://docs.example/mcp", "auth": "token", "label": "Docs" },
    "local": { "transport": "stdio", "command": "node", "args": ["server.mjs"], "env": { "MODE": "dev" } }
  }
}
```

- `id` matches `^[a-z][a-z0-9-]{0,30}$`; it is also the tool namespace.
- `transport` is `http` (streamable HTTP, `url`) or `stdio` (`command`, `args`, `env`).
- `auth` is `none` (default), `token` or `oauth`. `token` and `oauth` are
  HTTP-only, because MCP authorization is HTTP-only.
- An invalid entry is skipped with a warning naming it.
- `tools` (optional) overrides one tool at a time:
  `"tools": { "delete_item": { "class": "write", "policy": "never" } }`.

## Tool class and policy

`tool-policy.ts` (pure) gives each listed tool a class and a policy, and the
service's tool list reports both with their source (`annotation`, `default` or
`override`).

- **Class.** `readOnlyHint: true` is a read. `destructiveHint: true` or no
  annotation is a write, so an unannotated tool errs toward write.
- **Policy.** A read defaults to `run`, a write to `ask`. `run` on a write
  needs an explicit `policy` override. `never` removes the tool from the session.
- **Overrides** (`class`: `read`/`write`; `policy`: `run`/`ask`/`never`) win over
  the defaults. An unknown class or policy, or a tool the server does not list,
  is ignored with a warning naming it; a valid half of an entry still applies.

## Through the broker

`createBrokerMcpServer` (`src/server/sidecar/broker-mcp.ts`) gives a
**worktree** session every external tool whose policy is not `never`, under its
wire name, after the broker's own tools. A hub session gets none.

- **Listing.** The description is the server's, prefixed `<id>.<tool>: `. The
  input schema is the server's JSON Schema, passed through (the broker accepts
  any object; validation stays with the server). A connection that went
  unavailable keeps its last-listed tools, so the session's list does not shift
  and a call reads why it cannot run.
- **run** calls the server at once and returns its result unchanged, `isError`
  included. **ask** first checks the connection is up (a ping), then raises an
  `external-call` card showing the connection, the tool's display name, its
  class and the arguments; the server is called only on Approve. Deny or a
  withdrawn card calls nothing. External calls are never allow-listable: the
  broker cannot know what another server's write does.
- **Unavailable.** A call to a connection that is down returns `isError` text
  `connection unavailable: <reason>`, or `sign in again: …` when the server
  refuses the token, with no card. The broker's own tools keep answering.
- **Only when asked.** The broker is stateless, one server per request. With
  connections declared, it reads the request body first and touches the
  connections only for `tools/list` (all of them) or a call to an external
  tool (only the connection it names), so a slow server never holds up the
  broker's own tools or another connection's calls. Without connections the
  request path is as before.
- **One per project.** The routes keep one `ConnectionService` per project for
  the server's life; a connection added to `.n-dx.local.json` takes effect on
  restart until the Settings page manages connections.
- **Vendors.** The broker is the only MCP server a Sidecar spawn names, so an
  external server never reaches a vendor's own MCP config. The external tools
  are part of the broker's MCP surface, which a client reaches over Streamable
  HTTP with the session's URL and headers; the integration test drives it with
  the SDK client. Claude's spawn is given that endpoint (`--mcp-config`).
  Codex's spawn does not name the broker yet, so a Codex session has neither
  the broker's tools nor the external ones until it does.

## Decisions

- **Only the user's own config declares a connection.** A connection names a
  command to spawn or the URL a token is sent to, so a cloned repository must
  not choose one. A `connections` block in the tracked `.n-dx.json`, or in a
  `.n-dx.local.json` the repository commits, is ignored with one warning. Until
  the Settings page writes connections, `.n-dx.local.json` is edited by hand.
- **One module reads the credential store.** Web reads `connection:<id>`
  directly through `connection-credentials.ts`, with no gateway and no new
  llm-client export; a policy test fails any other `src/` file that imports a
  store function. The token is read on every connect and never cached on disk,
  logged or returned; status shows a fingerprint at most. No token stored reads
  `needs-sign-in`, and nothing is sent. A 401 for a stored token reads the same.
- **A stdio server never sees a secret.** Its environment is the MCP SDK's
  default variables (PATH, HOME, …) passed through `sanitizeChildEnv`, plus the
  literal `env` its config names. Never `process.env`, never a token.
- **Lazy, isolated, self-healing.** A connection is connected on first use and
  kept for the server's life. Refused, timed out, exited or closed reads
  `unavailable` with its reason, leaves the other connections working, and the
  next use reconnects. `tools/list` is cached and re-read on reconnect and on
  `notifications/tools/list_changed`. After a failed connect a tool *listing*
  serves the last-known tools without reconnecting for 30 s (doubling to 5 min),
  so a hung server does not delay every turn by the connect timeout; a call to
  it still reconnects at once.
- **Wire names use `__`.** A tool is shown as `<id>.<tool>` and carried as
  `<id>__<tool>`, because the Claude and OpenAI tool-name patterns reject dots.
  An id holds no `_`, so the first `__` splits a wire name. A wire name over 64
  characters, or with characters outside `[A-Za-z0-9_-]`, is skipped with a
  warning naming it.
- **Vendor-neutral.** The gateway sits behind the broker's MCP surface, so a
  Claude and a Codex session see the same tools. Nothing in it names a
  particular tracker, tool or status.
- **OAuth** (`auth: "oauth"`) reads `needs-sign-in` until the sign-in flow —
  discovery, PKCE, token storage and silent refresh — lands. Its redirect
  returns to a dashboard page that finishes the sign-in through an
  authenticated route; no new public route.
- **Nothing is on by default.** With no `connections` block the broker's tool
  list is unchanged, and nothing here turns on `web.sidecar`.
