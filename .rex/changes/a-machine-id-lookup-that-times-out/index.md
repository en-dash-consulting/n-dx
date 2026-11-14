---
id: "10a4e198-013b-4b08-8a28-532286662112"
type: "change"
title: "A machine-id lookup that times out once keeps a hench process on a hostname slot directory, apart from every other run on the host"
slug: "a-machine-id-lookup-that-times-out"
summary: "The shared test-run slot is named after the machine's id, which hench reads with a quick system lookup. If that lookup is slow once, for example while the machine is swapping, that hench process uses a different slot for the rest of its life and its tests run beside everyone else's."
intent: "Found by adversarial review of task 96357e8a (commit a75d03b6f). Verdict: should-fix, severity medium.\n\nScenario: on macOS, `readHostIdentity` runs `ioreg -rd1 -c IOPlatformExpertDevice` through `exec` with a 2 s timeout (packages/hench/src/process/validation-slot-dir.ts `LOOKUP_TIMEOUT_MS`, `runLookup`). On a heavily loaded host (memory pressure, swap, exactly when the slot matters), the lookup can exceed 2 s or fail transiently. `runLookup` returns undefined, `readHostIdentity` falls back to `{ kind: \"hostname\" }`, and `hostIdentity()` caches that promise for the life of the process. That hench process's gates then use `validation-slot/h-<hash>/` while every other process uses `validation-slot/m-<hash>/`, so its runs are admitted beside the current holder with no message. The same applies on Windows (`reg query`). Linux reads files and is unaffected.\n\nReachable: any `ndx work` / hench run with `hench.testGate.hostSlot` on, through `runInValidationSlot` → `resolveValidationSlotDir()` → `hostIdentity()`.\n\nOptions:\n1. Distinguish \"no machine id on this platform/host\" from \"lookup failed or timed out\": cache only a definitive result; on a failed lookup, use the hostname for this call but retry on the next call. Cheap; a single slow call can still split one validation.\n2. Also raise the timeout (e.g. 10 s; it is paid once per process when it works). Cheap.\n3. Persist the resolved machine dir name in the ndx home (e.g. `validation-slot/host-id`) after one successful lookup per host... but a shared network home makes that per-host file ambiguous; not recommended.\nRecommend 1 + 2. Note PR 3's `scripts/lib/validation-slot.mjs` mirrors the lookup and needs the same rule."
acceptanceCriteria:
  - "A failed or timed-out machine-id lookup is not cached: a later hostIdentity() call in the same process retries it and returns the machine identity once the lookup succeeds (unit test through injected sources)"
  - "A platform with no machine-id source at all (or a lookup that answered without an id) still caches the hostname identity once"
  - "The macOS/Windows lookup timeout is long enough for a loaded host (documented in the module header), and the docs name the fallback behaviour"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "medium"
discoveredFrom: {"item":"96357e8a-d040-477a-9f0d-d75fea4656ef","run":"264c9645-fe98-4c9c-82d1-36771c274184"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
source: "ndx-adversarial-review"
---
