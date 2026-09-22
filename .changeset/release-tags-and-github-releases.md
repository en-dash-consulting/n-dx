---
"@n-dx/core": patch
---

Release workflow creates git tags and GitHub releases again. Moved to `changesets/action@v2`, which reads the `CHANGESETS_OUTPUT` NDJSON that Changesets CLI v3 writes instead of scraping stdout for `New tag:` lines (which CLI v3 no longer prints — so 0.5.0 through 0.7.0 reached npm untagged while every run stayed green). Publish runs now fail if npm has a version that origin or GitHub Releases lacks, and `scripts/backfill-release-tags.mjs` recreates missing tags and releases from the CHANGELOGs.
