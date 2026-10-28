---
id: "17be629f-ce13-4dc1-bc14-8685f486342f"
type: "change"
title: "Learn: gate pass rate by model tier from run records"
slug: "learn-gate-pass-rate-by-model-tier"
intent: "Slice S5 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, decision PP4).\n\nLearn's first new tile, Outcomes by tier: the gate pass rate per vendor and tier over the last 30 days, from the hench run records already on disk (the gate result is in most records). Keyed on vendor plus tier, never model name alone, since models are renamed and retired; the resolved model stays visible for audit. The tile says \"runs on this machine\": run records are machine-local and per checkout, and runs in removed worktrees are gone until the learning-evidence store keeps them. Records without a gate result are left out of the rate and counted separately.\n\nThis is the first step toward calibration, with no new data."
acceptanceCriteria:
  - "Learn shows an Outcomes by tier tile with gate pass rate and run count per vendor and tier for the last 30 days"
  - "Runs without a gate result are excluded from the rate and shown as a count"
  - "The tile states that it covers runs on this machine"
  - "A unit test computes the rates from fixture run records"
touches:
  - "fdc6c3d4-34f6-4805-8473-a4e672582582"
  - "a19a8bac-6c65-4590-b2b7-543d9e01843c"
priority: "low"
tags:
  - "web"
  - "hench"
  - "dashboard"
  - "plan-page-redesign"
  - "learn"
source: "ndx-capture"
blockedBy:
  - "f5c7b061-22b2-4b84-93cd-55793d328d68"
---
