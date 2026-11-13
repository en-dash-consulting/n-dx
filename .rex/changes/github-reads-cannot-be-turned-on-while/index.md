---
id: "a35cd554-744e-426e-967c-802914fe8fc6"
type: "change"
title: "GitHub reads cannot be turned on while only branch health uses it"
slug: "github-reads-cannot-be-turned-on-while"
summary: "The setting that lets branch health and the Sidecar read pull requests and checks from GitHub only appears, and can only be saved, while the Sidecar is on. A project that uses branch health without the Sidecar has no way to turn it on from the dashboard."
intent: "Found by the adversarial review of the Project settings redesign (#1040). Pre-existing: Workflow › Sidecar had the same gating before the switch moved to Project › Connections.\n\nweb.sidecarGithubReads is read by GET /api/branch-health (routes-branch-health.ts readSidecarSettings(...).githubReads) whether or not the Sidecar is on, and by the Sidecar broker. But the Project page renders the GitHub reads row only while web.sidecar is on (views/project.ts rows), and the row reads and saves through GET/PUT /api/sidecar/settings, which the route feature gate refuses while web.sidecar is off (route-feature-gates.ts, prefix /api/sidecar).\n\nTrigger: web.sidecar off, git.branchHealth on. The Workspaces health strip says GitHub reads are off, and nothing in the dashboard can turn them on.\n\nFix (recommended): read and save githubReads through /api/project-settings, which is not Sidecar-gated, using the existing saveSidecarSettings writer so the value still lands in the local config and the shared config true still waits for trust; show the row while the Sidecar or branch health is on. Rejected: exempting /api/sidecar/settings from the Sidecar gate (an exception list in the gate registry for one route)."
acceptanceCriteria:
  - "With web.sidecar off and git.branchHealth on, Project › Connections shows the GitHub reads switch, and Save turns GitHub reads on"
  - "GET /api/project-settings reports githubReads as the value in force, and PUT accepts githubReads (true, false or null), writing it to the local config as the Sidecar route does"
  - "The switch is hidden while neither the Sidecar nor branch health is on"
  - "A Save that changes only GitHub reads does not rewrite .n-dx.json"
  - "A patch changeset for @n-dx/web"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "medium"
source: "ndx-capture"
---
