---
"@n-dx/rex": patch
---

On a branch cut again under a merged branch's name, `rex branch add` and MCP `assign_to_branch` no longer say "Already on" for an open task the earlier branch left: they add it to this branch's set, where `rex branch show` lists it and `rex next` picks it. The row gets `delivery.since`, this branch's fork point, so it no longer matches the earlier branch's row on the default branch. Assigning a change also takes over the change's own earlier `delivery`, so tasks it gains later follow it.
