---
id: "702e743b-b4b4-4956-b7c3-9672a024963f"
type: "task"
title: "Nothing fails if a worktree dashboard stops opening its drawer on the ?sidecar= session the hub handed off to"
slug: "nothing-fails-if-a-worktree-dashboard"
description: "Verdict: should-fix (medium). Found by the adversarial review of task 26ddda60 (run c277514c).\n\nuseSidecarShell (packages/web/src/viewer/hooks/use-sidecar.ts) reads `?sidecar=<id>` once and, when web.sidecar is on, calls drawer.show() and sidecar.openSession(id). That effect is the last step of \"Open in worktree sidecar\" (AC: \"opens that worktree's drawer\"). Only the parser handedOffSessionParam is tested (tests/unit/viewer/hub-session-drawer.test.ts); deleting the effect, or breaking its enabled/openSession wiring, fails no test. Reachable: every hub handoff lands on /p/<id>[/w/<key>]/?sidecar=<id>.\n\nFix: add a test to tests/unit/viewer/sidecar-drawer.test.ts, which already mounts useSidecarShell behind useFeatureToggle: set location.search to ?sidecar=<id> with two open sessions where <id> is not the most recently active, enable web.sidecar, and assert the drawer is open on <id> with its frames read. Cost: one test, no source change. Risk: none."
acceptanceCriteria:
  - "A test loads the shell with ?sidecar=<id> and web.sidecar on, and asserts the drawer opens on session <id> and reads its frames, even when another open session is more recently active"
  - "The test fails when the ?sidecar= effect in useSidecarShell is removed"
  - "With web.sidecar off, a ?sidecar= page leaves the drawer closed and reads no session"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
