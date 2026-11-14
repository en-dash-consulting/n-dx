---
id: "0ccd7aa6-6de3-45d5-9618-ea9f245a3891"
type: "change"
title: "A nested slot acquire fails on a machine-id lookup it does not need"
slug: "a-nested-slot-acquire-fails-on-a"
summary: "A test run started inside another run's validation slot still looks up the machine's identity first. If that lookup fails, the inner run fails or runs unslotted, even though the outer run already told it which slot to use."
intent: "Found by the adversarial review of c1e742ad (mirror PR 2's slot protocol in the runner's copy). Verdict: should-fix, severity medium.\n\nScenario: a hench gate holds the slot and runs `node scripts/run-all-tests.mjs …` with NDX_VALIDATION_SLOT and NDX_VALIDATION_SLOT_DIR set, inside hench's OS sandbox. `takeSlot` (scripts/run-all-tests.mjs, around line 300) awaits `resolveValidationSlotDir()` before `acquireValidationSlot`, so it runs the machine-id lookup (`ioreg` on macOS, `reg` on Windows) first. If that lookup is transient (10 s timeout on a loaded host, a non-zero exit, or a sandbox that refuses IOKit to `ioreg`; Seatbelt here is `(deny default)` with no iokit rule, unverified), the runner prints \"Could not take the validation slot\" and exits 1, failing the gate. After the sibling fail-open task, it would run unslotted with a warning instead. Either way, NDX_VALIDATION_SLOT_DIR already names the holder's directory, and the nested acquire reads only that directory (rule 6).\n\nHench does the same: `runInValidationSlot` (packages/hench/src/process/validation-run.ts:89) resolves `slotDir` before acquiring, so a nested hench acquire is exposed in the same way. Before c1e742ad, the runner did no lookup at all, so this is new for the runner.\n\nOptions:\n1. (Recommended) In both copies, when the environment carries a token and an absolute NDX_VALIDATION_SLOT_DIR, check nesting against that directory before resolving the host directory, and resolve it only when nesting fails. Low cost; keeps parity, with a parity case per copy.\n2. Grant `ioreg` IOKit access in the Seatbelt profile. This only covers macOS and widens the sandbox."
acceptanceCriteria:
  - "With NDX_VALIDATION_SLOT and an absolute NDX_VALIDATION_SLOT_DIR naming a live holder, the runner nests without running the machine-id lookup (a test injects a lookup that always fails and the run still reports 'ran inside the slot')"
  - "hench's runInValidationSlot nests the same way under a failing lookup, with a test"
  - "The parity test covers nesting under a failing lookup for both copies"
touches:
  - "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
priority: "medium"
discoveredFrom: {"item":"c1e742ad-552e-47c7-8587-b0d5212cde09","run":"8a6ba599-69fb-4321-9677-30a3a0251df4"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "validation-gate"
source: "ndx-adversarial-review"
---
