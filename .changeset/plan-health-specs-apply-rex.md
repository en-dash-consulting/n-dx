---
"@n-dx/rex": patch
---

`rex validate` warns on stale release plans: an open change planned for a release that has shipped, or for one older than the newest shipped release. The rule is shared with `rex health` and MCP `health`. A new `applyChange` core previews or applies a change under the PRD lock, refuses when the change or its targets moved since the preview, and backs MCP `apply_change`.
