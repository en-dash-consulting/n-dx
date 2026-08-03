---
id: "c9a53f95-ecd2-4c20-8bcf-a917668ea7c6"
level: "task"
title: "Ensure SourceVision PR markdown tab, file search, and route tree view are fully accessible"
status: "pending"
priority: "medium"
tags:
  - "a11y"
  - "sourcevision"
  - "pr-markdown"
  - "file-search"
  - "route-tree"
source: "smart-add"
acceptanceCriteria:
  - "PR markdown rendered output preserves the heading hierarchy from the source markdown without injecting new h1s"
  - "Raw/preview toggle uses role='tablist' and role='tab' with aria-selected state"
  - "File search input has role='combobox', aria-autocomplete='list', and results in a role='listbox' with aria-activedescendant tracking"
  - "Selecting a file search result navigates to the correct file info view and announces the result to screen readers"
  - "Route tree uses role='tree' at the root and role='treeitem' for each node, with aria-expanded for nodes with children"
  - "Route tree is fully keyboard-navigable per ARIA Authoring Practices tree widget pattern (arrow keys, Enter to select)"
description: "Three remaining SourceVision subviews need a11y remediation: (1) the PR markdown tab, where the rendered markdown must have proper heading hierarchy and the raw/preview toggle must be keyboard operable with ARIA role='tablist'; (2) file search, which must function as a proper ARIA combobox with listbox results; and (3) the route tree, which should use a semantic tree widget (role='tree', role='treeitem', aria-expanded) for hierarchical route navigation."
---
