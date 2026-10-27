---
id: "b1dc5843-120b-4151-933c-82fdead1faf3"
type: "change"
title: "Audit and enforce worker thread cleanup across all CLI entry points"
slug: "audit-and-enforce-worker-thread"
intent: "Review every spawn and worker-thread creation site in cli.js, ci.js, web.js, and config.js. Ensure all threads are explicitly joined or terminated before the parent process exits. Identify any code paths (errors, cancellations, SIGINT) where threads escape the cleanup gate."
acceptanceCriteria:
  - "All worker thread creation sites in orchestration scripts are catalogued"
  - "Each creation site has a corresponding explicit teardown path for success, error, and signal cases"
  - "Running `ndx analyze` and `ndx work` leaves zero lingering node threads as verified by process inspection"
  - "A new regression test verifies thread count returns to baseline after each CLI command completes"
touches:
  - "8abe3c45-9434-4862-aeee-0f56f107d130"
priority: "high"
tags:
  - "process-lifecycle"
  - "cli"
  - "reliability"
source: "smart-add"
---
