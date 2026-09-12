---
id: "79132a2f-96d9-41f0-8eb9-28d4edf9de59"
level: "task"
title: "Cleanup from the #370 review: dedupe the adapter stamping block, share the porcelain path matcher, align next-task wording"
status: "completed"
priority: "low"
startedAt: "2026-09-12T10:17:17.958Z"
completedAt: "2026-09-12T10:28:20.118Z"
endedAt: "2026-09-12T10:28:20.118Z"
acceptanceCriteria: []
description: "Follow-up to PR #370 review (cleanup findings, no behaviour change). Do this after the correctness tasks in this epic.\n\n1. Six pasted copies of the preserveModifiedBy stamping block: asana-adapter.ts, jira-adapter.ts, github-projects-adapter.ts, notion-adapter.ts, folder-tree-store.ts (stampModified(merged, undefined, options?.preserveModifiedBy ? entry.item.lastModifiedBy : undefined)) and the stampModifiedFields variant in file-adapter.ts. Add one helper next to stampModified in packages/rex/src/core/sync.ts (e.g. stampUpdatedItem(existing, updates, options)) and call it from all six. The file-adapter copy already differs (optional-chained existing?.item).\n\n2. isDiscounted + normalize in packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts re-implement the matching in isHenchRuntimeArtifact (packages/hench/src/store/artifacts.ts): same normalisation, same trailing-slash directory rule, same repoPrefix-on-pattern rule. Extract one matcher in artifacts.ts and have both call it, so a fix to one cannot leave the pre-run and post-run gates disagreeing about the same porcelain line.\n\n3. commitPrdTreeIfStaged inlines a staged-file count that duplicates countStagedFiles in the same file (different timeout and no pathspec). Extend countStagedFiles with an optional pathspec and use it.\n\n4. packages/rex/src/core/next-task.ts ~line 487 prints 'all children completed, ready to finalize' using an inline completed||deferred check — the precise #364 misreport. Use SUCCESSFUL_CHILD_STATUSES or change the wording.\n\n5. packages/hench/src/agent/analysis/livelock.ts keeps a reported Set, a firstDetection and a per-call return to remember 'already fired'; every caller stops on the first detection, so a single fired field suffices.\n\nACCEPTANCE CRITERIA\n- No behaviour change: full rex and hench suites pass unchanged (no test expectations edited except for renamed helpers).\n- One changeset per package touched (@n-dx/rex, @n-dx/hench), patch."
lastModified: "2026-09-12T10:28:20.427Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
