---
id: "f620332f-3247-4feb-9d05-251e5ac4f7fc"
level: "task"
title: "Add reviewMode and reviewVendor to rex's run block, CLI flags, and hench's per-task precedence"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-9"
blockedBy:
  - "d2d48473-3e07-4ec5-b167-6ba0bd370be2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "A run block with reviewMode pair and reviewVendor codex round-trips through the tree (schema test) and add_item/edit_item accept it."
  - "`ndx work --task=<id> --resolve` reports the saved values with source task.run, and the CLI flags override them."
  - "A saved reviewVendor equal to the executor is skipped with a warning and the run continues."
  - "A changeset carries the release-note entry."
  - "`pnpm --filter @n-dx/rex test` and the package typecheck pass."
  - "`pnpm --filter @n-dx/hench test` passes."
description: "**Schema:** add `reviewMode?: \"off\" | \"self\" | \"pair\"` and `reviewVendor?: \"claude\" | \"codex\"` to the `run` block in rex's schema and validation (`packages/rex/src/schema/v1.ts`, `validate.ts`). Update the `add_item` / `edit_item` MCP tool descriptions (`packages/rex/src/cli/mcp-tools/`) and `rex` help.\n\n**Flags** (UI-CLI parity): add `--review-mode=<off|self|pair>` and `--reviewer=<claude|codex>` to hench's run options (`run-resolve.ts`) and to the shared run-option allow-list (`packages/web/src/shared/run-options.ts`).\n\n**Precedence** in `packages/hench/src/cli/commands/run-settings.ts`: CLI flag, then the task's `run`, then `hench.review.*`, then the default.\n\n**Bad saved values:** a saved value the run cannot honour (a reviewer equal to the executor, or one with no CLI) is skipped with a warning and never stops a loop, matching the existing saved-setting rules.\n\n**Resolve output:** `ndx work --task=<id> --resolve` shows both with source `task.run`.\n\n**Release note:** add a changeset entry worded for the 0.10.0 release notes: \"the run block gains reviewMode and reviewVendor; add_item and edit_item accept them\"."
lastModified: "2026-10-10T23:41:41.227Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
