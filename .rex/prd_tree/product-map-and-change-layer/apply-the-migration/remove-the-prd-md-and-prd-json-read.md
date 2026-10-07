---
id: "2ea252fe-afbf-449d-ad6a-55b3285fd78a"
level: "task"
title: "Remove the prd.md and prd.json read fallbacks and the old migrate commands"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
blockedBy:
  - "ad842166-7ac1-4875-bac8-e5f55ea18402"
source: "roadmap"
acceptanceCriteria:
  - "No code path reads .rex/prd.md, .rex/prd.json or branch-scoped .rex/prd_*.md files as a PRD (test: a project with only prd.md is refused with the upgrade message)"
  - "rex migrate-to-md, migrate-to-folder-tree, migrate-folder-tree-filenames and migrate-slugs no longer exist, and their help text is gone"
  - "ndx migrate still converts a v1 folder tree to v2 (existing migration tests pass)"
  - "No current doc or instruction file mentions the removed commands outside the upgrade guide"
description: "1.0.0 removes the legacy PRD formats. Today rex still reads them as fallbacks: ensure-legacy-prd-migrated.ts migrates a .rex/prd.md or .rex/prd.json on first write, prd-md-migration.ts, prd-migration.ts and legacy-markdown-parser.ts read them, and prd-discovery.ts with branch-naming.ts resolves branch-scoped .rex/prd_<branch>_<date>.md files. Four commands only exist to move between old formats: rex migrate-to-md, migrate-to-folder-tree, migrate-folder-tree-filenames and migrate-slugs (frozen slugs make the last one obsolete). Remove the fallbacks, the branch-scoped file discovery and the four commands; ndx migrate becomes the only migration entry point, reading the v1 folder tree as its source. A project still on prd.md or prd.json is refused with a message naming the way out: upgrade with ndx 0.8.x first (rex migrate-to-folder-tree), then run ndx migrate. Keep everything the v1 folder-tree reader needs, since it is the migration's source. Update the CLI help, the docs and the instruction files so none of them mention the removed commands except the upgrade guide."
lastModified: "2026-10-07T15:13:45.904Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
