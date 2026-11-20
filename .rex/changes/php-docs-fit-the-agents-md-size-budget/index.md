---
id: "2791860e-20d2-43b8-a2df-665ee467fc28"
type: "change"
title: "PHP docs fit the AGENTS.md size budget and the docs tool-name check"
slug: "php-docs-fit-the-agents-md-size-budget"
summary: "Two repository checks fail on the PHP stack because of documentation: the PHP pack's assistant notes grew past the size an assistant reads in full, and one docs line names a folder in a way the docs check mistakes for a tool name. Fixing the text makes both checks pass."
intent: "Found while restacking the PHP PR stack onto main (2026-11-17); both failures enter in PR 13 (change c105a2c0) and CI never ran there.\n\n1. `tests/e2e/agents-md-size-budget.test.js`: Codex reads the root AGENTS.md (20,323 bytes) and a package's AGENTS.md as one chain, budget 30,720 bytes. `packages/lang-php/AGENTS.md` is 10,938 bytes at PR 13 (10,379 at PR 12), so its chain is 31,261, over by 541. `packages/sourcevision/AGENTS.md` (10,364) leaves its chain only 33 bytes of headroom, which PR 14 (change 901e0556) needs.\n2. `tests/e2e/docs-command-refs.test.js` (\"every MCP tool name is registered by a built server\"): `docs/packages/sourcevision.md` (the third-party fingerprint bullet, about line 332) writes the folder name `edit_area` as a code span; `mcpToolRefs` reads snake_case code spans whose first word is a tool verb (`edit`, from `edit_item`) as MCP tool names, so it reports `edit_area`."
acceptanceCriteria:
  - "tests/e2e/agents-md-size-budget.test.js passes with at least 1,024 bytes of headroom on the lang-php and sourcevision chains"
  - "tests/e2e/docs-command-refs.test.js passes without changing the test"
  - "No guidance is lost: detail moved out of an AGENTS.md lands in docs/ and is linked"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"c105a2c0-92f5-4e2f-ad3f-9e6a913d75d3"}
tags:
  - "lang-php"
  - "sourcevision"
  - "docs"
  - "ci"
  - "php-pr13"
---
