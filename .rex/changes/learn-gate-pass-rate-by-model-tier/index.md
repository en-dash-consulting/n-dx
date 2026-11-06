---
id: "17be629f-ce13-4dc1-bc14-8685f486342f"
type: "change"
title: "Tune: gate pass rate by tier and a Your tooling tile"
slug: "learn-gate-pass-rate-by-model-tier"
intent: "Slice S5 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12; decisions PP4, TN0, TN2).\n\nTune's first two new tiles:\n- Outcomes by tier: the gate pass rate per vendor and tier over the last 30 days, from the hench run records already on disk. Keyed on vendor plus tier, never model name alone, since models are renamed and retired; the resolved model stays visible for audit. The tile says \"runs on this machine\": run records are machine-local and per checkout, and runs in removed worktrees are gone until the learning-evidence store keeps them. Records without a gate result are left out of the rate and counted separately.\n- Your tooling (TN2): a read-only summary of what this project can run on: connected vendor CLIs, the model for each tier, per-command routes and review pairing, linking to Settings › Robot Wrangler and Workflow, where editing stays (TN1). The Sidecar's own settings and C1's connections join this tile in S8.\n\nThe first steps toward calibration, with no new data."
acceptanceCriteria:
  - "Tune shows an Outcomes by tier tile with gate pass rate and run count per vendor and tier for the last 30 days"
  - "Runs without a gate result are excluded from the rate and shown as a count"
  - "The Outcomes tile states that it covers runs on this machine"
  - "Tune shows a read-only Your tooling tile listing vendor CLIs and their state, models per tier, per-command routes and review pairing, with links to the Settings fields"
  - "Unit tests compute the rates from fixture run records and render Your tooling from fixture config"
touches:
  - "fdc6c3d4-34f6-4805-8473-a4e672582582"
  - "a19a8bac-6c65-4590-b2b7-543d9e01843c"
priority: "low"
tags:
  - "web"
  - "hench"
  - "dashboard"
  - "plan-page-redesign"
  - "tune"
source: "ndx-capture"
blockedBy:
  - "f5c7b061-22b2-4b84-93cd-55793d328d68"
---
