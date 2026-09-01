---
id: "b892e543-006f-402f-ae07-e359c1229a81"
level: "task"
title: "Persist full rex run log to .run-logs/ and add directory to .gitignore"
status: "completed"
priority: "medium"
tags:
  - "hench"
  - "logging"
  - "persistence"
source: "smart-add"
startedAt: "2026-04-08T23:38:36.976Z"
completedAt: "2026-04-08T23:44:30.738Z"
acceptanceCriteria:
  - ".run-logs/ is created automatically before the first log write if it does not exist"
  - "Each rex run produces a distinct file in .run-logs/ named with a timestamp or run ID"
  - "Log files contain the complete unbuffered run output, including lines not shown in the rolling window"
  - ".run-logs/ is present in .gitignore after the first run (appended if missing)"
  - "The log file path is printed to the user at run completion so they can locate it"
description: "Capture the complete output of each rex/hench run to a timestamped log file under .run-logs/ at the project root. The directory should be created automatically on first use. Each run must produce a distinct file (named by timestamp or run ID) so logs from concurrent or sequential runs do not collide. .run-logs/ must be added to the repository .gitignore."
---
