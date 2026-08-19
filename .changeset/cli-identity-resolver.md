---
"@n-dx/core": patch
---

Detect the project's CLI command name from the package.json bin field and record it as cli.name in .n-dx.json during init; manual overrides via `ndx config cli.name` are preserved.
