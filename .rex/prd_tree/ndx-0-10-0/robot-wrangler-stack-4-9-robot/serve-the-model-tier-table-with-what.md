---
id: "8986a809-6174-413f-a1a5-fdd14cd6fb76"
level: "task"
title: "Serve the model tier table, with what each tier is used by, from GET /api/llm/config"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-4"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "GET /api/llm/config returns agent, standard, light and heavy rows (and free only when configured), each with the model resolveTaskModel resolves and the key that supplied it."
  - "A project with `llm.routes[\"prd.rename\"] = \"heavy\"` lists rename under heavy, not light."
  - "A test fails when DEFAULT_ROUTES gains a task class with no label."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Add `tiers` to `GET /api/llm/config` for the active vendor: an array of rows `{ tier: \"agent\" | \"standard\" | \"light\" | \"heavy\" | \"free\", model: string, source: string, usedBy: Array<{ taskClass: string, label: string }> }`.\n\n- **agent**: the effective agent model, from `hench.models.<vendor>` when set (what the `effective` block already resolves).\n- **standard**, **light**, **heavy**: each `model` is exactly what llm-client's `resolveTaskModel` resolves for that tier, and `source` names the key that supplied it (`llm.claude.model`, `llm.claude.lightModel`, `llm.tiers.claude.heavy`, or `catalog default`).\n- **free**: included only when `llm.tiers.<vendor>.free` is configured.\n\nFill `usedBy` by grouping llm-client's `DEFAULT_ROUTES`, overlaid with the project's `llm.routes`, by the tier each task class resolves to. Agent is `ndx work`. Heavy also lists \"tasks set to Heavy in Prepare task\". Labels come from a web-side map from task class to user-facing name, for example `agent.execute` → `ndx work`, `prd.propose` → `ndx plan`, `prd.smart-add` → `ndx add`, `sourcevision.ask` → `Ask`, `zone.enrich-deep` → `deep analyze`, `zone.enrich-scan` → `analyze (scan)`, `git.commit-message` → `commit messages`, `context.summarize` → `summaries`, `prd.rename` / `prd.merge` → `rename/merge`, `code.classify` → `classify`. Add a test that fails when a `DEFAULT_ROUTES` key has no label."
lastModified: "2026-10-10T23:40:25.954Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
