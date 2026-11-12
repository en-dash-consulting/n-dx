---
id: "fbc4c752-bc1d-44e0-8815-a618d18eced1"
type: "change"
title: "Delete the eight feature toggles nothing reads"
slug: "delete-the-eight-feature-toggles"
intent: "The dashboard's feature registry (FEATURE_REGISTRY in packages/web/src/server/routes-features.ts) lists eight toggles that no code reads: sourcevision.callGraph, sourcevision.enrichment, sourcevision.componentCatalog, rex.autoComplete, rex.budgetEnforcement, hench.autoRetry, hench.guardRails and hench.adaptiveWorkflow. All came in with the first settings panel on 2026-02-18 (d252c0d1f). They show on Project settings and save a value to .n-dx.json, and switching them does nothing: the call graph and component catalog are built on every analysis, enrichment follows the analyze mode (--fast), parents always auto-complete, guard rails are always built (packages/hench/src/agent/lifecycle/loop.ts), and budget enforcement and adaptive workflow do not exist. hench.guardRails' description says turning it off gives the agent unrestricted file and command access, which is false. The same eight keys are listed in `ndx config --help` (packages/core/config.js) and hard-coded in the static export's api/features.json (packages/core/export.js).\n\nFound by the feature-flag audit on 2026-11-12."
acceptanceCriteria:
  - "None of the eight keys is in FEATURE_REGISTRY: GET /api/features does not return them and PUT /api/features refuses them as unknown keys"
  - "`ndx config --help` and packages/core/export.js no longer name any of the eight keys"
  - "A .n-dx.json that still stores one of the eight keys loads without an error or warning"
  - "Analysis, parent auto-completion, retries and guard rails behave exactly as before"
  - "A patch changeset names every affected scoped package"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "high"
tags:
  - "feature-flags"
  - "web"
  - "settings"
source: "ndx-capture"
---
