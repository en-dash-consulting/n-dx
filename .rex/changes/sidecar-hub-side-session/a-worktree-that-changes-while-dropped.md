---
id: "255ac873-9d63-4e5f-988a-9955cf807a00"
type: "task"
title: "A worktree that changes while dropped for the snapshot cap shows Δ when it reappears"
slug: "a-worktree-that-changes-while-dropped"
description: "Deferred review finding from run 8e4c3a86 (T1, a5beb47d) at packages/web/src/server/sidecar/hub-snapshot.ts:370. Over the 8k cap, buildHubSnapshot drops low-priority items but still records their new fingerprints, so an item that changed while dropped renders without Δ when it next fits."
acceptanceCriteria:
  - "For each item dropped for the cap, buildHubSnapshot keeps the previous build's fingerprint (or none, if it had none), so the first build that shows the item again marks it Δ when it changed since it was last shown"
  - "A unit test builds over the cap with a changed low-priority worktree dropped, then under the cap with no further change, and the worktree carries Δ; an unchanged dropped item carries none"
priority: "medium"
source: "review"
---
