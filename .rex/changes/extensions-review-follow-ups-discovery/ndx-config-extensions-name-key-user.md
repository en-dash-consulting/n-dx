---
id: "02ae881a-a188-44f9-a703-6118b07c1ed0"
type: "task"
title: "ndx config extensions.<name>.<key> --user erases a malformed <ndx home>/config.json"
slug: "ndx-config-extensions-name-key-user"
description: "Verdict: must-fix (data loss). handleSetExtensionConfig -> loadUserConfig -> loadOptionalJSON (packages/core/config.js:193-200) returns {} on a parse error, and saveJSON then overwrites the file. The docs tell users to hand-edit this file for extensions.paths (docs/extensions/config.md, example.md), so one trailing comma plus `ndx config extensions.recon.endpoint https://x --user` replaces the whole file and loses the dev paths. Also `--user --force` on extensions.paths.x turns the paths array into an object; the write is non-atomic. Fix: read the user config strictly for writes (fail naming the path, leave the file alone), write via tmp+rename, and refuse the name `paths` (and other reserved names) as an extension config section."
acceptanceCriteria:
  - "Setting a user extension value when <ndx home>/config.json is malformed fails with the path and leaves the file byte-for-byte unchanged"
  - "extensions.paths cannot be overwritten through ndx config extensions.paths.*, even with --force"
  - "The user config write is atomic (temp file + rename)"
priority: "high"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
