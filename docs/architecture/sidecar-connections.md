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
- `oauth` (optional, `auth: "oauth"` only) changes the client n-dx signs in
  as: `{ "clientMetadataUrl": "https://…/client.json" }` (an HTTPS URL with a
  path, no credentials or fragment) or `{ "clientId": "…" }` (a public client
  registered with the authorization server beforehand). One or the other; an
  invalid block skips the connection with a warning naming why. See
  [Client identity](#client-identity).

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
  event needs (input property and sources), `defaults` (`reviewer`,
  `estimateScale`) and an optional `itemUrlTemplate`: an http(s) URL holding
  one `{id}` (the id as given) or `{compactId}` (the id without dashes). CAOS
  items are Notion pages, so its template is `https://www.notion.so/{compactId}`.
- `oauth` (optional): `readScopes`, `writeScopes` and the `writeTools` that
  need the write scopes. See [Scopes](#scopes).

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
  "reviewers": { "@hal": "<tracker user id>" },
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
- An approved create card links the change to the confirmed work item (its
  `issues`, under the PRD lock), so the move rules that follow find it. An id
  that is no work ref (CAOS replies with an opaque UUID) is linked as the URL
  the profile's `itemUrlTemplate` builds, and a move on that link sends the id
  read back out of the URL. The entry records `workItemId`; a link that cannot
  be written, including an opaque id under a profile with no template, leaves
  the entry `ok` with a problem naming the failure.
- A refusal logs its problems list and settles the event: it is never planned
  again, with the same arguments or other ones. So do `ok`, `duplicate` and
  `card`. An unreachable connection, or one that needs sign-in, logs that once
  (again only when the result changes) and keeps the event queued, unchanged.
  One tick runs per project at a time; a second waits for the first.
- The log is append-only JSONL, `<henchDir>/sidecar/tracker-activity.jsonl`:
  `{ at, event, rexId, rule, mode, requestId, call, result, problems?, workItemId? }`,
  with `result` one of `would`, `ok`, `duplicate`, `refused`, `card`,
  `dismissed`, `unavailable`, `needs-sign-in`.

### Events and the clock

The project server collects events at each tick from what it already records
(`src/server/tracker/event-sources.ts`), reading only the sources whose rule
is not off:

| Event | Source | Cursor |
|-------|--------|--------|
| `run-started` | hench run records (`<henchDir>/runs/`) | `startedAt` |
| `run-failed-twice` | a run that ends a task's second hard failure in a row (hench's stuck rule), with its diagnosis class | `finishedAt` |
| `pr-opened`, `pr-merged` | `gh pr list`, PRs whose description or commits carry `N-DX-Item`; only while `web.sidecarGithubReads` is on | `createdAt`, `mergedAt` |
| `release-published` | a change stamped `shippedIn` a version that has a git tag (`v1.2.3`, `<pkg>@1.2.3`) | each change and version once |

- Each event's required facts are the profile's `tracker.facts[<event>]`; each
  takes the first of its `from` sources that answers (a value the collector
  already knows for the property counts first):

  | Fact | Source |
  |------|--------|
  | reviewer | profile `defaults.reviewer`, else the CODEOWNERS owner of the PR's files (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`; last matching rule wins), sent as the tracker user id `trackerSync.reviewers[<handle>]`; an unmapped handle is a card (`map @hal to a user in CAOS in trackerSync.reviewers`), never sent raw |
  | review link | the PR URL |
  | delivery note | `shipped in ndx <version>` from the release |
  | blocked reason, who can unblock | the failed run's diagnosis summary and best-ranked action |
  | epic | `trackerSync.featureMap[<feature name>]` |

  A fact no source answers turns the planned call into a `card` (in dry-run
  too) whose `problems` name it (`missing reviewer: …`); nothing stands in for
  it, no call is made, and the event is settled like any card. A profile's
  `limits` name what the tracker cannot do: with `create-feature` (CAOS), an
  unmapped feature's card reads `Create feature 'X' under epic Y in CAOS, then
  map it in trackerSync.featureMap`.
- An event is about the nearest item that links to a work item (the item,
  else its parent, and so on) and carries that item's first ref; an event no
  item links for is dropped.
- Cursors are saved per source in `<henchDir>/sidecar/tracker-cursors.json`,
  so a restarted server queues nothing twice. A source's first read is a
  baseline and queues nothing: turning a rule on never replays history. A
  source that cannot be read (gh failing, reads off) reports why in the
  tick's `collected.problems` and keeps its cursor. An event queued but
  still unreachable when the server stops is not queued again.
- The hub (`src/hub/tracker-sync.ts`) ticks each registered project whose
  `.n-dx.local.json` sets a rule to `dry-run` or `on`: once when its server is
  seen healthy after a start or an outage, then every five minutes, after the
  health check. It POSTs `/p/<id>/api/tracker/sync/tick` through its own
  proxy with the per-user token, and skips a server that is not healthy. It
  reads only the rule modes; the project server decides what a tick does.
  The hub ticks the repository root's server; a linked worktree's own
  `trackerSync` is not ticked by it.

Routes, governed by `web.sidecar`:

- `POST /api/tracker/sync/tick` collects the events since the last tick and
  runs the queue, answering the tick's result plus
  `collected: { queued, problems }`. It answers the
  per-user token itself only: a browser session is refused with 403, and a
  Sidecar broker credential never passes the request gate on it.
- `GET /api/tracker/activity` answers `{ entries, cards, sources, connection }`:
  the newest 200 entries, the request ids of the cards still waiting, the
  event sources the last tick could not read, and the sync connection's state
  (`null` with no `trackerSync` connection). Live's Tracker activity section
  reads it while `web.sidecar` is on.
- `GET /api/tracker/cards/form?requestId=` answers `{ externalCall }`, the
  waiting card's call drawn as the C1 form (schema and picker choices).
- `POST /api/tracker/cards/decide { requestId, action, args? }` decides a
  waiting card. `dismiss` logs `dismissed` and calls nothing. `approve` makes
  the call with `args` (the operator's edits; the planned `requestId` is kept
  whatever is sent), confirms a create or duplicate with a read, and logs the
  result. Either entry closes the card; an approval that finds the connection
  unreachable is logged and leaves the card waiting. Decisions run one at a
  time per project, so two approvals make one call. These need the per-user
  token or a browser session; a Sidecar broker credential is refused.

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
  its life (`workspaceConnectionService`). The Settings routes call `reload()`
  after each write, which keeps a connection whose declaration is unchanged,
  closes a removed or changed one and connects it afresh on its next use, so a
  change reaches a running session's next `tools/list`. A hand edit of
  `.n-dx.local.json` takes effect on restart.
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
| `GET /api/connections` | `{ connections }`: id, label, transport, auth, state, reason, tool count, `tokenStored`, profile check |
| `POST /api/connections` `{ id, label?, transport, auth?, url \| command, args?, env?, profile?, token? }` | `201 { connection }`; writes the declaration, and stores `token` as `connection:<id>` |
| `POST /api/connections/test` (same body, unsaved) | `{ state, reason?, tools }`: a throwaway service connects, lists tools and closes |
| `DELETE /api/connections/:id[?credential=delete]` | `{ removed, credentialDeleted }`; the token is kept unless asked |
| `POST /api/connections/:id/test` | `{ connection, tools }` after a fresh connect |
| `GET /api/connections/:id/tools` | `{ connection, tools }`: each tool with class, policy and where each came from |
| `PUT /api/connections/:id/tools/:tool` `{ class?, policy? }` | `{ tool }`; `null` clears an override |
| `PUT /api/connections/:id/profile` `{ profile \| null }` | `{ connection }` with the profile's check against the server's tools |
| `PUT /api/connections/:id/token` `{ token }` | `{ connection }`; the token is not in the answer |
| `GET`, `PUT /api/connections/sync` `{ rules, connection? }` | tracker sync's per-event `off \| dry-run \| on`, writing `trackerSync.rules` |
| `POST /api/connections/:id/oauth/start` `{ redirectUrl, basePath? }` | `{ authorizationUrl }` |
| `POST /api/connections/:id/oauth/finish` `{ code, state, iss? }` | `{ connection }` |
| `POST /api/connections/:id/sign-out` | `{ connection }` |

- **Writes land in `.n-dx.local.json` only.** `local-config-write.ts` edits one
  top-level key (`connections`, `trackerSync`) in place and refuses, with 409,
  a local file the repository commits or one that does not parse. The tracked
  `.n-dx.json` is never touched. The ids `test`, `sync`, `tracker` and
  `profiles` are reserved because they are fixed paths. An env value typed into
  the add form is written to that file as typed, as hand-editing would; a token
  never is.
- **A token is accepted, never returned.** The add and token routes store it
  through `connection-credentials.ts`; no response, log line or error carries
  it (a body that fails to parse is reported without the text it choked on),
  and the form empties its field as soon as it sends. Test of an unsaved
  token or OAuth server is not offered: its credential is stored when it is
  added.
- **A write to `ndx work`'s config is reverted mid-run.** Saving here while
  `ndx work` runs is the same hazard as `ndx config`; save it again after.

- **Never public.** Every route needs the per-user token or a browser session,
  directly and through the hub; `web.sidecar` gates the family
  (`route-feature-gates.ts`), because listing a connection connects it. No
  answer carries a token, refresh token, code or fingerprint.
- **The return is a page, not a route.** Sign in sends the tab (the same tab,
  whose `sessionStorage` holds the session) to the authorization URL, which
  returns to the fixed callback (see [Callback](#callback)). That address is
  the public page shell and the server acts on nothing in its query. The page
  takes `code`, `state` and `iss` out of the address bar, moves to Settings >
  Project, posts them to `oauth/finish` with its session in the header, and
  shows the result above the list.
- **The fixed loopback callback only.** `oauth/start` refuses a `redirectUrl`
  other than `http://127.0.0.1:<port>/oauth/callback` or the same on
  `localhost`, with no credentials, query or fragment, and a `basePath` that
  is not a dashboard base path.
- **One service per project.** The routes and the broker share
  `workspaceConnectionService`, so a sign-in reaches the next Sidecar turn.

## Decisions

- **Only the user's own config declares a connection.** A connection names a
  command to spawn or the URL a token is sent to, so a cloned repository must
  not choose one. A `connections` block in the tracked `.n-dx.json`, or in a
  `.n-dx.local.json` the repository commits, is ignored with one warning. The
  Settings page writes that file and no other; it can also be edited by hand.
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
  `OAuthClientProvider` and lets `auth()` do the client (a metadata document
  or dynamic client registration), authorization code with S256 PKCE, and
  refresh; nothing is hand-rolled. `beginSignIn` runs the SDK's discovery
  (protected-resource, then authorization-server metadata) first, to choose
  the scopes, and hands it to `auth()`.
  `beginSignIn(id, redirectUrl, route)` returns the authorization URL,
  `finishSignIn(id, code, state, iss)` exchanges the code and reconnects, and
  `signOut(id)` forgets the entry. The redirect returns to a dashboard page that
  finishes the sign-in through an authenticated route.
- **One record, bound to its URL, client and scopes.** The client, the tokens,
  and the URL, client identity and scopes they were issued for are one JSON
  value in `connection:<id>`. When the configured URL or client identity no
  longer matches, or the connection now needs a scope the record lacks,
  nothing is sent and the connection reads `needs-sign-in` ("sign in again").
  A new client is stored only with the tokens it earns, so a sign-in that is
  never finished stores nothing. A record from before identities were stored
  counts as n-dx's own document.
- **State and verifier stay in memory.** Each is single-use and expires after
  10 minutes; a wrong, reused, expired or other connection's state is refused
  and stores nothing. A state is spent by its first use, right or wrong.
- **`iss` is checked (RFC 9207).** An `iss` on the return must equal the
  authorization server's `issuer`, and a server that advertises
  `authorization_response_iss_parameter_supported` must send one; otherwise
  the sign-in is refused and nothing is stored.

### Client identity

n-dx signs in as its client ID metadata document,
`https://docs.n-dx.dev/oauth/client.json` (`CLIENT_METADATA_URL`), whose
`redirect_uris` are `http://127.0.0.1/oauth/callback` and
`http://localhost/oauth/callback` on any port (RFC 8252). Where the
authorization server advertises `client_id_metadata_document_supported`, the
SDK sends that URL as the `client_id` and registers nothing; elsewhere it falls
back to dynamic client registration. A connection's `oauth.clientMetadataUrl`
names another document; `oauth.clientId` a pre-registered public client, which
is then the only client used. The identity (`metadata-document <url>` or
`client-id <id>`) is stored with the tokens, so changing it means signing in
again.

### Callback

Every sign-in returns to `http://127.0.0.1:<port>/oauth/callback`, or
`localhost` when the dashboard was opened there (the session lives in that
origin's `sessionStorage`), on the origin the dashboard is served from. The
state (`src/shared/oauth-callback.ts`) is
`<project>~<workspace>~<connection>~<nonce>`: the routing fields are plain
text, percent-encoded, and only the nonce is secret; the server holds the whole
state single-use.

- **Served directly**, the project server answers `/oauth/callback` with the
  public page shell. The viewer reads the state; when it names another
  worktree, the page moves to `/w/<key>/oauth/callback` with the query intact,
  so the sign-in finishes on the workspace that started it.
- **Through the hub**, the callback lands on the hub's origin root. The hub
  answers `GET /oauth/callback` itself (`src/hub/oauth-callback.ts`), after its
  request guard and without a credential: it forwards the browser, query
  intact, to `/p/<project>/oauth/callback` for the project the state names, or
  for the sole registered project when it names none. An unknown project, a
  missing one among several, or no state is a plain error page. It reads no
  token, cookie or code and stores nothing.

### Scopes

When the server's metadata lists `scopes_supported` (protected resource first,
then authorization server) and the connection's profile names `oauth` scopes,
the sign-in asks for the needed scopes the server lists
(`src/server/tracker/oauth-scopes.ts`); otherwise the SDK's default applies.
A profile's read scopes are always needed; its write scopes too while one of
its `writeTools` has a policy other than `never` (before the server lists its
tools, a write tool's policy is its override, else `ask`), or tracker sync
goes through the connection with a rule that is not `off`. The CAOS profile
reads `caos:work-items:read` and `caos:context:read`, and adds
`caos:work-items:create`, `caos:work-items:edit` and `caos:work-items:move`. A
change that needs a scope the stored sign-in lacks reads "sign in again".
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
