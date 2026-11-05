---
id: "ddb6a3b7-e44f-43b6-8291-8f88de0916bd"
type: "task"
title: "allowlist-union applies only to list-shaped conflicts, never to lockfiles or code blocks"
slug: "allowlist-union-applies-only-to-list"
description: "Found by running task 23's classifier over this repository's real conflicting worktree branches on 2026-10-29. allowlist-union fires for any file whose conflicting hunks only add lines on both sides, so it offered a \"keep both\" union for:\n- pnpm-lock.yaml: a 942-line diff, on feat/sv-lang-pr1-wasm-runner;\n- .github/workflows/ci.yml and .gitattributes, on feat/sv-lang-pr8-terraform-structure;\n- TypeScript source: packages/web/src/server/routes-rex/items.ts (286 lines) and a viewer test, on fix/0100-smart-add-v2.\nUnioning two added code blocks or lockfile entries is a person's call; the class is meant for list-shaped conflicts such as packages/core/child-process-allowlist.json (a correct hit, 22 lines) or the route list in route-feature-gates.test.ts.\nAlso, a source conflict's \"also changed in\" list named up to 15 worktrees on one file, which floods the Workspaces expansion."
acceptanceCriteria:
  - "allowlist-union applies only when every line each side adds is one list entry (a JSON or JS array element, a YAML '- ' item, a quoted string with optional trailing comma); a hunk adding a code block, a function or a mapping is source (tested with both)"
  - "Lockfiles (pnpm-lock.yaml, package-lock.json, yarn.lock) are never allowlist-union; with no web.generatedFiles entry they are source (tested)"
  - "This repo's .n-dx.json declares pnpm-lock.yaml as generated with command [\"pnpm\", \"install\", \"--lockfile-only\"]"
  - "A temp-repo test with the route-feature-gates.test.ts shape (both sides add one array row after the same line) is still allowlist-union, and its diff keeps both rows"
  - "The Workspaces expansion names at most 3 other worktrees per source conflict and says how many more; the API keeps the full list (viewer test)"
priority: "high"
---
