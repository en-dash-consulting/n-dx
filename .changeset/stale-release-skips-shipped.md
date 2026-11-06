---
"@n-dx/rex": patch
---

`stale-release-plan` no longer flags a change that shipped in the release it was planned for. Under `rex.applyOn: review` a completed change carries `shippedIn` before it is applied, and `rex validate`, MCP `health` and the Plan health light told the operator to re-plan it.
