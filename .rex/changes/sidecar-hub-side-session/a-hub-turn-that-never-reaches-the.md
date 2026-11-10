---
id: "771fdf69-d81a-483e-8108-7d1c1be810cb"
type: "task"
title: "A hub turn that never reaches the model still advances the snapshot's Δ fingerprints"
slug: "a-hub-turn-that-never-reaches-the"
description: "Verdict: should-fix (medium), from the adversarial review of a23d8599.\n\nScenario: the hub session's turn builds its packet, and hubSnapshotReader (packages/web/src/server/sidecar/hub-packet.ts:81) writes <id>.snapshot.json before it returns. If the turn then never reaches the model, the next turn compares against the fingerprints of a snapshot the model never saw. That happens when the Claude CLI is signed out, the operator stops the turn while the packet builds (session-registry.ts:428/436), or the spawn fails. Every change from the lost build then shows without Δ, and the model reads moved work as unchanged. The registry already knows the packet was not delivered and restores packetDue for that case (session-registry.ts:464); the fingerprints are not rolled back.\n\nReachable: POST /hub/session/sessions/:id/turns on a signed-out CLI, or POST …/interrupt during a packet build.\n\nOptions:\n1. (recommended) Split the read from the commit. hubSnapshotReader returns the new state with the text, and the registry commits it only once the turn completes, through a new SidecarContextOptions hook such as packetDelivered(record). Cheap, and keeps the registry generic.\n2. Keep the last two states and roll back on failure. More state to keep, no simpler."
acceptanceCriteria:
  - "A hub turn that fails or is interrupted after its packet was built leaves <id>.snapshot.json as it was before that turn"
  - "After such a turn, the next completed turn marks with Δ every item that changed since the last delivered snapshot"
  - "A test in routes-sidecar-hub.test.ts drives a failed turn followed by a completed one and asserts the Δ mark survives"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
