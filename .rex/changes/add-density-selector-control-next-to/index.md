---
id: "933f5c2a-b488-46cc-83f9-15cfb1a76565"
type: "change"
title: "Add density selector control next to theme toggle with persisted preference"
slug: "add-density-selector-control-next-to"
intent: "Add a small/medium/large segmented control adjacent to the existing dark/light theme toggle in the dashboard header. Selection writes to localStorage (mirroring how the theme preference is stored) and applies the `data-density` attribute on the root element on every load. Default value is `medium` for new and existing users so behavior is unchanged until the user opts in."
acceptanceCriteria:
  - "Three-option segmented control (S / M / L) is rendered immediately adjacent to the theme toggle"
  - "Selecting an option updates the UI density without a page reload"
  - "The choice persists across reloads via localStorage using a stable key (e.g. `ndx.ui.density`)"
  - "Default density for users without a stored preference is `medium` and produces no visible change from the pre-feature UI"
  - "Control is keyboard-accessible and exposes appropriate ARIA roles/labels"
amends: [{"target":"6f1c5031-4fb4-4a9c-8560-64f11d55732f","delta":"modified","summary":"Add density selector control next to theme toggle with persisted preference","base":"f15ab08ada49eb14543c57f78695ac3b2dbd7ceccee1300c59fe6c7a88f9320e"}]
priority: "medium"
tags:
  - "web"
  - "ui"
  - "settings"
source: "smart-add"
---
