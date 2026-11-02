---
"@n-dx/rex": patch
"@n-dx/web": patch
---

The Sidecar Place lens drafts where an Inbox change belongs on a v2 PRD. Its packet carries the change, rex's top-5 shortlist with scores, strengths and reasons, each candidate's statement and capability criteria, the default relation and the rule that set it, and the open changes already amending a candidate. Without an attached change, or on a v1 tree, the lens is unavailable and says what it needs.

`place_change_card` now carries out a placement. The card shows rex's dry run (the target's spec hash for an amends placement, or rex's refusal kind) and, on approval, writes through the same rex place and propose rules as the Inbox routes. A proposed capability or constraint is recorded on the change only, and reaches the product map when the change is applied. `POST /api/rex/changes/:id/placement/check` returns the same dry run and writes nothing.

Rex's `suggestPlacement` now returns `relationRule` and each candidate's `amendedBy`, and `GET /api/rex/changes/:id/placement` includes both.
