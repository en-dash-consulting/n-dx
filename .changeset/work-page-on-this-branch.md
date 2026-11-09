---
"@n-dx/web": patch
---

On a branch with a work set, the Work page opens with "On this branch", grouped by change with Remove, then Ready to run, then "Not on a branch" with Add (the first 10 changes, then "Show all N"). A task on the branch through its change says "via its change"; nothing off the branch does. The sections and Ready to run re-read after Start a branch switches the checkout. Ready to run lists only the set, and an empty set names `{cli} work --any`. The work-set read also returns the open units not on the branch. The default branch, a detached HEAD and a branch with nothing assigned render as before.
