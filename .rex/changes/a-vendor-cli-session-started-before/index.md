---
id: "10fb002b-534b-4596-b28e-1f80d8cfbcec"
type: "change"
title: "A vendor CLI session started before the host lookup finishes gets no slot directory for its whole session"
slug: "a-vendor-cli-session-started-before"
summary: "Hench now tells sandboxed commands where the shared test slot lives, but it only knows once a quick machine lookup has finished. If the Claude session starts first, on a busy machine, that whole session's test runs do their own lookup inside the sandbox and may run without the slot."
intent: "Found by adversarial review of task 5e14adef (commit e1ccf4e2b). Verdict: should-fix, severity medium.\n\nScenario: `spawnVendorProcess` (packages/hench/src/agent/lifecycle/cli-loop.ts) calls `sandbox.prepareSpawn(cliEnv)` once per session. `prepareSpawn` → `withHostValidationSlotDir` / `reclaimHostValidationSlot` (packages/hench/src/process/validation-run.ts) only peek the host identity cache and never wait. The lookup is started at run start (`startHostIdentityLookup`, cli-loop posture block) and at sandbox creation, but on macOS/Windows it runs `ioreg`/`reg`, which on a loaded host (swapping, exactly when the slot matters) can take seconds, longer than brief building. When it has not resolved by the spawn, the Claude CLI session gets neither `NDX_VALIDATION_SLOT_DIR` nor the pre-spawn stale-holder reclaim, and every `pnpm test` the agent runs in that session does its own lookup inside Seatbelt. If Seatbelt refuses IOKit to `ioreg` (unverified) or it is slow, the runner fails open and runs unslotted, the outcome this task meant to remove. Per-command tool spawns recover on the next command; the vendor session is a single spawn, so it does not.\n\nReachable: `ndx work` with the Claude CLI vendor and the sandbox on, on macOS, when the lookup is slower than run start → spawn.\n\nOptions:\n1. (Recommended) In `spawnVendorProcess` before `prepareSpawn`, await `hostIdentity()` bounded by a short timeout (e.g. 2–3 s) and ignore its failure. One wait per session (not per command) keeps the spirit of 2387d5ba; the 60 s failure memory makes repeat sessions during an outage free. Cost: small; risk: up to the bound of added latency once per session on a slow host.\n2. Await the lookup at run start, bounded, in the posture block. Same cost; covers the API loop too.\n3. Leave it and rely on the in-sandbox lookup (accept unslotted agent runs on slow hosts)."
acceptanceCriteria:
  - "With a host-identity lookup that answers after the vendor sandbox is created but within the bound, the vendor CLI spawn env carries NDX_VALIDATION_SLOT_DIR (test with an injected slow cache through the vendorSandbox seam)"
  - "With a lookup that never answers, the vendor CLI still spawns within the bound (test)"
  - "Per-command tool spawns (run_command, git) still never wait on the lookup"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "medium"
discoveredFrom: {"item":"5e14adef-7996-48b2-a2bd-4681c6e1f85b","run":"8f2816f5-5f84-4b5a-877c-490444a48893"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
source: "ndx-adversarial-review"
---
