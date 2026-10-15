---
"@n-dx/web": patch
---

Turn the Live task page into the run summary once the selected run finishes.
At the same `/live/task/:taskId` URL a Summary tab appears and opens by
default, showing the run's closing words, what the work changed, what the
reviewer found and what was done about it, the run metrics (wall time, turns,
retries, tool calls, tokens by class, estimated cost, files changed) and the
commits it landed — all read from `GET /api/hench/runs/:id`, the route the
Work view already uses. Actions: Re-run (the page follows the new run), Open
commit, and Capture follow-up to the PRD. Work, Log and Review stay available,
and an explicit tab click is never overridden.

The viewer's commit-link building moves to `viewer/utils/commit-link.ts`, now
shared with the PRD tree's commits table, which also fixes the dead link that
table produced for an scp-style (`git@host:owner/repo`) remote.
