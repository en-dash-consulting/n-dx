---
"@n-dx/hench": patch
---

Withdrawing a completion now reopens the ancestors the run's own cascade closed.

When the uncommitted-work gate refused a completion, the task went back to
`pending` but the feature and epic its cascade had just closed stayed
`completed` — the parent/child inconsistency `rex validate` warns about, with no
path that repairs it. The withdrawal now walks up with rex's `findParentResets`
and reopens every consecutive completed ancestor, preserving their authorship.
