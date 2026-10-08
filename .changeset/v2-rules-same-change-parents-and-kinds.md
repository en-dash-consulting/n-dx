---
"@n-dx/rex": patch
---

The v2 `ref-resolves` rule now rejects a change whose added nodes are placed under themselves or in a cycle, and a reference that names the wrong kind of node: touches, amendment targets and appliesTo must name product nodes, dependsOn a capability, blockedBy a change-layer node, and an added node's `under` a node that can hold it. `removed-target-live` now reports only retired targets.
