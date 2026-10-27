---
id: "7bf0be34-f352-41bc-addc-dac9392f80b2"
type: "capability"
title: "Completion must not cascade over an explicit in_progress parent, or outside the run's subtree"
slug: "completion-must-not-cascade-over-an"
statement: "Completion cascades from a child to its parents only inside the subtree of the task a run works on, never over a parent whose status is explicitly in_progress, and never rewrites attribution on items the run did not intend to change."
criteria: [{"id":"c1","text":"When an item's last child completes and the item's own status is in_progress, the completion cascade shall leave the item's status unchanged."},{"id":"c2","text":"The completion cascade shall modify only items inside the subtree of the task the run is working on."},{"id":"c3","text":"A run shall leave lastModifiedBy unchanged on every item it did not intentionally modify."},{"id":"c4","text":"When a run makes zero tool calls, such as when it hits a session limit or fails immediately, the run shall change only its own task's status in the PRD."}]
tags:
  - "reliability"
  - "release-0.6.0"
  - "rex"
  - "gh-368"
  - "data-integrity"
source: "GitHub #368, found during the wave-1 session 2026-09-11"
priority: "critical"
---

GitHub #368. Severity: critical — silent loss of ANOTHER PERSON'S tracked work, plus authorship misattribution. Distinct from #364: that one was about which CHILD statuses count as done; this is about whether the PARENT should be touched at all.

OBSERVED
`ndx work --task=<x> --auto --yes` hit the account session limit on turn 1. The run record: status failed, turns 1, "Tool calls: 0", "Changes: none". The agent never ran. Yet four PRD files came back modified — two were the attempted task's own status, and two were in a completely unrelated epic:

  .rex/prd_tree/testing-documentation/n-dx-rex-fails-intermittently-under/index.md
    task d3a995ca  in_progress -> completed
  .rex/prd_tree/testing-documentation/index.md
    epic 738f6000  pending -> completed

Both had lastModifiedBy rewritten from "sterling.h@endash.us" to the user running the command.

The completed task is an open investigation whose own description ends "Whether the correct fix is in the lock, the guard, or the test's expectation that two concurrent imports both succeed is the open question." Its acceptance criteria require a root cause and a fix; none was done. It has one child subtask which IS completed — and that is the trigger. Completion cascaded up from the only child, overrode the parent's explicit in_progress, then cascaded again to the epic.

Reverted by hand before committing. It was caught only because the run left the tree dirty and the diff was read. A run that committed normally would have swept a teammate's closed task into an unrelated PR.

WHY #364's FIX DOES NOT COVER THIS
#364 narrowed TERMINAL_CHILD_STATUSES from {completed, deferred} to {completed}. Here the child genuinely IS completed, so the narrowed predicate is still satisfied and the cascade still fires. The two fixes are independent and both are needed.

REQUIRED BEHAVIOUR
1. An item whose own status is explicitly in_progress is NOT auto-completed by a child transition. Someone set that deliberately, and the parent has work of its own.
2. An item with unmet acceptance criteria of its own is not completed on its children's behalf. (Decide whether this is a separate guard or subsumed by (1); record the reasoning.)
3. A cascade never modifies items outside the subtree the run is operating on. The run here targeted a task in a different epic entirely.
4. Attribution is not rewritten on an item the run did not intentionally modify — lastModifiedBy should not change on a cascade the user did not ask for.

Of these, (3) is the containment guarantee and probably the most valuable: it bounds the blast radius regardless of what the completion predicate decides.

REPRODUCTION
PRD containing an in_progress task whose only child is completed. Run any `ndx work` invocation that fails early — the session-limit path reproduces with zero tool calls. Inspect `git status`.
