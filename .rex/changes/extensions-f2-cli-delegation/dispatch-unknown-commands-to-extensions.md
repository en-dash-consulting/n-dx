---
id: "0d02f78e-7d40-4f25-837e-777eecf044fe"
type: "task"
title: "Dispatch unknown commands to extensions"
slug: "dispatch-unknown-commands-to-extensions"
acceptanceCriteria:
  - "An unknown `ndx <name>` spawns the matching command's `bin` with the remaining args, using the same Node as n-dx"
  - "Built-in commands always win; a test fails if an extension can shadow one"
  - "stdio inherited, SIGINT and SIGTERM forwarded, exit code passed through (tested with codes 0, 1 and 7)"
  - "No match: today's \"Unknown command\" error, plus a hint when a disabled or incompatible extension has the name"
  - "Orchestration still never imports extension code (`architecture-policy` test extended)"
priority: "critical"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "e9435b47-1ab2-4739-9338-ab00f1c518d6"
---
