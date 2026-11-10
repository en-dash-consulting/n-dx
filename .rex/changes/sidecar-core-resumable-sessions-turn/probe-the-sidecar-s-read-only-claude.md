---
id: "6a764d20-2e7a-4fe3-9c16-47e29fb658cc"
type: "task"
title: "Probe the Sidecar's read-only Claude spawn against the real CLI"
slug: "probe-the-sidecar-s-read-only-claude"
description: "Story 04 (1042b913) spawns the Sidecar's Claude CLI with --tools Read,Grep,Glob, --setting-sources \"\", --mcp-config <file> --strict-mcp-config and --allowed-tools mcp__ndx-sidecar. Unit tests assert this argv against a fake CLI. Design §11.1 lists two points as untested on a real CLI: (1) whether the CLI accepts an empty --setting-sources \"\" and then loads no user, project or local settings; (2) whether --allowed-tools mcp__ndx-sidecar alone lets the broker tools run in -p mode, with no permission prompt tool. Also verify the CLI connects to the broker's stateless Streamable HTTP endpoint (JSON responses, GET answered 405), sends the X-Ndx-Token and x-ndx-workspace headers from the config file, and keeps a tool call open while a card waits (MCP tool timeout). If (1) fails, fall back to an explicit --settings document whose permissions.allow is empty, and prove that user allow rules no longer apply."
acceptanceCriteria:
  - "a recorded probe on the current Claude CLI shows a Sidecar turn listing only Read, Grep, Glob and the mcp__ndx-sidecar__ tools"
  - "a user-settings permissions.allow rule for Write or Bash has no effect on a Sidecar turn"
  - "a broker tool call reaches the card and waits for at least 60 s without timing out"
  - "the design doc §11.1 and spawn-policy.ts state the verified flags"
priority: "high"
tags:
  - "sidecar"
  - "follow-up"
source: "hench-follow-up"
---
