---
id: "c91cb672-86a5-44e7-9d88-593c123ad7df"
type: "task"
title: "Fix the configuration guide's toggle example and table, and the public-surface Graview claim"
slug: "fix-the-configuration-guide-s-toggle"
description: "In docs/guide/configuration.md, replace the flat-key example with the nested form and list every toggle left in FEATURE_REGISTRY with its default and cost. In docs/architecture/public-surface.md, drop \"and its feature flags\" from the Graview projection row."
acceptanceCriteria:
  - "Copying the guide's example into .n-dx.json turns the feature on"
  - "The guide's table and FEATURE_REGISTRY list the same keys"
priority: "medium"
tags:
  - "feature-flags"
  - "docs"
source: "ndx-capture"
---
