---
id: "2387d5ba-7b2a-4886-a4a2-b58fe3f2a70d"
type: "change"
title: "A failing machine-id lookup delays every sandboxed command by up to the lookup timeout"
slug: "a-failing-machine-id-lookup-delays"
summary: "Before each sandboxed command, hench now checks the shared test slot, which first needs the machine's id. If that lookup keeps failing, every command the agent runs waits up to ten seconds for it to time out again."
intent: "Found by adversarial review of task 3ab4bb09 (reclaim a dead sandboxed holder's slot from the host). Verdict: should-fix, severity medium.\n\nScenario: `reclaimHostValidationSlot` (packages/hench/src/process/validation-run.ts) runs before every confined spawn via `ToolSandbox.prepareSpawn` (packages/hench/src/guard/sandbox.ts) and before every `execRepoShellCmd`. It awaits `resolveValidationSlotDir()` → `hostIdentity()`, whose cache forgets a rejected lookup (validation-slot-dir.ts `createHostIdentityCache`). On macOS (`ioreg`) or Windows (`reg query`) a transient failure (timeout at LOOKUP_TIMEOUT_MS = 10 s on a loaded host, or a non-zero exit) is retried on the next call, so while the failure persists every `run_command`, `git` tool call and vendor-CLI start waits up to 10 s before spawning. The task's own contract says the reclaim \"never waits\".\n\nReachable: any hench run with the sandbox on, on macOS/Windows, during a lookup outage.\n\nOptions:\n1. (Recommended) Have the pre-spawn reclaim skip when no host identity has resolved yet in this process and one is not already cached, or back off: after a transient failure, skip the pre-spawn reclaim for N seconds instead of re-running the lookup. Cheap; loses one reclaim opportunity at worst.\n2. Run the lookup once in the background at run start and make prepareSpawn use only the cached result. Cheap; same trade-off.\n3. Bound the pre-spawn reclaim with a short timeout (e.g. 500 ms). Simple but still adds latency per spawn."
acceptanceCriteria:
  - "With a host-identity lookup that always fails transiently, consecutive prepareSpawn calls do not each re-run the lookup (test through injected sources counts lookups)"
  - "prepareSpawn returns within a small bound (well under LOOKUP_TIMEOUT_MS) when the lookup is slow, with a test using a lookup that never answers"
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
