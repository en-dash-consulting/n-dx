---
"@n-dx/core": patch
---

Fix `cli.timeouts.<command>` being silently ignored when stored as a string

- `ndx config cli.timeouts.work <ms>` now stores the value as a number (numeric-shaped strings and `"true"`/`"false"` are auto-coerced when setting a brand-new key)
- `resolveCommandTimeout` accepts numeric strings defensively, so existing configs that were written as strings by earlier versions start working without a re-set
- `ndx init` runs a new config-repair pass that rewrites known-numeric paths (`cli.timeoutMs`, `cli.timeouts.*`, `web.port`) as proper numbers and reports what was repaired
