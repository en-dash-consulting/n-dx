---
id: "5d6f2512-4aa0-470b-9447-7d6e51ce18d4"
level: "task"
title: "cli-start-two-projects asserts the exact relocation port, which is environment-fragile"
status: "pending"
priority: "low"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-02-review"
source: "holistic review of PR 2, 2026-09-11"
acceptanceCriteria:
  - "The test asserts portB is above requestedPort and within the near window, not equal to a specific port."
  - "The test still fails if relocation jumps into 3117–3200 (the behaviour the old contract had)."
  - "A comment records why the exact-port form was rejected, so it is not tightened again later."
description: "Severity: low (test flakiness, no product defect). Found by holistic review of PR 2, in the contract update for item 38a30719 (commit 72fc25b3).\n\nFAILURE SCENARIO\ntests/e2e/cli-start-two-projects.test.js now asserts `expect(portB).toBe(requestedPort + 1)`. requestedPort is an OS-assigned ephemeral port obtained by binding :0 and releasing it, and ephemeral ports are handed out from a small, busy range — on a developer machine or a shared CI runner, requestedPort + 1 is quite likely to be held by some unrelated process. When it is, relocation correctly moves to requestedPort + 2 and the test fails for a reason that has nothing to do with the behaviour under test.\n\nThe assertion was tightened from `expect(portB).not.toBe(requestedPort)` in order to pin the new near-port contract, which was the right instinct — the loose version passed under the old 3117–3200 behaviour too. But exact-next-port is stronger than the contract actually promises: findRelocationPort guarantees \"the first FREE port at or above requestedPort + 1, within the window\", not \"requestedPort + 1\".\n\nSOLUTION\nAssert the neighbourhood rather than the exact port: portB > requestedPort and portB <= requestedPort + 83, plus the existing check that it is not inside 3117–3200 (which is what distinguishes the new contract from the old). That is precisely as strong as the guarantee and is immune to a neighbouring port being taken."
lastModified: "2026-09-11T13:29:56.439Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
