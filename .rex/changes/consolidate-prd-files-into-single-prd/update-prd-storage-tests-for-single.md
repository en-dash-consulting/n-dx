---
id: "54be143d-cb14-4fe1-89e1-376b8a224755"
type: "task"
title: "Update PRD storage tests for single-file 'prd' location"
slug: "update-prd-storage-tests-for-single"
description: "Revise unit, integration, and e2e tests that assume the branch-scoped multi-file PRD layout so they target the new single 'prd' file location. Add migration coverage that exercises loading a legacy multi-file fixture and verifying it collapses correctly into the unified file."
acceptanceCriteria:
  - "All rex store tests reference the new single 'prd' file path"
  - "Tests covering branch-scoped multi-file behavior are either removed or converted into migration tests"
  - "New test verifies legacy multi-file fixture migrates into the unified file with identical item/log content"
  - "Integration tests for ndx add, rex add, plan, and status pass against the new location"
  - "pnpm test passes across rex and web packages with the updated layout"
priority: "high"
tags:
  - "rex"
  - "tests"
  - "migration"
source: "smart-add"
---
