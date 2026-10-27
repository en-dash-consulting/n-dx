---
id: "136a8c3e-485e-4a79-8a82-0241d5479005"
type: "capability"
title: "Match settings-page text boxes to the Analyze & Import input style and fix dark-mode native form chrome"
slug: "match-settings-page-text-boxes-to-the"
statement: "The web dashboard's General and 'n-dx analyze / plan' settings pages draw their text boxes in the same style as the Analyze & Import input box, and native form controls follow the active light or dark theme."
criteria: [{"id":"c1","text":"The settings pages shall render the llm-text-input, ps-number-input, ps-select and ps-pin-input controls with the same background, border radius, padding and focus ring as the smart-add-textarea input."},{"id":"c2","text":"While dark mode is active, the settings pages shall give their text inputs and the active vendor card the surface background, not a transparent one."},{"id":"c3","text":"When a settings input receives focus, the dashboard shall show an accent border and an accent-subtle focus ring."},{"id":"c4","text":"The dashboard shall declare color-scheme on both the dark and light theme roots, so native select popups, number spinners, scrollbars and autofill follow the active theme."}]
priority: "medium"
---

Align the text boxes on the General and 'n-dx analyze / plan' settings pages with the Analyze & Import input box (bg-surface background, radius-md, space-2/3 padding, accent border + accent-subtle focus ring), repairing four invalid var(--bg)) background declarations and a mangled active-vendor-card background left by the earlier token remap (transparent inputs, visible only in dark mode). Also declare color-scheme: dark/light on the theme roots so native form chrome (select popups, number spinners, scrollbars, autofill) follows the active theme. Backfilled capture: completed in commits f683d8ed7 and f42b6b182.
