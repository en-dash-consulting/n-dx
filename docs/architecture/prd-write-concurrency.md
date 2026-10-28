# PRD write concurrency

How n-dx keeps concurrent PRD writers from losing each other's work. The rules
an assistant has to follow are in `AGENTS.md` / `CLAUDE.md` under "Concurrency
contract"; this page is the reasoning behind them.

**What the code enforces:** the MCP write tools, the dashboard's PRD-writing routes (item CRUD, merge, prune, restore, and the SourceVision Ask panel's `apply-refinements`), and the bulk restructurers `reorganize`, `prune`, and `reshape` perform their read-modify-write inside `store.withTransaction`, which holds the PRD file lock across the whole span — a concurrent writer's item is no longer silently dropped by their full-document save. Their LLM analysis runs on an unlocked snapshot; accepted proposals are re-applied against a freshly loaded document under the lock. `saveDocument` itself always takes the lock, so writes cannot interleave, and a writer that cannot acquire the lock within its timeout fails loudly with an error naming the holder PID rather than proceeding.

**The PRD lock is per workspace, one per `rexDir`.** Each worktree's resolved
rex directory has its own lock. The dashboard resolves its store from the
request's `ctx.rexDir`, so `/w/<key>/` (or `X-Ndx-Workspace`) targets that
worktree's v2 roots or v1 tree. To edit the anchor, switch workspace through
the top bar. MCP sessions likewise bind to the worktree named by the
client's roots. A root that cannot be served refuses writes instead of
falling back to the launch checkout. Separate worktree locks do not merge
their PRDs; git review and merge reconcile those independent histories.

**V1 operator discipline:** other CLI write paths (`analyze`/`plan` imports,
`update`, `move`, `remove`, `fix`, and similar) still do their own
load→mutate→save. The lock serializes the write but does not merge a stale
snapshot. Keep PRD writers sequential. A restructure computed against an
older snapshot can also turn individual proposals into reported no-ops.

## V2 roots and transactions

On v2, read-modify-write runs in `withPrdModelTransaction` (or the resolved
change-layer store's `withTransaction`) against `product/` and `changes/`.
Resolve their parent from the project layout: `.ndx/rex/` or legacy `.rex/`.
The workspace binding described above applies to these roots as well as the
v1 `prd_tree/`; it never writes another worktree's tree. Intent is Markdown,
while a status update changes the containing folder's `state.yaml`.

The lock spans both layers, so applying amendments cannot race another
cooperating product writer. Atomicity is per file; an interrupted multi-file
write can still require recovery. The warning about snapshot-based CLI
paths above describes v1: v2 callers transact around the full mutation,
not merely its final save. Continue to keep writer commands sequential;
that also protects config, logs and analysis that have their own write paths.

The only writable PRD roots on v2 are these two directories. Logs, config,
locks, backups and dashboard caches are separate artifacts. A transport
bundle must be outside the resolved rex directory. Ordinary PRD mutations
never produce legacy `prd.md`, `prd_*.md` or `prd.json` files.

## References

- [Architecture Overview](overview.md) — the tier hierarchy these entry points sit in
- [PRD folder-tree schema](prd-folder-tree-schema.md) — what the tree the lock guards looks like
