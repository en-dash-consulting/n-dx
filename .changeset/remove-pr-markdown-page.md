---
"@n-dx/web": patch
---

The dashboard's PR Markdown page and its `sourcevision.prMarkdown` toggle are removed; an old `/pr-markdown` link now opens the Analyze page.

The page had been off by default and unchanged since April. `GET /api/sv/pr-markdown` and `/api/sv/pr-markdown/state` now answer 404, and `/api/sv/summary` no longer carries a `prMarkdown` block. The generator stays: `sv pr-markdown`, the PR markdown step of `sv analyze` and the cache `ndx refresh --pr-markdown` rebuilds still write `.sourcevision/pr-markdown.md`. A `.n-dx.json` that still stores `features.sourcevision.prMarkdown` loads as before, and the value is ignored.
