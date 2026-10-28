---
"@n-dx/web": patch
---

Stop active agent runs before manual browser fixtures stop their dashboard.
Test-only teardown now polls workspace runs and starting executions, confirms
termination, and falls back to a bounded process-tree kill on API failure.
