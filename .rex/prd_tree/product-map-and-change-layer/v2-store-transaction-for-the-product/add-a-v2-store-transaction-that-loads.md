---
id: "000328e7-4ac8-461d-a931-e286420db79f"
level: "task"
title: "Add a v2 store transaction that loads and writes the product and change layers under the PRD lock"
status: "pending"
priority: "high"
tags:
  - "pr-31"
  - "lane-rex-store"
  - "rex"
acceptanceCriteria:
  - "A v2 mutation run through the transaction holds the PRD lock for the whole load-mutate-write span (test)"
  - "A concurrent writer waits rather than dropping the other's change (test)"
  - "Calling it on a v1 tree is refused with a message naming the layout (test)"
description: "Found preparing PR 16 (2026-10-08). store.withTransaction is v1-only: it loads prd_tree/ and writes it back. writePrdModel requires the PRD lock to be held, but nothing in the store opens a transaction for a v2 tree. PR 16 therefore keeps selection (core/change-selection.ts) and completion/split/apply (core/change-completion.ts) pure: they return a new V2Tree and a result, and nothing writes it.\n\nNeeded before MCP or CLI can complete, split or apply a change on a v2 tree: a store API that takes the PRD lock, calls loadPrdModel, runs the caller's mutation on the model and writes it with writePrdModel, refusing a non-v2 tree. Store lane; PR 17 is the first caller, PR 18 the second.\n\nAcceptance criteria: a v2 mutation run through the new transaction holds the PRD lock for the whole load-mutate-write span (test); a concurrent writer waits rather than dropping the other's change (test); calling it on a v1 tree is refused with a message naming the layout (test)."
lastModified: "2026-10-08T18:56:22.479Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
