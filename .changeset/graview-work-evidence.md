---
"@n-dx/rex": patch
"@n-dx/graview": patch
---

The v1-to-v2 migration plan marks a capability or constraint `met` when its v1 item completed, and the plan's data stage stamps `metAt` with the drafted spec's hash, as `appliedAt` already stamps a completed change: without it every migrated capability read proposed forever. `specHash` and `nodeSpec` join rex's public API. The Graview projection's proposed product layer stamps the same, so a completed feature's capability reads met, one with an open amending change reads changing, and the capability declaration drops its `metAt` datetime (rex's `metAt` is a spec hash, said through `intentStatus`).
