---
id: "51a8aed3-0098-43e1-9f84-87c080ababdd"
level: "feature"
title: "Review follow-ups for the product layer work"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "follow-ups"
source: "roadmap"
acceptanceCriteria: []
description: "Home for items captured by review passes and runs on the product layer roadmap that are not needed to finish the PR they came from. Captures left under a roadmap feature keep that feature pending, and every feature that depends on it stays blocked, which is what happened after the first overnight wave. Move such items here (rex move <id> --parent=<this feature>) and tag them with the pr-NN they came from. Nothing depends on this feature. Work them as small PRs of their own, or fold one into a later roadmap PR that touches the same files."
lastModified: "2026-10-06T16:54:38.582Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Bitbucket token patterns in redact.ts are tested only against samples built from the patterns themselves](./bitbucket-token-patterns-in-redact-ts.md) | pending |
| [.claude/rules accepts any new policy file with a table; only *-injection-seams.md names are blocked](./claude-rules-accepts-any-new-policy.md) | pending |
| [Codex drops most of packages/web/AGENTS.md: root plus nested AGENTS.md exceeds its 32 KiB combined project-doc budget](./codex-drops-most-of-packages-web.md) | pending |
| [Codex never sees the per-package governance or the path-scoped rules, because they live only in Claude-loaded files](./codex-never-sees-the-per-package.md) | pending |
| [Defer the PRD timeline view and re-scope it to the Changes view](./defer-the-prd-timeline-view-and-re.md) | pending |
| [Install the sv analyze stop handlers before the progress file says running](./install-the-sv-analyze-stop-handlers.md) | in_progress |
| [Nothing stops AGENTS.md growing past Codex's 32 KiB project-doc limit, where Codex silently drops the tail](./nothing-stops-agents-md-growing-past.md) | pending |
| [Rex MCP tool access kinds are unpinned, so a write tool can flip to read and escape #499 write refusal](./rex-mcp-tool-access-kinds-are-unpinned.md) | pending |
| [Stop the timed-out test gate test racing its fake gate startup](./stop-the-timed-out-test-gate-test.md) | pending |
| [Web Product view still shows "map node" wording after decision N1](./web-product-view-still-shows-map-node.md) | pending |
