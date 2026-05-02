---
id: "fcfc2e7c-270b-4367-949e-59992caf6766"
level: "task"
title: "Add Go guard defaults and language-aware config to Hench"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "go"
  - "guard"
  - "config"
source: "smart-add"
startedAt: "2026-03-26T06:16:07.320Z"
completedAt: "2026-03-26T06:27:36.895Z"
acceptanceCriteria:
  - "Go projects get allowedCommands including \"go\", \"make\", \"git\", \"golangci-lint\""
  - "Go projects get \"vendor/**\" in blockedPaths"
  - "JS/TS projects get the existing default allowedCommands unchanged"
  - "hench init detects Go projects and applies Go-appropriate defaults"
  - "The guard validates Go commands (go test, go build, make lint) as allowed for Go projects"
  - "Existing JS/TS guard behavior is unchanged"
description: "Modify `packages/hench/src/schema/v1.ts` and `packages/hench/src/schema/templates.ts` so that when a Go project is detected (go.mod present or language config is \"go\"), `allowedCommands` defaults to `[\"go\", \"make\", \"git\", \"golangci-lint\"]` and `blockedPaths` includes `\"vendor/**\"`. JS/TS project defaults remain unchanged. Detection should use the sourcevision language registry or go.mod presence check during `hench init`."
---

# Add Go guard defaults and language-aware config to Hench

🟠 [completed]

## Summary

Modify `packages/hench/src/schema/v1.ts` and `packages/hench/src/schema/templates.ts` so that when a Go project is detected (go.mod present or language config is "go"), `allowedCommands` defaults to `["go", "make", "git", "golangci-lint"]` and `blockedPaths` includes `"vendor/**"`. JS/TS project defaults remain unchanged. Detection should use the sourcevision language registry or go.mod presence check during `hench init`.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** hench, go, guard, config
- **Level:** task
- **Started:** 2026-03-26T06:16:07.320Z
- **Completed:** 2026-03-26T06:27:36.895Z
- **Duration:** 11m
