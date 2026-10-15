---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

On a v2 PRD whose product layer has no capability and no constraint, such as a fresh project, a change in the Inbox is no longer stuck: there is nowhere to place it, so `rex next`, `get_next_task` and `ndx work` select it and its tasks, `ndx work --task` runs it, and it completes when its last task does. With no target it stays unapplied in the Inbox until placed. Once the product layer has a capability or constraint, Inbox changes are held from selection and closing as before, and `change-placed-at-close` reports any that closed unplaced. rex exports `awaitsPlacement`, the one predicate all of these use.

Changes a v2 selection and completion rule under the soft freeze: an Inbox change is held for placement only while the product layer has a capability or constraint to place it on. rex's public API gains `awaitsPlacement`; no MCP tool or CLI flag changes shape.
