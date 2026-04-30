---
id: "8894ca28-c09b-4fb7-a704-cde878a0990f"
level: "task"
title: "Update rex package README and PACKAGE_GUIDELINES for markdown-first storage"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "rex"
source: "smart-add"
startedAt: "2026-04-24T20:51:00.332Z"
completedAt: "2026-04-24T20:55:20.172Z"
resolutionType: "code-change"
resolutionDetail: "Added Storage section to packages/rex/README.md documenting prd.md as primary, dual-write to prd.json, automatic on-load migration, manual migration via rex migrate-to-md, required vs optional fields, and how to edit prd.md by hand. Updated PACKAGE_GUIDELINES.md (.rex/ write-access protocol) to describe markdown-primary with prd.json as derived sync artifact, dual-write invariant, and updated write-ownership table. Updated TESTING.md rex integration scenario list to call out JSON→markdown migration and dual-write, and added test-file pointers for prd-md-migration, file-adapter-markdown-migration, markdown-roundtrip, and prd-write-routing."
acceptanceCriteria:
  - "packages/rex/README.md contains a Storage section documenting prd.md as primary, dual-write to prd.json, and the automatic migration path"
  - "PACKAGE_GUIDELINES.md updated to reference prd.md wherever prd.json storage format is discussed"
  - "TESTING.md updated if any test guidance references prd.json as the file to inspect or seed"
  - "Migration path is clearly described: automatic on first load, or manual via `rex migrate-to-md`"
  - "README documents how to read and manually edit prd.md, including which fields are required vs optional"
description: "Update packages/rex/README.md to document the new markdown storage format with a Storage section covering the schema overview, dual-write behavior, and migration path. Update PACKAGE_GUIDELINES.md and TESTING.md wherever prd.json file format or storage conventions are referenced to reflect the markdown-primary model."
---

# Update rex package README and PACKAGE_GUIDELINES for markdown-first storage

🟡 [completed]

## Summary

Update packages/rex/README.md to document the new markdown storage format with a Storage section covering the schema overview, dual-write behavior, and migration path. Update PACKAGE_GUIDELINES.md and TESTING.md wherever prd.json file format or storage conventions are referenced to reflect the markdown-primary model.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** docs, rex
- **Level:** task
- **Started:** 2026-04-24T20:51:00.332Z
- **Completed:** 2026-04-24T20:55:20.172Z
- **Duration:** 4m
