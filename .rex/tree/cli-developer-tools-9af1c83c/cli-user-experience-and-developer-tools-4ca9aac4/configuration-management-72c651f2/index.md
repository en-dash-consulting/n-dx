---
id: "72c651f2-974f-48c1-85c6-462b6a1d2204"
level: "task"
title: "Configuration management"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
description: "Unified configuration system across all packages"
---

## Subtask: Add unified config command

**ID:** `cf194705-5786-44f9-8d8b-ddb8aa7bd924`
**Status:** completed
**Priority:** low

Single command to view and edit settings across all packages

**Acceptance Criteria**

- Shows all package configurations
- Allows editing any setting
- Validates configuration values

---

## Subtask: Support project-level config file

**ID:** `20fee51e-b879-49ef-ab3c-6a28b7f39b4a`
**Status:** completed
**Priority:** low

Use .n-dx.json at project root for unified configuration

**Acceptance Criteria**

- Reads .n-dx.json from project root
- Merges with individual package configs
- Project config takes precedence

---

## Subtask: Document all config options in help

**ID:** `a8a20d83-c58c-43c1-a3c7-9a2fecfb4988`
**Status:** completed
**Priority:** low

Include comprehensive config documentation in --help output

**Acceptance Criteria**

- All options documented
- Clear descriptions provided
- Examples included where helpful

---
