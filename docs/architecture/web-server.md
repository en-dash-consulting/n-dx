# Web server: request gate, concurrency and workspaces

The reasoning behind the rules in `packages/web/src/server/AGENTS.md`. The rules
themselves are there, beside the code; this page is why they are what they are.

## Request gate: Host first, then Origin

Both servers are loopback-only, so the request gate is the access control
against a web page the operator has open; the credential check between its
two rules is what tells this user from another account
([Authentication](#authentication)). It has two rules,
applied in this order, and both live in `src/shared/origin.ts` so the hub
(`hub/request-guard.ts`) and the project server (`server/request-security.ts`)
cannot drift:

1. **Host must name loopback on this socket's port** — `localhost`,
   `127.0.0.1` or `[::1]`, with the exact port, round-tripping through the URL
   parser unchanged. Anything else is `421 Misdirected Request`, for `GET` as
   much as `POST`. Behind the hub the proxy rewrites `Host` to
   `127.0.0.1:<child port>`, so a project server only ever judges requests made
   to it directly.
2. **A present `Origin` on a mutation must be this server's own**, compared
   against the socket port (never `Host`); `Sec-Fetch-Site: cross-site` without
   an `Origin` is refused too. Safe methods with a foreign `Origin` pass
   unreflected — the page cannot read them without the CORS header.

Consequences for new code:

- **Every listener gets the gate.** A new `createServer` in this package calls
  `handleRequestSecurity` (or the hub's `guardHubRequest`) before routing, and
  its `upgrade` handler applies `isTrustedHost` + the origin check. The
  dashboard, the hub and the preview server all do.
- **`GET` must be read-only.** A safe method must not have side effects; a
  `GET` that writes a file or spawns a process is a bug even on loopback.
- **Internal clients must use a loopback name.** The hub's health probes and
  overview fetches use `127.0.0.1:<port>`; a client that reached a server by
  the machine's hostname or `0.0.0.0` would now get 421. Remote access through
  a tunnel or devcontainer port-forward is unsupported for the same reason — if
  it ever becomes a feature it needs an explicit Host allowlist setting, not a
  relaxed check.
- **Tests build requests by hand.** `fetch()` will not send a foreign `Host`;
  use `node:http`'s `request` with `setHost: false` (see
  `tests/integration/hub-proxy.test.ts`) or the mock request helpers in the
  unit tests, which default `Host` to the socket so origin tests exercise the
  origin rule.

## Authentication

Host and Origin tell a web page apart from the dashboard; they cannot tell
this user from another account on the same machine, since every account can
reach `127.0.0.1`. With a per-user token configured (`ndx start` always
configures one unless `--no-auth`), every request to the hub, a project server
or the preview server must also carry a credential, **in a header**
(`X-Ndx-Token` or `Authorization: Bearer`). The shared definitions are in
`src/shared/auth.ts`; each gate applies them after the Host rule and before the
Origin rule.

**Why not a cookie.** A cookie set by `localhost:3117` is sent to every
`localhost:<port>` — cookies are scoped by host, not port, and `SameSite` is
same-*site*, which ignores the port. Any other local server the operator opens
in the same browser (a dev server, a tool's web UI) would receive it and could
replay it. `sessionStorage` is scoped to the origin, port included, so a
credential kept there and sent as a header reaches only the server that issued
it. No server sets or reads an `ndx_token` cookie any more; one presented is
ignored, so the request is answered as if it carried nothing (401 for anything
but the page shell).

**Two kinds of credential.**

- The **per-user token** (`<ndx home>/auth.token`, 0600) — the CLI, MCP
  clients, scripts, and the hub's own calls to the project servers it
  supervises. Never handed to a browser, and never put in a URL: what
  `ndx start` prints and passes to the browser opener (whose argv is visible
  in `ps`, and which lands in browser history) carries a nonce instead.
- **Browser sessions**, minted by the server the page is on and held in its
  memory (`CredentialStore`): 256-bit CSPRNG values, compared in constant
  time, distinct from and not derived from the token. A session ends after
  12 hours idle or 7 days, and every session ends when that server restarts.

**The landing exchange.** `ndx start` asks the server it just started or
registered with — over a token-bearing request, after identifying the listener
as its own — for a nonce (`POST /api/auth/nonce`, token only; a session cannot
mint nonces), and prints `…/?ndx_nonce=<nonce>`. The nonce is single-use and
expires after 60 seconds. Every HTML document the servers send starts with the
session script (`src/shared/browser-session.ts`), which posts the nonce in
`X-Ndx-Nonce` to `POST /api/auth/session`, stores the returned credential in
`sessionStorage`, removes the nonce from the address bar, and wraps `fetch` so
every same-origin request carries the credential. Behind the hub the nonce and
the session are the hub's: the hub answers `/api/auth/*` itself, at the root
and under any `/p/<id>/`, and its proxy replaces whatever credential a client
sent with the per-user token before forwarding, so a project server never sees
a hub session. A `--here` server or the preview server mints and keeps its own.

**WebSockets.** A browser cannot set headers on a handshake, so the page trades
its session for a ticket (`POST /api/auth/ws-ticket`) and puts it in the socket
URL as `?ndx_ticket=`. Tickets are single-use and expire after 30 seconds. The
hub spends the ticket and forwards the upgrade with the token header. Viewer
code opens sockets only through `openWebSocket()` (`viewer/session.ts`),
asserted by `tests/unit/viewer/socket-guard.test.ts`.

**What is public.** A navigation carries no header, so a safe-method request
with no credential is passed on *marked* public-only, and gets only the page
shell: the viewer HTML, the landing page, static images, the hub home page
without its cards (they load once the page is signed in). Anything else is 401
— an HTML "sign-in needed" page for a navigation, JSON otherwise. The shell is
the built bundle, the same for every user. The preview server's document is
not public: a navigation without a credential gets a sign-in page, which moves
the tab to `/__preview/s/<capability>/` — a separate, read-only capability for
the document directory, minted for a signed-in page — because a design
document's stylesheets and images load without headers.

**Reload, new tab, deep link.**

- *Reload* keeps the tab's `sessionStorage`, so the tab stays signed in.
- *A new tab* starts with empty `sessionStorage`. The session script asks the
  other tabs of the same origin over a `BroadcastChannel`; if one is signed in,
  it hands its credential over. So a link opened in a new tab, or a deep link
  pasted while the dashboard is open, works.
- *A deep link with no signed-in tab* (or after a server restart) gets the
  shell, whose script finds no credential and replaces the page with "Sign-in
  needed — run `ndx start` again and open the URL it prints". A deep link to
  data rather than a page gets the same text as a 401 page. An expired or
  reused landing link says so.

## Sidecar broker key

A Sidecar session's CLI reaches the broker with a per-session key minted in
`sidecar/broker-credential.ts`, not the dashboard token. The gate accepts it
only on a `POST` to that session's raw `/api/sidecar/sessions/<id>/mcp` target;
every other route, method or session answers 401. The session can read its own
MCP config file, so that file never carries the token.

## Response headers

`src/shared/response-headers.ts` is applied by both gates before any verdict is
written, so a refusal carries the same headers as a page: `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and a
Content-Security-Policy. The built viewer and hub pages ship an inline
bootstrap script and inline styles, so the page policy keeps `'unsafe-inline'`
for scripts and styles and is otherwise same-origin (plus `data:`/`blob:`
images and loopback WebSockets). `/data/*` responses switch to a strict policy
that allows nothing, because they are data, not documents. The hub session's
drawer page alone may be framed, by its own origin (`SAMEORIGIN`,
`frame-ancestors 'self'`): the hub home docks it in an iframe. The preview server
adds `https:` sources, since a design document may load from a CDN.

## Repository trust

A repository's tracked config can widen what n-dx executes. The dashboard
follows the same decision as `ndx work` (`isRepoRestricted`): routes that spawn
from repository content answer 403 with `hint: "ndx trust accept ."` until the
operator accepts the config. The LLM catalog needs no gate of its own: it
reads config through `loadLLMConfig`, which drops the shared config's
`cli_path` until then, so its `--version` probe runs only a binary the
operator chose, and its live model list always calls the vendor's own models
URL, never a configured `api_endpoint`. A restricted answer is not cached, so
accepting the config shows the probed result at once. CLIs are never
resolved from the analyzed project — it is what the dashboard serves, not what
it runs.

## Sidecar Diagnose run packet

Knowledge packets omit error text (PK4). The Diagnose run packet is a
deliberate exception: it carries the newest run's gate failure digest (or
output tail when hench extracted no digest), capped at 2,400 characters —
the digest's start, which lists the failing tests, or the tail's end —
because the diagnosis is about that error. The text is local,
passes through `redactDeep`, and goes only to the vendor the project is
configured with. The packet's other sections are the run classifier's
verdict (`RunRecord.diagnosis`), the review's unrepaired findings and the
run's last events, each read from disk in `sidecar/packet-sources.ts`; web
still imports nothing from hench.

A run from a hench that predates the classifier records no verdict. When the
newest run has ended without completing, the verdict comes from
`hench runs diagnose <id> --format=json`, spawned through `SpawnedReads`
(`diagnoseTaskRun` in `routes-hench-prep.ts`, beside the resolve and preview
spawns) and named as the section's provenance. A failed or timed-out spawn
leaves a gap naming the command; a running or completed run is never
classified. The verdict section also lists the failed run's settings (`model`
when a flag chose it, `review` and `reviewModel` when it had a review plan; a
pair review repeats as `reviewMode: "pair"` with its `reviewVendor`) for the
model to pass to `start_work` on a re-run or `--fresh`. The spawned verdict
passes through `redactDeep` like the recorded one: its evidence quotes the
run's error.

## Sidecar Diagnose branch and GitHub cards

The Diagnose branch packet (`sidecar/branch-packet.ts`) is the second PK4
exception: each failing check carries the end of its failed-job log, at most
1,200 characters of the tail branch health already capped, through
`redactDeep`. Its target is a workspace key; `SidecarWorkspaces`, injected by
start.ts, names the worktree, and fix cards are offered only when that
worktree is the session's own, because a card runs in the session's worktree
(no cross-workspace write action). A source conflict never gets a card.

GitHub reads have one allowance, `web.sidecarGithubReads`, saved to the
user's local config; the shared config's `true` applies only in a trusted
checkout (`network-reads` trust finding). The packet runs gh
only under it; `github_read` runs without a card under it and raises a
network-read card otherwise. `github_read` is `per-project` in the broker
policy, so an allow-list rule for it is ignored. `draft_github_post` is never
allowed without its card: Approve posts the card's own input under the
operator's gh login (`gh pr comment` or `gh pr review --comment`, body on
stdin); Copy and Discard deny it.

## Hub session

`/hub/session/…` on the hub is the hub-scope Sidecar session, one per machine.
The hub spawns no vendor CLI for it: `hub/proxy.ts` forwards it, HTTP and
WebSocket, to `/api/sidecar/hub/…` on the project server `hub/session-host.ts`
picks. That is the holder of `<ndx home>/hub/sidecar/host.lock` (pid and port)
while it is healthy, else the first healthy registered project, skipping one
the proxy just failed to reach until its next health check. All session state
is under `<ndx home>/hub/sidecar/`, so a new host resumes it from disk. The
holder gives the lock up on graceful shutdown, and when its web.sidecar gate
refuses a hub session route, once any hub turn running on it finishes; a
crashed holder is replaced as a dead pid. The
path mapping and the lock's location are in `src/shared/base-path.ts`, which
the host's routes (`server/routes-sidecar.ts`) read too. The hub judges the
browser's credential and forwards the per-user token to the host, as it does
for `/p/<id>/`.

The hub home offers it only when `probeHubLens` (`hub/session-host.ts`) gets a
yes from the host it would pick (`/lens`): a header toggle (⌘J) docks an
iframe of `/hub/session/drawer`, the drawer-only viewer page the host builds
beside the dashboard (`viewer/hub-session.ts`). `hub/home.ts` stays
server-rendered with no Preact; the frame posts `HUB_SESSION_CLOSE_MESSAGE` to
undock. The host injects the page's paths into it, so they do not cross
`viewer/external.ts`, and the session script, so the frame signs in from its
tab. With auth on, a navigation gets the deferred home with the toggle hidden;
its first overview read after sign-in (`?hubSession=1`) runs the same probe and
shows it. The frame's navigation is the one credential-less `/hub/session/`
request the hub serves: a GET wanting HTML of `/drawer`, fetched from the host
with the token. That page holds only static paths; everything else there is 401.

### Hub session: drafts only

The hub session's broker is scoped (`BROKER_SCOPE_TOOLS` in
`sidecar/broker-policy.ts`): it is offered `run_command`, `draft_github_post`,
`save_draft` and `ledger_append`, and never `start_work`, `propose_edit`,
`propose_prd_change`, `place_change_card` or `migration_decision`. Calls name a
`project`, resolved to its repository root through the hub's overview
(`sidecar/hub-actions.ts`), never from a path the agent gives.

- `run_command` accepts only `HUB_COMMAND_ARGV` (`ndx status`,
  `git worktree list`, `git status --short --branch`). Any other argv, or a
  project the hub does not name, is refused before a card is raised. The
  allow-list key is `{ project, argv }`, so a rule covers one project.
- `draft_github_post` posts only on Approve, with cwd at the project's
  repository root.
- `save_draft` writes nothing before Approve. The card shows the absolute path
  (a relative one lands in `<ndx home>/hub/drafts/`), the operator can change
  it, an existing file is never overwritten, and it is never allow-listable.

## Sidecar Guide and the run-plan card

The Guide packet (6k cap) is the queue planner's plan as hench printed it:
lanes with their commands and reasons, the tasks left out and why, active
runs against the limit. It is read through `readQueuePlan` in
`routes-hench.ts`, the same spawn and parse `GET /api/hench/plan-queue`
uses, injected as `SpawnedReads.queuePlan` (web has no `node:child_process`
and no hench import). Its target is the whole ready list, so no ref is
needed. While `hench.readyNext` is off, `GET /api/sidecar/lenses` reports the
lens unavailable and naming that toggle, and `buildLensPacket` reads
nothing: no packet, no planner spawn. The gate is `SpawnedReads.featureEnabled`
because packet code imports no route.

`propose_run_plan` raises a run-plan card and is never allow-listable. The
model gives no commands: the broker reads the planner itself (refusing with
no card when it has no lane or the toggle is off) and the card carries that
plan. Copy commands is the page's own clipboard write, with no broker call.
Start lane approves the card with `lane`, and the tool result then names that
lane's first task alone for a `start_work` card, listing the rest with their
exact commands for a later turn. A first step carrying a flag a work card
cannot (`--require-unblocked`) is not started from a card. Nothing starts
without an approved work card, whose preview shows active runs against
`guard.maxConcurrentProcesses`; approving one that would make a run past the
limit is refused, naming the limit and the runs that hold it. The count is the
repository's, not the worktree's: live lock holders in every worktree of
`git worktree list` (`repositoryRunSlotUsage`), the same locks the planner's
`activeRuns` reads, plus runs this server spawned that hold no lock yet. On the
run-plan card a chosen lane reads "Work card raised" until its first task's work
card is approved and the run started ("Started"); a denied or withdrawn work
card clears it.

## HTTP-request concurrency

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes to `.rex/prd_tree/` | Partial aggregate read or stale derived JSON | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** most routes treat disk files as read-only. The exception is the PRD: the routes that mutate `.rex/prd_tree/` (item CRUD, merge, prune, reorganize, restore, the Ask panel's `apply-refinements`, and `PUT /api/hench/prep/:taskId` — the Prepare task modal's Save) go through `rex-gateway`'s `resolveStore` and hold the PRD file lock for the span of `withTransaction`. That makes the server a first-class PRD writer alongside `ndx work` and the MCP tools, and it is why those routes surface a lock-acquisition failure — which names the holder's PID — rather than retrying or writing anyway.

The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations; routes that write also call `refreshPRDCache` so their own change is visible to the next read without a restart. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.

## Writes are workspace-scoped

Every PRD-writing route resolves its target from `ctx.rexDir` — through
`resolveStore(ctx.rexDir)` in `routes-rex/items.ts`, `prune.ts`, `health.ts`,
`refinements.ts` (which is where the Ask panel's accepted proposals land, via
`POST /api/rex/apply-refinements`), `requirements.ts`, `routes-rex-analysis.ts`
and `routes-hench-prep.ts` (`PUT /api/hench/prep/:taskId`, which saves a task's
own run settings and is the one writer outside `routes-rex/`); and by path in
`restore.ts`, which restores from that workspace's `.rex/.backups`.
Since PR 12 that ctx is whichever workspace the request addressed —
the `/w/<key>/` slot or `X-Ndx-Workspace` — so a write made while viewing a branch
worktree rewrites **that worktree's** `.rex/prd_tree/` and leaves the anchor's
untouched. The PRD lock is per `rexDir` (`prdLockPath`), one per workspace: two
worktrees write concurrently without contending, and equally, the lock does not
serialize them against each other. Nothing needs it to — they are different trees.

Two rules follow, and both are load-bearing:

- **No cross-workspace write action.** No route takes a workspace as a parameter,
  and no UI offers "apply to the anchor instead". Editing the anchor's PRD while
  viewing a branch requires switching workspace through the top bar's workspace switcher,
  which is a full navigation. A cross-workspace affordance would make the write
  target a thing the reader has to check rather than a thing the URL states.
- **The write target is stated, not inferred.** `WorkspaceWriteStrip`
  (`viewer/components/workspace-write-strip.ts`) renders a one-line strip in the
  PRD view for a non-anchor workspace only. On the anchor it renders nothing —
  a permanent banner on the common case is noise.

`tests/integration/workspace-scoped-prd-writes.test.ts` pins this by hashing both
trees around each write; a route that wrote both would fail it.

## The Workspaces board is the one cross-workspace reader

`viewer/views/workspaces.ts` is the exception to both rules above, deliberately
and in one direction only. It is *about* the set of worktrees, so it addresses
each one explicitly with the `X-Ndx-Workspace` header rather than the `/w/<key>/`
slot — the slot is already spent on whichever workspace the viewer itself is
mounted under, and the server reads the header ahead of the slot
(`workspaceFromHeader` in the dispatcher, not the lenient `resolveWorkspace`).
Four endpoints answer for the whole repository and are fetched plainly
(`/api/workspaces`, `/api/worktrees`, `/api/hench/memory`, `/api/live`); the
rest are per workspace. `/api/live` (`routes-live.ts`) is the Live tab's one
read — every worktree's running runs and jobs, the queue, the machine strip —
built from the registry's list and the digest cache behind `/api/worktrees`,
never from `git` per request. Its `live:changed` frame is tagged `"*"`, like
the memory monitor's.

**A header naming no known worktree is a 404, on reads as much as on writes.**
Falling back to the anchor would answer under a name the caller did not ask
for: a write to the wrong tree, or — on the board's per-card polling — the
anchor's running task painted onto another worktree's card. Refusing is safe
because only a fetch ever sets this header (`workspaceFetch`,
`StartTaskButton`), never a navigation, so no page load can 404 on it. The
dispatcher re-reads the worktree list once before refusing, since the registry
only rescans every 30s and a worktree created since the last tick would
otherwise be rejected for no reason. `respondUnknownWorkspaceHeader` answers
JSON naming the key and the keys that do exist; `StartTaskButton` already
renders that `error` field.

Two constraints keep this from eroding the rules:

- **No route gained a workspace parameter.** The header is the existing
  addressing mechanism, not a new one. A request made with it *is* that
  workspace's request — `ctx` resolves the same way it does for a `/w/<key>/`
  navigation, so the run it starts has that worktree as its cwd and writes that
  worktree's tree. Nothing writes across a boundary.
- **The only cross-workspace action is Start working / Stop.** Starting an agent
  in another worktree names the worktree on the button
  (`StartTaskButton`'s `workspace` prop, which sets the header). Editing a PRD
  item still requires navigating there — the board links, it does not edit.

Because it is about every worktree, it is also the one socket consumer that must
**not** call `acceptsFrame`: a run progressing in worktree B is exactly what
should move B's card while the viewer sits on A. It reads the `workspace` tag
itself (`frameWorkspace`) and refreshes only that workspace's slice, falling back
to a whole-board reload for a `"*"` frame or an unrecognised key.

## Branch health

`GET /api/branch-health` (`routes-branch-health.ts`, logic in
`server/branch-health/`) reports one worktree's branch by fixed rules, with no
model: the data the Sidecar's Diagnose branch lens and the hub narrate later.
The Workspaces board asks it once per card, by header, while `git.branchHealth`
is on; the route gate refuses it with 403 while the toggle is off.

- **The toggle is per worktree.** The board reads `git.branchHealth` from its
  own workspace, but the gate reads the addressed worktree's `.n-dx.json`,
  which is tracked, so each worktree has its own copy. With the anchor's toggle
  on and a branch worktree's still off, that card answers 403
  `feature_disabled` and shows a neutral "off in this worktree" note, not an
  error. Enable the flag in that worktree (or merge the `.n-dx.json` change
  into its branch) to see its strip. The gate is not widened to follow the
  viewer's toggle: it always reads the project the request addresses.

- **Local facts need no network.** Branch, head, base, ahead/behind
  (`rev-list --left-right --count`), predicted conflicts and stack containment
  come from git alone, so the strip still answers offline.
- **The base is chosen in a fixed order:** the PR's base when GitHub reads are
  on, else the PR base a GitHub read cached, else the upstream when it names another branch, else origin's default
  branch. `baseSource` says which, because a branch whose upstream is its own
  remote copy has no useful upstream base.
- **Conflicts are predicted, not rehearsed.** `git merge-tree --write-tree`
  merges in the object store and returns the conflicted paths with their index
  stages. It leaves the worktree, the index and HEAD untouched, so a `GET` that
  predicts a merge stays read-only where it matters; the only trace is
  unreferenced objects that `git gc` collects. A git older than 2.38 cannot do
  this, and the answer says so in `conflictsUnavailable`.
- **Each conflict is classified, with a fix a person runs.**
  `branch-health/conflicts.ts` is a pure function over each file's stages and
  the diff3-style conflicted result merge-tree wrote, plus the project config:
  it reads no file, runs no process and writes nothing. Fixes assume
  `git merge <base>` on this branch (ours = this branch, theirs = the base).
  First match wins:

  | Class | When | Fix |
  |-------|------|-----|
  | `generated` | the path matches a `web.generatedFiles` glob | `checkout --theirs`, the declared command, `git add`; listed after every other fix |
  | `prd-state` | a v2 `state.yaml` while `merge.rex-state.driver` is unset | register the driver, `checkout --merge`, `git diff --check HEAD` (stops on markers the driver left, since `checkout --merge` exits 0 regardless), `git add`. With the driver set it is `source` |
  | `duplicate-capture` | add/add on a PRD item file, same title, different ids | keep the base's id (`checkout --theirs`), `git add`, `rex validate --post-merge --repair` (prunes the state row and `blockedBy` refs naming the dropped id), `git add -u` on the rex directory, `rex validate --post-merge` |
  | `prd-children-table` | a v1 `prd_tree` `index.md` whose hunks are all `## Children` rows, and the base changed nothing above the table (else `source`: keeping this branch's copy would drop it) | `checkout --ours`, `rex validate --post-merge --repair`, `git add`, `rex validate` |
  | `allowlist-union` | every hunk only adds list entries on both sides: each line a YAML `- ` scalar item, a quoted string, a number or literal, or a one-line `[…]`/`{…}` element, or the lines together a run of JSON array elements. Never a lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`); an added code block or mapping is `source` | a unified diff against this branch's copy: ours, then theirs |
  | `source` | everything else | none; names the other local worktrees whose branch changed the path (the API lists all; the Workspaces expansion shows three and counts the rest) |

  Stage blobs and other worktrees' diffs are read at most eight git processes
  at a time, and other worktrees only when a `source` conflict needs naming.
  `web.generatedFiles` is `[{ "paths": [globs], "command": [argv] }]`; with no
  declaration nothing is `generated`. This repository declares the prompt
  baseline, the iso-map skill script and `pnpm-lock.yaml`
  (`pnpm install --lockfile-only`).
- **A stack is content, not configuration.** Each layer below in the base
  chain is checked with `merge-base --is-ancestor`. A branch whose base is set
  to a lower layer but lacks that layer's commits is reported not contained:
  restacking is the fix, and a base setting alone would hide it. The chain
  follows each layer's PR base (GitHub reads on) or its upstream, and stops at
  origin's default branch, which is the trunk and not a layer.
- **gh runs only with `web.sidecarGithubReads` true.** That one project
  allowance governs every GitHub read the Sidecar makes. With it off, or gh
  missing or signed out, `github` is null and `githubReason` says why.
- **gh runs only on request.** Without `?github=1` the route answers local
  facts and sets `githubDeferred` when reads are allowed. The board asks that
  way on mount and adds `?github=1` when a card's strip is first expanded, so
  opening a board of many worktrees runs no gh command. A GitHub read
  remembers each PR base it finds, per worktree and branch, in the server's
  memory; later local-only answers use it for the base (`baseSource:
  "pr-cached"`) and the stack. Before any GitHub read, a local-only answer
  falls back to upstreams and origin's default branch, and `baseNote` says the
  PR base is not read yet, so a stacked branch's strip does not pass off
  `origin/main` as its base.
- **A failing check is classed on the whole log.** gh's per-line job, step and
  timestamp prefix and colour codes are removed first, whether gh wrote the
  escape as the 0x1b byte or as literal `^[` text. policy-test needs a policy
  suite among the failing test files: a log names passing suites on its ✓
  lines too. A failing-file line may carry a vitest project label between
  `FAIL` and the path (`FAIL  llm-client:shared tests/x.test.ts`). When no
  policy suite or touched test explains the failure, behind-base also fires when the PR's
  `mergeStateStatus` is `BEHIND` or a stack layer is not contained, and the
  evidence names which. A test path printed by a package's
  runner (`packages/p test: FAIL tests/x.test.ts`) matches only that
  package's `packages/p/tests/x.test.ts`. Only the stored `logTail` is cut, to
  the last 80 lines and 8,000 characters.
- **A failing check gets one class, first rule wins:** `fork-no-ci`,
  `codeql`, `behind-base`, `policy-test`, `touched-test`, else
  `unclassified`, each with the fact that decided it (`branch-health/checks.ts`).
  The order puts what no code change on the branch can fix first.
- **git and gh run through `@n-dx/llm-client`'s `exec`.** Web imports no
  `node:child_process`; the collector takes the exec function as an option
  so tests stub gh and run git for real against temporary repositories.

## web-server zone stability

`web-server` (composition root — Express routes, gateways, MCP handlers) is prone to dissolving into `web-viewer` in Louvain analysis because server files import from `packages/web/src/shared/` (required by the barrel-import policy), and shared files are also imported by viewer files, creating a Louvain connectivity bridge. If the zone dissolves:

1. Check `stability.reassignedFiles` in `.sourcevision/zones.json` for `[file, "web-server", "web-viewer"]` entries
2. Update `.sourcevision/hints.md` with re-analysis guidance
3. The zone pins in `.n-dx.json` targeting `"web-server"` are no-ops when the zone is absent — they will re-activate if the zone re-appears in Louvain output
4. The actual server/viewer boundary is enforced by `boundary-check.test.ts` regardless of zone detection — zone dissolution is a metrics artifact, not an architectural violation

## See also

- [Architecture Overview](overview.md) — the tiers the web package sits across
- [Gateway Modules](gateways.md) — the gateways the server wires
- [PRD write concurrency](prd-write-concurrency.md) — the lock the PRD routes take
