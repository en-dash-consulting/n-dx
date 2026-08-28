---
id: "bb55952e-1fb1-41bf-9875-d6daf3a5b288"
level: "task"
title: "Address pattern issues (4 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T00:50:08.593Z"
completedAt: "2026-03-07T00:56:25.870Z"
acceptanceCriteria: []
description: "- E2E suite has zero source-level coupling but a hidden build-time dependency on all packages; CI must enforce a build step before e2e execution. This should be documented or enforced via a pre-test script to prevent silent false-negatives when a package fails to compile.\n- The runtime-state zone is a shared mutable sink readable by both rex and hench packages without creating import-graph coupling — this is an intentional design but concurrent write safety is implicit; documenting the write-access protocol would prevent future race conditions.\n- Absence of an index/facade module means task-usage-tracking has no encapsulated public surface; consumers couple directly to internal service files, weakening the zone boundary.\n- Build scripts (build.js, dev.js) in this zone operate at the package boundary but are grouped with UI components (elapsed-time.ts, task-audit.ts) — splitting into a pure build-config group and a reusable-components group would clarify which files are tooling versus production API surface."
recommendationMeta: "[object Object]"
---
