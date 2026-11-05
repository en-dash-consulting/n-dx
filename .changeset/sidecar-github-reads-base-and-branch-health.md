---
"@n-dx/web": patch
---

Sidecar's `github_read` of a check calls it "failing on main" only when the base is the repository's default branch; on any other base, such as a stacked PR's parent layer, the class is "failing on the base (<base>)". A `pr` read while `git.branchHealth` is off reads nothing and raises no card, as `GET /api/branch-health` already refuses.
