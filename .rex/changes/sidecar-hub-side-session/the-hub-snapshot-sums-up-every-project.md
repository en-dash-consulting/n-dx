---
id: "a5beb47d-a6c2-47da-a926-3078533e060d"
type: "task"
title: "The hub snapshot sums up every project's worktrees, runs, PRs and changesets in 8k characters"
slug: "the-hub-snapshot-sums-up-every-project"
description: "Story 25, part 1 of 3 (CAOS 3f7a80b7-1924-81b5-9c3e-d5aa3573b938). A pure snapshot builder over data the host fetches from the hub's HTTP API, plus the one read route the data lacks (pending changesets). Design §6 Hub snapshot. No session or UI in this task."
acceptanceCriteria:
  - "buildHubSnapshot (server/sidecar/hub-snapshot.ts) is a pure function from fetched JSON to text of at most 8,000 characters; over the cap it drops the lowest-priority detail and states how many items it left out"
  - "Every item that changed since the previous snapshot is marked Δ; a test builds twice over changed inputs and checks that changed items carry Δ and unchanged ones do not"
  - "Per project it shows the PRD layout (v1 flagged 'not migrated'), each worktree's branch, dirty count, ahead/behind, claim and latest run status with its diagnosis class, active runs against the limit of 3, and the hub admission queue"
  - "Per open PR it shows base, stack position and contains-below, review decision, check rollup, mergeability and conflict class from R2's branch health; when GitHub reads are off for a project the section says so instead of guessing"
  - "A new project-server read route lists pending .changeset/*.md files with each package and bump type (fs read, no child_process); the snapshot flags any major bump and any changeset text mentioning 1.0.0"
  - "A project with reachable:false in /api/hub/overview still appears, marked unreachable with its error, and every other project's section still builds"
  - "The fetcher reads only hub HTTP routes (/api/hub/overview, /api/hub/queue, /p/<id>/... routes) with the hub token; no path is hand-spelled (resolveNdxHome / resolveLayout), and layout-literal-policy passes"
priority: "high"
source: "caos"
---
