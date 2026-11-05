---
id: "7da01445-1d7e-48ed-9d26-cf303ce98d72"
type: "task"
title: "A Describe session's first turn waits up to 45 s on two serial ndx spawns that a stop cannot cancel"
slug: "a-describe-session-s-first-turn-waits"
description: "Verdict: should-fix (low). From adversarial review of 9559114b (commit b3055dc5a).\n\nScenario: on a Describe session, buildDescribePacket (packages/web/src/server/sidecar/packet-builders.ts) awaits sources.resolve, then sources.preview. In production these spawn `ndx work --resolve` (15 s timeout) and `ndx work --dry-run` (30 s timeout) through prepareReads (routes-sidecar.ts) → resolveTaskRun / previewTaskRun (routes-hench-prep.ts). They run one after the other, and neither gets an AbortSignal. The packet is rebuilt for turn one, every re-lens and every cold refresh after a checkpoint. A slow or hung CLI delays the operator's first turn by up to 45 s. A stopped turn leaves both children running until they time out. Both also count against PREP_MAX_IN_FLIGHT, which the Prepare modal shares.\n\nReachable: open a Sidecar session with the describe lens on a task (web.sidecar on).\n\nOptions:\n(1) Recommended: start resolve and preview together with Promise.all in the builder, and pass the turn's AbortSignal down through SpawnedReads into runNdx. Cost: a small signature change plus tests. Risk: low.\n(2) Only run them in parallel. Cheaper, but a stop still leaves orphaned children."
acceptanceCriteria:
  - "The Describe builder starts the resolve and dry-run reads concurrently: a test with two stub reads that stay pending asserts both have started before either is resolved, without reading a clock (tested)"
  - "Stopping a turn whose packet is still building aborts both ndx spawns: a test asserts the turn's AbortSignal reaches resolveTaskRun and previewTaskRun and is aborted (tested)"
  - "Tests bound no clock reading (tests/e2e/wall-clock-inventory-policy.test.js passes)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
