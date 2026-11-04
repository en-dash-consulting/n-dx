---
id: "d1255dab-4b11-4a2b-98d3-813b94b4b651"
type: "change"
title: "Repo-scope run reads look in the worktree root's .hench, not the served project's, when the project sits in a subdirectory of its git repo"
slug: "repo-scope-run-reads-look-in-the"
intent: "Found by the adversarial review of 8cb5a7fc (Sidecar Diagnose run reads every worktree). Verdict: out-of-scope (pre-existing in resolveRunSources, packages/web/src/server/routes-hench.ts:392). Severity: medium.\n\nScenario: a project initialised in a subdirectory of its git repository (repo/app with app/.hench). resolveRunSources maps every worktree to join(resolveLayout(wt.path).henchDir, \"runs\"), i.e. repo/.hench/runs, ignoring the served project's offset from the worktree root (getWorktreeRoot(ctx.projectDir) = repo, projectDir = repo/app). Runs (?scope=repo), Live's running-run sweep, collectHeldRuns and now the Sidecar Diagnose run lens (taskRun through resolveRunTargets, and its `hench runs diagnose <worktree root>` spawn) read a runs directory that does not exist, so the project's runs read as none. Before 8cb5a7fc the Diagnose run lens read ctx.projectDir's own runs, so that lens regressed for this layout; Runs and Live had the gap already.\n\nReachable: `ndx start` in a subdirectory project, then Runs with scope=repo, Live, or a Diagnose run Sidecar session.\n\nOptions:\n(a) Recommended: in resolveRunSources, apply the served project's relative path from its worktree root to every worktree: root = join(wt.path, relative(servedRoot, ctx.projectDir)), runsDir from resolveLayout(root). Cost: a few lines plus tests; risk: a sibling worktree without that subdirectory simply has no runs (existsSync already handles it).\n(b) Fall back to the served directory alone when projectDir is not a worktree root. Cheap but loses sibling runs for those projects."
acceptanceCriteria:
  - "With a git repo whose n-dx project is in a subdirectory (repo/app/.hench/runs holding a run), resolveRunTargets(ctx with projectDir repo/app) returns runsDir repo/app/.hench/runs for the served worktree and <sibling>/app/.hench/runs for a sibling (unit test with a real git worktree)"
  - "GET /api/hench/runs?scope=repo and the Sidecar Diagnose run packet list that run for the subdirectory project (test)"
  - "The Diagnose run fallback spawns `hench runs diagnose` with the worktree's project directory (<worktree>/app), not the worktree root (test)"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
discoveredFrom: {"item":"8cb5a7fc-a5c6-4744-b317-6b7b941b2e4c","run":"a41015c2-7aba-498b-aa56-ca26d64b78d9"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
