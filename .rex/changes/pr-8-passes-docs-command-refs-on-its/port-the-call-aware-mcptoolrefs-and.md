---
id: "eae785d9-e20f-4247-92a5-2c04c91fbc91"
type: "task"
title: "Port the call-aware mcpToolRefs and the call-form PHP docs from c9ad315f1"
slug: "port-the-call-aware-mcptoolrefs-and"
summary: "Brings the reviewed fix for the documentation check into this part of the PHP work."
description: "Port from c9ad315f1:\n- the `tests/e2e/docs-command-refs.test.js` hunks: the `(?!\\()` lookahead in `mcpToolRefs`, its doc comment, and the test \"reads a name written as a call as a function, not a tool\";\n- the `docs/packages/sourcevision.md` hunks for the bullets this PR has (**Outbound calls**, **Legacy constructs**): function names written as calls (`get_headers()`). Leave the **Dynamic code** and **Database-driven dynamic code** bullets to PR 10.\nTests from the repository root: `npx vitest run tests/e2e/docs-command-refs.test.js` (it needs built packages: run `pnpm build` first if `packages/*/dist` is missing or stale)."
acceptanceCriteria:
  - "docs-command-refs passes"
  - "The ported lines match c9ad315f1's"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
