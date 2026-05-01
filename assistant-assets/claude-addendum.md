##### Monorepo-wide zone fragility governance

Any production zone with **cohesion < 0.5 AND coupling > 0.5** is a dual-fragility zone requiring active governance. The following zones currently meet both thresholds:

| Zone | Package | Cohesion | Coupling | Notes |
|------|---------|----------|----------|-------|
| `web-shared` | web | 0.36 | 0.64 | Foundation layer; 5 files (metrics unreliable at this size); two-consumer rule enforced by `boundary-check.test.ts` |
| `rex-cli` | rex | 0.25 | 0.75 | 27+ command files in flat directory; high coupling to core |
| `prd-fix-command` | rex | 0.25 | 0.75 | Satellite CLI zone; 2 files with tight core coupling |
| `crash` | web | 0.50 | unidirectional (web-viewer → crash) | At threshold boundary — crash imports web-shared directly (documented bypass), not web-viewer |
| `viewer-ui-hub` | web | 0.38 | 0.63 | Viewer composition hub; 5 files; structurally expected for a UI composition root — documented in `viewer-ui-hub` governance section |

**Universal governance rules** (apply to all dual-fragility zones):
- **Two-consumer rule:** A new module must have at least two distinct consumer zones before being added. Single-consumer utilities belong closer to their dominant use site.
- **Addition review required:** Treat these as risk zones requiring active review on additions. Changes have a wide blast radius.
- **Cohesion monitoring:** If a zone's cohesion drops below its current value after a change, the change needs explicit justification.

##### web-shared addition policy

`web-shared` has low cohesion (0.36) and high coupling (0.64). The zone contains 5 files (below the 5-file threshold for reliable metrics), so the measured values reflect the inherent low internal relationship between its modules (data-file constants, feature flags, view identifiers, routing helpers) rather than structural decay. Note: Louvain may merge this zone into `web-viewer` when shared imports create a strong bridge to viewer files — if that happens, pin the shared files back to `web-shared` on the next analysis. In addition to the universal governance rules above:

- **Framework-agnostic only:** `web-shared` must not contain Preact/React imports or server-only (`node:*`) imports. If a utility needs framework APIs, it belongs in the consuming zone.
- **Barrel import enforcement:** Consumers must import through `shared/index.ts` rather than directly from leaf files (`data-files.ts`, `view-id.ts`). Enforced by `boundary-check.test.ts`.
- **Two-consumer rule (automated):** Every module in `shared/` must have at least two distinct consumer zones. Enforced by the "shared/ modules have at least two consumer zones" assertion in `boundary-check.test.ts`.

##### rex-satellite zone policy

Both `chunked-review` and `prd-fix-command` are satellite zones of `rex-cli` with cohesion 0.25 and coupling 0.75. In addition to the universal governance rules:

- **CLI-only content:** These zones must contain only CLI command handlers and their direct support modules. Domain logic belongs in `rex-prd-engine` (e.g., `src/core/`).
- **Subdirectory convention:** Satellite zone files should be grouped into subdirectories under `packages/rex/src/cli/commands/` to make zone boundaries visible in the file tree.

##### crash zone proactive governance

`crash` (cohesion 0.5, unidirectional coupling: web-viewer → crash) sits at the dual-fragility threshold boundary. Crash imports web-shared directly (documented bypass) rather than web-viewer. Apply the two-consumer rule proactively to new crash zone additions before cohesion degrades further.

##### viewer-ui-hub governance

`viewer-ui-hub` (cohesion 0.38, coupling 0.63) is the intentional Preact UI composition hub — it assembles sidebar, config-footer, faq, and logos components. Its dual-fragility metrics are **structurally expected** for a UI composition root: it imports broadly from `web-viewer` (high coupling) while its internal files serve distinct UI concerns (low cohesion). In addition to the universal governance rules:

- **No domain logic:** This zone must contain only UI composition components and their direct rendering helpers. Data fetching and state management belong in hooks or views.
- **Monitor fan-out:** The bidirectional 74-edge coupling with the web dashboard platform zone is the largest cross-zone relationship in the web package — audit import direction periodically to ensure inbound imports enter through `api.ts` or composition-root wiring rather than ad-hoc leaf reach-ins.
- **Satellite consolidation:** Three micro-zones (theme-toggle, search-overlay, graph-view-tests) are community-detection artifacts pointing at this hub — consolidating them reduces zone noise without losing architectural boundaries.

##### web-server zone stability

`web-server` (composition root — Express routes, gateways, MCP handlers) is prone to dissolving into `web-viewer` in Louvain analysis because server files import from `packages/web/src/shared/` (required by the barrel-import policy), and shared files are also imported by viewer files, creating a Louvain connectivity bridge. If the zone dissolves:

1. Check `stability.reassignedFiles` in `.sourcevision/zones.json` for `[file, "web-server", "web-viewer"]` entries
2. Update `.sourcevision/hints.md` with re-analysis guidance
3. The zone pins in `.n-dx.json` targeting `"web-server"` are no-ops when the zone is absent — they will re-activate if the zone re-appears in Louvain output
4. The actual server/viewer boundary is enforced by `boundary-check.test.ts` regardless of zone detection — zone dissolution is a metrics artifact, not an architectural violation

##### hench-agent internal governance

`hench-agent` (160+ files, 31 directories) is the second-largest zone in the monorepo. Internal sub-zone boundaries:

- **`agent/`** — Agent loop, tool dispatch, conversation management
- **`prd/`** — PRD integration via `rex-gateway.ts` and `llm-gateway.ts`
- **`brief/`** — Task brief construction and context gathering
- **`tools/`** — Tool implementations (file ops, shell, search)
- **`process/`** — Process lifecycle, concurrency management

Rules:
- Each sub-zone directory should maintain a barrel `index.ts` re-exporting its public API.
- Cross-sub-zone imports should flow through barrels, not reach into internal modules.
- Boundary assertions should be added to hench's test suite before the zone reaches web-viewer's scale.

> **Spawn-exempt exception:** `config.js` directly reads/writes package config files (`.rex/config.json`, `.hench/config.json`, `.sourcevision/manifest.json`, `.n-dx.json`) rather than delegating to spawned CLIs. This is intentional — config operations require cross-package reads, atomic merges, and validation logic that cannot be expressed as a single CLI spawn. It is the only orchestration-tier script that breaks the spawn-only rule.

### Gateway modules

Packages that import from other packages at runtime concentrate **all** cross-package imports into a single gateway module per upstream package. This makes the dependency surface explicit, auditable, and easy to update when upstream APIs change.

| Package | Gateway file | Imports from | Re-exports |
|---------|-------------|--------------|------------|
| hench | `src/prd/rex-gateway.ts` | rex | 19 functions + 6 types (schema, store, tree, task selection, timestamps, auto-completion, requirements, level helpers, finding acknowledgment) |
| hench | `src/prd/llm-gateway.ts` | @n-dx/llm-client | 30 functions + 10 types (config, constants, JSON, output, help, errors, process execution, token parsing, model resolution) |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory |
| web | `src/viewer/external.ts` | `src/viewer/messaging/`, `src/shared/`, `src/schema/` | Schema types (V1), data-file constants, RequestDedup — viewer↔server boundary gateway |
| web | `src/viewer/api.ts` | `src/viewer/types.ts`, `src/viewer/route-state.ts` | Viewer types (LoadedData, NavigateTo, DetailItem), route-state functions — inbound API contract for sibling zones (crash, route, performance) |

Rules:
- **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways (e.g. web has separate gateways for rex and sourcevision).
- **Intra-package gateways** — within the web package, `src/viewer/external.ts` concentrates all viewer-side imports from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through `external.ts` for viewer consumers.
- **Re-export only** — gateways re-export; they contain no logic. Enforced by `domain-isolation.test.js`.
- **Type imports through gateway** — `import type` must also flow through gateways to prevent type-import promotion erosion (a type import can be silently promoted to a runtime import during refactoring). Exception: web viewer files are exempt because the server/viewer boundary prevents them from reaching the server-side gateway.
- **Messaging exemption** — `src/viewer/messaging/` files may import directly from `src/shared/` without going through `external.ts`. The shared/ directory is neutral (neither server nor viewer), and messaging utilities access it directly to avoid zone-level dependency inversion. Enforced by `boundary-check.test.ts` (lines 74-80). New files added to `viewer/messaging/` inherit this exemption — review them to ensure they are genuine messaging infrastructure, not general viewer code.
- **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

See also: `PACKAGE_GUIDELINES.md` for the full pattern reference.

### Injection seam registry

Some cross-zone dependencies use callback injection rather than gateway imports. These seams are invisible to static analysis tools (boundary-check.test.ts, domain-isolation.test.js) and must be listed explicitly to prevent future contributors from replacing injection with direct imports.

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|--------------------|----------------|
| `web/src/server/start.ts` | `web/src/server/register-scheduler.ts` | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |

Rules:
- **Prefer injection over import** when the target module would otherwise need to import from a higher-tier zone (e.g., scheduler importing from dashboard wiring).
- **Document the interface type** — every injection seam must have a named TypeScript interface (not inline parameter types) so that refactoring either side triggers a type error.
- **New seams** require an entry in this table and a named interface type in the target module.

### Tier boundary crossing: spawn vs gateway

When a new feature requires crossing a tier boundary, use this decision rule:

| Signal | Use spawn (child process) | Use gateway module (direct import) |
|--------|--------------------------|-----------------------------------|
| Caller tier | Orchestration (cli.js, ci.js, web.js) | Execution or Domain |
| Data flow | Fire-and-forget or exit-code only | Structured return values needed in-process |
| Frequency | Per-command (once per CLI invocation) | Per-request (hot path, many calls per second) |
| Error handling | Exit code + stderr is sufficient | Caller needs typed errors, retries, or partial results |
| State sharing | None (each spawn is stateless) | Shared in-memory state (e.g. PRDStore instance) |

**Rules of thumb:**
- Orchestration-tier scripts **always spawn** — they must not `import` from packages (exception: `config.js` for cross-package config reads).
- If the consumer is a library (hench, web), use a **gateway module** to keep the import surface explicit and auditable.
- If in doubt, prefer spawn — it provides stronger isolation and can always be replaced with a gateway later if performance requires it.

### Concurrency contract

The four orchestration entry points (`cli.js`, `web.js`, `ci.js`, `config.js`) share mutable state files on disk. Concurrent execution rules:

| Command pair | Safe? | Notes |
|-------------|-------|-------|
| `ndx start` + `ndx status` | ✅ | Status is read-only |
| `ndx start` + `ndx work` | ✅ | Hench writes to `.hench/runs/`; the server reads the folder tree via `.rex/.cache/prd.json` (refreshed by file watcher) |
| `ndx start` + `ndx plan` | ⚠️ | Plan rewrites the folder tree; the server's tree watcher refreshes `.rex/.cache/prd.json` automatically, but a restart flushes all in-process caches. |
| `ndx ci` + `ndx work` | ❌ | Both may write `.sourcevision/` plus the folder tree and sync files concurrently |
| `ndx plan` + `ndx work` | ❌ | Both write the folder tree (`.rex/prd_tree/`) |
| `ndx refresh` + any write command | ❌ | Refresh writes `.sourcevision/` and rebuilds web assets |
| `ndx config` + `ndx config` | ❌ | Concurrent config writes may lose updates (no file locking) |

**General rule:** Commands that write to the PRD backend (`.rex/prd_tree/`), `.sourcevision/`, or `.hench/config.json` must not run concurrently. Read-only commands (`status`, `usage`) are always safe.

**MCP write operations** (`add_item`, `edit_item`, `update_task_status`, `merge_items`, `move_item`) write only to the folder tree (`.rex/prd_tree/`). No JSON files are produced. Never invoke MCP write tools while a CLI command that writes to the PRD is running in the background (e.g., `reorganize`, `prune`, `reshape`, `analyze`, `plan`). The last writer wins silently — no error, just data loss. Always wait for the background command to complete before making MCP writes.

**PRD invariant.** The sole writable PRD surface is the folder tree: `.rex/prd_tree/` (slug-named directories, each with `index.md`). No PRD mutation (CLI, MCP, or `rex update`) writes to `prd.md`, branch-scoped `.rex/prd_{branch}_{date}.md` files, or `prd.json`. Avoid parallel writers.

#### HTTP-request concurrency (web server)

When `ndx start` is running, the web server holds in-process caches (aggregation cache, PRD tree snapshot) that are populated from disk on demand. External CLI commands that write to the same files can cause stale or partial reads:

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Dashboard reads PRD while `ndx plan` writes to `.rex/prd_tree/` | Partial aggregate read or stale derived JSON | Restart server after plan (`ndx start stop && ndx start`) |
| MCP request during `ndx work` PRD update | Momentarily stale status — hench writes are small atomic updates | Acceptable — dashboard polls and self-corrects within seconds |
| Concurrent dashboard API requests | Safe — Express serializes requests per-connection; no shared mutable state between request handlers | No action needed |

**General rule for HTTP:** The web server treats disk files as read-only and never holds write locks. The folder tree watcher refreshes `.rex/.cache/prd.json` automatically for most PRD mutations. Any command that bulk-rewrites `.sourcevision/` (ci, refresh) should be followed by a server restart to flush stale caches.
