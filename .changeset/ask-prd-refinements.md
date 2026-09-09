---
"@n-dx/web": patch
---

Let the Ask exchange propose PRD refinements, diff-reviewed and written under
the store lock.

Capture files a new item; a refinement changes one that exists. That difference
sets the terms: adding a wrong item leaves a wrong item to delete, while
rewriting acceptance criteria destroys what was there, and an LLM doing that
unreviewed is how a PRD quietly loses its history.

With "Propose PRD changes" ticked, the answer may carry mutations to existing
items — description, acceptance criteria, priority, parent, or merging a
duplicate sibling — as structured fields, not prose. Each renders as a
before/after diff of exactly the field it changes, with its rationale, and is
accepted or rejected on its own. Nothing is written by being proposed: the
verdicts are local, and rejecting everything sends no request at all rather
than an empty one.

Accepted proposals go to `POST /api/rex/apply-refinements`, which applies them
through the gateway's `resolveStore` inside `withTransaction`. That holds the
PRD file lock across load → mutate → save, so a concurrent writer — hench
finishing a task, an MCP `edit_item`, a `rex reshape` in another terminal —
cannot be silently overwritten. When the lock is held the route returns 409 with
the lock's own message, which names the holder's PID.

Every proposal carries the `before` it was written against, and that is checked
inside the lock against the freshly loaded document — not when the proposal was
made, and not before the lock, either of which leaves a window for the item to
change. A proposal whose item has moved on is refused individually with the
reason; the rest of the batch still applies, because one item changing
underneath the user is not a reason to discard their other decisions.

Applied changes refresh the PRD cache and broadcast `rex:prd-changed`, so the
PRD views pick them up without a restart.
