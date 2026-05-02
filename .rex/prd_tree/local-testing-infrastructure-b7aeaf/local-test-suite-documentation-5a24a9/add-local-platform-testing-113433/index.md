---
id: "11343373-2400-483d-9736-04f42cbce488"
level: "task"
title: "Add Local Platform Testing section to main README with prerequisites and run commands"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "readme"
  - "testing"
  - "docker"
source: "smart-add"
startedAt: "2026-04-20T19:33:37.471Z"
completedAt: "2026-04-20T19:34:22.499Z"
resolutionType: "code-change"
resolutionDetail: "Added \"Local Platform Testing\" section to README.md with prerequisites, copy-pasteable commands for Windows/macOS gauntlets, exit codes, and link to .local_testing/README.md for advanced options."
acceptanceCriteria:
  - "README.md contains a 'Local Platform Testing' section with Windows and macOS run commands"
  - "Prerequisites (Docker Desktop version, disk space) are explicitly listed"
  - "Commands are copy-pasteable from the repo root without modification"
  - "Section links to .local_testing/README.md for advanced options"
  - "Section accurately reflects the actual scripts and Dockerfiles present in .local_testing/"
description: "Insert a 'Local Platform Testing' section in README.md (near the Platform Support table) that documents: (1) prerequisites — Docker Desktop ≥ 20, disk space for images; (2) commands to run the Windows and macOS gauntlet suites; (3) expected output and exit codes; (4) a pointer to .local_testing/README.md for advanced options. Content must be accurate and runnable from the repo root."
---

# Add Local Platform Testing section to main README with prerequisites and run commands

🟡 [completed]

## Summary

Insert a 'Local Platform Testing' section in README.md (near the Platform Support table) that documents: (1) prerequisites — Docker Desktop ≥ 20, disk space for images; (2) commands to run the Windows and macOS gauntlet suites; (3) expected output and exit codes; (4) a pointer to .local_testing/README.md for advanced options. Content must be accurate and runnable from the repo root.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** docs, readme, testing, docker
- **Level:** task
- **Started:** 2026-04-20T19:33:37.471Z
- **Completed:** 2026-04-20T19:34:22.499Z
- **Duration:** < 1m
