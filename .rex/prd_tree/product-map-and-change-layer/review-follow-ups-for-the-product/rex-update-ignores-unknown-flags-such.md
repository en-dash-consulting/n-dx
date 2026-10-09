---
id: "22eaf4a1-d1cd-4fac-a6c2-a0380960579b"
level: "task"
title: "rex update ignores unknown flags such as --resolution without an error"
status: "pending"
priority: "low"
source: "overnight-lane-a"
acceptanceCriteria:
  - "rex update with an unknown flag exits non-zero and names the flag (test)"
  - "A task's resolution type and detail can be set from rex update, or the help text names the MCP tool as the way to set them"
description: "Observed 2026-10-09 (overnight Lane A): `rex update <id> --status=completed --resolution=\"...\" .` exits 0 and prints the update, but --resolution is not a rex update flag and nothing is stored. A resolution can be set only through the MCP update_task_status tool (resolutionType, resolutionDetail). An operator closing a task from the CLI after a stale-dist gate re-run has no CLI way to record why.\n\nOptions: 1. Refuse unknown flags in rex update (exit non-zero, name the flag). 2. Add --resolution-type and --resolution-detail to rex update, matching the MCP tool. Both are small; 1 is the general fix and 2 closes the CLI/MCP parity gap."
lastModified: "2026-10-09T06:56:06.796Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
