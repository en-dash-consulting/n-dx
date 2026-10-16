---
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

`ndx install-sample` on a v2 project adds the sample as a change with two tasks through `rex add`, instead of writing a `prd_tree/` beside `product/`; `ndx destroy-sample` removes it. A v1 project is unchanged.

Changes what a CLI command writes under the soft freeze: on a v2 project `ndx install-sample` and `ndx destroy-sample` write the change layer (`{rex}/changes/`), not `prd_tree/`. No flag changes shape.

`rex remove <id>` now works on a v2 PRD, removing a change, task or subtask inside the PRD lock. `ndx destroy-sample` on a v2 project uses it instead of deleting change folders itself, and fails naming the lock holder when another writer holds the lock.

Widens a CLI command under the soft freeze: `rex remove` accepts v2 change, task and subtask ids (it refused v2 trees before). No flag or MCP tool changes shape.

The first `/api/rex/prd` read after `ndx start` no longer answers 404 on a folder tree: the boot PRD cache is written before the server listens, so a request cannot beat it.

Changes a v2 rule under the soft freeze: `change-placed-at-close` is a warning, not an error, for a change the migration held for placement that completed at or before the cut. A held change completed after the cut is still an error.

The apply-side fixes on this layer (blockedBy rewrites onto open changes, the guarded `prd_tree/` leftover removal, the dry run listing each rewrite) are described in the `ndx migrate --apply` changeset, migrate-apply.md.
