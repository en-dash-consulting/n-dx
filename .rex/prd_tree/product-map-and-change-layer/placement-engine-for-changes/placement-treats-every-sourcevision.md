---
id: "d0e81205-795f-4c37-b2e4-456a513b4c9c"
level: "task"
title: "Placement treats every sourcevision-sourced change as a code-health finding"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A change with source \"sourcevision\" that is a zone-derived feature (no finding marker) and asks for new behaviour gets relation \"amends\" and no code-health boost"
  - "A finding-derived change (from rex recommend or rex analyze findings) still gets relation \"touches\" and the architecture-constraint boost"
  - "Unit tests in packages/rex/tests/unit/core/placement.test.ts cover both cases"
description: "Verdict: should-fix (medium). Found by the adversarial review of 2fa34877.\n\nScenario: `rex analyze` emits zone features (`kind: \"feature\"`, `source: \"sourcevision\"`, scanners.ts:608) and category epics (scanners.ts:755) as well as findings. `isCodeHealthChange` (packages/rex/src/core/placement.ts, `change.source === CODE_HEALTH_SOURCE`) counts all of them as code-health. So a zone-derived feature such as \"Add export to web-viewer\" gets relation `touches`, not `amends`, plus a +4 boost toward the architecture constraint. Under `autoAccept: agree` it can be silently accepted there.\n\nReachability: no caller of decidePlacement exists yet. The bug becomes live when recommendations become changes (feature \"Recommendations become changes\") and place_change ships (PR 17).\n\nOptions:\n1. Mark findings explicitly: recommend/analyze write a `code-health` tag (or `fix: true`) on finding-derived changes, and placement stops reading `source`. Low cost; needs the emitter change. Recommended.\n2. Narrow the detector to source sourcevision AND a finding marker (a `finding:<hash>` / `tech-debt` / `structural-debt` tag). This is cheap but couples placement to scanner tag conventions, and `rex recommend` items carry finding hashes in meta, not tags."
lastModified: "2026-10-08T04:41:02.503Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
