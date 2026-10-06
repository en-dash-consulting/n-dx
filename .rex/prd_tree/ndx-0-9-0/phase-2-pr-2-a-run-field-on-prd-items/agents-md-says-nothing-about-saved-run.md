---
id: "20bcdbdd-c3e1-418f-b253-c03c1bfd7794"
level: "task"
title: "AGENTS.md says nothing about saved run settings, so Codex never learns a task can carry them"
status: "pending"
priority: "medium"
tags:
  - "docs"
  - "assistant-assets"
  - "core"
  - "task-prep"
  - "0.9.0"
acceptanceCriteria:
  - "renderAgentsMd() emits a Rex bullet describing the run block on add_item/edit_item (replace semantics, null removes) without claiming ndx work applies it"
  - "The root AGENTS.md is regenerated from renderAgentsMd() and its diff is only the new bullet"
  - "A root e2e test asserts the rendered AGENTS.md mentions the run block"
  - "A patch changeset for @n-dx/core exists"
description: "**This task is part of PR 2 of 4** (Prepare task phase 2: the `run` field). Requested by Ryan on 2026-10-06.\n\n## Why\nRyan's rule: assistant-facing documentation must reach AGENTS.md (read by Codex and other assistants), never only CLAUDE.md. PR 2 added the `run` argument to the `add_item` / `edit_item` lines in packages/core/assistant-assets/project-guidance.md, which flows into CLAUDE.md, but AGENTS.md never shows it:\n- `renderAgentsMd()` in packages/core/assistant-assets.js (~:420) filters project-guidance's \"MCP Servers\" section out (`filterSections(..., new Set([\"MCP Servers\", \"Development Workflow\"]))`, ~:426).\n- Its own MCP section lists tool NAMES only, from the manifest (~:470-500).\nSo nothing in AGENTS.md tells an assistant that a task can carry saved run settings.\n\n## What to do\n1. In `renderAgentsMd()`, in the hard-coded \"## When to Use Each Server\" → **Rex** bullet list (~:500-510, after \"Update task status as you work\"), add one bullet:\n   `- Save how a task should run — model, provider, review, permission mode, test gate, turn and token budgets, notes for the agent (\\`add_item\\` / \\`edit_item\\` with a \\`run\\` block; an object replaces the whole block, \\`null\\` removes it)`\n   Do NOT say that `ndx work` applies these settings: that lands in PR 3, whose docs task extends this wording.\n2. Regenerate the root AGENTS.md from the generator, without running `ndx init` (which rewrites other files):\n   `node -e \"import(process.cwd()+'/packages/core/assistant-assets.js').then(m=>require('fs').writeFileSync('AGENTS.md', m.renderAgentsMd()))\"`\n   The checked-in AGENTS.md matched `renderAgentsMd()` byte-for-byte on 2026-10-06, so `git diff AGENTS.md` must show only the new bullet. If it shows more, stop and report it rather than committing unrelated drift.\n3. Add an assertion that the rendered AGENTS.md mentions the `run` block (e.g. in tests/e2e/codex-integration.test.js next to the \"When to Use Each Server\" check at ~:150, or in codex-artifact-validation.test.js).\n4. This changes the AGENTS.md that `ndx init` writes into every user project, which is intended. Patch changeset for @n-dx/core saying so in user terms.\n\n## Operator note\nCommands are pre-approved only when they START with npx, node, npm, git or vitest. Never prefix a command with `cd … &&`. From the project root, run:\n- `npx vitest run tests/e2e/codex-integration.test.js tests/e2e/codex-artifact-validation.test.js tests/e2e/instruction-alignment.test.js tests/e2e/assistant-integration.test.js` for the assistant-file tests;\n- `npx vitest run tests/e2e tests/integration` for all root policy tests.\nAdd a patch changeset for @n-dx/core (scoped name)."
lastModified: "2026-10-06T15:09:30.859Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
