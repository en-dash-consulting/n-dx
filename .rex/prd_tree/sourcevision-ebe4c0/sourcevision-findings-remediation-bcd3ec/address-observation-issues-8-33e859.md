---
id: "33e8596e-7a9d-4194-8e3b-3b66edecb18b"
level: "task"
title: "Address observation issues (8 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-07T02:59:35.729Z"
completedAt: "2026-03-07T03:05:42.450Z"
acceptanceCriteria: []
description: "- cli-contract.test.mjs living alongside non-test .mjs scripts rather than in tests/e2e/ may cause it to be excluded from standard test runner discovery if glob patterns only target tests/e2e/.\n- Bidirectional coupling: \"web-build-tooling\" ↔ \"web-dashboard\" (10+4 crossings) — consider extracting shared interface\n- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects\n- High coupling (0.56) — 1 imports target \"web-dashboard\"\n- Cohesion of 0.44 is below the recommended 0.5 threshold; the three components (smart-add-input, proposal-editor, batch-import-panel) may have been grouped algorithmically by shared test imports rather than by meaningful domain affinity.\n- Coupling of 0.56 approaches the high-coupling threshold; auditing which viewer internals these components import could reveal opportunities to depend on stable public APIs instead.\n- Bidirectional import coupling between web and web-viewer (10 web→web-viewer, 4 web-viewer→web) is the primary cause of the 0.42 coupling score; the web-viewer→web direction should be audited to ensure viewer code is not importing build infrastructure.\n- Cohesion of 0.58 is below the ideal threshold because viewer UI components (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) are co-classified with build scripts — reclassifying them into web-viewer would restore cohesion for both zones."
recommendationMeta: "[object Object]"
---
