---
id: "5a0e4b05-12bc-46a3-ad63-36d74d54b9d3"
type: "task"
title: "Key import never silently replaces a stored key or imports from a tracked local config"
slug: "key-import-never-silently-replaces-a"
description: "Should-fix from the #949 review. importLocalApiKeys / offerKeyImport in packages/core/config.js run `set <vendor>` over whatever the store holds, with no notice or backup, and never check whether .n-dx.local.json is git-tracked. (1) A repo commits .n-dx.local.json with llm.google.api_key; plain `ndx config credentials` on a TTY asks to move it without saying the file belongs to the repository; answering y replaces the user's own stored google key and rewrites the tracked file — and Google auto uses a stored key, so every project then bills the repo's key. (2) A stale file key that shadows a newer stored key replaces it on import. Fix: skip or confirm a vendor whose store entry exists with a different fingerprint; treat a tracked (or untellable) local file as repository config here, as the api_key alias path already does."
acceptanceCriteria:
  - "Import never replaces an existing store entry with a different fingerprint without an explicit confirmation naming both fingerprints"
  - "With .n-dx.local.json tracked by git, the prompt and --import say the file belongs to the repository and do not move its keys by default"
  - "A key whose store entry already matches is removed from the file without rewriting the store"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
