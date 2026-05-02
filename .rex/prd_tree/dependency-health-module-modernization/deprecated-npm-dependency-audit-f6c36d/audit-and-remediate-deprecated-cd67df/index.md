---
id: "cd67dfc1-0053-43fd-8e4f-1722d6b6a982"
level: "task"
title: "Audit and remediate deprecated npm dependencies across all monorepo packages"
status: "completed"
priority: "high"
tags:
  - "dependencies"
  - "audit"
  - "upgrade"
  - "security"
source: "smart-add"
startedAt: "2026-04-08T22:08:34.925Z"
completedAt: "2026-04-08T22:59:35.957Z"
acceptanceCriteria:
  - "pnpm audit output reviewed and all deprecation notices catalogued across all six packages"
  - "Each deprecated direct dependency has either been replaced or has a documented justification for deferral"
  - "Transitive-only deprecations are noted separately with no action required unless they surface a CVE"
  - "No direct dependency in any package.json resolves to an npm-deprecated package"
  - "pnpm audit reports zero high/critical advisories after upgrades"
  - "Full monorepo test suite (pnpm test) passes with no new failures introduced by replacements"
  - "Any breaking API changes in upgraded packages are handled at all call sites within the monorepo"
description: "Run pnpm audit and inspect each package.json for npm packages marked as deprecated, unmaintained, or superseded across packages/core, packages/rex, packages/hench, packages/sourcevision, packages/llm-client, and packages/web. Produce a prioritized remediation list distinguishing direct from transitive hits and flagging CVEs, then execute: upgrade packages with semver-compatible replacements, swap deprecated packages for their published successors, and update all call sites where replacement APIs have changed. Verify the full test suite passes after each replacement."
---

# Audit and remediate deprecated npm dependencies across all monorepo packages

🟠 [completed]

## Summary

Run pnpm audit and inspect each package.json for npm packages marked as deprecated, unmaintained, or superseded across packages/core, packages/rex, packages/hench, packages/sourcevision, packages/llm-client, and packages/web. Produce a prioritized remediation list distinguishing direct from transitive hits and flagging CVEs, then execute: upgrade packages with semver-compatible replacements, swap deprecated packages for their published successors, and update all call sites where replacement APIs have changed. Verify the full test suite passes after each replacement.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** dependencies, audit, upgrade, security
- **Level:** task
- **Started:** 2026-04-08T22:08:34.925Z
- **Completed:** 2026-04-08T22:59:35.957Z
- **Duration:** 51m
