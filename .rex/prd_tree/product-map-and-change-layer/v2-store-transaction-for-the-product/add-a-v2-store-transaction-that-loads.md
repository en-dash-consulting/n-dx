---
id: "000328e7-4ac8-461d-a931-e286420db79f"
level: "task"
title: "Add a v2 store transaction that loads and writes the product and change layers under the PRD lock"
status: "completed"
priority: "high"
tags:
  - "pr-31"
  - "lane-rex-store"
  - "rex"
startedAt: "2026-10-08T20:26:23.972Z"
completedAt: "2026-10-08T21:45:54.362Z"
resolutionType: "code-change"
resolutionDetail: "Delivered by run d3e891fe (commits 034fecbb0, review repair 66426a641): withPrdModelTransaction in packages/rex/src/store/prd-model-transaction.ts with tests for the lock span, a waiting concurrent writer and the v1 refusal. That run failed only at the test gate (stale rex dist/ after the review repair; hench bug 7d3e9741). The isolation-test gap was closed by follow-up d3c20225 (run 0953a112, commit 6bc7a0708), whose gate passed. Completed by hand with Ryan's approval, 2026-10-08."
acceptanceCriteria:
  - "A v2 mutation run through the transaction holds the PRD lock for the whole load-mutate-write span (test)"
  - "A concurrent writer waits rather than dropping the other's change (test)"
  - "Calling it on a v1 tree is refused with a message naming the layout (test)"
description: "Found preparing PR 16 (2026-10-08). store.withTransaction is v1-only: it loads prd_tree/ and writes it back. writePrdModel requires the PRD lock to be held, but nothing in the store opens a transaction for a v2 tree. PR 16 therefore keeps selection (core/change-selection.ts) and completion/split/apply (core/change-completion.ts) pure: they return a new V2Tree and a result, and nothing writes it.\n\nNeeded before MCP or CLI can complete, split or apply a change on a v2 tree: a store API that takes the PRD lock, calls loadPrdModel, runs the caller's mutation on the model and writes it with writePrdModel, refusing a non-v2 tree. Store lane; PR 17 is the first caller, PR 18 the second.\n\nAcceptance criteria: a v2 mutation run through the new transaction holds the PRD lock for the whole load-mutate-write span (test); a concurrent writer waits rather than dropping the other's change (test); calling it on a v1 tree is refused with a message naming the layout (test)."
lastModified: "2026-10-08T21:45:54.626Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
