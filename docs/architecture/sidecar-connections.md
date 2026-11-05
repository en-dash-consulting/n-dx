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
- `fieldHints` (optional) fills pickers on a write card; see
  [Through the broker](#through-the-broker). A malformed hint is skipped with
  a warning naming it.
- `profile` (optional) names a [server profile](#server-profiles).

## Server profiles

A profile is data for one kind of server (`src/server/tracker/server-profiles.ts`);
no code path knows any server. It carries:

- `fieldHints` by write tool, then property, in the connection hint shape. A
  connection's own hint wins for the same property.
- `tracker` (optional): `createTool`, `moveTool`, `readTool`, `editTool`, the
  `requestIdProperty` filled with `ndx:<project>:<rexId>:<event>`, the
  `itemIdProperty`, the status properties, a `statusMap` from every ndx event
  (`change-captured`, `run-started`, `pr-opened`, `pr-merged`,
  `release-published`, `run-failed-twice`) to a tracker status, the `facts` each
  event needs (input property and sources) and `defaults` (`reviewer`,
  `estimateScale`).

Built-ins ship in `src/server/tracker/profiles/` (`caos` first). A user adds
`<ndx home>/tracker-profiles/<name>.json`. A bare name resolves to the built-in
of that name, else the user's file; `user:<name>` is the user's file only, so a
user profile never replaces a built-in by accident.

A profile is used only when it fits the server's tool list: every tool it
names is listed, every property it names is declared, and the status map
covers every event with a status the server accepts. Otherwise
`GET /api/connections` reports `profile.state: "invalid"` with a problem naming
each gap, its hints are not used, and the connection works attended as one
without a profile: reads run and writes raise the plain form card.

## Tracker links

An item links to a tracker work item by one work ref, a tracker key
(`WM-2054`) or an http(s) URL, the shapes rex's `isWorkRef` accepts. A v2 item
holds it in `issues`, a v1 item in `links[]` (`{ system: "tracker",
workItemId, url? }`); the v1 to v2 migration moves each `links[]` entry that is
a work ref into `issues` and keeps any other (an opaque page id) in `links`.
`server/tracker/link-refs.ts` is the one reader of either shape and
`item-links.ts` the one write, under the PRD lock, so rex gains no export.

- **Dashboard.** `GET`, `POST` and `DELETE /api/rex/items/:id/links` (`POST` and
  `DELETE` take `{ ref }`) serve Link and Unlink on a task or change's detail
  panel. The Live task page shows the same refs. A ref reads with the tracker's
  label, the `label` of the profile of the first connection whose profile maps
  a tracker (`GET /api/connections/tracker`), and as its key or host while none
  does.
- **Sidecar.** `propose_link { itemId, ref }` raises a link card, never
  allow-listed, from a worktree session only. The card shows the item and the
  ref as read when it was raised and writes only on Approve, from its own
  link. A call naming no item, a bad ref, or a ref the item already has raises
  no card.

## Tracker sync

Deterministic rules, no model, turn ndx events into tracker calls
(`src/server/tracker/rules.ts`, `sync-engine.ts`). Settings live in the
untracked `.n-dx.local.json` only, as connections do:

```json
"trackerSync": {
  "connection": "caos",
  "profile": "caos",
  "project": "n-dx",
  "featureMap": { "0.10.0": "<epic id>" },
  "rules": { "run-started": "dry-run", "pr-merged": "on" }
}
```

- `profile` defaults to the connection's own; `project` (the `<project>` in
  every request id) defaults to the directory name.
- Each event is one rule. `change-captured` (no link yet) is **create**,
  `run-failed-twice` is **blocked**, the rest are **move** on a linked item.
- Every rule is `off` unless set. `dry-run` logs the would-be call and makes
  none. `on` makes a move through the connection service; create and blocked
  are logged as a card instead, so a person decides.
- Every call carries the profile's `requestIdProperty` set to
  `ndx:<project>:<rexId>:<event>`. A create reply, and any duplicate reply
  (`duplicate: true` or an `error` starting `duplicate`), is confirmed with the
  profile's `readTool` before it is logged.
- A refusal logs its problems list and settles the event: it is never planned
  again, with the same arguments or other ones. So do `ok`, `duplicate` and
  `card`. An unreachable connection, or one that needs sign-in, logs that once
  (again only when the result changes) and keeps the event queued, unchanged.
  One tick runs per project at a time; a second waits for the first.
- The log is append-only JSONL, `<henchDir>/sidecar/tracker-activity.jsonl`:
  `{ at, event, rexId, rule, mode, requestId, call, result, problems? }`, with
  `result` one of `would`, `ok`, `duplicate`, `refused`, `card`, `unavailable`,
  `needs-sign-in`.

Routes, governed by `web.sidecar`:

- `POST /api/tracker/sync/tick` runs the queued events. It answers the
  per-user token itself only: a browser session is refused with 403, and a
  Sidecar broker credential never passes the request gate on it.
- `GET /api/tracker/activity` answers `{ entries }`, the newest 200.

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
- **The card is a form.** The card carries `externalCall`: the connection's
  label, the host of an http connection's url (shown `CAOS · caos.endash.us`;
  the label alone for stdio) and the tool's input schema. The drawer draws a
  field per property (string, number, integer, boolean, enum, a list of
  scalars one per line, an object one level deep), prefilled with the agent's
  arguments, required ones marked; anything else, and any argument the schema
  does not name, is a JSON field for that property alone. Approve sends the
  edited `arguments` (`POST …/cards/:id` with `arguments`, an approval only) and
  the server is called with those; an unedited approval calls with the agent's.
  An idempotency key (`requestId` or `idempotencyKey`) is shown read-only and
  the server keeps the agent's value whatever is sent. A field that holds text
  that is not a value of its type (a non-integer, malformed JSON) holds Approve.
- **Field hints.** A connection may carry `fieldHints`, a map from a write
  tool's property name to `{ "optionsFrom": { "tool": "<read tool>", "path":
  "<dotted path>" } }` or `{ "auto": true }`. When the card is raised the broker
  calls that read tool (no arguments, five-second limit) and the property
  becomes a picker over the array at `path` of the result (structured content,
  else JSON text): scalars as they are, objects by `id`/`value`/`key` and
  `name`/`title`/`label`. `auto` reads the read tool the property's name
  points at (`ownerId` → `list_owners`, `list_owner` or `owners`) and takes the
  result's first list. Only a read-class tool of the same connection whose policy
  is `run` is called (a hint never makes a call the operator would be asked about); a hint that finds no choices leaves a plain field, and the
  card is never held up on it. With no hints the plain schema form renders. A
  [server profile](#server-profiles) adds its hints under the connection's; none
  live in the broker.
- **Problems.** When an approved call's result is an error carrying a
  `problems` list (structured content, or JSON text such as
  `{"error":"validation_failed","problems":[…]}`), the card shows each problem
  (string, or an object with `field`/`path` and `message`). The session gets
  the result unchanged, and nothing retries with altered arguments.
- **Unavailable.** A call to a connection that is down returns `isError` text
  `connection unavailable: <reason>`, or `sign in again: …` when the server
  refuses the token, with no card. The broker's own tools keep answering.
- **Only when asked.** The broker is stateless, one server per request. With
  connections declared, it reads the request body first and touches the
  connections only for `tools/list` (all of them) or a call to an external
  tool (only the connection it names), so a slow server never holds up the
  broker's own tools or another connection's calls. Without connections the
  request path is as before.
- **One per project.** The server keeps one `ConnectionService` per project for
  its life (`workspaceConnectionService`); a connection added to `.n-dx.local.json` takes effect on
  restart until the Settings page manages connections.
- **Vendors.** The broker is the only MCP server a Sidecar spawn names, so an
  external server never reaches a vendor's own MCP config. The external tools
  are part of the broker's MCP surface, which a client reaches over Streamable
  HTTP with the session's URL and headers; the integration test drives it with
  the SDK client. Claude's spawn is given that endpoint (`--mcp-config`).
  Codex's spawn does not name the broker yet, so a Codex session has neither
  the broker's tools nor the external ones until it does.

## Settings and sign-in

`routes-connections.ts` serves Settings > Project, which shows a Connections
section (`viewer/views/connections.ts`) only while `web.sidecar` is on:

| Route | Answer |
|-------|--------|
| `GET /api/connections` | `{ connections }`: id, label, transport, auth, state, reason, tool count |
| `POST /api/connections/:id/oauth/start` `{ redirectUrl }` | `{ authorizationUrl }` |
| `POST /api/connections/:id/oauth/finish` `{ code, state }` | `{ connection }` |
| `POST /api/connections/:id/sign-out` | `{ connection }` |

- **Never public.** Every route needs the per-user token or a browser session,
  directly and through the hub; `web.sidecar` gates the family
  (`route-feature-gates.ts`), because listing a connection connects it. No
  answer carries a token, refresh token, code or fingerprint.
- **The return is a page, not a route.** Sign in sends the tab (the same tab,
  whose `sessionStorage` holds the session) to the authorization URL, which
  returns to `<origin><base>/project?connection=<id>`, under the hub's `/p/<id>/`
  when the page is. That address is the public page shell and the server acts
  on nothing in its query. The page removes `connection`, `code` and `state`
  from the address bar, then posts the code and state to `oauth/finish` with
  its session in the header, and shows the result above the list.
- **Loopback only.** `oauth/start` refuses a `redirectUrl` that is not http(s)
  on `127.0.0.1`, `localhost` or `[::1]`, or that carries credentials or a
  fragment.
- **One service per project.** The routes and the broker share
  `workspaceConnectionService`, so a sign-in reaches the next Sidecar turn.

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
- **OAuth on the SDK's own flow.** `oauth-provider.ts` implements the SDK's
  `OAuthClientProvider` and lets `auth()` do discovery (protected-resource,
  then authorization-server metadata), dynamic client registration,
  authorization code with S256 PKCE, and refresh; nothing is hand-rolled.
  `beginSignIn(id, redirectUrl)` returns the authorization URL,
  `finishSignIn(id, code, state)` exchanges the code and reconnects, and
  `signOut(id)` forgets the entry. The redirect returns to a dashboard page that
  finishes the sign-in through an authenticated route (no new public route).
- **One record, bound to its URL.** The client registration and tokens are one
  JSON value in `connection:<id>`, with the URL they were issued for. When the
  configured URL no longer matches, nothing is sent and the connection reads
  `needs-sign-in`. A new registration is stored only with the tokens it earns,
  so a sign-in that is never finished stores nothing.
- **State and verifier stay in memory.** Each is single-use and expires after
  10 minutes; a wrong, reused, expired or other connection's state is refused
  and stores nothing. A state is spent by its first use, right or wrong.
- **Headless by default.** The server never opens a browser. Every connect,
  the hub's automation included, uses a provider that throws where the SDK
  would send a user to sign in, so a caller with no valid refresh token gets
  `needs-sign-in` at once instead of waiting.
- **Silent refresh, re-reading the store.** An access token within 30 s of its
  expiry is refreshed before it is sent, and a 401 refreshes through the
  transport. The provider reads the store on every call, since another process
  may have rotated the tokens. A refresh that fails is retried once after
  re-reading; a refused refresh token left unrotated clears the tokens, keeps
  the client registration, and reads "sign in again". A refresh that fails for
  any other reason keeps the tokens and reads `unavailable`.
- **Nothing is on by default.** With no `connections` block the broker's tool
  list is unchanged, and nothing here turns on `web.sidecar`.
