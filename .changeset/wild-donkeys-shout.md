---
"@n-dx/web": patch
---

SourceVision Ask: propose and apply PRD refinements, reviewed as diffs and written under the store lock.

A new opt-in refine mode sends the PRD with the question and lets the answer carry proposed changes to existing items — a rewritten description, replacement acceptance criteria, a different priority, a reparent, or a merge with a duplicate sibling. Each proposal renders as a before/after diff of exactly the fields it changes and is accepted or rejected on its own; rejecting issues no request at all.

Accepted proposals go to `POST /api/rex/apply-refinements`, which applies them through the rex gateway's `resolveStore` inside `withTransaction`. A proposal whose item changed since the answer was generated is refused as stale rather than applied over the top of whoever changed it, and a PRD lock held by another writer fails the request loudly, naming the holder's PID.
