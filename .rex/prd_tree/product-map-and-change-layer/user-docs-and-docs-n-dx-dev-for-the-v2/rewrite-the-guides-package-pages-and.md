---
id: "4301fba6-667a-4b59-b18d-6d1b18e16626"
level: "task"
title: "Rewrite the guides, package pages and examples for the v2 model"
status: "pending"
priority: "high"
tags:
  - "pr-28"
  - "lane-core-docs"
  - "docs"
blockedBy:
  - "bc0aa415-331f-406f-8d14-2eff065dd91f"
  - "5cfa1d83-839a-47a1-ae42-4353cd1acf83"
  - "70443075-8352-48a4-a8ed-799505872d4b"
source: "roadmap"
acceptanceCriteria:
  - "No current (non-archive) docs page presents epics/features/tasks as the PRD's structure"
  - "Every command and MCP tool named in the docs exists in the 1.0.0 build (a docs check or test)"
  - "pnpm docs:build passes"
description: "Rewrite every docs page that describes epics, features and tasks as the PRD's structure, the PRD commands, the rex MCP tools, the folder tree and the dashboard's PRD page, using the shipped CLI and MCP names (rex product, rex change, get_product, place_change, apply_change) and .ndx/rex/product and .ndx/rex/changes. Update examples and screenshots."
lastModified: "2026-10-06T16:54:42.933Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
