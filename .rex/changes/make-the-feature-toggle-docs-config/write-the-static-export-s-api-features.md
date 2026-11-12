---
id: "39c8343f-6e25-4798-bd75-3036e66eab58"
type: "task"
title: "Write the static export's api/features.json in the shape the viewer reads"
slug: "write-the-static-export-s-api-features"
description: "packages/core/export.js writes `{features: {...}}`; useFeatureToggle (packages/web/src/viewer/hooks/use-feature-toggle.ts) reads `{toggles: [...]}`. Write the GET /api/features shape. A static export has no server, so a toggle whose feature needs server routes must be off in it."
acceptanceCriteria:
  - "api/features.json in an export parses as FeaturesResponse"
  - "A published dashboard shows no page or control whose server routes the export cannot serve"
priority: "medium"
tags:
  - "feature-flags"
  - "core"
source: "ndx-capture"
---
