---
id: "136a8c3e-485e-4a79-8a82-0241d5479005"
level: "feature"
title: "Match settings-page text boxes to the Analyze & Import input style and fix dark-mode native form chrome"
status: "completed"
priority: "medium"
startedAt: "2026-08-17T16:08:06.505Z"
completedAt: "2026-08-17T16:08:06.505Z"
endedAt: "2026-08-17T16:08:06.505Z"
acceptanceCriteria:
  - "llm-text-input, ps-number-input, ps-select, and ps-pin-input visually match smart-add-textarea (background, radius, padding, focus ring)"
  - "No invalid var(--bg)) declarations remain in llm-provider.css or project-settings.css"
  - "color-scheme is declared on both theme roots so native form chrome follows the active theme"
  - "No behavior changes; full web suite passes"
description: "Align the text boxes on the General and 'n-dx analyze / plan' settings pages with the Analyze & Import input box (bg-surface background, radius-md, space-2/3 padding, accent border + accent-subtle focus ring), repairing four invalid var(--bg)) background declarations and a mangled active-vendor-card background left by the earlier token remap (transparent inputs, visible only in dark mode). Also declare color-scheme: dark/light on the theme roots so native form chrome (select popups, number spinners, scrollbars, autofill) follows the active theme. Backfilled capture: completed in commits f683d8ed7 and f42b6b182."
---
