# Collaborative Workflows Discovery

**Status:** Discovery / brainstorming — no implementation commitments
**Date:** 2026-08-19
**Question:** n-dx works well as an isolated, single-developer project tool. What would it take to make it a genuinely collaborative experience?

---

## 1. Diagnosis: why n-dx feels single-player

The "isolated tool" symptom is not primarily a ritual/habits problem. Four codebase surveys (export/deploy, sync adapters, web server, PRD storage) show it is architectural, and it reduces to four root causes:

### 1.1 No identity model — anywhere

There is no concept of *who* did anything:

- `LogEntry` (`packages/rex/src/schema/v1.ts`) has `timestamp`, `event`, `itemId`, `detail` — no actor, host, or user field.
- `RunRecord` (`packages/hench/src/schema/v1.ts`) records vendor/model/tokens/tool calls — no user, host, or author.
- `WriteOptions.applyAttribution` exists in the store contract and is passed by ~20 call sites (MCP tools, `add`, `update`, `smart-add`), but **`FolderTreeStore` ignores it entirely** — `addItem`/`updateItem` take `_options?: WriteOptions` and never read it. Zero files in `.rex/prd_tree/` carry a `branch:` field.
- The only real attribution is retroactive: `rex backfill-commit-attribution` walks `git log` for `N-DX-Status:` trailers and pulls `git config user.*` from commits after the fact.
- The web server has no auth, sessions, or caller concept; two MCP clients are indistinguishable.

Everything downstream ("who changed this task?", "whose hench run was that?", "who holds the execution lock?") is impossible until this exists.

### 1.2 The server is architecturally single-operator

- Bind address is a compile-time constant `127.0.0.1` (`packages/web/src/server/start.ts:48`) — no `web.host` config key exists.
- Zero auth on ~70 mutating endpoints; `Access-Control-Allow-Origin: *`; no Origin/CSRF check. **The loopback bind is the only control** keeping an API that can spawn child processes (`POST /api/commands/*`) off the network — exposing the port in any way (tunnel, container publish, reverse proxy) is unauthenticated RCE.
- WebSocket layer is broadcast-to-all with no per-client channels; client→server frames are discarded.
- Coordination primitives are process-global singletons: `executionState` ("one execution at a time"), `selfHealStatus`, `svWriteJob`, plus the `.n-dx-web.pid` file. `ndx start` **kills whatever holds the port** (`lsof`/`kill -9`), so a second person on a shared box terminates the first person's server.

### 1.3 The PRD's git merge story doesn't exist

`.rex/prd_tree/` is designed to be committed ("canonical PRD storage" per `docs/guide/gitignore.md`), and IDs are collision-proof UUIDs — but the file layout fights git:

- **Slugs are title-only by default** (`folder-tree-serializer.ts` `slugify`); the `-{id6}` suffix is appended only for long titles or same-tree sibling collisions. Two developers creating same-titled items under the same parent on different branches produce the *identical path* with different content — a content conflict where the filenames give no clue there are two distinct items.
- Title renames relocate files (rename + delete), creating rename/modify conflict classes.
- **No merge driver, no `merge=` gitattributes, no three-way PRD merge, no post-merge validation.** Resolution is whatever raw `git merge` does to frontmatter markdown.
- **`removeStaleEntries` is a footgun:** any `saveDocument` deletes every on-disk item not in the in-memory tree. A save from a process holding a pre-merge snapshot silently destroys the other branch's items. The only recovery, `.rex/.backups/`, is gitignored and local-only.
- All locking (`prd.lock`, `reshape.lock`, hench limiter locks) is PID/filesystem-local — meaningless across machines or branches.

### 1.4 The collaboration surfaces that exist are 60–80% finished

Two features already point at collaboration and each stops short:

**Static export** (`ndx export --deploy=github`, `packages/core/export.js`) — real and working locally, but:
- ~25 viewer GET endpoints are never pre-rendered (global search, per-item `index.md`, requirements coverage/traceability, dependency graph, most hench panels, merge graph) — the nav renders and the views 404.
- **No redaction:** exported hench run records include full `toolCalls` inputs/outputs and (in verbose runs) complete event streams. Deploying to a public repo publishes complete agent transcripts. This is a blocker for the whole publishing direction until fixed.
- No automation: no shipped CI workflow, no staleness indicator (`exportedAt` is captured but never rendered — a 3-month-old export looks fresh).
- POSIX-only deploy path (`rm -rf`, confirmed Windows breakage), force-push with no confirmation, requires bare `rex` on `PATH` unlike every other core command, no test coverage at all.
- Only `--deploy=github` exists; other values are silently ignored. No Bitbucket/GitLab target.

**Remote sync** (`ndx sync`, rex adapter registry) — much further along than expected. **Four real adapters exist: Notion (most complete), Jira, Asana, GitHub Projects v2** — real HTTP clients, field mappers, redacted credential storage (`.rex/adapters.json` + `REX_<ADAPTER>_<FIELD>` env vars), bidirectional `SyncEngine` with per-field last-write-wins conflict records. But:
- **Change detection is functionally broken:** `stampModified` is called only by the four *remote* adapters; `FileStore`/`FolderTreeStore` never stamp `lastModified` on local writes. Since `isModifiedSinceSync()` returns false when the stamp is absent, locally edited items are *skipped* on push — only newly created items reliably propagate.
- Deletions never propagate through `sync()` (the ID union re-pulls locally deleted items); `SyncOptions.deletions` is dead code.
- `WorkItemLink[]` (`item.links` — a clean, system-agnostic linkage model with sync state per link) is fully defined and **entirely unwired**: nothing reads or writes it.
- No assignee/person mapping in any adapter schema — the Notion mapping has Status/Priority/Tags but no owner concept (consequence of §1.1).

---

## 2. Framing: three collaboration topologies

Every option below serves one of three team shapes. Naming them keeps the portfolio coherent:

| Topology | Shared substrate | What teammates need |
|---|---|---|
| **A. Git-mediated** | The repo itself (`.rex/prd_tree/` committed) | Safe merges, attribution, PR-native visibility |
| **B. SaaS-mediated** | Notion / Jira / GitHub as the work-management hub | Reliable bidirectional sync; n-dx as executor, PM tool as planner |
| **C. Live-shared** | A running n-dx server (shared box, container, sidecar) | Network binding, auth, multi-operator coordination |

A is the cheapest (git is the transport every team already shares) and is the *foundation for B and C* — sync and live servers both corrupt state faster when merges and attribution are broken. B matches how this team already works (Notion). C is the most expensive and depends on server hardening that doesn't exist yet.

---

## 3. Option portfolio

### Option 1 — Finish and automate static dashboard publishing (topology A)

*The proposed "static GitHub page generation" idea — already 60% built.*

The existing `ndx export --deploy=github` force-pushes a read-only dashboard to an `n-dx-dashboard` branch. Path to "teammates actually use this":

1. **Redaction pass (prerequisite, security).** Strip or truncate `toolCalls` input/output bodies and `events` from exported run records; keep summaries/token stats. Possibly `--include-transcripts` for private repos, default off.
2. **Close the pre-render gap.** Generate the ~25 missing endpoint JSONs (search index, per-item `index-md`, requirements coverage, dependency graph, hench config/audit panels) or add deployed-mode gating so absent views don't render dead nav. The fetch adapter already drops query strings, so the JSON-file pattern extends cleanly.
3. **Ship CI templates.** A `ndx export --ci-template=github|bitbucket` that writes a GitHub Actions workflow (`actions/deploy-pages`, no force-push needed — the docs site already uses this exact pattern in `.github/workflows/docs.yml`) or a `bitbucket-pipelines.yml` step. Export freshness then tracks `main` automatically instead of someone's laptop.
4. **Bitbucket target.** Bitbucket Cloud has no Pages-equivalent branch convention; the realistic targets are (a) the `<workspace>.bitbucket.io` repo convention, or (b) pipeline-driven deploy to any static host (S3/Cloudflare Pages/Netlify). Suggest implementing `--deploy` as a small adapter interface (mirroring the rex adapter registry pattern) rather than a second hardcoded branch dance.
5. **Staleness banner.** Render `exportedAt` (already in `window.__NDX_DEPLOYED__`) with an "exported N days ago" badge.
6. Housekeeping already surfaced: use resolved `tools.rex` instead of bare `rex`, replace `rm -rf` with `fs.rmSync` for Windows, document `--cname`, unify `web.publicUrl` with the deploy URL, add export artifacts to the init gitignore template, add any test coverage at all.

**Effort:** low–medium. **Leverage:** high — this is the fastest visible win and the on-ramp for stakeholders who will never run a CLI.

### Option 2 — Git-native PRD collaboration: make merges safe (topology A) ⭐ recommended foundation

*Not in the original idea list, but the surveys say it's the highest-leverage gap: the PRD is already designed to be shared through git; git is just currently unsafe.*

1. **ID-qualified slugs by default** (or a `rex.slugStyle: id-suffixed` config): always append `-{id6}`. Kills the cross-branch same-path collision class and makes every item path stable under title edits (or at least unambiguous). One-time migration = a single rename commit.
2. **Custom git merge driver.** `.gitattributes`: `.rex/prd_tree/** merge=rex-prd`, with `rex merge-driver %O %A %B` doing a three-way *frontmatter-aware* merge: per-field resolution (union for tags/blockedBy, latest-timestamp for status, textual merge for description), emitting conflict markers only for genuinely conflicting fields. The `gitattributes-pins.js` mechanism already exists for eol pins — extend it to write the merge attribute and register the driver in `.git/config` during `ndx init`.
3. **Guard `removeStaleEntries`.** Before deleting on-disk entries absent from memory, verify the in-memory tree was loaded after the last on-disk mtime (or require an explicit `--prune` intent for bulk deletes). This converts the worst silent-data-loss path into an error.
4. **`rex validate --post-merge`** (and a suggested merge hook): detect duplicate IDs, orphaned directories, level/nesting mismatches after a merge; offer auto-repair.
5. **Wire `applyAttribution` in `FolderTreeStore`** — it's a contract no-op today; implementing it gives per-item `branch`/`sourceFile` stamps nearly for free and stamps `lastModified`, which *also fixes the sync engine's broken change detection* (§1.4). One field, two features.

**Effort:** medium. **Leverage:** foundational — every other option degrades without it.

### Option 3 — Identity & attribution layer (all topologies)

*Prerequisite plumbing for "collaborative" to mean anything.*

1. **Actor capture at mutation time:** resolve `git config user.name/user.email` (fallback `os.userInfo()`) once per process; stamp an `actor` field on `LogEntry`, `RunRecord`, and PRD item mutations (`lastModifiedBy`). Both schemas already have passthrough/index signatures, so this is additive and non-breaking.
2. **Surface it:** dashboard activity log shows who; task detail shows last-modified-by; hench runs show whose machine ran them.
3. **Commit trailers already exist** (`N-DX-Status:`, `N-DX:` run trailer, `Co-Authored-By`) — extend `backfill-commit-attribution` to run incrementally (post-commit hook or on `ndx status`) so `PRDItem.commits[]` populates continuously instead of on demand.
4. Later: assignee as a first-class PRD field (feeds Option 5's Notion owner mapping and Option 8's task claiming).

**Effort:** low–medium. **Leverage:** enabling — cheap now, expensive to retrofit later.

### Option 4 — PR-native surfaces: meet the team in review (topology A)

*New proposal. Collaboration already happens somewhere — the PR. Bring n-dx's signal there instead of asking teammates to visit a dashboard.*

1. **PR comment bot / CI step:** on each PR, run `sourcevision analyze --lite` and post a delta comment — zone health changes, new anti-pattern findings, boundary violations, plus rex status changes parsed from the branch's `N-DX-Status:` trailers ("this PR completes task X, starts task Y"). The `pr-markdown` sourcevision surface and the trailer reader (`packages/hench/src/tools/pr-status-trailers.ts`) are existing building blocks.
2. **Hench run summary as PR comment:** when hench opens/updates a PR, attach the structured run summary (task, acceptance criteria verified, test gate result, token cost) — reviewers see *why* the agent did what it did without opening `.hench/runs/`.
3. **`ndx ci` as a status check** — it already exists and validates PRD health; wiring it as a required check makes PRD hygiene a shared team concern rather than one person's ritual.
4. Ship as reusable GitHub Action + Bitbucket Pipe (pairs with Option 1's CI templates).

**Effort:** medium. **Leverage:** high for teams that live in PRs — zero new habit required from teammates.

### Option 5 — Notion-first work management (topology B)

*The proposed Notion integration — the adapter exists; the workflow inversion is what's missing.*

Today's model is "rex is canonical, push to Notion." The proposal inverts it: **Notion is where work is planned; `ndx` pulls work items into rex tasks and executes them.** Path:

1. **Fix the sync engine's two functional gaps** (both surveyed, both concrete): stamp `lastModified` on local writes (falls out of Option 2.5), and implement deletion propagation (tombstones or a `deletedIds` set computed from the last-sync snapshot).
2. **Pull-first workflow:** `ndx sync --pull` already works for ingestion. Add `ndx work --from-notion` sugar: pull, select next actionable item (existing `get_next_task` logic), execute, push status back (`In progress` → `Complete` in Notion's native status groups — the mapper already handles status-group fallback for custom Notion options).
3. **Owner/assignee mapping:** add `Assignee` (person property) to the Notion `DATABASE_SCHEMA` mapping, paired with Option 3's identity — so hench only auto-picks tasks assigned to the invoking user (or unassigned ones).
4. **Continuous ingest:** near-term, a poll on the running server (the file-watcher/broadcast infrastructure is there); later, Notion webhooks into the sidecar (Option 6). Broadcast `rex:prd-changed` already refreshes the dashboard on pull.
5. **Wire `WorkItemLink`** as the visible linkage: each rex item shows its Notion URL and sync state in the dashboard; sync errors become per-item badges instead of buried log entries. The schema and pure-function API are fully built and unused.
6. Same pattern then generalizes: the Jira/Asana/GitHub-Projects adapters get the pull-first workflow for free since all four implement the same `PRDStore` interface.

**Effort:** medium (the hard 80% — adapters, mappers, engine — exists). **Leverage:** highest for *this team specifically*, since Notion is already the work-management home.

### Option 6 — Deployment sidecar / team server mode (topology C)

*The proposed containerized sidecar, merged with the general "shared live server" need — they're the same work.*

A lightweight container that ships alongside a deployed app (or runs on a team box/tailnet) serving the dashboard + MCP endpoints for the team. Honest assessment: **this is the most valuable end-state and the least ready today.** Hard prerequisites from the server survey:

1. **`web.host` config key** (currently a compile-time constant) — trivial, but must not ship alone, because…
2. **Auth before exposure:** minimum viable = a bearer token (`web.authToken` / `NDX_WEB_TOKEN`) checked on every request including `/mcp/*`, CORS tightened from `*` to configured origins, and the SDK's DNS-rebinding protection options enabled on the MCP transport (currently unset). Without this, any exposure is unauthenticated RCE via `/api/commands/*`.
3. **Server-side read-only mode:** the deployed-mode 405 today is client-side monkey-patched fetch + CSS hiding. A `web.mode: read-only` flag rejecting non-GET at the router is ~30 lines and makes a *safe* sidecar possible immediately — a "live static export" that's always fresh.
4. **Sidecar packaging:** a `Dockerfile`/compose snippet that mounts the repo (or bakes committed `.rex/` + `.sourcevision/` into the image at build time) and runs `ndx start --host 0.0.0.0 --read-only`. CI rebuilds it on merge — this leapfrogs Option 1's staleness problem entirely.
5. **Full multi-operator read-write server** (per-user identity, write attribution, replacing the global execution/self-heal singletons with a queue, per-client WS channels, fixing the unwired `closeAllMcpSessions` shutdown leak and the `/api/projects` host-path disclosure) is a large project. Recommend explicitly scoping the sidecar to **read-only + MCP-read** for v1 and treating collaborative *writes* as topology A/B's job.

**Effort:** medium for read-only sidecar; large for read-write team server. **Leverage:** high for visibility; the read-only version is the pragmatic cut.

### Option 7 — Event bus → chat notifications (topologies A/B/C)

*New proposal, small and orthogonal.*

`.rex/execution-log.jsonl` is already an append-only structured event stream, and the server already has watchers + a broadcast seam. Add an outbound webhook dispatcher (configured in `.n-dx.json`: `notify.webhooks[]` with event filters) posting to Slack/Teams/Discord on selected events: task completed, hench run failed, sync conflict recorded, PRD health drop, self-heal finished. Teammates who never open the dashboard still see the agent working. Pairs naturally with Option 3 (events carry an actor).

**Effort:** low. **Leverage:** medium — disproportionate "feels collaborative" per line of code.

### Option 8 — Multi-operator task claiming (topologies A/B)

*New proposal — the first thing that breaks when two people (or two hench agents) work the same PRD.*

`get_next_task` has no notion of "someone else is on this." Two people running `ndx work` on different machines will happily pick the same task. Options, cheapest first:

1. **Claim-in-frontmatter:** `ndx work` stamps `claimedBy` + `claimedAt` on the item and pushes the branch (topology A) or syncs to Notion (topology B); `get_next_task` skips fresh claims; claims expire after N hours. Eventually consistent, zero infrastructure.
2. **Adapter-mediated claims:** for Notion-first teams, the assignee field *is* the claim (Option 5.3).
3. **Server-mediated leases:** if/when the team server exists, it becomes the lock authority.

Recommend 1+2; defer 3.

**Effort:** low. **Leverage:** high the moment a second person (or second agent) runs `ndx work`.

### Option 9 — GitHub Issues adapter (topology B, adjacent)

The existing GitHub adapter targets **Projects v2 draft issues via GraphQL** — invisible to most contributors. A GitHub *Issues* adapter (REST, `PRD ID` in a hidden HTML-comment footer like the Jira/GH-Projects mappers already do) would let issue-driven teams use n-dx with zero new tooling, and pairs with Option 4's PR surfaces. The adapter registry makes this a contained, pattern-following addition. A Linear adapter is the same shape if demand appears (currently only a doc-comment mention exists).

**Effort:** medium. **Leverage:** depends on team; high for OSS-style repos.

---

## 4. Sequencing recommendation

Dependency-ordered, not priority-ordered — several tracks can run in parallel:

```
Phase 0  (foundations, unblock everything)
  Option 3: actor capture + lastModified stamping    ← also fixes sync change detection
  Option 2: slug id-suffixing + merge driver + removeStaleEntries guard

Phase 1  (fast visible wins, parallel tracks)
  Option 1: export redaction → endpoint coverage → CI templates (GH + Bitbucket)
  Option 5: Notion pull-first workflow + assignee mapping + WorkItemLink wiring
  Option 7: webhook notifications

Phase 2  (team surfaces)
  Option 4: PR comment bot / status checks
  Option 8: task claiming
  Option 6: read-only sidecar (host config + token auth + server-side read-only)

Phase 3  (only if demand proves out)
  Option 6 full read-write team server
  Option 9: GitHub Issues / Linear adapters
```

**The single highest-leverage insight from discovery:** stamping `lastModified` + actor on local folder-tree writes is one small change that simultaneously (a) fixes the broken sync engine, (b) enables attribution, (c) enables claim expiry, and (d) gives the merge driver a resolution timestamp. It should be first regardless of which topology the team bets on.

## 5. Open questions for the team

1. **Which topology is the bet?** Notion-first (B) matches current rituals; git-first (A) is the most durable and vendor-neutral. They compose, but the *canonical source of truth* must be named — the sync engine currently treats local as structurally canonical (`rebuildTree` uses the local skeleton).
2. **Is publishing agent transcripts ever acceptable?** Export redaction defaults need a decision before any public deploy story ships.
3. **Should `.rex/prd_tree/` commit-by-default become enforced?** Init currently appends only 2 gitignore lines and the rest is manual paste; this repo itself tracks several files its own template says to ignore (`acknowledged-findings.json`, `archive.json`, six hench runs) — the per-developer vs shared boundary should be scaffolded, not documented.
4. **How much of hench becomes multi-tenant?** Two agents on one PRD is the same problem as two humans (Option 8) — worth deciding whether "team of agents" is an explicit product direction, since it strengthens the case for claims + attribution.

## 6. Fact appendix — survey sources

All claims above trace to four code surveys performed 2026-08-19 against this worktree:

| Survey | Key files examined |
|---|---|
| Export/deploy | `packages/core/export.js`, `packages/web/src/viewer/deployed-mode.ts`, `styles/deployed.css`, `.github/workflows/docs.yml` |
| Sync/adapters | `packages/rex/src/core/{sync,sync-engine}.ts`, `src/store/{adapter-registry,notion-adapter,notion-map,jira-*,asana-*,github-projects-*}.ts`, `src/core/work-item-link.ts` |
| Web server | `packages/web/src/server/{start,routes-mcp,websocket,routes-commands,routes-rex/execution}.ts`, `packages/core/web.js` |
| PRD storage | `packages/rex/src/store/{folder-tree-serializer,folder-tree-parser,folder-tree-store,file-lock}.ts`, `docs/architecture/prd-folder-tree-schema.md`, `docs/guide/gitignore.md`, `packages/hench/src/agent/lifecycle/shared.ts` |
