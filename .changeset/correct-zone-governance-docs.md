---
"@n-dx/core": patch
---

Correct stale zone-governance documentation and stop leaking n-dx internals into generated instruction files

The zone fragility tables named six zones that no longer exist under those IDs
(`web-shared`, `crash`, `viewer-ui-hub`, `prd-fix-command`, `chunked-review`,
`hench-agent`) with metrics that no longer match any analysis. Because
`CLAUDE.md` is generated from `assistant-assets/`, those n-dx-specific zone
names and numbers also shipped into every `ndx init` target.

The generated surfaces now carry only the threshold rule plus instructions to
read live values; n-dx's own measured inventory moved to `ZONES.md`, which is
repo-internal and not templated downstream.
