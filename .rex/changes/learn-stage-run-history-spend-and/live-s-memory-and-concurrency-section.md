---
id: "71c475ec-6c18-413a-b98e-b4dae67c8bd3"
type: "task"
title: "Live's Memory and concurrency section repeats the machine strip and shows an empty heading until its panels load"
slug: "live-s-memory-and-concurrency-section"
description: "Verdict: should-fix (low). Task 3044e7b8 mounted MemoryPanel and ConcurrencyPanel in Live's side column (packages/web/src/viewer/views/live.ts, the \"Memory and concurrency\" live-side-section). Live's MachineStrip already shows Memory pressure and Hench slots from /api/live (live-model.ts machineTiles), so the side panels repeat both numbers from a second and third poll. Both panels render null until their fetch succeeds, so the section's h3 shows over nothing on first paint, and permanently when /api/hench/memory or /api/hench/concurrency answers non-OK (e.g. a hub-proxied older server). Each panel also carries its own h3 under the section's h3. Options: drop the wrapper heading and let the panels' own titles stand; render the section only once a panel has data; or fold the panels' extra detail (per-process memory, load average, pending tasks) into the strip's tile details and drop the panels."
acceptanceCriteria:
  - "With /api/hench/memory and /api/hench/concurrency both answering non-OK, Live renders no 'Memory and concurrency' heading"
  - "Live does not show the same memory pressure or slot count in two places, or a test documents why both are kept"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
