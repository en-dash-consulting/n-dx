---
"@n-dx/rex": patch
"@n-dx/web": patch
---

The Sidecar Place lens drafts where an Inbox change belongs on a v2 PRD. Its packet carries the change, rex's top-5 shortlist with scores, strengths and reasons, each candidate's statement and capability criteria, the default relation and the rule that set it, and the open changes already amending a candidate. Without an attached change, or on a v1 tree, the lens is unavailable and says what it needs.

`place_change_card` now carries out a placement. The card shows rex's dry run (the target's spec hash for an amends placement, or rex's refusal kind) and, on approval, writes through the same rex place and propose rules as the Inbox routes. A proposed capability or constraint is recorded on the change only, and reaches the product map when the change is applied. `POST /api/rex/changes/:id/placement/check` returns the same dry run and writes nothing.

The placement card lets the operator review and edit before anything is written: the shortlist as radio rows with score, strength and reasons, a row to propose a new capability or constraint, a touches/amends toggle and, for amends, an editor for the statement and the criteria add, replace and remove. An edit re-checks through the placement check route, and Place stays disabled until the dry-run line for the edited placement is back. Approving sends the edit with the decision and rex writes the edited placement; Leave in Inbox and Deny write nothing. "Place with Sidecar" on the Inbox triage page and on a change awaiting placement attaches the change and opens the drawer on Place, and shows nothing while `web.sidecar` is off.

Rex's `suggestPlacement` now returns `relationRule` and each candidate's `amendedBy`, and `GET /api/rex/changes/:id/placement` includes both.
