---
id: "a58edbcf-4588-47ef-9c99-eb02aac46f41"
type: "capability"
title: "Standardize Rex Analysis and Hench Optimization pages to shared dashboard UI styles"
slug: "standardize-rex-analysis-and-hench"
statement: "The dashboard's Rex Analysis page and Hench Optimization page use the dashboard's shared UI styles for their buttons, panels, headings, spacing and interactive controls."
criteria: [{"id":"c1","text":"The Rex Analysis page shall render every button with the standard dashboard button styles, including size, color tokens and hover and disabled states, and no ad-hoc button styling."},{"id":"c2","text":"The Rex Analysis page shall format its headings, panels, spacing, lists and tables to match the existing dashboard conventions."},{"id":"c3","text":"The Hench Optimization page shall render its buttons and UI elements with the same standard dashboard styles as the Rex Analysis page."},{"id":"c4","text":"When the dashboard switches between light and dark themes, the Rex Analysis page and the Hench Optimization page shall keep equivalent styling in both themes."}]
priority: "medium"
---

Bring the Rex section's Analysis page (packages/web/src/viewer/views/analysis.ts, view id 'analysis') and the Hench Optimization page (view id 'hench-optimization') in line with the dashboard's established button styling and UI element conventions — the standard styling used by the recent Overview restyle work. Covers buttons, panels, headings, spacing, and interactive controls on both pages.
