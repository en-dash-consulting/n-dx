---
"@n-dx/web": patch
---

Fix two Tasks-view bugs: Quick Add now persists `acceptanceCriteria` on
accepted task proposals (it was dropped client-side in both the direct-accept
and proposal-editor paths), and the dashboard "Start Task" button now launches
an autonomous hench run for the task via `/api/hench/execute` instead of merely
flipping its status to in_progress.
