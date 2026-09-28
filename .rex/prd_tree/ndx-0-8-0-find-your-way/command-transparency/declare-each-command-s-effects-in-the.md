---
id: "38679536-98a9-4236-b92d-b4500e4b08f3"
level: "task"
title: "Declare each command's effects in the core command manifest and regenerate cli-ui-gap.md from it"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-22"
source: "caos work management: WM-2122 (Declare each command's effects in the core command manifest and regenerate cli-ui-gap.md from it); 0.8.0 planning, PR 22 · Command effects manifest and terminal preflight"
acceptanceCriteria:
  - "Every command in the manifest has an effects declaration (test fails on a command without one)."
  - "docs/cli-ui-gap.md regenerated from the manifest shows no command without one."
  - "/api/commands/manifest returns the declarations unchanged from core."
description: "Extend the manifest served at /api/commands/manifest so every command declares its effects once: what it reads, what it writes (analysis output, PRD tree, source files, or nothing), which phases call an LLM with which model and roughly how many calls, what network it touches, and a duration hint. The source of truth lives in core beside the help registry so the CLI and the server read the same object.\n\nImplementation notes: Put the declarations beside the help registry in packages/core/help.js and serve them through packages/web/src/server/routes-commands.ts; the web server must read the object without importing core at runtime in a way that breaks the tier rules, so follow the existing manifest path. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
