---
id: "f125703d-34c1-4d9b-a452-43b405340525"
level: "task"
title: "Test gate must distinguish \"suite never launched\" from \"tests failed\""
status: "pending"
priority: "critical"
tags:
  - "hench"
  - "test-gate"
  - "cross-os"
  - "windows"
source: "ndx-capture"
acceptanceCriteria:
  - "`runTestGate` reads `ExecResult.launched` and does not treat `launched: false` as a test failure"
  - "When `launched` is false, the returned `TestGateResult` carries a distinct error naming the shell that could not be spawned and the underlying spawn error message"
  - "Gate output for a never-launched suite is visibly different from output for a genuinely failing suite — an operator can tell the two apart without opening the run log"
  - "A unit test asserts that a `launched: false` exec result produces the never-launched outcome rather than a failed-tests outcome"
  - "A unit test asserts that `launched: true` with a non-zero exitCode still produces a normal test-failure outcome (no regression)"
  - "Every other `execShellCmd` call site that branches on exitCode is audited for the same gap; each is either fixed or has a comment stating why exitCode alone is sufficient there"
description: "`runTestGate` (packages/hench/src/tools/test-runner.ts:608) computes `const overallPassed = exitCode === 0;` and never consults `ExecResult.launched`. When the shell itself cannot be spawned, `exec` returns `{ stdout: \"\", stderr: \"\", exitCode: 1, launched: false }` — indistinguishable from a real failing exit unless `launched` is read.\n\nObserved on Windows without a POSIX shell (`where sh` exits 1; Git for Windows does not put `usr/bin` on PATH). Before commit b5a3a3e0, `execShellCmd` hardcoded `spawn(\"sh\", [\"-c\", cmd])`, so the gate ENOENTed and reported `✗ 0/0 package(s) failed` with an empty `Error: Test gate failed:` message. Three consecutive `ndx work --loop` iterations failed this way and auto-cancelled the loop, despite each task's work being complete and committed.\n\nb5a3a3e0 fixed shell resolution (`buildShellInvocation` falls back to `cmd.exe /d /s /c`), which removes the trigger on this machine — but the gate's inference remains unguarded and will misreport any future spawn failure the same way. exec.ts:52-69 documents this exact hazard: \"a caller that infers pass/fail from exitCode alone reports 'your tests failed' for a suite that was never launched.\" The agent that shipped b5a3a3e0 explicitly flagged this as left undone.\n\nA gate that cannot start the suite must fail loudly and distinctly, naming the unresolvable shell — not silently claim the tests failed."
lastModified: "2026-09-03T19:44:56.281Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
