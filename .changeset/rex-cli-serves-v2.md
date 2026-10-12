---
"@n-dx/rex": patch
---

The rex CLI serves a v2 tree: `status`, `tree`, `update`, `move`, `remove`, `ready`, `verify`, `fix`, `validate` and `report` run through the change-layer store, and `rex move` places items by node type (a task moves between changes; a change never goes under a task). `rex move` and the MCP `move_item` can now nest a change under another change, which the type rule allowed but the level check at insertion refused. `rex analyze`, `rex recommend --accept` and `rex restore` refuse on a v2 tree with a sentence naming what to use instead (`rex add`, `rex change place`; restore is v1-only until after the cut). `ndx status` and `ndx ci` pass on a v2 project with no change to `@n-dx/core`. v1 is unchanged. No MCP field is added in this change.
