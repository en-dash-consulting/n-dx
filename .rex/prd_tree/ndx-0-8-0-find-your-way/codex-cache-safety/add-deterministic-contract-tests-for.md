---
id: "75ddf4d1-c7f8-4a9e-a439-0f0b15310ed8"
level: "task"
title: "Add deterministic contract tests for Codex session resume that run in CI without credentials"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "codex-cache-safety"
  - "pr-19"
blockedBy:
  - "0c437e81-6092-45e7-a5dd-358d2c662184"
source: "caos work management: WM-2150 (Add deterministic contract tests for Codex session resume that run in CI without credentials); 0.8.0 planning, PR 19 · Codex cache safety"
startedAt: "2026-09-28T21:59:05.159Z"
acceptanceCriteria:
  - "An eligible chain resumes exactly once with the expected arguments (test)."
  - "An unsafe chain never reaches the spawned command (test)."
  - "The contract tests run in CI without credentials."
description: "Prove that an eligible chain resumes exactly once with the expected arguments and an unsafe chain never reaches the spawned command.\n\nImplementation notes: Use a fake codex binary fixture in packages/hench/tests to capture spawn arguments; no network or credentials. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-28T21:59:05.981Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
