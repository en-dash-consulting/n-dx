---
"@n-dx/hench": patch
---

Fix the end-of-run summary reporting "Status: failed" beside "Summary: Task complete" when only the PRD bookkeeping (record) commit failed to land after the task's own work succeeded. The summary now names every commit the run produced and renders one of three consistent outcomes: the work failed, the work succeeded and the record was committed, or the work succeeded and the record is still uncommitted. "Changes: none" is no longer printed when commits actually landed, nor when the run left files uncommitted in the working tree — the summary names how many paths are outstanding, so it can no longer read "Changes: none" directly beneath a refusal listing them.
