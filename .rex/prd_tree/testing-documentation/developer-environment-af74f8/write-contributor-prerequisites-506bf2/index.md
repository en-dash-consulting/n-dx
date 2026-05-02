---
id: "506bf2d9-72ce-4570-848c-95c464e15840"
level: "task"
title: "Write contributor prerequisites and platform-specific setup guide"
status: "completed"
priority: "low"
tags:
  - "docs"
  - "dx"
  - "contributing"
source: "smart-add"
startedAt: "2026-04-19T04:55:04.167Z"
completedAt: "2026-04-19T04:56:26.426Z"
resolutionType: "code-change"
resolutionDetail: "Created CONTRIBUTING.md with contributor prerequisites, pnpm workspace bootstrap, build/test commands, macOS Xcode CLI tool callout, Windows WSL2/Docker notes. Linked from README.md Contributing section."
acceptanceCriteria:
  - "A 'Development Setup' section or CONTRIBUTING.md exists and is linked from the README"
  - "Lists contributor-specific prerequisites separate from end-user prerequisites"
  - "Covers pnpm workspace bootstrap (pnpm install), build (pnpm build), and test (pnpm test) commands"
  - "Includes at least one platform-specific callout for Windows (WSL or Docker requirement) and notes any macOS-specific steps"
  - "Node version requirement for development matches the engines field and any .nvmrc added in the user prerequisites task"
description: "Add a 'Contributing / Development Setup' section (or CONTRIBUTING.md) covering the additional tools required to build and test the monorepo: pnpm version, build commands, and any platform-specific notes (e.g. Windows requires WSL or Docker, macOS may need Xcode CLI tools for native deps). Distinguish clearly between what a user needs versus what a contributor needs."
---

# Write contributor prerequisites and platform-specific setup guide

⚪ [completed]

## Summary

Add a 'Contributing / Development Setup' section (or CONTRIBUTING.md) covering the additional tools required to build and test the monorepo: pnpm version, build commands, and any platform-specific notes (e.g. Windows requires WSL or Docker, macOS may need Xcode CLI tools for native deps). Distinguish clearly between what a user needs versus what a contributor needs.

## Info

- **Status:** completed
- **Priority:** low
- **Tags:** docs, dx, contributing
- **Level:** task
- **Started:** 2026-04-19T04:55:04.167Z
- **Completed:** 2026-04-19T04:56:26.426Z
- **Duration:** 1m
