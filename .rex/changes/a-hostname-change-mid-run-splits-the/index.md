---
id: "a3e16b11-5cc3-44ff-9112-9d50aa55f988"
type: "change"
title: "A hostname change mid-run splits the host validation slot, so two test runs on one host run at once"
slug: "a-hostname-change-mid-run-splits-the"
summary: "The test-run slot is named after the computer's network name, which macOS can change when the network changes. When it does, a new test run looks in a different place and starts beside the one already running."
intent: "Found by adversarial review of task 24e3c609 (per-host slot, commit 4a41af8e5). Verdict: should-fix, severity medium.\n\nScenario: on macOS without a fixed HostName, os.hostname() follows DHCP/reverse DNS and changes when the network changes (e.g. `ryans-mbp.local` → `ryans-mbp.lan`). Run A takes `<ndx home>/validation-slot/ryans-mbp.local/holder.json`; the network changes; run B's `validationSlotOptions` (packages/hench/src/process/validation-run.ts:210) calls `resolveValidationSlotDir()` again, gets `validation-slot/ryans-mbp.lan/`, finds it free and runs beside A with no message. The same happens to a nested acquire whose environment reports a different hostname (a sandbox that unshares UTS): it would not find its parent's token and would wait on its parent forever. No sandbox on this branch unshares UTS, but PR 3's runner nests under hench gates.\n\nEvidence: packages/hench/src/process/validation-slot-dir.ts resolveValidationSlotDir (hostname read per call).\n\nOptions:\n1. Resolve the host name once per process and pass the slot dir to children (e.g. export it beside NDX_VALIDATION_SLOT so a nested acquire uses the holder's directory). Cheap; fixes nesting; does not fix two independent processes started before/after a rename.\n2. Key the host directory on a stable machine id (macOS IOPlatformUUID, /etc/machine-id, Windows MachineGuid) with hostname as fallback. Fixes both; costs a platform lookup in a module that imports only node: builtins (would live in validation-slot-dir.ts) and must be mirrored by PR 3's scripts/lib/validation-slot.mjs.\nRecommend 2 plus 1's nesting fix."
acceptanceCriteria:
  - "Two acquires in one host whose os.hostname() differ between calls still exclude each other (test with an injected host identity)"
  - "A nested acquire under a live holder is nested even when the child's reported hostname differs from the holder's"
  - "Docs and the validation-slot.ts protocol header name the host identity actually used"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "medium"
discoveredFrom: {"item":"24e3c609-310d-41d1-b65f-26d8c55656cd","run":"bc54513e-ae7d-45ba-9c9a-81018daafb8f"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
source: "ndx-adversarial-review"
---
