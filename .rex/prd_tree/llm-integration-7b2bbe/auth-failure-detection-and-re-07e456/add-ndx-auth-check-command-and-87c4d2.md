---
id: "87c4d2e3-09bd-46c0-b337-95ecd6300807"
level: "task"
title: "Add ndx auth check command and credential verification surface"
status: "pending"
priority: "medium"
tags:
  - "auth"
  - "cli"
  - "ux"
source: "smart-add"
acceptanceCriteria:
  - "'ndx auth' (or 'ndx config --check-auth') runs the provider preflight for the active vendor and exits 0 on success, non-zero on auth failure"
  - "On failure, the structured auth-failure message (no raw JSON) from the previous task is displayed"
  - "On success, a confirmation line shows the active vendor, model, and 'credentials valid'"
  - "The auth failure error message from the previous task ends with 'Verify credentials: ndx auth' or equivalent"
  - "Command appears in 'ndx --help' output"
  - "Regression test covers pass and fail paths for at least the Claude provider"
description: "Expose a 'ndx auth' subcommand that re-runs the provider preflight for the currently configured vendor and reports pass/fail with the same actionable guidance as the runtime error path. This gives users a clear, repeatable way to verify credentials after fixing them. The command should link to it from the auth failure error message as the recommended verification step after remediation."
---
