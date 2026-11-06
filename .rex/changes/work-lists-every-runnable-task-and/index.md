---
id: "fab17b38-480a-43f4-97d9-be9b8f77d45a"
type: "change"
title: "Work lists every runnable task, and capture forms take criteria and tags"
slug: "work-lists-every-runnable-task-and"
intent: "Found in user testing on 2026-11-05 against main a5748057f (triage: workshop analysis/sidecar/user-testing-2026-11-05.md). A tester could not find the task she wanted to run: Work's Ready to run shows only the top ten by priority (packages/web/src/viewer/components/ready-to-run.ts:80, /api/hench/ready limit 10, max 50), and the only other Start is on the task detail panel. Every placed task with what it needs to run should be easy to find and start, whatever its priority. She also found the add forms ask for too little: the PRD tree Add item form never sends the tags or acceptance criteria its input type declares."
acceptanceCriteria:
  - "Any runnable task can be found and started from Work, and Add item sends criteria and tags (tests)"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
source: "ndx-capture"
---
