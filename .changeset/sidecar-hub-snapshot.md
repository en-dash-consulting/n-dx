---
"@n-dx/web": patch
---

Adds the hub snapshot builder for the coming hub Sidecar session: every registered project's PRD layout (v1 flagged "not migrated"), worktrees (branch, dirty count, ahead/behind, claim, latest run and its diagnosis class), active runs against the limit, the hub queue, open PRs (base, stack and containment, review, checks, mergeability, conflict classes) and pending changesets (major bumps and "1.0.0" mentions flagged), within 8,000 characters, with items changed since the last build marked Δ. Its input is read over the hub's HTTP API with the per-user token. New read route `GET /api/changesets` lists `.changeset/*.md` with each package's bump. `GET /api/status` now reports `rex.layout`, `GET /api/worktrees` each latest run's `diagnosisClass`, and `GET /api/branch-health` `githubReads`.
