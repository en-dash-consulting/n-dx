---
id: "ad842166-7ac1-4875-bac8-e5f55ea18402"
level: "task"
title: "Chain layout and schema steps in ndx migrate and refuse legacy projects"
status: "pending"
priority: "high"
tags:
  - "pr-23"
  - "lane-migration"
  - "rex"
  - "core"
blockedBy:
  - "11c88bce-4e63-4e56-b0b8-041232f0a21a"
source: "roadmap"
acceptanceCriteria:
  - "A legacy fixture migrates with one command"
  - "PRD commands on a v1 project keep working and print one deprecation notice naming ndx migrate (refusal comes one release later)"
  - "ndx init creates a v2 project"
description: "ndx migrate runs versioned steps (layout to .ndx, then schema to v2: plan, then apply) as links in a chain, so a later schema step is one more link. On a v1 project every PRD command keeps working and prints one deprecation line naming ndx migrate; refusal comes one release later (D5). ndx init scaffolds a v2 project (product/index.md), and never prd_tree/.\n\nState on this branch (C2): `ndx migrate --plan` and `ndx migrate --apply [--plan <path>] [--dry-run]` exist in packages/core/cli.js and spawn `rex migrate`. The layout step is `ndx migrate-layout` (packages/core/migrate-layout.js). Chain them so a bare `ndx migrate [dir]` runs layout (if needed), then plan, then apply, each step a versioned link a later schema step can extend; the explicit --plan/--apply forms keep working. The deprecation notice is one line on stderr, printed once per command on a v1 tree (prd_tree/ present, no product/), naming `ndx migrate`; keep it out of --format=json stdout and --quiet. Keep edits to rex's shared CLI files (cli/index.ts, errors.ts) to the smallest hook: another stack is changing store resolution and CLI error mapping there.\n\nIf packages/core/command-effects.js or help.js changes, regenerate docs/cli-ui-gap.md with `node scripts/build-cli-ui-gap.mjs` in the same commit (tests/e2e/cli-ui-gap-drift.test.js fails otherwise; that cost 1c70426e two gate failures). Also run the root e2e drift tests before finishing.\n\nFirst pass (decided 2026-10-12; v2 migration path, decisions D1-D7):\n- Every v1 item lands in v2, checked by count and id. The migration drops or cancels nothing.\n- Changes the rules placed land on their capability. Changes the rules could not place (held) land in the Inbox with needsPlacement, in changes/inbox/. A text-model pick is recorded as a suggestion only.\n- Areas keep their v1 epic names, except a review-sourced epic (source \"ndx-adversarial-review\"), which proposes no area (#631 finding 1). Its children are placed or held like other changes.\n- Capability specs ship as drafted and stay flagged as unreviewed.\n- The cut is recorded as the first change, as 11c88bce describes.\n- Apply removes prd_tree/ and tree-meta.json in the same PRD transaction that writes the v2 tree, so the two layouts never exist side by side.\n- No decisions file and no area-renaming pass: those come after the cut.\n\nBoundary (stack C, roadmap PR 23):\n- Lane files: packages/rex/src/migrations/; one new rex CLI command for plan and apply, in its own module under packages/rex/src/cli/commands/ plus one dispatch line in packages/rex/src/cli/ (keep edits to the shared CLI files minimal: another stack is changing rex's store resolution and CLI error mapping in the same files, so a merge conflict is expected later); store/prd-model-writer.ts (c0dc9b3f); core/change-add.ts or the Inbox writer (2898acbe); packages/core for ndx migrate (spawn only, no library imports) and ndx init; tests.\n- Not hench, not web, not the v2 schema shape (schema/v2.ts), and not the MCP tools.\n- v1 trees keep working exactly as today, apart from the one-line deprecation notice in ad842166.\n- Each newly wired module that imports a v2 module is added to the v2 isolation allowlist in packages/rex/tests/unit/schema/v2.test.ts."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T09:13:44.083Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
