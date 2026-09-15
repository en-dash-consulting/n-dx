---
id: "8174c84e-2076-489b-8b2e-fadb75c0b386"
level: "task"
title: "Windows orphan-child E2E fixture can start without its grandchild"
status: "pending"
priority: "high"
tags:
  - "windows"
  - "core"
  - "ci-smoke"
  - "process-tree"
source: "ndx-capture"
startedAt: "2026-09-13T16:36:03.640Z"
acceptanceCriteria:
  - "The stop-orphan-children E2E fixture launches its real shell-mediated Node grandchild with an explicit executable path or equivalent platform-safe mechanism."
  - "The test waits on an observable ready signal from the grandchild, and a launch failure reports the underlying executable or shell error rather than a generic timeout."
  - "The detached stand-in server emits its own observable startup signal before the test waits for the grandchild, so Windows CI scheduling delay cannot be reported as a child-launch or orphan-cleanup failure."
  - "The test still fails if terminateTreeByPid kills only the recorded detached server while its grandchild survives."
  - "Fixture cleanup reaps the server and child processes and removes its temporary directory on Windows."
  - "The focused stop-orphan-children test and Windows CLI Smoke pass without skipping the real process-tree assertion."
description: "CLI Smoke (Windows) run 34735894891 failed tests/e2e/stop-orphan-children.test.js:159 after five seconds: the detached stand-in server launched sh without an error, but its shell-launched Node grandchild never wrote child.pid or a tick file. The test must continue to exercise a real escaped process tree—the purpose is to prove terminateTreeByPid reaches a grandchild—but it currently assumes that a shell inherited a usable node executable and has no deterministic ready handshake. Make fixture startup platform-safe and observable, surface an exact child-launch error when it occurs, and ensure cleanup reaps every fixture process and releases the temporary directory on Windows.\n\nCompletion was disproved by PR #370 Windows CLI Smoke run 34896122321 on 2026-09-14. The same test failed at line 203 before terminateTreeByPid was exercised: `The stand-in server's grandchild never started. sh resolved on PATH and the child recorded no launch error.` The fixture now has a grandchild-ready record but no server-ready record, so it cannot distinguish a delayed detached-server startup from a real shell/Node launch failure. Replace that timing-dependent ambiguity with an observable server-start handshake followed by the real grandchild readiness and tree-kill assertions; do not merely lengthen the timeout."
lastModified: "2026-09-14T22:30:53.993Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
