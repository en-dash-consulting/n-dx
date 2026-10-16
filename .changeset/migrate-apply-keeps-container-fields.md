---
"@n-dx/rex": patch
---

`rex migrate-apply` keeps a dissolved release epic's description and acceptance criteria under its line in the cut change's body, and moves its own `blockedBy` onto its open children, so a release's work still waits for the release it depended on.
