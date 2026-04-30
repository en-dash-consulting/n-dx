---
id: "8af32cae-af63-4d0f-a1c7-2a6f9e34a3a5"
level: "task"
title: "Implement dependency audit step in self-heal pipeline"
status: "completed"
priority: "high"
tags:
  - "self-heal"
  - "dependencies"
  - "audit"
source: "smart-add"
startedAt: "2026-04-14T19:39:02.939Z"
completedAt: "2026-04-14T19:48:08.585Z"
acceptanceCriteria:
  - "Runs before the analyze–recommend–execute loop begins"
  - "Detects unused dependencies in each workspace package via depcheck or equivalent"
  - "Detects outdated patch and minor versions via pnpm outdated"
  - "Detects known vulnerabilities via pnpm audit"
  - "Produces a structured JSON summary stored under a 'dependencyAudit' key in the run artifact"
  - "Does not modify any files — audit only in this step"
  - "Audit step is skippable via a --skip-deps flag on ndx self-heal"
description: "Add a pre-loop dependency audit that scans all monorepo workspace package.json files using depcheck (or equivalent) and pnpm audit. The step produces a structured report of unused, outdated, and vulnerable packages grouped by workspace package. This report feeds into the cleanup step and is stored in the run artifact for dashboard visibility. No files are modified during this step."
---

# Implement dependency audit step in self-heal pipeline

🟠 [completed]

## Summary

Add a pre-loop dependency audit that scans all monorepo workspace package.json files using depcheck (or equivalent) and pnpm audit. The step produces a structured report of unused, outdated, and vulnerable packages grouped by workspace package. This report feeds into the cleanup step and is stored in the run artifact for dashboard visibility. No files are modified during this step.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** self-heal, dependencies, audit
- **Level:** task
- **Started:** 2026-04-14T19:39:02.939Z
- **Completed:** 2026-04-14T19:48:08.585Z
- **Duration:** 9m
