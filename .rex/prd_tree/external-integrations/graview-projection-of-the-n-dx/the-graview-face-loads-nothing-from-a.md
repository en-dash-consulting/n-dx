---
id: "917eb3f3-3c79-449d-b77d-61ef2a0aa4eb"
level: "task"
title: "The Graview face loads nothing from a CDN, and only the face may skip the release-age gate"
status: "pending"
priority: "low"
tags:
  - "graview"
  - "security"
source: "notepad:graview-run"
acceptanceCriteria:
  - "The face's fonts are bundled with it and index.html makes no request to another origin"
  - "The release-age exemption for graview and @graview/* applies only to the packages that pin them, or is documented with the reason it cannot be narrowed"
description: "From the graview run's notepad. The face's index.html loads its fonts from Google Fonts, so every page view calls a third party; self-host them before the face is served anywhere a CDN call is unwelcome. And pnpm-workspace.yaml exempts graview and @graview/* from the three-day release-age gate for the whole workspace, though only @n-dx/graview-face and the adapter's devDependency need it."
lastModified: "2026-10-13T00:04:54.925Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
