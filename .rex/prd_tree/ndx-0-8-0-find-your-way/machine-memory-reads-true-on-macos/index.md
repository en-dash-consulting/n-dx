---
id: "dc2f7cfb-25b7-4439-b6dd-4511c8d482a1"
level: "feature"
title: "Machine memory reads true on macOS"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "macos-memory"
source: "GitHub issue en-dash-consulting/n-dx#497 (2026-10-01)"
acceptanceCriteria:
  - "On a Mac with ~3.9 GB reclaimable but ~115 MB in free pages, the dashboard reports healthy available memory and the hub admits runs against a 2 GB floor."
  - "When the memory reading cannot be taken, every surface reports it as unknown and nothing flags, throttles, refuses or queues a run because of memory."
  - "Linux and Windows readings, health and admission decisions are unchanged."
description: "On macOS, n-dx reads free memory with os.freemem(), which counts only Darwin's free pages and leaves out inactive, speculative and purgeable memory the OS reclaims on demand. A healthy 16 GB Mac read 115 MB free (dashboard \"critical\", below the hub's 2 GB admission floor) while vm_stat showed ~3.6 GB inactive. The hub admission gate queues dashboard-started runs on that number, hench's opt-in MemoryThrottle refuses runs on it, and hench's pre-spawn check falls back to it when vm_stat fails. This feature adds one shared available-memory reading in @n-dx/llm-client (free + inactive + speculative + purgeable from vm_stat, health from kern.memorystatus_vm_pressure_level, unknown when neither can be read) and routes every caller through it. Linux and Windows keep os.freemem(), which is already MemAvailable / standby-inclusive there.\n\nGoal: Memory numbers represent the machine's real state, or there is no memory signal at all; nothing flags, throttles or holds a run on an unknown reading."
lastModified: "2026-10-01T23:05:10.439Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a shared available-memory reading to llm-client that counts macOS reclaimable pages and kernel pressure](./add-a-shared-available-memory-reading.md) | completed |
| [Route hench's memory throttle and pre-spawn check through the shared reading and never act on an unknown reading](./route-hench-s-memory-throttle-and-pre.md) | completed |
| [Show memory pressure and available memory on the Live tab tile, and never flag an unknown reading](./show-memory-pressure-and-available.md) | pending |
| [Use the shared reading for the dashboard memory status and hub admission floor, labelled Available memory](./use-the-shared-reading-for-the.md) | completed |
