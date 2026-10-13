---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

The base workflow now tells an agent when to use the two v2 tools its run is
granted, and a task-less change is covered end to end as a unit of work.

`get_capability` and `place_change` are in the rex MCP tools a run may call,
but no prompt asked for either, and the rule behind that list is that a tool
no prompt asks for does not belong in it. The base workflow
(`.rex/n-dx_workflow.md`, rewritten by `ndx init`) now says: on a v2 PRD, read
a capability with `get_capability` when the brief's trimmed entry cannot tell
you whether the change is finished (step 2); and place a follow-up captured
with `add_item` using `place_change`, because an untargeted change lands in
the Inbox carrying `needsPlacement` and is never selected autonomously from
there (step 9). The autonomous adversarial-review pass says the same of the
findings it captures. A test now checks that every granted tool is named in
the base workflow, and that `apply_change` — the one PRD write the completion
hold cannot withdraw — stays operator-only; the allowlist's own comment
carries that rationale.

A hench integration test runs a task-less change through a real v2 tree: the
store `resolveStore` returns is the change layer, selection picks the change
itself and claims it, picks a task over its change where one exists, refuses
rather than falling back to the v1 selector when v2's rules leave nothing to
run, and a completion held on the claim is written to the change's
`state.yaml` once the test gate passes.
