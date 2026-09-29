---
id: "84e55e78-95c8-445f-aa85-e144ef097cef"
level: "task"
title: "Run every async dashboard job through one shared job tray with phase, elapsed and Stop"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-25"
source: "caos work management: WM-2125 (Run every async dashboard job through one shared job tray with phase, elapsed and Stop); 0.8.0 planning, PR 25 · Job tray and dashboard preflight cards"
startedAt: "2026-09-29T17:40:48.113Z"
acceptanceCriteria:
  - "One job tray shows every async job across Commands, Overview and Suggestions, each with a working Stop."
  - "Per-view pollers for those jobs are removed."
  - "A finished job shows a result card linking to its output."
description: "Replace the per-view pollers with one shared tray that shows each async job's phase and elapsed time with a working Stop, and a result card linking to what the job produced.\n\nImplementation notes: Build on packages/web/src/viewer/components/active-operations-tray.ts and hooks/use-active-operations.ts; replace the pollers in views/commands.ts, views/overview.ts and views/suggestions.ts. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-29T17:40:48.939Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
