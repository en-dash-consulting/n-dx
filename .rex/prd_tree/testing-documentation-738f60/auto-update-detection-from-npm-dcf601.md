---
id: "dcf6018e-e658-4708-ae6e-1bd23431748f"
level: "feature"
title: "Auto-Update Detection from npm Registry"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "ux"
source: "conversation"
startedAt: "2026-04-09T21:20:35.164Z"
completedAt: "2026-04-09T21:37:39.977Z"
acceptanceCriteria:
  - "On any ndx command, check npm registry for latest @n-dx/core version"
  - "Cache the check result with a 24-hour TTL (e.g., in .n-dx.json or temp file)"
  - "Display a single non-blocking line after command output when update is available"
  - "Never block or delay command execution for the registry check"
  - "Respect quiet mode (suppress notice when --quiet)"
description: "Automatically detect when a newer version of n-dx is available on the npm registry and notify the user non-intrusively after command output. Cache the check with a 24-hour TTL to avoid repeated network calls."
---
