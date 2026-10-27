# n-dx extensions: design and PRD capture

Status: proposed, 2026-10-26. Imported from the design doc at https://claude.ai/artifact/B5hBBT5rS6rx6FWN23xS8z as the starting point for the extensions epic. The contract as built, for extension authors, is in [docs/extensions/](../extensions/index.md).

## Summary

n-dx should let separately installed packages add `ndx <name>` commands and a hub-mounted web page, through a declared manifest and spawned processes only. Today it can't: commands are a fixed map in `packages/core/cli.js` (`COMMAND_DISPATCH`), viewer panels are statically imported, and the hub only proxies registered projects.

- **Out-of-process only.** An extension is a CLI and, optionally, a web server n-dx spawns. n-dx never imports extension code, so the tier rules, spawn-only orchestration and failure isolation all hold.
- **Many at once.** Each extension has its own name, mount (`/x/<name>/`), state folder, config section and logs. Names can't shadow built-in commands or each other.
- **Built for any publisher, proven by three consumers.** The first outside extension, a private assessment add-on (recon) built by En Dash, plus the Graview product face moved onto the manifest, and a minimal fixture extension in the e2e suite.
- **Decision asked:** accept the manifest contract and the out-of-process rule, then schedule the epic in the PRD capture section below. Its first two features can ship without the hub work.

## Goals and non-goals

**Goals**

- A third party can ship an extension as an ordinary npm package with no change to n-dx.
- Several extensions can be installed, enabled and run side by side, per user and per project.
- An extension can add CLI commands, a hub-mounted web app, and links from a project's dashboard to that app.
- Extensions reach n-dx only through public, versioned surfaces: spawned `ndx` commands, the hub API, project HTTP and MCP endpoints, and documented files.
- Nothing runs until the user has approved it, and an approval is tied to the exact manifest that was approved.
- A broken or incompatible extension never stops a built-in command or the hub.

**Non-goals (this epic)**

- In-process plugins or hooks inside rex, sourcevision, hench or the web server.
- Injecting panels or components into the project dashboard. Extensions get links and their own pages only.
- A hosted marketplace or registry beyond npm.
- Sandboxing beyond separate processes and a scoped environment.

**First consumers**

| Consumer | Uses | Proves |
| --- | --- | --- |
| Recon (private assessment add-on, first extension, built by En Dash) | `ndx recon ...` commands, a hub page that batch-prepares many repos with per-repo progress, project links | A real multi-repo workflow, private code on public seams |
| Graview product face | Its sidecar launch: `ndx graview serve` runs the plan `ndx extensions sidecar graview-face` prints (once hard-wired in `serveProductApp`) | The manifest replaces a one-off integration |
| Fixture extension (`tests/e2e`) | One command, one sidecar, one project link | Every contract rule has a test |

## How it fits

n-dx finds extensions by manifest and runs them only as separate processes.

```
  Installed packages  ───────────►  Discovery and approval
  project, user, global,            reads package.json only;
  dev paths                         cached; approvals hashed
                                         │              │
                     ┌───────────────────┘              │
                     ▼                                  ▼
               ndx CLI                             Hub :3117
               unknown command                     proxies /x/<name>/
               goes to extension                   after the token check
                     │ spawns                      │ spawns        │
                     ▼                             ▼               ▼
            ┏━━━━━━━━━━━━━━━━━━━━━┓      ┏━━━━━━━━━━━━━━━┓   Hub home, dashboards
            ┃ Extension command   ┃      ┃ Sidecar       ┃   cards and project links
            ┃ stdio, signals and  ┃      ┃ lazy start,   ┃
            ┃ exit code pass thru ┃      ┃ idle stop     ┃
            ┗━━━━━━━━━━━━━━━━━━━━━┛      ┗━━━━━━━━━━━━━━━┛
                     ┊                             ┊
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ Back to n-dx only through spawned ndx, the hub API and project HTTP/MCP │
  │ Every process gets NDX_BIN, NDX_HOME, a state folder, its config file   │
  │ and the hub URL                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

Heavy boxes are extension code; everything else is n-dx, including the parts this epic adds.

Discovery and approval sit in front of both entry points. A command and a sidecar are ordinary child processes, and neither can reach n-dx except through the surfaces n-dx already publishes.

## Manifest and discovery

Any publisher can ship an extension; nothing in the contract is specific to one vendor or product. An extension is any npm package whose `package.json` has an `ndx.extension` block. n-dx reads only that block and never runs package code while discovering.

```json
{
  "name": "@<publisher-scope>/ndx-<extension-name>",
  "ndx": {
    "extension": {
      "apiVersion": 1,
      "name": "<extension-name>",
      "displayName": "<Display name>",
      "ndxVersion": ">=0.10.0 <0.12.0",
      "commands": [
        { "name": "<extension-name>", "bin": "bin/cli.js", "summary": "<one line for ndx --help>" }
      ],
      "sidecar": { "bin": "bin/serve.js", "health": "/healthz", "idleStopMinutes": 15 },
      "hub": { "label": "<Card label>", "description": "<one line for the hub home>" },
      "projectLinks": [ { "label": "<Link label>", "path": "/project/{projectId}" } ],
      "configSchema": "schema/config.json"
    }
  }
}
```

| Field | Rule |
| --- | --- |
| `apiVersion` | Integer contract version. An unknown version is listed as incompatible, never run |
| `name` | Lowercase slug, unique across installed extensions, not a built-in command, bin alias or reserved word (`ext`, `x`, `hub`, `extensions`, `paths`) |
| `ndxVersion` | Semver range the extension supports; outside it, the extension is disabled with the reason shown |
| `commands[]` | Each `name` becomes `ndx <name>`; `bin` is a path inside the package, run with the same Node as n-dx |
| `sidecar` | Optional web server the hub mounts at `/x/<name>/` |
| `hub`, `projectLinks` | Optional entries on the hub home and on each project's dashboard; `{projectId}` and `{repoRoot}` are the only placeholders |
| `configSchema` | Optional JSON Schema for the extension's config section |

**Where n-dx looks, highest precedence first**

1. **Project:** the project's own `node_modules`, for packages listed in its `package.json`. Applies to commands run in that project.
2. **User:** `<ndx home>/extensions/node_modules`, installed by `ndx extensions add <package>`. Applies everywhere.
3. **Global:** the global npm or pnpm root that n-dx itself was installed from.
4. **Development:** paths listed in `extensions.paths` in `<ndx home>/config.json`, for working on an extension from a checkout.

When the same package is found in several sources, the highest one wins and `ndx extensions info` names the others. Two different packages claiming one name are both refused, with both paths shown. The result is cached in `<ndx home>/extensions.json` and recomputed when the modification time of a source folder, or of a found extension's `package.json`, changes (a linked package is a symlink, so editing it moves no folder), so `ndx --help` does not walk `node_modules` every time.

**Management commands:** `ndx extensions list | add <pkg> | remove <name> | enable <name> | disable <name> | info <name> | doctor`. `doctor` checks every manifest, range, bin path and name clash, and prints one line per problem.

## CLI delegation

When `ndx <name>` matches no built-in command, the dispatcher looks the name up among enabled extensions and spawns that command's `bin` with the remaining arguments. Built-ins always win, and an unknown name with no extension still prints today's "Unknown command" error, now with a hint when a disabled or incompatible extension has that name.

**Process contract**

- `stdio` is inherited and the extension shares the terminal's session, so Ctrl+C, Ctrl+Z and `/dev/tty` reach it directly. `SIGTERM`, and on POSIX `SIGHUP`, sent to `ndx` are forwarded. The extension's exit code becomes `ndx`'s exit code.
- The working directory is unchanged; n-dx resolves no project for the extension.
- `ndx --help` lists enabled extension commands under an **Extensions** heading with their `summary`. `ndx <name> --help` is passed through to the extension.
- A missing `bin` or an unapproved manifest exits 2 with one line naming the problem and the fix (`ndx extensions doctor`, or `ndx extensions enable <name>`). A disabled or incompatible extension, including an out-of-range `ndxVersion`, is an "Unknown command" (exit 1) with a hint naming the extension, its state and the fix.

**Environment every extension process gets (CLI and sidecar)**

| Variable | Value |
| --- | --- |
| `NDX_EXTENSION_API` | The contract version n-dx speaks (`1`) |
| `NDX_VERSION` | The running n-dx version |
| `NDX_BIN` | Absolute path to this install's `cli.js`, run with Node (`process.execPath`), so an extension calls the same install |
| `NDX_HOME` | The resolved n-dx home |
| `NDX_EXTENSION_NAME` | The manifest `name` |
| `NDX_EXTENSION_STATE_DIR` | `<ndx home>/ext/<name>/`, created on first run; the only n-dx-owned place the extension may write |
| `NDX_EXTENSION_CONFIG` | Path to a JSON file holding the merged, schema-checked config section |
| `NDX_HUB_URL`, `NDX_TOKEN_FILE` | Set when a hub is running; the token is read from the file, never passed in the environment |

The environment is otherwise the user's own. Extensions talk to n-dx by spawning `NDX_BIN` or calling the hub and project endpoints, never by importing `@n-dx/*` internals. A small `@n-dx/extension-kit` package can wrap this contract later, but no extension should be required to use it.

## Hub integration

The hub (`packages/web/src/hub/`) gains extension sidecars as a second kind of child, next to the per-project dashboard servers it already runs (`children.ts`).

**Sidecar lifecycle**

- **Lazy start.** The first request to `/x/<name>/` starts the sidecar's `bin` on an ephemeral loopback port, passed as `PORT`. The hub holds the request until `health` answers 200, up to 20 seconds, then returns 503 naming the log file.
- **Idle stop.** With no request for `idleStopMinutes` (default 15) and no open WebSocket, the hub stops it. `ndx hub stop` stops all sidecars.
- **Crash handling.** A crashed sidecar is restarted on the next request, with backoff after three crashes in five minutes. Output goes to `<ndx home>/ext/<name>/logs/`.
- **Budget.** Sidecars count against the hub's existing memory floor (`registry.ts`), and the hub refuses to start one below it rather than starve project servers.
- **Launch plan.** The hub reads no manifest. It runs `ndx extensions sidecar <name> --json`, which applies the same discovery, approval and config checks as `ndx <name>` and prints the bin, environment, `health` (default `/`), `idleStopMinutes` and log file; the hub spawns that bin itself. Sidecars come from the user, global and development sources: the hub serves no single project.

**Proxy and auth**

- `proxy.ts` forwards `/x/<name>/...` to the sidecar with the prefix stripped, streaming HTTP and piping WebSockets as it does for `/p/<id>/`.
- The hub checks the per-user token before proxying, so a sidecar never sees an unauthenticated request. It adds `X-Ndx-Base-Path: /x/<name>/` so the app builds correct links, and drops the token cookie and header from the forwarded request.
- `/x/` is a reserved prefix: no project id or route may start with it.

**Where extensions show up**

- **Hub home** (`home.ts`): an Extensions row with one card per enabled extension that declares `hub`, plus incompatible and unapproved ones greyed out with the reason. The page waits up to 3 s for the list and renders without the row when n-dx cannot answer.
- **Project dashboards** (`viewer/components/extension-links.ts`): each `projectLinks` entry appears as a link in the project's dashboard header, resolved by the hub to `/x/<name>/<path>` with `{projectId}` and `{repoRoot}` filled in. The dashboard gets the list from `GET /api/hub/extensions`: the `/p/<id>/` prefix names the project, and on the single-project root alias it sends `?project=<id>`. No extension code reaches the viewer bundle. It asks only once the hub has answered, so a standalone dashboard shows no links, and a failed list leaves the header without them.
- **Hub API:** `GET /api/hub/extensions` (manifests, state, compatibility) and `POST /api/hub/extensions/:name/stop`. Both are part of the versioned extension API, as are `GET /api/hub/projects` and `POST /api/hub/projects`, which extensions use to list and register repos.

With no hub running, extension commands still work; only sidecars and links need the hub.

**Versioned hub API.** These four endpoints are stable under `apiVersion` 1. Every answer carries `apiVersion`; a field listed here is removed or retyped only with a bump, and new fields may be added. Errors are `{ "error": "…" }`. Like every hub request, they need the per-user token, and a mutating one a loopback `Origin` or none. Contract tests: `packages/web/tests/integration/hub-extension-api.test.ts`.

| Endpoint | Answer |
| --- | --- |
| `GET /api/hub/projects` | `{ apiVersion, projects }`; each project has `id`, `name`, `repoRoot`, `worktrees`, `ndxBin`, `port`, `pid`, `lastSeen` and `status` (`state`, `pid`, `port`, `attached`, `respawns`, `lastHealthAt`, `lastError`) |
| `POST /api/hub/projects` | Takes `{ id, repoRoot, ndxBin, worktree?, name? }`. Answers `{ apiVersion, project }`: 201 when registered, 200 when already registered, 400 for a bad body |
| `GET /api/hub/extensions[?project=<id>]` | `{ apiVersion, extensions, errors }`. Each extension has `name`, `packageName`, `version`, `source`, `state`, `reason`, `compatible` (false when incompatible or invalid), `manifest` (null when invalid), `mount` (`/x/<name>/` or null) and `sidecar` (`state`, `recentCrashes`, `lastError`, or null). With a project, it adds `links: [{ label, url }]`: the `projectLinks` filled in for that project, empty unless the extension is enabled. An unknown project is 404, and 503 means n-dx could not be asked. The list is the user, global and development sources, which are where the hub serves sidecars from |
| `POST /api/hub/extensions/:name/stop` | `{ apiVersion, name, stopped }`. `stopped` is false when no sidecar was running, and the next request to `/x/<name>/` starts it again. 404 for a name no extension could have |

The hub reads no manifest for these either: it runs `ndx extensions list --json` from the n-dx home. The hub's `apiVersion` is a twin of core's `EXTENSION_API_VERSION`, pinned by `tests/e2e/extension-api-version-parity.test.js`.

## Trust, versioning and config

**Consent.** An extension runs only after the user approves it, the way Claude Code approves a project's MCP servers.

- The first `ndx <name>` or `/x/<name>/` request shows the package, version, source, commands and sidecar, then asks. In a non-interactive shell it exits 2 and points at `ndx extensions enable <name>`.
- The approval is stored in `<ndx home>/extensions.json` with a hash of the `ndx.extension` block and the package version. A changed manifest or version asks again.
- Approvals of project-source extensions are per project path, so cloning an untrusted repo never runs its extensions.
- `ndx extensions enable <name> --yes` approves non-interactively, for CI and provisioning scripts.

**Versioning.** Two numbers make compatibility checkable without running code. `apiVersion` is the contract this document defines; a breaking change to the environment, the proxy, the manifest or the versioned hub endpoints bumps it, and n-dx supports the current and previous version. `ndxVersion` is the extension's own range. Either mismatch leaves the extension listed but disabled, with the reason in `list`, `doctor` and the hub home.

**Config.** Each extension owns one section, `extensions.<name>`, in `<ndx home>/config.json` (user) and `.n-dx.json` (project), merged project over user. `ndx config extensions.<name>.<key> <value>` reads and writes it, validated against `configSchema` when one is given. It writes `.n-dx.json`, or the user config with `--user`. A missing `required` key does not stop a write, since a section is filled one key at a time. n-dx checks the validation keywords a config section needs (types, `enum`, `const`, object properties, arrays, string and number bounds, `allOf`/`anyOf`/`oneOf`/`not`) and reads annotations such as `format` as information; a schema using any other keyword, `$ref` included, is reported as one it cannot check (`packages/core/extension-config-schema.js`). The merged result is what `NDX_EXTENSION_CONFIG` points at; a run whose merged section breaks the schema, `required` included, is refused with exit 2. `paths` is a reserved name because the user config's `extensions.paths` is discovery's list of dev paths. `config.js` keeps its role as the one orchestration script that touches config files directly.

**Disable and remove.** `disable` keeps the approval and config, but hides the commands, links and hub card. `remove` uninstalls a user-source package and deletes its approval; `--purge` also deletes `ext/<name>/`. A disabled extension's state folder is never touched.

## PRD capture

Ready to enter in the n-dx PRD with `ndx rex add` or the rex `add_item` tool. Each task's criteria go in `acceptanceCriteria`, one per entry. Set `source: ndx-capture`. "Blocked by" names tasks in this list, to wire as `blockedBy` once ids exist. Priorities: F1 and F2 ship first and are useful without the hub.

**Epic: Extensions: out-of-process add-ons for the CLI and hub** (priority high)

Let separately installed npm packages add `ndx <name>` commands, a hub-mounted web app and project-dashboard links, through a declared manifest and spawned processes only. Contract: this document. Consumers: recon, the Graview product face, a fixture extension.

### Feature F1: Manifest, discovery and management

1. **Task: Extension manifest schema and validator** (critical)
    - JSON Schema for `ndx.extension` v1 (all fields in the manifest table) in `packages/core`, with types
    - Validation reports every problem as one line: package, JSON path, rule, fix
    - Reserved names (built-in commands, bin aliases, `ext`, `x`, `hub`, `extensions`) are rejected
    - Unknown `apiVersion` is reported as incompatible, not as invalid
    - A failing and a passing fixture per rule
2. **Task: Discover extensions across sources with a cache** (critical; blocked by 1)
    - Finds manifests in project, user (`<ndx home>/extensions`), global and dev-path sources, in that precedence
    - Reads only `package.json`; a test proves no package code runs during discovery
    - Same package in two sources: the higher wins and `info` names the other; two packages with one name are both refused
    - Result cached in `<ndx home>/extensions.json` and recomputed when a source folder changes; `ndx --help` with 20 installed extensions adds under 50 ms over none
    - `$NDX_HOME` and the legacy `~/.n-dx` home are honoured
3. **Task: `ndx extensions` management commands** (high; blocked by 2)
    - `list`, `add <pkg>`, `remove <name> [--purge]`, `enable`, `disable`, `info`, `doctor`
    - `add` installs into `<ndx home>/extensions` without touching any project's `package.json`
    - `doctor` exits non-zero when any problem is found and prints one line per problem with its fix
    - `list --json` gives name, version, source, state (enabled, disabled, unapproved, incompatible) and reason

### Feature F2: CLI delegation

1. **Task: Dispatch unknown commands to extensions** (critical; blocked by 2)
    - An unknown `ndx <name>` spawns the matching command's `bin` with the remaining args, using the same Node as n-dx
    - Built-in commands always win; a test fails if an extension can shadow one
    - stdio inherited, SIGINT and SIGTERM forwarded, exit code passed through (tested with codes 0, 1 and 7)
    - No match: today's "Unknown command" error, plus a hint when a disabled or incompatible extension has the name
    - Orchestration still never imports extension code (`architecture-policy` test extended)
2. **Task: Extension environment contract** (high; blocked by 4)
    - Every extension process (CLI and sidecar) gets the variables in the environment table, and no token value
    - `NDX_EXTENSION_STATE_DIR` is created on first run
    - `NDX_BIN` re-enters the same n-dx install, tested from a global and a project install
3. **Task: Extension commands in help** (medium; blocked by 4)
    - `ndx --help` lists enabled extension commands under an Extensions heading with their summary
    - `ndx <name> --help` is passed through to the extension

### Feature F3: Consent and config

1. **Task: Approve extensions before first run** (critical; blocked by 4)
    - First run shows package, version, source, commands and sidecar, then asks; non-interactive runs exit 2 naming `ndx extensions enable <name>`
    - The approval stores a hash of the manifest block and the version; a change to either asks again
    - Project-source approvals are per project path; a freshly cloned repo's extensions never run unapproved
    - `enable --yes` approves without a prompt
2. **Task: Per-extension config sections** (medium; blocked by 1)
    - `extensions.<name>` in user config and `.n-dx.json`, merged project over user
    - `ndx config extensions.<name>.<key>` reads and writes, validated against `configSchema`
    - The merged config is written to the file `NDX_EXTENSION_CONFIG` names

### Feature F4: Hub sidecars

1. **Task: Sidecar lifecycle in the hub** (high; blocked by 5, 7)
    - First request to `/x/<name>/` starts the sidecar on an ephemeral loopback port and waits for `health`; 503 naming the log file after 20 s
    - Idle stop after `idleStopMinutes` with no requests and no open WebSocket; `ndx hub stop` stops all sidecars
    - Restart on next request after a crash, with backoff after three crashes in five minutes; logs in `<ndx home>/ext/<name>/logs/`
    - Refuses to start below the hub's memory floor, with a clear message
2. **Task: Proxy `/x/<name>/` with auth** (high; blocked by 9)
    - HTTP streamed and WebSockets piped, prefix stripped, `X-Ndx-Base-Path` added
    - Requests without the per-user token are refused before the sidecar; the token cookie and header are not forwarded
    - `/x/` is reserved: registering a project id that collides is refused
    - Unknown, disabled or unapproved names answer 404 with the reason

### Feature F5: Where extensions appear

1. **Task: Versioned hub extension API** (high; blocked by 2)
    - `GET /api/hub/extensions[?project=<id>]` and `POST /api/hub/extensions/:name/stop`
    - `GET /api/hub/projects` and `POST /api/hub/projects` documented as stable under `apiVersion` 1, with contract tests
2. **Task: Extensions on the hub home** (medium; blocked by 10, 11)
    - One card per enabled extension with a `hub` block, linking to `/x/<name>/`
    - Incompatible and unapproved extensions show greyed out with their reason
3. **Task: Extension links in project dashboards** (medium; blocked by 10, 11)
    - `projectLinks` appear in the dashboard header with `{projectId}` and `{repoRoot}` filled in
    - The viewer bundle contains no extension code; links come from the hub API only
    - With no hub running, the dashboard shows no links and no error

### Feature F6: Proof and docs

1. **Task: Fixture extension and e2e suite** (high; blocked by 4)
    - A fixture package in `tests/e2e` with one command, one sidecar and one project link
    - The suite covers every acceptance criterion above that a process boundary can show
    - Required on every change that touches dispatch, the hub proxy or discovery
2. **Task: Move the Graview product face onto the manifest** (medium; blocked by 9, 10)
    - `@n-dx/graview-face` declares an `ndx.extension` block; `findProductFace()` and `serveProductApp` are replaced by the generic path
    - `ndx graview serve` behaves as before (same flags, same environment), checked by the existing graview tests
3. **Task: Extension authoring guide and API reference** (medium; blocked by 5, 11)
    - `docs/extensions/` covers the manifest, environment, hub API, consent, config, versioning and a minimal example
    - Linked from `README.md` and `docs/architecture/overview.md`; the root `AGENTS.md` gains one pointer line within its byte budget

## Open questions

- Should extensions be able to add MCP servers that `ndx init` registers beside rex and sourcevision, or is that a later `apiVersion`?
- Should extensions add skills to `.claude/skills` and `.agents/skills` at init, and how does that interact with the generated instruction files?
- Is idle stop enough to bound memory with many sidecars, or should the hub's admission queue (`admission.ts`) also govern sidecar starts?
- Do project-source extensions belong in v1 at all, given they widen the trust surface? User-source alone covers every named consumer.
- Should the project dashboard ever embed an extension page (an iframe tab), or stay links-only?
- Where does `@n-dx/extension-kit` live, and does it ship with v1 or after the first two outside extensions?
