---
id: "4e541caf-04ea-4f3b-8389-c8ca6ad28d5c"
type: "change"
title: "Make the feature-toggle docs, config help and static export match the registry"
slug: "make-the-feature-toggle-docs-config"
intent: "The 2026-11-12 feature-flag audit found four places that describe toggles differently from FEATURE_REGISTRY (packages/web/src/server/routes-features.ts):\n\n- docs/guide/configuration.md:354 shows `{ \"features\": { \"rex.placementDraft\": true } }`. Both readers (isProjectFeatureEnabled in packages/llm-client/src/project-features.ts and getConfigValue in packages/web/src/server/hench-config-fields.ts) walk nested objects, so a flat dotted key is silently ignored and the feature stays off. The working form is `{ \"features\": { \"rex\": { \"placementDraft\": true } } }`.\n- `ndx config --help` (packages/core/config.js) lists nine `features.*` keys: eight that do nothing and rex.showTokenBudget. It lists none of the other live toggles, and not the web.sidecarGithubReads permission either.\n- packages/core/export.js writes api/features.json as `{features: {...}}`, but the viewer's useFeatureToggle reads `{toggles: [...]}`, so every toggle in a published dashboard falls back to its built-in default.\n- docs/architecture/public-surface.md mentions Graview face feature flags that do not exist in packages/graview or packages/graview-face.\n\nLands after the two changes that delete toggles, so the docs and help describe the registry that remains."
acceptanceCriteria:
  - "The configuration guide's example uses the nested form, and its table lists every toggle in FEATURE_REGISTRY with its default and cost"
  - "`ndx config --help` lists every toggle in FEATURE_REGISTRY and web.sidecarGithubReads, and a test fails when a registry key is missing from the help"
  - "A static export's api/features.json has the `{toggles: [...]}` shape GET /api/features returns, and no toggle in it is on for a feature whose server routes a static export cannot serve"
  - "public-surface.md no longer claims Graview face feature flags"
  - "A patch changeset names every affected scoped package"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "medium"
tags:
  - "feature-flags"
  - "docs"
  - "settings"
source: "ndx-capture"
blockedBy:
  - "fbc4c752-bc1d-44e0-8815-a618d18eced1"
  - "e782039b-f010-45b8-bae3-868d36283243"
---
