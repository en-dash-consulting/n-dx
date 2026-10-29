# Hub and API

The hub (`ndx start`, port 3117) mounts each enabled extension's sidecar at `/x/<name>/`. It also serves the endpoints an extension uses to find projects and other extensions.

## Sidecar lifecycle

The hub reads no manifest. For `/x/<name>/` it runs `ndx extensions sidecar <name> --json`, which applies the same discovery, approval and config checks as `ndx <name>` and prints a launch plan. The hub then spawns the plan's `bin`.

- **Lazy start.** The first request starts the sidecar with `PORT` set to an ephemeral loopback port, and waits for `health` to answer 200. If it has not answered after 20 seconds, the request gets 503 naming the log file.
- **Revocation.** Disable and removal stop the running sidecar. Every request rechecks approval, and the hub also rechecks running sidecars every 30 seconds, including those with open WebSockets. A refused plan stops the process.
- **Idle stop.** A sidecar with no request in flight, no open WebSocket and no traffic for `idleStopMinutes` is stopped. The next request starts it again. `ndx hub stop` stops every sidecar.
- **Crashes.** An exit the hub did not ask for is a crash, and so is a start that never turns healthy. The next request restarts the sidecar. After 3 crashes in 5 minutes, starts are refused with 503 and `retryAfterSeconds` until the oldest crash ages out.
- **Memory.** No sidecar starts while available memory is at or below `hub.memoryFloorBytes`.
- **Logs.** stdout and stderr go to `<ndx home>/ext/<name>/logs/`.
- **Sources.** Sidecars come from the `user`, `global` and `dev` sources. A project-source extension has commands only.

The hub keeps a stdin pipe open for the lifetime of each sidecar. Exit when stdin closes, including when the hub crashes or is killed. Handle `SIGTERM` by shutting down. The hub sends it on idle stop and on `ndx hub stop`.

## The proxy

- The path reaches the sidecar with `/x/<name>` stripped: `/x/hello/a/b?c=1` arrives as `/a/b?c=1`. The bare `/x/hello` redirects to `/x/hello/`.
- `X-Ndx-Base-Path: /x/<name>/` names the mount. Build absolute links from it, or use relative links.
- HTTP bodies stream in both directions, and WebSocket upgrades are piped.
- The hub checks the per-user token before the sidecar sees a request, and answers 401 without it. It removes the token from what it forwards: `X-Ndx-Token`, the `ndx_token` cookie (other cookies are kept) and a bearer header carrying it. Forwarded requests contain no hub credential. Loopback alone is not an authentication boundary: the hub generates a fresh `NDX_SIDECAR_SECRET` for each launch and sends it as `X-Ndx-Sidecar-Secret` on HTTP, health probes and WebSocket upgrades. Sidecars must reject missing or incorrect secrets before serving any route or upgrade, and must never expose the secret to the browser.
- A name that is unknown, disabled or unapproved, or whose `bin` is missing, answers 404. Any other refusal answers 503. Either way the body is `{ "error", "reason", "log"? , "retryAfterSeconds"? }`.
- `/x/` is reserved: no project id may start with it.

## Where an extension appears

- **Hub home:** one card per enabled extension that declares `hub`, linking to `/x/<name>/`. Unapproved and incompatible extensions are shown greyed out with their reason.
- **Project dashboards:** each `projectLinks` entry becomes a link in the dashboard header, resolved to `/x/<name>/<path>` with `{projectId}` and `{repoRoot}` filled in. A dashboard served without the hub shows no links. No extension code ever reaches the dashboard bundle.

## Versioned API

These endpoints are experimental under the current `apiVersion` 1 contract, not a stability promise; see [Versioning](./versioning.md). Every answer carries `apiVersion`. A listed field is removed or retyped only with a version bump, and new fields may be added at any time. Errors are `{ "error": "…" }`. Every request needs the token, from `NDX_TOKEN_FILE`, as `X-Ndx-Token: <token>` or `Authorization: Bearer <token>`. A mutating request must send a loopback `Origin`, or none.

| Endpoint | Answer |
| --- | --- |
| `GET /api/hub/projects` | `{ apiVersion, projects }`. Each project has `id`, `name`, `repoRoot`, `worktrees`, `ndxBin`, `port`, `pid`, `lastSeen` and `status`. `status` holds `state`, `pid`, `port`, `attached`, `respawns`, `lastHealthAt` and `lastError` |
| `POST /api/hub/projects` | Takes `{ id, repoRoot, ndxBin, worktree?, name? }`. Answers `{ apiVersion, project }`: 201 when registered, 200 when it was already registered, 400 for a bad body |
| `GET /api/hub/extensions[?project=<id>]` | `{ apiVersion, extensions, errors }`. Each extension has `name`, `packageName`, `version`, `source`, `state`, `reason`, `compatible`, `manifest` (null when invalid), `mount` (`/x/<name>/` or null) and `sidecar` (`state`, `recentCrashes`, `lastError`, or null). With `project` set, each entry adds `links: [{ label, url }]`, which is empty unless the extension is enabled. An unknown project answers 404. A 503 means n-dx could not be asked |
| `POST /api/hub/extensions/:name/stop` | `{ apiVersion, name, stopped }`. `stopped` is false when no sidecar was running. A name no extension could have answers 404 |

A project's own API and MCP endpoints sit under `/p/<id>/`, using the `id` from `GET /api/hub/projects`. While exactly one project is registered, `/` also aliases to it.

The contract tests are `packages/web/tests/integration/hub-extension-api.test.ts`.

Sidecar pages share the hub origin. Their JavaScript can call hub APIs using the browser session cookie even though it cannot read that HttpOnly cookie. Approving a sidecar therefore grants browser-side hub authority as well as permission to run local code; extensions must treat repository content as untrusted input and prevent script injection.
