---
"@n-dx/core": patch
---

Add the `/ndx-adversarial-review` skill: review by attack rather than by inspection.

Invoked bare it attacks the working or branch diff; given a task ID it attacks
the claim that the task is done, criterion by criterion; given a name or topic it
finds the matching PRD item and confirms it with the user before starting.

The skill runs two passes. Pass 1 works a fixed rubric — unimagined inputs,
failure paths, concurrency, platform, contract drift, test quality, the
acceptance criteria themselves — and drops any finding it cannot give a concrete
trigger or cannot defend against its own refutation attempt. Pass 2 then asks
whether each survivor is worth acting on at all: reachable by a real caller,
already covered upstream, worth what the fix costs, and in scope for this change.
A real defect that lands on "not worth fixing" is reported as such rather than
inflated into work.

Ground truth includes the project's own checks, discovered rather than assumed —
`.rex/workflow.md`, the manifest scripts, or the CI config name them, and only
read-only ones are run. A red result is a finding whose repro is already written;
a green one bounds the review without ending it.

Nothing is written until the user rules on the findings. Approved findings are
then checked against what the PRD already tracks — matched on the defect rather
than the wording — so a repeated review does not bury the original item under
near-duplicates: an already-tracked finding is either extended via `edit_item`,
when the review has something new to say, or skipped with the existing item's ID
reported. Genuinely new findings become items carrying the failure scenario,
candidate solutions, and failing acceptance criteria.

The skill never edits source or applies a fix. Fixing an approved item is a
separate `/ndx-work` run.
