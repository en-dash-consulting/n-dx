---
id: "2211ed70-5738-4ae2-a57b-a8e0baa41950"
level: "task"
title: "Add dashboard preflight cards, new Run buttons and labelled terminal-only rows on Commands"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "command-transparency"
  - "pr-25"
blockedBy:
  - "38679536-98a9-4236-b92d-b4500e4b08f3"
  - "84e55e78-95c8-445f-aa85-e144ef097cef"
source: "caos work management: WM-2126 (Add dashboard preflight cards, new Run buttons and labelled terminal-only rows on Commands); 0.8.0 planning, PR 25 · Job tray and dashboard preflight cards"
acceptanceCriteria:
  - "Every runnable command shows a preflight card before it runs."
  - "The listed commands have working Run buttons; sourcevision reset requires confirmation."
  - "Terminal-only commands appear as labelled rows, not buttons."
description: "Show each command's declared effects as a preflight card with Run and Cancel. Add Run buttons for status, next, tree, report, verify, prd export, prd import, an auth re-check and a confirm-gated sourcevision reset. Commands that stay terminal-only (init, start, dev, pair-programming, bicker) say so in their row instead of showing an inert button.\n\nImplementation notes: Extend packages/web/src/viewer/views/commands.ts and server/routes-commands.ts; route every run through the shared job tray. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
