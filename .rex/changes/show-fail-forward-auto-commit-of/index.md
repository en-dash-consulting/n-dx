---
id: "01856e28-5c0d-477d-b6a5-1c7022e3e6f5"
type: "change"
title: "Show fail-forward, auto-commit of generated files and the token budget column as ordinary settings"
slug: "show-fail-forward-auto-commit-of"
intent: "From the 2026-11-12 feature-flag audit. Three registry entries are personal preferences rather than experiments, and should stay opt-in permanently:\n\n- git.failForward: commit after every run, loop iteration and settings change (marked experimental; read by ndx work through isFailForwardEnabled in llm-client).\n- git.autoCommitGenerated: commit a working tree whose changes all came from one tool (marked experimental).\n- rex.showTokenBudget: the token budget column on tasks (already marked stable, default off since 2026-03-06).\n\nMark them stable and present them on Project settings as settings, apart from the experimental feature flags, with their defaults unchanged (off). Keep the stored keys under `features` so existing .n-dx.json files keep working; renaming them is not part of this change."
acceptanceCriteria:
  - "All three are marked stable and none is labelled experimental anywhere in the dashboard"
  - "Project settings shows them apart from the experimental feature flags"
  - "All three still default off, and a value already stored under features keeps working"
  - "A patch changeset for @n-dx/web"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "low"
tags:
  - "feature-flags"
  - "web"
  - "settings"
source: "ndx-capture"
blockedBy:
  - "fbc4c752-bc1d-44e0-8815-a618d18eced1"
---
