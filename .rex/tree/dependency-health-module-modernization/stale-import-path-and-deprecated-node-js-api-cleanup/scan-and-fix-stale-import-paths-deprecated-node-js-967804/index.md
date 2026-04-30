---
id: "96780413-6007-4eb0-8550-a118e3d9a8c2"
level: "task"
title: "Scan and fix stale import paths, deprecated Node.js APIs, and outdated module references across packages"
status: "completed"
priority: "medium"
tags:
  - "imports"
  - "node"
  - "typescript"
  - "audit"
  - "refactor"
source: "smart-add"
startedAt: "2026-04-08T23:44:47.183Z"
completedAt: "2026-04-08T23:49:58.622Z"
acceptanceCriteria:
  - "All TS compiler errors related to unresolved or mismatched module paths are enumerated before any changes are made"
  - "grep scan for known deprecated Node.js API patterns completes and all findings are documented with file, line, current usage, and recommended fix"
  - "Any require() calls in ESM-target files are identified and converted"
  - "tsc --noEmit reports no new module-resolution or deprecated-API errors after changes"
  - "No remaining uses of documented deprecated Node.js APIs in production source files"
  - "pnpm test passes with no regressions introduced by the import path changes"
  - "sourcevision analyze import graph shows no broken or dangling edges for changed files"
description: "Use static analysis (grep, tsc --noEmit, sourcevision import graph) to enumerate: imports pointing to moved or renamed files, uses of deprecated Node.js built-in APIs (fs.exists, url.parse, etc.), and any CommonJS require() calls in ESM-targeted files. Then apply all fixes: update import paths to current locations, replace deprecated APIs with modern equivalents (e.g. url.parse → new URL(), fs.exists → fs.access), and convert stray require() to ESM imports. Confirm tsc --noEmit and pnpm test pass cleanly after all changes."
log:
  - "[object Object]"
---

# Scan and fix stale import paths, deprecated Node.js APIs, and outdated module references across packages

🟡 [completed]

## Summary

Use static analysis (grep, tsc --noEmit, sourcevision import graph) to enumerate: imports pointing to moved or renamed files, uses of deprecated Node.js built-in APIs (fs.exists, url.parse, etc.), and any CommonJS require() calls in ESM-targeted files. Then apply all fixes: update import paths to current locations, replace deprecated APIs with modern equivalents (e.g. url.parse → new URL(), fs.exists → fs.access), and convert stray require() to ESM imports. Confirm tsc --noEmit and pnpm test pass cleanly after all changes.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** imports, node, typescript, audit, refactor
- **Level:** task
- **Started:** 2026-04-08T23:44:47.183Z
- **Completed:** 2026-04-08T23:49:58.622Z
- **Duration:** 5m
