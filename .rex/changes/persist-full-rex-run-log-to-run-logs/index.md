---
id: "b892e543-006f-402f-ae07-e359c1229a81"
type: "change"
title: "Persist full rex run log to .run-logs/ and add directory to .gitignore"
slug: "persist-full-rex-run-log-to-run-logs"
intent: "Capture the complete output of each rex/hench run to a timestamped log file under .run-logs/ at the project root. The directory should be created automatically on first use. Each run must produce a distinct file (named by timestamp or run ID) so logs from concurrent or sequential runs do not collide. .run-logs/ must be added to the repository .gitignore."
acceptanceCriteria:
  - ".run-logs/ is created automatically before the first log write if it does not exist"
  - "Each rex run produces a distinct file in .run-logs/ named with a timestamp or run ID"
  - "Log files contain the complete unbuffered run output, including lines not shown in the rolling window"
  - ".run-logs/ is present in .gitignore after the first run (appended if missing)"
  - "The log file path is printed to the user at run completion so they can locate it"
touches:
  - "8f175c2d-6868-4687-a7e5-355e78f785f1"
priority: "medium"
tags:
  - "hench"
  - "logging"
  - "persistence"
source: "smart-add"
---
