---
id: "013bc11c-ec20-4ac2-8463-9c17adf31fe4"
level: "feature"
title: "Auto Re-Init Detection for Stale Projects"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "ux"
blockedBy:
  - "dcf6018e-e658-4708-ae6e-1bd23431748f"
source: "conversation"
startedAt: "2026-04-09T21:44:44.254Z"
completedAt: "2026-04-09T21:58:12.050Z"
acceptanceCriteria:
  - "On command invocation, check for missing .sourcevision/, .rex/, .hench/ directories"
  - "Detect schema version mismatch in manifest.json or prd.json"
  - "Detect missing required config keys added in newer versions"
  - "Display a suggestion like 'Project was initialized with n-dx X.Y — run ndx init to update'"
  - "Respect quiet mode"
description: "Detect when a project's n-dx setup is stale or incomplete and suggest re-initialization. Check for missing directories, schema version mismatches, and missing config keys from newer versions."
---
