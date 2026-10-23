---
id: "dcf6018e-e658-4708-ae6e-1bd23431748f"
type: "capability"
title: "Auto-Update Detection from npm Registry"
slug: "auto-update-detection-from-npm-registry"
statement: "When a newer version of @n-dx/core is published on the npm registry, ndx tells the user with a single non-blocking line after the command's output, and caches the registry check for 24 hours."
criteria: [{"id":"c1","text":"When any ndx command runs, ndx shall check the npm registry for the latest published version of @n-dx/core."},{"id":"c2","text":"ndx shall cache the registry check result with a 24-hour TTL."},{"id":"c3","text":"While a cached registry check result is younger than 24 hours, ndx shall use the cached result instead of calling the npm registry again."},{"id":"c4","text":"When a newer version of @n-dx/core is available, ndx shall display a single non-blocking notice line after the command output."},{"id":"c5","text":"ndx shall run the registry check without blocking or delaying the command's execution."},{"id":"c6","text":"When a command runs with --quiet, ndx shall suppress the update notice."}]
tags:
  - "cli"
  - "ux"
source: "conversation"
priority: "medium"
---

Automatically detect when a newer version of n-dx is available on the npm registry and notify the user non-intrusively after command output. Cache the check with a 24-hour TTL to avoid repeated network calls.
