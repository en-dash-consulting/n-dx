---
id: "8c045996-2f38-4940-8dc3-82eef87d6cf7"
type: "task"
title: "Per-extension config sections"
slug: "per-extension-config-sections"
acceptanceCriteria:
  - "`extensions.<name>` in user config and `.n-dx.json`, merged project over user"
  - "`ndx config extensions.<name>.<key>` reads and writes, validated against `configSchema`"
  - "The merged config is written to the file `NDX_EXTENSION_CONFIG` names"
priority: "medium"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "03ef01ab-cea6-48f9-934b-c06c6fbf5673"
---
