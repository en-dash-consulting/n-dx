---
id: "3f564624-cbee-4520-b9f6-247ccfc8e92a"
type: "task"
title: "Recognise slot nesting and live holders from inside bubblewrap's PID namespace"
slug: "recognise-slot-nesting-and-live"
summary: "On Linux the sandbox hides other processes from the test runner, so it cannot tell that the gate holding the test slot is still alive. It may skip nesting, or even take the slot from a running gate."
description: "Found while fixing d8a7343d (PR #1035 review P1). The bwrap builder (packages/llm-client/src/sandbox.ts planBwrap) always passes --unshare-pid, so inside the sandbox kill(pid, 0) for a holder or its recorded child outside the namespace fails with ESRCH. Both slot implementations (packages/hench/src/process/validation-slot.ts, scripts/lib/validation-slot.mjs) then treat a live holder as dead:\n- rule 6 nesting: a gate's runner does not recognise its own holder's token, so it contends for the slot instead of nesting;\n- rule 5 stale recovery: a no-token confined runner (agent shell) judges a live holder stale and reclaims holder.json, so two validations overlap.\nSeatbelt is unaffected (kill(pid,0) gives EPERM there, which counts as alive). The macOS fix and its live tests are in packages/hench/tests/e2e/validation-slot-sandbox.test.ts, which skips bwrap with this reason.\nOptions to decide: detect a nested PID namespace (/proc/self/status NSpid has more than one entry) and treat an unreachable pid as unknown (alive) in both implementations; or accept a token match as nested without the liveness check; or drop --unshare-pid (a security trade-off, needs sign-off). Change the hench protocol header first, then the runner, and keep tests/e2e/validation-slot-parity.test.js passing."
acceptanceCriteria:
  - "Under bubblewrap, a gate's scripts/run-all-tests.mjs runs nested inside the holder's slot"
  - "Under bubblewrap, a confined runner with no token waits for a live holder and never reclaims its record"
  - "The validation-slot-sandbox e2e test runs on Linux hosts with a usable bwrap instead of skipping"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "sandbox"
  - "linux"
source: "hench-run"
---
