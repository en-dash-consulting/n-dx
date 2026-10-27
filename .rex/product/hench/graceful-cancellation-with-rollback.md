---
id: "626d40cf-4513-4cb1-a767-0aabd05a5f7c"
type: "capability"
title: "Graceful Cancellation with Rollback Prompt on Ctrl+C"
slug: "graceful-cancellation-with-rollback"
statement: "When the user presses Ctrl+C during a hench run, hench stops the agent loop at the next safe checkpoint and offers the same rollback prompt it shows for a failed run, so the PRD task is not left in progress."
criteria: [{"id":"c1","text":"When the user presses Ctrl+C during an active agent loop, hench shall set a cancellation flag instead of exiting the process immediately."},{"id":"c2","text":"When the cancellation flag is set, the agent loop shall exit cleanly at the next loop iteration boundary."},{"id":"c3","text":"When Ctrl+C is received, hench shall let any in-flight tool call or LLM request finish before the loop exits."},{"id":"c4","text":"When a run concludes, whether cancelled or not, hench shall restore the default SIGINT handler."},{"id":"c5","text":"When a run is cancelled with Ctrl+C, hench shall print a terminal message saying that the run was interrupted."},{"id":"c6","text":"When the agent loop exits after a Ctrl+C cancellation, hench shall display the same rollback confirmation prompt it shows on run failure."},{"id":"c7","text":"If the user confirms rollback after a cancellation, hench shall use git to revert the file changes made during the run and shall reset the PRD task status to its pre-run value."},{"id":"c8","text":"If the user declines rollback after a cancellation, hench shall keep the file changes, leave the task in a non-completed state, and print a terminal message explaining how to resume."},{"id":"c9","text":"When a run is cancelled, hench shall not leave the PRD task status as 'in_progress', whichever rollback choice the user makes."}]
source: "smart-add"
---

Extend the existing run-failure rollback flow to also trigger when the user cancels a hench run via Ctrl+C (SIGINT). Currently Ctrl+C exits abruptly, leaving the PRD task in an in-progress state and any partial file changes uncommitted. This feature brings parity between the failure-path rollback UX and the user-initiated cancellation path.
