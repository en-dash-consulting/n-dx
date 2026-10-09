---
"@n-dx/rex": patch
---

On a v2 PRD, rex MCP read tools no longer grow with change history. `get_capability` lists every open change plus the 10 most recently applied by default, with `status` (`recent`, `open`, `applied`, `all`), `since` (release), `cursor` and `limit` to read more, and reports `changeCounts` over all related changes and `changesPage.nextCursor`. `get_prd_status` lists releases with open changes and the 5 newest closed ones (`allReleases` lists all, `releasesOmitted` counts the rest); its change counts still cover every change.
