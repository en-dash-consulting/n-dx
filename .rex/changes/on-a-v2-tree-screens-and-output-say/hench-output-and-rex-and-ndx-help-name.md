---
id: "03b49289-cca0-4880-a0ad-235b80a2088c"
type: "task"
title: "hench output and rex and ndx help name a change as a change on a v2 tree"
slug: "hench-output-and-rex-and-ndx-help-name"
description: "CLI words: hench prints \"Task: <title>\" even for a task-less change (packages/hench/src/agent/lifecycle/task-display.ts:32-35); print \"Change: <title> (runs as one task)\" for one and \"Task: <title> (in change <title>)\" for a task. ndx work help (packages/core/help.js:1019-1030) says --task targets \"a specific Rex task ID\": say it accepts a task or a change that runs as one task, and list --mine and --tags, which only hench help shows (packages/hench/src/cli/help.ts:44-47). rex help (packages/rex/src/cli/help.ts:75-78) describes next as \"the next actionable task\": say task or change. rex next's empty-PRD hint (packages/rex/src/cli/commands/next.ts:40) suggests rex add epic: on v2 suggest rex add with a title. The adversarial reviewer prompt (packages/hench/src/agent/analysis/adversarial-review.ts:438-450) says \"Capture as a PRD task with add_item\": on v2 say it lands as an Inbox change. If prompt text changes, regenerate the prompt census in its own commit after the code commit (census --write refuses a dirty tree). Keep the help-text parity tests green. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "hench prints Change: for a task-less change and names the change for a task (hench test)"
  - "ndx work, rex next and rex help text say task or change (help parity tests)"
  - "rex next's empty v2 hint does not mention epic (rex test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
