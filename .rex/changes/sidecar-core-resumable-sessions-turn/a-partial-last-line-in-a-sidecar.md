---
id: "92c2fda1-e21b-47f4-9cc6-5ec5e0298248"
type: "task"
title: "A partial last line in a Sidecar transcript breaks readFrames and corrupts the next append"
slug: "a-partial-last-line-in-a-sidecar"
description: "Verdict: should-fix (medium). packages/web/src/server/sidecar/session-registry.ts readFrames/appendFrame: transcripts are appended with appendFileSync, one JSON line per frame. Scenario: the server is killed while appending a large event frame, leaving `{\"seq\":7,\"at\":...` with no newline. readFrames then throws on JSON.parse for every read of that session (including the cursor reconcile on the next turn, so the session can no longer take turns), and if a turn did run, its first frame would be glued onto the fragment, corrupting a middle line. Reachable only on a crash mid-append. Options: (1, recommended) on the first append per registry, if the file does not end in \"\\n\", truncate the trailing fragment (or move it to a .corrupt sidecar file) and log it; readFrames ignores only a final line without a newline, never a middle line — small, explicit, no silent swallowing of real corruption; (2) write each frame atomically via a per-frame file — far costlier."
acceptanceCriteria:
  - "a transcript ending in a partial line without a newline still returns every complete frame from readFrames"
  - "the next turn after such a fragment appends frames on their own lines with unique, consecutive seq numbers"
  - "a malformed complete middle line still raises an error naming the file"
  - "tests in packages/web/tests/unit/server/sidecar-session-registry.test.ts cover the three cases"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
