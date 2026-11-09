---
id: "36dd680c-c708-4157-8c08-f1c468b4ad61"
type: "change"
title: "rex branch add reports \"Already on\" for a task an earlier branch of the same name left, which is not in the set"
slug: "rex-branch-add-reports-already-on-for"
intent: "Verdict: should-fix (medium). Introduced by task 6a45f6d1 (earlier-use rule for work sets).\n\nScenario: on feat/x assign task T and leave it pending; merge feat/x into main and delete it; `git switch -c feat/x` from main. T's `delivery.branch` is feat/x on main at the fork point, so readWorkSet lists it in `earlier`, not `ids`. `rex branch add T` (or MCP assign_to_branch, or adding its change) then finds effectiveDelivery(T).branch === \"feat/x\" and reports \"Already on feat/x\" (packages/rex/src/core/work-set.ts planAssignToBranch, `from === branch` -> unchanged), writing nothing. `rex branch show` still says the branch has no work set and names T as from an earlier branch, and `rex next` does not narrow to it. The operator is told the task is in the set when every reader says it is not, and has no way to put it there short of remove-then-add (which drops the provenance). The same applies to a new task added under a change whose own delivery came from the earlier branch: it inherits the earlier owner and cannot be assigned.\n\nReachable: `rex branch add`, MCP `assign_to_branch`, on any branch name reused while an earlier use left an open unit (pending, failing, in progress) on the default branch.\n\nOptions:\n1. (Recommended) Pass the earlier-use row set into planAssignToBranch (assignToBranch reads it with earlierUseRows for the checked-out workspace) and treat a unit whose delivery owner is earlier as not on this branch; on assign, write a delivery that differs from the fork-point row (e.g. a passthrough field such as `since: <fork-point sha>` or an assigned-at marker that earlierUseRows compares) so the row is no longer equal to its fork-point value. Cost: a schema-compatible delivery field plus the comparison in earlierUseRows; risk: soft-freeze surface change to state.yaml (DeliverySchema is passthrough).\n2. Compare rows by full delivery value instead of branch only, and have assign rewrite delivery with a fresh field. Same cost class.\n3. Refuse with a clear message (\"comes from an earlier branch of this name; remove it first\") — cheapest, keeps readers truthful, but leaves no one-step way to re-adopt the unit. Decision for Ryan: whether re-adopting an earlier unit should be one command."
acceptanceCriteria:
  - "On a branch cut again under a merged branch's name, `rex branch add <id>` for an open unit the earlier branch left does not report it as already on the branch: it either joins this branch's set (shown by `rex branch show` and picked by `rex next`) or is refused with a message naming the earlier branch"
  - "MCP assign_to_branch behaves the same as `rex branch add` in that case"
  - "A test in a temporary repository covers the merged-and-reused name with an open earlier unit being assigned"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "medium"
discoveredFrom: {"item":"6a45f6d1-b249-48ff-8e90-e45a7b49fc04","run":"7a64c65a-ecc3-42a5-9124-86591c0c24bb"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
