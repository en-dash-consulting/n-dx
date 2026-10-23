---
id: "013bc11c-ec20-4ac2-8463-9c17adf31fe4"
type: "capability"
title: "Auto Re-Init Detection for Stale Projects"
slug: "auto-re-init-detection-for-stale"
statement: "When a command runs, n-dx detects a project setup that is stale or incomplete and suggests re-running initialization."
criteria: [{"id":"c1","text":"When a command is invoked, n-dx shall check whether the .sourcevision/, .rex/ and .hench/ directories exist in the project."},{"id":"c2","text":"When a command is invoked, n-dx shall detect a schema version mismatch in manifest.json or prd.json."},{"id":"c3","text":"When a command is invoked, n-dx shall detect required config keys that newer versions added and the project's config lacks."},{"id":"c4","text":"When n-dx detects a stale or incomplete project setup, n-dx shall display a suggestion naming the n-dx version the project was initialized with and telling the user to run ndx init to update."},{"id":"c5","text":"While quiet mode is active, n-dx shall not display the re-initialization suggestion."}]
tags:
  - "cli"
  - "ux"
source: "conversation"
priority: "medium"
---

Detect when a project's n-dx setup is stale or incomplete and suggest re-initialization. Check for missing directories, schema version mismatches, and missing config keys from newer versions.
