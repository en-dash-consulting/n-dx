---
id: "3c3f21c2-b454-4968-8817-f5e6f12855b0"
type: "task"
title: "A Sidecar interrupt gives the process-table read only 500 ms, so a slow ps leaves the vendor CLI's children running"
slug: "a-sidecar-interrupt-gives-the-process"
description: "Found by an adversarial review of story 03 (run 9871054b). Verdict: should-fix, medium.\n\nScenario: on POSIX, spawnCli does not detach the vendor CLI, so terminateProcessTree cannot signal a group and relies on posixDescendants to find the CLI's children (MCP servers, tool shells). vendor-session.ts stopChild passes forceKillTimeoutMs: INTERRUPT_GRACE_MS (500). terminatePosixTree uses that one value as the escalation grace and also as the timeout for the `ps` table read (process-tree.ts:569, posixDescendants → readProcessTable). On a loaded machine where `ps` takes longer than 500 ms, the read comes back empty. Only the direct child is killed, and its descendants keep running after the turn reports `interrupted`. Before this change the read had the 5 s default.\n\nReachable: POST /api/sidecar/sessions/:id/interrupt, and end(), on any POSIX host under load. Mitigated in practice because the Claude CLI usually reaps its own children on SIGTERM.\n\nOptions:\n(a) Add a separate `scanTimeoutMs` (default: forceKillTimeoutMs) to TerminateTreeOptions. vendor-session keeps the 500 ms grace and passes a longer scan budget, e.g. 1 s. Cheap, local. The 2 s total is still met because the scan usually takes a few ms. Recommended.\n(b) Spawn session CLIs detached, so the group kill reaches the whole tree without a scan. Larger: spawnCli has no detach option, and detaching loses terminal Ctrl-C forwarding."
acceptanceCriteria:
  - "terminateProcessTree accepts a process-table scan timeout separate from the force-kill grace, and a unit test with a slow fake ps (over 500 ms) still finds and kills the descendants while the grace stays 500 ms"
  - "A Sidecar session interrupt passes a scan budget of at least 1 s while keeping INTERRUPT_GRACE_MS at 500 ms, and the vendor-session test still stops a SIGTERM-ignoring CLI within 2 s"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
