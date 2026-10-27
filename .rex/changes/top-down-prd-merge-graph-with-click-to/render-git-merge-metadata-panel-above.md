---
id: "7da4ce50-0614-47db-8e6d-3fd142d41028"
type: "task"
title: "Render git merge metadata panel above the graph for the selected node"
slug: "render-git-merge-metadata-panel-above"
description: "Add a panel positioned above the merge graph that displays git merge metadata for the currently selected PRD node: merge timestamp, commit hash (with copy affordance), and merge author. Pull this data from the existing merge history pipeline built for the PRD Merge Context Graph (feature a32f8a34-...). When no node is selected, show an empty/instructional state. When the selected node has no associated merge, surface a clear 'no merge recorded' state."
acceptanceCriteria:
  - "Merge metadata panel renders above the graph and shows timestamp, commit hash, and merge author for the selected node"
  - "Commit hash is presented in short form with a copy-to-clipboard affordance that copies the full hash"
  - "Selecting a node updates the panel synchronously with the graph selection"
  - "Nodes with no associated merge display a 'no merge recorded' state instead of empty fields"
  - "Panel data is sourced from the existing merge history pipeline; no duplicate data fetching is introduced"
priority: "high"
tags:
  - "web"
  - "dashboard"
  - "rex"
  - "graph"
  - "git"
source: "smart-add"
---
