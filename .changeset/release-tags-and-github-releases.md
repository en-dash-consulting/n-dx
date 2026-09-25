---
"@n-dx/core": patch
---

Release workflow creates git tags and GitHub releases again. Moved to `changesets/action@v2`, which reads the `CHANGESETS_OUTPUT` NDJSON that Changesets CLI v3 writes instead of scraping stdout for `New tag:` lines (which CLI v3 no longer prints — so 0.5.0 through 0.7.0 reached npm untagged while every run stayed green). A publish run now fails if the version it just published is on npm but its tags are missing from origin or its GitHub releases were not created, and `scripts/backfill-release-tags.mjs` recreates missing tags and releases from the CHANGELOGs.
