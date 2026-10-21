---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

`rex migrate-plan`, `rex migrate-apply --dry-run` and `rex migrate-apply` refuse a v1 tree with an item file the parser cannot read, such as unclosed front matter left by a hand edit or a merge conflict. The refusal names each file. Before this, the store's load dropped the parser's warning, so the plan and the dry run left the item out without saying so, and apply then removed `prd_tree/` along with that item's file. The v1 parser now marks a warning `skipped` when it drops an item, as the v2 reader already did.

`rex migrate-apply` and its `--dry-run` print the v2 rule findings on the migrated tree, counted by rule (errors and warnings), as `rex health` then reports them. They are reported, not refused. A test now pins apply's refusal when the tree reads back without a v1 id.

`rex migrate-apply` keeps a dissolved release epic's description and acceptance criteria under its line in the cut change's body, and moves its own `blockedBy` onto its open children, so a release's work still waits for the release it depended on.

`migrate --apply`: when removing `prd_tree/` or `tree-meta.json` fails after the v2 tree is switched in (a handle held on Windows), apply now says the v2 tree is in place, names the leftovers and the underlying error, and gives the manual step to clear them, instead of throwing the raw error.

`migrate --apply`: every leftover `prd_tree/` message now names the leftover and the same manual step (check the v2 tree holds everything in it, then delete it by hand). A failed removal after the switch no longer promises a re-run finishes the job, and a failed removal on an already-v2 apply says the v2 tree is in place instead of throwing the raw error.

A migration plan's `metAt` now follows a capability's spec when a later pass redrafts it, instead of keeping the rules-stage draft's hash.

`ndx migrate` (the bare chain) now shows the preflight banner, and its `--dry-run` runs no model unless `--with-models` is given

`rex migrate-plan`, `rex migrate-apply` and `ndx migrate-layout` refuse inside an agent run (`NDX_AGENT_RUN` set), as `ndx migrate` already does.

`rex migrate-to-folder-tree` keeps the PRD title

The command wrote the tree but not `.rex/tree-meta.json`, so a migrated project
read back as "PRD". It now writes the sidecar with the source document's title.

`rex migrate-slugs` on a v2 tree now says slugs are frozen there and applies to v1 trees only, instead of pointing at the v1 `rex migrate-to-folder-tree` command.

Placing an Inbox change (`rex change place`) carries the non-tree files in its folder into `changes/<slug>/` with it, and removes the empty Inbox folder; a name clash refuses before anything is written.

The v2 writer keeps a moved folder node's extra top-level `state.yaml` keys (keys a newer rex wrote) in its new folder. A node that moves and loses its last child in the same write is refused, naming its old folder and the keys, instead of dropping them.

Writes on a v2 tree now stamp `lastModified` and `lastModifiedBy` on every
node they change, create or move, as v1 writes do. Before, `update_task_status`,
`edit_item`, `add_item` and `move_item` left a node's old stamp in place and
gave a new change none, so remote sync and the dashboard read v2 writes as
stale. A write that changes nothing stamps nothing. The stamp lands in the
node's `state.yaml` row, so a write now also rewrites that file.

The rex MCP `get_capabilities` tool now reports `"schemaVersion": "rex/v2"` on a
v2 tree. It answered `"rex/v1"` beside `"adapter": "v2-change-layer"`, so a
client that reads `schemaVersion` took the tree for v1. A v1 tree still reports
`rex/v1`. The change layer store declares its version through the new optional
`schemaVersion` on `StoreCapabilities`.

`get_product` now answers with a summary by default: each area with its counts
of capabilities and constraints by status, defective nodes and open changes.
Pass `area` (an id or display id) for that area's capabilities and constraints,
or `full: true` for the whole map, the previous default. On a large v2 tree the
whole map exceeded what an MCP client accepts and was refused. The
`/ndx-capture`, `/ndx-plan`, `/ndx-reshape` and `/ndx-adversarial-review`
skills read the summary, then the areas they need.

The preflight banner and the dashboard's command effects name `changes/` and `product/` for the PRD on a v2 project instead of `prd_tree/`, which a v2 project does not have.

The dashboard server turns off rex's v1-layout deprecation notice for the commands it spawns, so a failing rex spawn on a v1 project shows its real error and not the notice first.

`rex next` labels v2 work by type (`[change]`, `[task]`, `[subtask]`), never `[epic]`. On a v2 tree, `level` in MCP and JSON payloads is the v1 projection of `type` and nesting: it stays for compatibility in this release and is deprecated. `type` is authoritative; the release that refuses v1 PRDs removes `level` from every v2 payload.

Changes under the soft freeze:
- `ndx migrate --dry-run` (the bare chain) runs no model unless the new `--with-models` flag is given.
- `rex migrate-plan`, `rex migrate-apply` and `ndx migrate-layout` refuse inside an agent run.
- `rex migrate-plan`, `migrate-apply` and its dry run refuse a v1 tree with an item file the parser skipped.
- MCP `get_capabilities` reports `schemaVersion: rex/v2` on a v2 tree.
- MCP `get_product` answers with a per-area summary by default; `area` and `full: true` reach the detail, and `full: true` is the previous default.
- v2 writes stamp `lastModified` / `lastModifiedBy`.
- `level` is deprecated on v2 payloads (kept in this release); `rex next` text labels v2 work by type.
- The preflight banner and command effects name `changes/` and `product/` on a v2 project.
