---
id: "933f5c2a-b488-46cc-83f9-15cfb1a76565"
level: "task"
title: "Add density selector control next to theme toggle with persisted preference"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "settings"
source: "smart-add"
acceptanceCriteria:
  - "Three-option segmented control (S / M / L) is rendered immediately adjacent to the theme toggle"
  - "Selecting an option updates the UI density without a page reload"
  - "The choice persists across reloads via localStorage using a stable key (e.g. `ndx.ui.density`)"
  - "Default density for users without a stored preference is `medium` and produces no visible change from the pre-feature UI"
  - "Control is keyboard-accessible and exposes appropriate ARIA roles/labels"
description: "Add a small/medium/large segmented control adjacent to the existing dark/light theme toggle in the dashboard header. Selection writes to localStorage (mirroring how the theme preference is stored) and applies the `data-density` attribute on the root element on every load. Default value is `medium` for new and existing users so behavior is unchanged until the user opts in."
---
