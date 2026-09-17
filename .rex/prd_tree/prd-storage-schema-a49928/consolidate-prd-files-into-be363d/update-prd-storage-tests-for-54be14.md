---
id: "54be143d-cb14-4fe1-89e1-376b8a224755"
level: "task"
title: "Update PRD storage tests for single-file 'prd' location"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "tests"
  - "migration"
source: "smart-add"
startedAt: "2026-04-23T02:22:15.872Z"
completedAt: "2026-04-23T02:30:34.809Z"
resolutionType: "code-change"
resolutionDetail: "Added legacy multi-file fixture under packages/rex/tests/fixtures/legacy-multifile-prd/ and a new prd-migration.test.ts describe block that copies the fixture into a fresh .rex/, runs migrateLegacyPRD (and resolveStore), and asserts the merged prd.json has identical item content and that execution-log.jsonl is preserved byte-for-byte. Prior multi-file test suites had already been removed/converted; every remaining rex and web test references the single prd.json. Full rex (3457) and web (2618) test suites pass."
acceptanceCriteria:
  - "All rex store tests reference the new single 'prd' file path"
  - "Tests covering branch-scoped multi-file behavior are either removed or converted into migration tests"
  - "New test verifies legacy multi-file fixture migrates into the unified file with identical item/log content"
  - "Integration tests for ndx add, rex add, plan, and status pass against the new location"
  - "pnpm test passes across rex and web packages with the updated layout"
description: "Revise unit, integration, and e2e tests that assume the branch-scoped multi-file PRD layout so they target the new single 'prd' file location. Add migration coverage that exercises loading a legacy multi-file fixture and verifying it collapses correctly into the unified file."
---
