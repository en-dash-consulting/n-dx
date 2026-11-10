---
id: "ee87336f-2945-4507-a90d-c92f36923c31"
type: "task"
title: "Setting llm.vendor.auth locally keeps the repository's committed auth"
slug: "setting-llm-vendor-auth-locally-keeps"
description: "Should-fix from the #949 review. Adding '.auth' to LOCAL_ONLY_SETTINGS.llm.suffixes in packages/core/config.js (~line 143) pulls it into the generic 'move local-only settings out of the shared file' step. If a team commits llm.claude.auth: 'cli' in .n-dx.json, any developer running `ndx config llm.claude.auth api` removes the shared value (printed as 'moved … out of .n-dx.json'), leaving a tracked change ready for `git commit -a`. credential-routing.ts says a repository's cli/auto always applies and setApiAuthIfUnset respects a shared auth, so a committed auth is a supported setting, not a stale copy. Either drop '.auth' from the list and let the local value override, or document the intent in a changeset and docs."
acceptanceCriteria:
  - "ndx config llm.<vendor>.auth <mode> writes .n-dx.local.json and leaves a committed llm.<vendor>.auth in .n-dx.json untouched"
  - "The local value overrides the shared one where repository trust allows it"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
