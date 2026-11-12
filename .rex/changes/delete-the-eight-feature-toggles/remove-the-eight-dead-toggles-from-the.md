---
id: "e7b79cc6-d9ad-4e84-bb39-786d615f7ca9"
type: "task"
title: "Remove the eight dead toggles from the registry, the export list and the config help"
slug: "remove-the-eight-dead-toggles-from-the"
description: "Delete the eight entries from FEATURE_REGISTRY (packages/web/src/server/routes-features.ts), from the hard-coded api/features.json list in packages/core/export.js, and from the `features.*` block of `ndx config --help` in packages/core/config.js (and the help example that uses one of them, if it does). Update or remove the tests that assert on them. Leave stored values in existing .n-dx.json files alone: they are ignored, never rewritten."
acceptanceCriteria:
  - "FEATURE_REGISTRY, export.js and the config help name none of sourcevision.callGraph, sourcevision.enrichment, sourcevision.componentCatalog, rex.autoComplete, rex.budgetEnforcement, hench.autoRetry, hench.guardRails, hench.adaptiveWorkflow"
  - "The Project settings page's feature flags section no longer shows them"
  - "Web and core test suites pass with the tests that referenced them updated"
priority: "high"
tags:
  - "feature-flags"
source: "ndx-capture"
---
