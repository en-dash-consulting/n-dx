---
id: "3d40e0c3-c900-4975-b150-59f80469e01e"
type: "capability"
title: "Relocation-port unit test races with real CI port allocation"
slug: "relocation-port-unit-test-races-with"
statement: "When an explicitly requested port outside the default range is occupied, the web server's relocation logic picks the first free port above it."
criteria: [{"id":"c1","text":"When an explicitly requested port outside the default range is occupied, findRelocationPort shall return the first free port above the requested port."},{"id":"c2","text":"If the port immediately above an explicitly requested port is free, findRelocationPort shall return that port rather than skipping it."},{"id":"c3","text":"While a free port is available above an explicitly requested port outside the default range, findRelocationPort shall not fall back to a port in the default range."}]
tags:
  - "core"
  - "ci"
  - "deterministic-test"
source: "ndx-capture"
priority: "high"
---

Build & Validate run 34735336738 failed tests/unit/web-port-occupant.test.js:618: the test expected findRelocationPort(34001) to return 34002 but received 34003. bindPortWithFreeSuccessor observes that port + 1 is free, then releases the observation before findRelocationPort probes it again; another concurrent CI process can bind the successor in that interval. Production correctly chooses the next available near port, but the test is nondeterministic. Keep the exact first-available-near-port contract by introducing a controlled probe seam or test double; do not weaken the assertion to accept arbitrary ports.
