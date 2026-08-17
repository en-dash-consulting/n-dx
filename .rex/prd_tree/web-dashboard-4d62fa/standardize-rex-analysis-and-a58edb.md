---
id: "a58edbcf-4588-47ef-9c99-eb02aac46f41"
level: "feature"
title: "Standardize Rex Analysis and Hench Optimization pages to shared dashboard UI styles"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "All buttons on the Rex Analysis page use the standard dashboard button styles (size, color tokens, hover/disabled states) — no ad-hoc styling"
  - "Page formatting (headings, panels, spacing, lists/tables) on the Analysis page matches existing dashboard conventions"
  - "The Hench Optimization page's buttons and UI elements follow the same standard styling"
  - "Light/dark theme parity preserved on both pages"
  - "No behavior changes; existing web tests pass"
description: "Bring the Rex section's Analysis page (packages/web/src/viewer/views/analysis.ts, view id 'analysis') and the Hench Optimization page (view id 'hench-optimization') in line with the dashboard's established button styling and UI element conventions — the standard styling used by the recent Overview restyle work. Covers buttons, panels, headings, spacing, and interactive controls on both pages."
---
