---
id: "21d0a1c3-10c5-486b-a712-7a9cc9ab30b3"
level: "task"
title: "Make SourceVision findings list, filter controls, and finding detail panels keyboard and screen-reader accessible"
status: "completed"
priority: "high"
tags:
  - "a11y"
  - "sourcevision"
  - "findings"
  - "aria"
source: "smart-add"
startedAt: "2026-08-03T14:59:13.040Z"
completedAt: "2026-08-03T15:09:33.366Z"
endedAt: "2026-08-03T15:09:33.366Z"
acceptanceCriteria:
  - "Findings are rendered as <li> inside a <ul role='list'> or equivalent semantic list structure"
  - "Filter controls (type, zone, severity) use native <select> elements or ARIA combobox pattern with keyboard support"
  - "An aria-live='polite' region announces the count of visible findings when filters change"
  - "Finding severity/priority is conveyed by both color AND a text label or aria-label (not color alone)"
  - "Expandable finding rows have aria-expanded state; expanded content is adjacent in DOM order"
  - "axe-core reports no critical/serious violations on the findings view"
description: "The findings view displays a filterable list of code analysis findings (anti-patterns, observations, suggestions, structural issues). Findings can be expanded to show detail. Ensure the filter dropdowns use proper <select> or ARIA combobox patterns, finding rows are list items in a <ul role='list'>, expandable finding detail uses aria-expanded, and the total/filtered count is announced via a live region when filters change. Priority badge colors must not be the sole indicator of severity."
---
