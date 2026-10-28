---
"@n-dx/hench": patch
"@n-dx/web": patch
---

New `hench runs diagnose <run-id> [--format=json]` explains why a run did not complete, using fixed rules and no model call. It names the class (test-gate-new, test-gate-preexisting, completion-held, review-blocked, claim-lost, budget-timeout, vendor-transient, no-changes or unclassified), the evidence behind it, the ranked next actions, and the attempt number out of 2. A run counts as completion-held when its completion was not applied (a completion that was applied or bypassed is not a hold), when it was a gate-only retry, or when the completion gate refused on uncommitted work. That refusal outranks every rule but a lost claim, and its first action is to commit or discard the uncommitted paths, then verify. claim-lost covers only a claim taken by another worktree and a read-only refusal. An absolute path in the test gate's failure digest is read relative to the run's worktree, so it matches the file the run changed. On the second failed attempt it no longer suggests a re-run. Runs that end in any status other than completed store this verdict as `diagnosis` on the run record. When the task has no failure reason yet, the verdict's one-line summary becomes its `failureReason`; an existing reason is kept.

A new experimental toggle, `hench.runVerdict` (off by default), adds a verdict banner to a task's detail panel when its latest run did not complete. The banner shows the class, the summary, the first next action and the attempt number.
