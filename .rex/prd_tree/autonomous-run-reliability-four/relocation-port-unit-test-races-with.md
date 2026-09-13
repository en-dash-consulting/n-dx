---
id: "3d40e0c3-c900-4975-b150-59f80469e01e"
level: "task"
title: "Relocation-port unit test races with real CI port allocation"
status: "pending"
priority: "high"
tags:
  - "core"
  - "ci"
  - "deterministic-test"
source: "ndx-capture"
acceptanceCriteria:
  - "The explicit-port relocation test controls the availability probe rather than observing a real free port and probing it again later."
  - "The test proves that findRelocationPort selects the first free port above an explicit requested port outside the default range."
  - "The test fails if the implementation skips a free immediate successor or falls back to the default range while a near port is available."
  - "The focused web-port-occupant suite and the root Build & Validate suite pass repeatedly in CI."
description: "Build & Validate run 34735336738 failed tests/unit/web-port-occupant.test.js:618: the test expected findRelocationPort(34001) to return 34002 but received 34003. bindPortWithFreeSuccessor observes that port + 1 is free, then releases the observation before findRelocationPort probes it again; another concurrent CI process can bind the successor in that interval. Production correctly chooses the next available near port, but the test is nondeterministic. Keep the exact first-available-near-port contract by introducing a controlled probe seam or test double; do not weaken the assertion to accept arbitrary ports."
lastModified: "2026-09-13T03:36:07.002Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
