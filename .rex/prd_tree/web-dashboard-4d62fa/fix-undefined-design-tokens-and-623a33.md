---
id: "623a333a-753b-4609-8edc-6d21db064719"
level: "feature"
title: "Fix undefined design tokens and standardize buttons on General and analyze/plan settings pages"
status: "completed"
priority: "medium"
startedAt: "2026-08-17T15:41:43.504Z"
completedAt: "2026-08-17T15:41:43.504Z"
endedAt: "2026-08-17T15:41:43.504Z"
acceptanceCriteria:
  - "All --color-*/--spacing-* var() usages in llm-provider.css and project-settings.css are remapped to defined theme tokens"
  - "Save/Discard buttons on both pages use the standard cmd-btn primary/secondary variants; superseded llm-btn/ps-btn CSS removed"
  - "Light/dark theme parity on both pages via shared tokens"
  - "No behavior changes; full web suite passes"
description: "The General (llm-provider) and 'n-dx analyze / plan' (project-settings) settings pages were styled against an undefined token vocabulary (--color-*/--spacing-*), leaving 163 declarations inert and the pages visually unformatted. Remap all usages to the real theme tokens and replace the ad-hoc llm-btn/ps-btn Save/Discard buttons with the standard cmd-btn variants. Backfilled capture: work completed in commit c98e51dda."
---
