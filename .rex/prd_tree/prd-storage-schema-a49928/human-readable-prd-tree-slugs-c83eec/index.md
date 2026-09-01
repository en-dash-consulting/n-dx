---
id: "c83eecc7-a23e-4a3e-aeee-fc022dea0fc1"
level: "feature"
title: "Human-readable PRD tree slugs"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "PRD tree paths contain no id-derived suffix; item ids appear only in front matter"
  - "Slugs read as prose at every depth and get more specific with depth rather than repeating parent context"
  - "The rename lands on its own branch as a pure-rename commit, separate from any behaviour change"
  - "`rex validate` passes on the renamed tree and `ndx status` renders the same hierarchy as before"
description: "PRD tree paths should be readable at every level, with nesting supplying the context so each level only adds its own specificity, and the item id living in front matter only. Today every slug carries an unconditional `-<shortId>` suffix: `slugify(title, id)` in packages/rex/src/store/folder-tree-serializer.ts:251 appends the first 6 alphanumeric characters of the id and truncates the title body to keep the whole slug within MAX_SLUG_LENGTH=40. So `testing-documentation-160499/skills-reference-and-gitignore-ab5438/add-skills-used-in-this-guide-408e0c.md` instead of `testing-documentation/skills-reference/add-skills-used-in-this-guide.md`. All 1398 items currently conform to the id-qualified rule, so this is a deliberate convention change rather than a repair. Two things block it and are broken out as child tasks: 127 items would collide on a title-only slug today, and the suffix exists for a stated merge-safety reason that needs a different answer before it is dropped. Sequencing matters — the reshape and the validate guard must both land before the rename, or the rename produces collisions. The work belongs on a dedicated branch: the rename touches roughly 1400 paths and should be one mechanical, pure-rename commit that is reviewable precisely because it contains nothing else."
lastModified: "2026-09-01T14:11:13.678Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Consolidate PRD items that collide on a title-only slug](./consolidate-prd-items-that-f0ca95.md) | pending |
| [Make the MCP and CLI write paths agree on the slug convention](./make-the-mcp-and-cli-write-c1589e.md) | pending |
| [Replace the id-qualified slug with a title-only slug, guarding merge safety in validate](./replace-the-id-qualified-slug-5836fe.md) | pending |
| [Point migrate-slugs at the readable convention](./point-migrate-slugs-at-the-ab96ea.md) | pending |
