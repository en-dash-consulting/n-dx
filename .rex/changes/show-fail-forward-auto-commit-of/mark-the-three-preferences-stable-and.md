---
id: "0b9bb9fe-9b80-4826-a7e5-177f8ee8cb32"
type: "task"
title: "Mark the three preferences stable and show them apart from the experimental flags"
slug: "mark-the-three-preferences-stable-and"
description: "Change the stability of git.failForward and git.autoCommitGenerated to stable in FEATURE_REGISTRY, and change views/feature-toggles.ts (or the Project settings section that renders it) so stable preferences appear as settings apart from experimental flags. Keep the keys, defaults and fail-forward's details text."
acceptanceCriteria:
  - "Project settings separates the three preferences from experimental flags"
  - "Saving each still writes the same key under features in .n-dx.json"
priority: "low"
tags:
  - "feature-flags"
  - "settings"
source: "ndx-capture"
---
