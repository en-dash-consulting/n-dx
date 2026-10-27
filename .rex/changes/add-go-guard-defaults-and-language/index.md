---
id: "fcfc2e7c-270b-4367-949e-59992caf6766"
type: "change"
title: "Add Go guard defaults and language-aware config to Hench"
slug: "add-go-guard-defaults-and-language"
intent: "Modify `packages/hench/src/schema/v1.ts` and `packages/hench/src/schema/templates.ts` so that when a Go project is detected (go.mod present or language config is \"go\"), `allowedCommands` defaults to `[\"go\", \"make\", \"git\", \"golangci-lint\"]` and `blockedPaths` includes `\"vendor/**\"`. JS/TS project defaults remain unchanged. Detection should use the sourcevision language registry or go.mod presence check during `hench init`."
acceptanceCriteria:
  - "Go projects get allowedCommands including \"go\", \"make\", \"git\", \"golangci-lint\""
  - "Go projects get \"vendor/**\" in blockedPaths"
  - "JS/TS projects get the existing default allowedCommands unchanged"
  - "hench init detects Go projects and applies Go-appropriate defaults"
  - "The guard validates Go commands (go test, go build, make lint) as allowed for Go projects"
  - "Existing JS/TS guard behavior is unchanged"
amends: [{"target":"8ae4d60a-f66a-40aa-afd7-dac7562ec263","delta":"modified","summary":"Add Go guard defaults and language-aware config to Hench","base":"35095ea7bcb7ca56a9222ffa6a5b2b794bfbde0b9bd4698e9bc0ab3f364e9a44"}]
priority: "high"
tags:
  - "hench"
  - "go"
  - "guard"
  - "config"
source: "smart-add"
---
