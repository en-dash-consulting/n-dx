---
id: "8c88933a-a1f3-4799-a106-0c316e98a20c"
level: "task"
title: "Correct the concepts pages on apply, Changing, steward enforcement and the evidence path"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "The glossary's Apply example is an added or modified amendment; #473 remains the example of computed health and history"
  - "The Changing rule covers an unapplied amendment, including a completed change awaiting review or release apply, and excludes cancelled changes"
  - "stewards.md scopes the code-owner guarantee to the complete apply mode and says where steward review happens when apply is deferred"
  - "The evidence row uses .ndx/hench/runs/"
  - "npx vitepress build docs passes and no page uses \"map\" for the product layer"
description: "From the PR #590 review (ryrykeith, 2026-10-08, commit fb5468f08). Four should-fix documentation correctness findings in docs/guide/concepts/. Docs only: change no package source, tests or generated files.\n\n1. glossary.md:17, Apply example. The Apply row uses #473, which these pages define as a touches-only fix; a touches-only fix writes nothing under product/ and is never applied (changes-and-apply.md). Use an added or modified amendment as the Apply example, and keep #473 as the example of computed health and history.\n2. glossary.md:29, Changing. With rex.applyOn review or release, a change can be completed while its amendment still awaits apply, and the capability stays changing (changes-and-apply.md:49 says so). State that a capability is Changing while an amendment to it is unapplied, including completed changes awaiting review or release apply, and not for cancelled changes.\n3. stewards.md:23, code-owner enforcement. \"Every amendment appears as product/ edits in the PR\" holds only for the default `complete` apply mode. With `review` the apply may land in a later PR, and with `release` it waits for publication, so the original change PR can contain no product-layer edits and a product/ CODEOWNERS rule will not gate it. Scope the guarantee to complete mode and say where steward review happens when apply is deferred (the PR that carries the apply).\n4. index.md:13, evidence path. The table uses the 1.0.0 .ndx/ layout for both PRD layers but sends readers to the legacy .hench/runs/. On the .ndx layout run records live in .ndx/hench/runs/ (resolveLayout mode ndx gives .ndx/hench; resolveHenchPaths puts runs under it). Use .ndx/hench/runs/, and label the legacy path separately only if needed.\n\nInputs: the design excerpt at .run-logs/pr28-design-reference.md (gitignored, never commit it) and packages/rex/src/schema/v2.ts; main wins where they disagree. Never use \"map\" for the product layer. Run `npx vitepress build docs` (not pnpm; the sandbox allows only npm, npx, node, git, tsc and vitest) and commit only after it passes."
lastModified: "2026-10-08T17:13:15.473Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
