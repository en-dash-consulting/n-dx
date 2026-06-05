---
id: "787fdfc1-ef04-45e9-a929-70730f5ea73f"
level: "task"
title: "Fix code in project-scaffold: cli-brand.js exists at both the repo root and inside packages/core, creating a d"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-17T15:22:45.611Z"
completedAt: "2026-04-17T15:30:03.296Z"
resolutionType: "code-change"
resolutionDetail: "Deleted root cli-brand.js (dead code, no importers). Updated ORCHESTRATION_PEERS in architecture-policy.test.js from \"cli-brand.js\" to \"packages/core/cli-brand.js\"."
acceptanceCriteria: []
description: "- cli-brand.js exists at both the repo root and inside packages/core, creating a duplication risk if one copy diverges silently during future edits."
recommendationMeta: "[object Object]"
---
