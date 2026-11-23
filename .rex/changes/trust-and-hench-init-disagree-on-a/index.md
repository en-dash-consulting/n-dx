---
id: "00fd5bcc-0aa1-4f4f-83e7-919961ce0d2f"
type: "change"
title: "Trust and hench init disagree on a symlinked package.json or composer.json marker"
slug: "trust-and-hench-init-disagree-on-a"
summary: "When a project's package manifest is a symbolic link, the agent setup and the repository safety check can pick different languages, so a freshly set-up project is flagged as untrusted. Both should read the marker files the same way."
intent: "Severity low; verdict should-fix (ndx-adversarial-review of task dae1f866, run 5dfc5004).\n\nScenario: root composer.json is a regular file, root package.json is a symlink (e.g. to a shared workspace manifest), source mostly JS/TS. `detectRepoLanguage` (packages/llm-client/src/repo-trust.ts, `entries.some(e => e.isFile() && e.name === \"package.json\")`) uses Dirent.isFile, which is false for a symlink, so it returns php. hench init's `detectProjectLanguage` (packages/hench/src/cli/commands/init.ts, `isRegularFile` = fs.stat, follows symlinks) sees package.json, counts, and returns the JS/TS default. `hench init` writes the JS guard; trust then reports language-mismatch / commands-added and clamps the checkout until `ndx trust accept .`. The same divergence existed for a symlinked composer.json before this change.\n\nReachable: `hench init` / `ndx init`, then any trust evaluation (ndx work, ndx trust, dashboard trust routes) on such a checkout. Rare layout.\n\nOptions: (1) recommended: one marker rule in both — e.g. hench reads root entries with readdir withFileTypes and Dirent.isFile, as llm-client does (a symlinked marker is not a marker; repository content following a link outside the tree is not trusted). Cost: a few lines plus tests in both packages. (2) llm-client follows symlinks with statSync; risk: a link pointing outside the checkout becomes a marker."
acceptanceCriteria:
  - "detectRepoLanguage and hench init's detectProjectLanguage return the same language for a checkout whose package.json is a symlink beside a regular composer.json"
  - "detectRepoLanguage and detectProjectLanguage return the same language for a checkout whose composer.json is a symlink"
  - "Tests in packages/llm-client/tests/unit/repo-trust.test.ts and hench's detection tests cover both symlink cases (skipped where the OS cannot create symlinks)"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"dae1f866-2c38-437b-804f-3091f71b2ff8","run":"5dfc5004-965b-4b43-8b8b-d80abb4b9e05"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "hench"
  - "trust"
source: "ndx-adversarial-review"
---
