---
id: "66468883-4570-4ac2-9252-bbbd81f9528a"
level: "task"
title: "Rebuild the failover control as a section that shows the chain and says when failover cannot fire"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
blockedBy:
  - "45ad9e5b-c825-46b0-bf17-e074f5110b9e"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
acceptanceCriteria:
  - "The toggle saves llm.autoFailover and its track is visible in both themes."
  - "The chain renders from the server's failover block."
  - "With Claude CLI the page shows the reason that failover will not fire."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "**Section 4, \"If a run fails\":**\n- A toggle (a real checkbox with a visible track) labelled \"Automatic failover\", with the description \"On a retryable error, try the next model in the chain before giving up.\"\n- Below it, the server's `chain` as monospace pills joined by arrows, dimmed while the toggle is off.\n- When `failover.applies` is false, show the server's `reason` as a warning line.\n- Local shows \"Failover is not available for local models.\""
lastModified: "2026-10-10T23:40:56.611Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
