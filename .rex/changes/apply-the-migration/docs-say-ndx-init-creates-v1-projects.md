---
id: "e7a6da01-6252-4a8b-82fe-374a95fb4339"
type: "task"
title: "Docs say ndx init creates v1 projects; it now creates v2"
slug: "docs-say-ndx-init-creates-v1-projects"
description: "After ff12092b, rex init / ndx init give a new project an empty v2 tree. About 24 statements in docs/ still say \"ndx init creates v1 projects until the storage migration ships\" (grep 'storage migration ships' docs/): guide/quickstart, workflow, spec-driven, prd-storage, change-management, commands (lines 124, 170), mcp, skills, existing-project, overnight, vibe-cleanup, onboarding, gitignore, n-dx-vs-spec-kit, concepts/{index,glossary,changes-and-apply,bugs-and-hotfixes,stewards}, architecture/{level-system-reference,prd-folder-tree-schema}, packages/{web,rex}. Several pages narrate a v1-only flow (epics from ndx add) and need the v2 path, not a one-word swap. Check root-docs tests after."
acceptanceCriteria:
  - "No doc page says ndx init creates a v1 project"
  - "Pages that walk a new-project flow describe the v2 path, with v1 noted as the migrated-from layout"
  - "node scripts/run-all-tests.mjs root-docs passes"
priority: "medium"
tags:
  - "docs"
  - "lane-migration"
blockedBy:
  - "ff12092b-d386-46b4-b344-8ccf22a338ba"
---
