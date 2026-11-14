---
id: "3455bc3c-2fa0-4c72-9cb9-faaa06c6697d"
type: "change"
title: "No test fails if the vendor CLI or a confined repo command stops clearing a stale slot holder before it spawns"
slug: "no-test-fails-if-the-vendor-cli-or-a"
summary: "Hench now clears a dead test run's claim on the shared slot before it starts the vendor CLI or a sandboxed validation command, but no test checks those two call sites. Someone could remove either call and every test would still pass."
intent: "Found by adversarial review of task 3ab4bb09. Verdict: should-fix, severity medium (test quality).\n\nScenario: delete `await sandbox?.prepareSpawn()` from `spawnVendorProcess` (packages/hench/src/agent/lifecycle/cli-loop.ts) or `await sandbox.prepareSpawn()` from the confined branch of `execRepoShellCmd` (packages/hench/src/guard/sandbox.ts). Every hench test still passes: the sandbox tests check `prepareSpawn` on the sandbox objects, `run_command`/`git` ordering, and the unconfined `execRepoShellCmd` path only; agent-loop tests run with NDX_SANDBOX=off so the vendor sandbox is null. The production default `reclaimHostValidationSlot` is also never exercised against a real slot directory under a temp ndx home.\n\nOptions:\n1. (Recommended) Add a `reclaimSlot`-style seam to `SpawnWithAdapterOptions` (or let the test inject the sandbox options) and assert it runs before the CLI spawns; add a confined `execRepoShellCmd` case with a fake backend that records order; add one `reclaimHostValidationSlot` test that plants a stale record (dead pid) under the temp ndx home's per-host dir and sees it removed. Low cost."
acceptanceCriteria:
  - "A test fails when spawnVendorProcess stops awaiting the vendor sandbox's prepareSpawn before spawning"
  - "A test fails when the confined branch of execRepoShellCmd stops awaiting prepareSpawn"
  - "A test plants a stale holder.json under the temp ndx home's per-host slot dir and shows reclaimHostValidationSlot removes it"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "medium"
discoveredFrom: {"item":"3ab4bb09-5f4b-4127-bb01-8aca612cd9b4","run":"53954dd5-8bef-4ffc-8dd5-6cfb391206b4"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
source: "ndx-adversarial-review"
---
