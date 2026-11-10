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
- `X-Ndx-Base-Path` names the mount: `/x/<name>/`, or `/x/<name>/~<key>/` when the hub requires the per-user token. A browser sends no header with a page's scripts, styles and images, so the key in the path is what admits them; it opens that one sidecar and nothing else, and lasts as long as the hub. The same value arrives at launch as `NDX_BASE_PATH`. Build absolute links from either (a drawer tab's page is the exception; see [Frame keys](#frame-keys)), or use relative links; a link to `/x/<name>/…` without the key still works, through a sign-in page the hub serves before moving on to the keyed mount.
- HTTP bodies stream in both directions, and WebSocket upgrades are piped.
- The hub checks the per-user token before the sidecar sees a request, and answers 401 without it. It removes the token from what it forwards: `X-Ndx-Token`, the `ndx_token` cookie (other cookies are kept) and a bearer header carrying it. Forwarded requests contain no hub credential. Loopback alone is not an authentication boundary: the hub generates a fresh `NDX_SIDECAR_SECRET` for each launch and sends it as `X-Ndx-Sidecar-Secret` on HTTP, health probes and WebSocket upgrades. Sidecars must reject missing or incorrect secrets before serving any route or upgrade, and must never expose the secret to the browser.
- A name that is unknown, disabled or unapproved, or whose `bin` is missing, answers 404. Any other refusal answers 503. Either way the body is `{ "error", "reason", "log"? , "retryAfterSeconds"? }`.
- `/x/` is reserved: no project id may start with it.

## Where an extension appears

- **Hub home:** one card per enabled extension that declares `hub`, linking to `/x/<name>/`. Unapproved and incompatible extensions are shown greyed out with their reason.
- **Project dashboards:** each `projectLinks` entry becomes a link in the dashboard header, resolved to `/x/<name>/<path>` with `{projectId}` and `{repoRoot}` filled in. A dashboard served without the hub shows no links. No extension code ever reaches the dashboard bundle.
- **Sidecar drawer:** an extension that declares `sidecarTab` gets one tab. The hub reports it per project as `tab` on `GET /api/hub/extensions?project=<id>`, and serves it only through a frame key (below). The drawer lists the tabs after Sidecar in the hub's order, asks for the key and creates the iframe on a tab's first open, and fetches the keyed page once first so a cold start shows "Starting `<label>`…", a 503 shows its message and log file, and a 401 shows "Expired · Reload". A dashboard without the hub, or with `web.sidecar` off, shows no tabs; the hub-home drawer has none in v1.

## Frame keys

A drawer tab is an iframe sandboxed without `allow-same-origin`, so it carries neither the token nor the cookie. `POST /api/hub/extensions/:name/frame?project=<id>` issues a key for it, and the hub answers with the finished URL: `/x/<name>/~f/<key>/<sidecarTab path>`.

- **The key.** 32 random bytes, base64url, held only in the hub's memory. It is bound to one extension; the project it was issued for fills the URL. It goes stale after the extension's `idleStopMinutes` without use (each accepted request slides the window), and 8 hours after issue in any case. Disable, removal, a changed approval and a refused launch plan drop the extension's keys, and so does a hub restart. Ask for a new one when a keyed request answers 401.
- **Where it works.** Only on its own extension's `/x/<name>/~f/<key>/…` paths, HTTP and WebSocket, in place of the token. Anywhere else — `/p/<id>/…`, `/api/hub/…`, another extension's mount — it is not a credential, and the request answers 401 before any sidecar starts. A keyed request may send `Origin: null` (the sandboxed page) or no Origin; any other non-loopback Origin on a mutating request answers 403.
- **What the sidecar sees.** `~f/<key>` is stripped like the rest of the mount, `X-Ndx-Base-Path` is `/x/<name>/~f/<key>/`, and every hub credential is removed as on any proxied request. Build links from this header, or use relative links, so they keep the key. Do not build them from `NDX_BASE_PATH`: it names the hub-lifetime mount, and a module script or `fetch` the tab sends there from its opaque origin gets no CORS answer, so it fails.
- **Reading its own API.** The page's origin is opaque, so a script's `fetch("api/data")` to its own sidecar is cross-origin and carries `Origin: null`; the browser hides the response unless it names that origin. The hub does this for the extension, so a sidecar needs no CORS code to work in a tab. On a keyed request whose `Origin` is exactly `null`, the hub sets `Access-Control-Allow-Origin: null` and `Vary: Origin` on the response, replacing the sidecar's own allow-origin and credentials headers, and never sends `Access-Control-Allow-Credentials` (the key is the credential; no cookie is involved). A preflight (`OPTIONS` with `Access-Control-Request-Method`) is answered by the hub with 204, echoing the requested method and headers, `Access-Control-Max-Age: 600`, and never reaches the sidecar. Requests without an `Origin` (navigations, subresources) and unkeyed `/x/<name>/` responses are unchanged.
- **What the browser sees.** Every keyed response carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-downloads` and `Referrer-Policy: no-referrer`. The page therefore has an opaque origin even when opened full-window (the drawer's pop-out opens the same URL), and the key never leaves in a `Referer`. A sidecar's own CSP is kept beside the sandbox, so it can only narrow it.

## Versioned API

These endpoints are experimental under the current `apiVersion` 1 contract, not a stability promise; see [Versioning](./versioning.md). Every answer carries `apiVersion`. A listed field is removed or retyped only with a version bump, and new fields may be added at any time. Errors are `{ "error": "…" }`. Every request needs the token, from `NDX_TOKEN_FILE`, as `X-Ndx-Token: <token>` or `Authorization: Bearer <token>`. A mutating request must send a loopback `Origin`, or none.

| Endpoint | Answer |
| --- | --- |
| `GET /api/hub/projects` | `{ apiVersion, projects }`. Each project has `id`, `name`, `repoRoot`, `worktrees`, `ndxBin`, `port`, `pid`, `lastSeen` and `status`. `status` holds `state`, `pid`, `port`, `attached`, `respawns`, `lastHealthAt` and `lastError` |
| `POST /api/hub/projects` | Takes `{ id, repoRoot, ndxBin, worktree?, name? }`. Answers `{ apiVersion, project }`: 201 when registered, 200 when it was already registered, 400 for a bad body |
| `GET /api/hub/extensions[?project=<id>]` | `{ apiVersion, extensions, errors }`. Each extension has `name`, `packageName`, `version`, `source`, `state`, `reason`, `compatible`, `manifest` (null when invalid), `mount` (`/x/<name>/` or null) and `sidecar` (`state`, `recentCrashes`, `lastError`, or null). With `project` set, each entry adds `links: [{ label, url }]`, which is empty unless the extension is enabled, and `tab: { label, url } | null`. `url` is the manifest's `sidecarTab.path` under `/x/<name>/` with `{projectId}` and `{repoRoot}` URL-encoded; `tab` is null unless the extension is enabled, compatible and has a sidecar and a `sidecarTab`. Without `project` there is neither `links` nor `tab`. An unknown project answers 404. A 503 means n-dx could not be asked |
| `POST /api/hub/extensions/:name/stop` | `{ apiVersion, name, stopped }`. `stopped` is false when no sidecar was running. It also drops the extension's frame keys. A name no extension could have answers 404 |
| `POST /api/hub/extensions/:name/frame?project=<id>` | `{ apiVersion, url, expiresAt }`: a [frame key](#frame-keys) for the extension's drawer tab, inside `url`; `expiresAt` is ISO 8601 and moves with use. Also answered under `/p/<id>/` without the query. 404 for an unregistered project, an unknown extension, one that is not enabled (approved and compatible), and one without a sidecar and a `sidecarTab`. 400 without a project, 503 when n-dx could not be asked |

A project's own API and MCP endpoints sit under `/p/<id>/`, using the `id` from `GET /api/hub/projects`. While exactly one project is registered, `/` also aliases to it.

The contract tests are `packages/web/tests/integration/hub-extension-api.test.ts`, and for frame keys `hub-frame-keys.test.ts` beside it.

Sidecar pages served at `/x/<name>/`, or under its keyed mount, share the hub origin; a page served through a frame key does not. The hub never puts its session script on them, but any script on that origin can ask the other signed-in hub tabs for their session (the `ndx-auth` channel the dashboard uses to sign in new tabs) and then call hub APIs, mutations included. Approving a sidecar therefore grants browser-side hub authority as well as permission to run local code; extensions must treat repository content as untrusted input and prevent script injection.
