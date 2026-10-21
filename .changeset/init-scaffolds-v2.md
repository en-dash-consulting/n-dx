---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

`rex init` (and so `ndx init`) gives a project with no PRD an empty v2 tree, `product/index.md` stamped `rex/v2`, and no `prd_tree/`, so a new project no longer prints the v1 deprecation notice. A project that already has a PRD keeps its layout; moving a v1 PRD stays `ndx migrate`'s job. The next steps init prints use the v2 verb (`rex add --title=…`) whenever the tree is v2, fresh or migrated.

Changes what a CLI command creates under the soft freeze: `rex init` / `ndx init` on a project with no PRD now writes the v2 layout instead of v1. No flag or MCP tool changes shape.

On a v2 PRD whose product layer has no capability and no constraint, such as a fresh project, a change in the Inbox is no longer stuck: there is nowhere to place it, so `rex next`, `get_next_task` and `ndx work` select it and its tasks, `ndx work --task` runs it, and it completes when its last task does. With no target it stays unapplied in the Inbox until placed. Once the product layer has a capability or constraint, Inbox changes are held from selection and closing as before, and `change-placed-at-close` reports any that closed unplaced. rex exports `awaitsPlacement`, the one predicate all of these use.

Changes a v2 selection and completion rule under the soft freeze: an Inbox change is held for placement only while the product layer has a capability or constraint to place it on. rex's public API gains `awaitsPlacement`; no MCP tool or CLI flag changes shape.
