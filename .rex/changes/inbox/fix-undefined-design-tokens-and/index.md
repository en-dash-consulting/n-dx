---
id: "623a333a-753b-4609-8edc-6d21db064719"
type: "change"
title: "Fix undefined design tokens and standardize buttons on General and analyze/plan settings pages"
slug: "fix-undefined-design-tokens-and"
intent: "The General (llm-provider) and 'n-dx analyze / plan' (project-settings) settings pages were styled against an undefined token vocabulary (--color-*/--spacing-*), leaving 163 declarations inert and the pages visually unformatted. Remap all usages to the real theme tokens and replace the ad-hoc llm-btn/ps-btn Save/Discard buttons with the standard cmd-btn variants. Backfilled capture: work completed in commit c98e51dda."
acceptanceCriteria:
  - "All --color-*/--spacing-* var() usages in llm-provider.css and project-settings.css are remapped to defined theme tokens"
  - "Save/Discard buttons on both pages use the standard cmd-btn primary/secondary variants; superseded llm-btn/ps-btn CSS removed"
  - "Light/dark theme parity on both pages via shared tokens"
  - "No behavior changes; full web suite passes"
priority: "medium"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Match settings-page text boxes to the Analyze & Import input style and fix dark-mode native form chrome" (136a8c3e-485e-4a79-8a82-0241d5479005).
