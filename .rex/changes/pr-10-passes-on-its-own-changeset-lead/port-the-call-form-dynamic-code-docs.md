---
id: "844b186b-7589-484e-954e-32eaf9a8eadb"
type: "task"
title: "Port the call-form Dynamic code docs bullets from c9ad315f1"
slug: "port-the-call-form-dynamic-code-docs"
summary: "Writes PHP function names in two docs bullets as calls, so the docs check stops mistaking them for tool names."
description: "Apply the `docs/packages/sourcevision.md` hunks of c9ad315f1 for the **Dynamic code** and **Database-driven dynamic code** bullets, verbatim. Test from the root: `npx vitest run tests/e2e/docs-command-refs.test.js` (run `pnpm build` first if `packages/*/dist` is missing or stale)."
acceptanceCriteria:
  - "The two bullets match c9ad315f1's"
  - "docs-command-refs passes"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
