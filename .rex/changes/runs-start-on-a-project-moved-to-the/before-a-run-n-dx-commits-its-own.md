---
id: "8b4233b1-cb6a-4b38-a21b-7d0143d48bd4"
type: "task"
title: "Before a run, n-dx commits its own pending planning files as their own commit; other uncommitted files still refuse"
slug: "before-a-run-n-dx-commits-its-own"
description: "Decision UT1. The pre-run gate (packages/hench/src/agent/lifecycle/shared.ts:3046, message :3103) and its --resolve twin (run-resolve.ts:456-465) filter git status only through excludeHenchRuntimeArtifacts (hench/src/store/artifacts.ts:303), so the PRD roots and n-dx's project config count as dirty. Split the dirty set: n-dx planning files (BOOKKEEPING_PATHS, hench/src/store/paths.ts:171, for both layouts, plus the project config .ndx/config.json or .n-dx.json) versus everything else. When only planning files are dirty, commit exactly those (git add of those paths only, never -A) in one commit titled like \"chore(prd): commit planning changes before run\" with the usual N-DX-Item trailer for the task about to run, then start. When anything else is dirty, refuse as today but list only the non-planning files. --resolve reports that the planning files would be committed. --allow-dirty keeps its meaning. A dashboard or Sidecar start shows the same outcome. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "With only PRD/config files dirty, the run commits exactly those in one commit and starts (hench test)"
  - "With an app file also dirty, the run refuses and names only the non-planning files (hench test)"
  - "--resolve reports the planning files it would commit (hench test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
