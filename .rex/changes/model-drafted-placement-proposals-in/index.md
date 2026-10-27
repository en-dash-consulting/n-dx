---
id: "43951e89-3957-4fa2-bac3-80d0a4767fe5"
type: "change"
title: "Model-drafted placement proposals in the dashboard, behind a feature toggle"
slug: "model-drafted-placement-proposals-in"
intent: "PR 5 of 5 for issue #873 (later; IB4). Design: https://claude.ai/artifact/PS6Jg1NgsJ2a6nidJx4HBm.\n\nWhen nothing on the rules' shortlist fits, the detail panel's proposal form (PR 3) is filled by hand. Rex's placement model (`prd.place` task class, `analyze/place-reason.ts`, via `placeChange` in `core/placement.ts`) can pick a target or propose a new node under a known area, but only runs at capture time. This change lets the steward ask the model to draft the form from the dashboard. It never writes: the draft fills the form, and a person places or proposes. Each call spends tokens, so it sits behind a feature toggle that defaults off and is enforced on the server with `isFeatureEnabled`, the way `sourcevision.ask` is (see packages/web/AGENTS.md, feature-toggle enforcement: every entry point reads the same toggle)."
acceptanceCriteria:
  - "With the toggle off, the Draft button is hidden or disabled and the draft route refuses"
  - "With it on, Draft with the model fills the proposal form or selects a candidate from the model's answer and writes nothing"
  - "A model answer under an unknown area or malformed is reported, not applied"
  - "Changeset bumps the changed packages as patch"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "low"
tags:
  - "inbox-placement"
  - "issue-873"
  - "web"
  - "rex"
source: "ndx-capture"
blockedBy:
  - "21a8d036-41d6-45fb-b10c-181f074f3e4f"
---
