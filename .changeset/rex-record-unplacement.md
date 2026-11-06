---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Taking back a touches is rex's `recordUnplacement`: `POST /api/rex/changes/:id/unplace` refuses a cancelled change (`change-not-open`) and a target the change does not touch (`not-touched`), and runs the v2 rules, as a placement does.
