---
id: "29de69ae-7a90-49b0-941a-7bd681a33856"
level: "epic"
title: "0.8.0 / PR 15 · Hub admission gate: global session cap, memory headroom, queue instead of 503"
status: "pending"
priority: "medium"
tags:
  - "parallel-dev"
  - "release-0.8.0"
  - "pr-15"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "With hub.maxSessions = 1, a second Start working from another project is queued (202 + position) and starts when the first finishes."
  - "Memory headroom below the floor pauses admission and the Overview strip says so."
  - "Direct (--here) servers are unaffected."
description: "Release 0.8.0 (minor) · PR 15 of 5 · packages: @n-dx/web · changeset: minor · after PR 8 and PR 11.\n\nToday each project allows guard.maxConcurrentProcesses (default 3) agents and runs its own memory monitor (routes-hench.ts getEffectiveMaxConcurrent, startMemoryMonitor); nothing coordinates across projects. The hub gains an admission gate for dashboard-started runs: a global cap (hub.maxSessions, default 4) and a memory-headroom check (os.freemem against a configurable floor) applied before a request is proxied to a project's execute route; over cap, the request is queued and the caller receives 202 with a queue position, broadcast as it changes, instead of a 503. Per-project caps still apply inside the child. Config in ~/.n-dx/config.json.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:36.434Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Admission gate in the hub for execute requests: global cap, memory floor, FIFO queue with position broadcasts, ~/.n-dx/config.json](./admission-gate-in-the-hub-for-execute.md) | pending |
