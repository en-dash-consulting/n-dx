---
id: "37e5c938-463a-472a-8666-046c3511d5b2"
type: "task"
title: "ndx extensions add resolves a relative path or tarball against the n-dx home, not the user's cwd"
slug: "ndx-extensions-add-resolves-a-relative"
description: "Verdict: should-fix. extensions-command.js:278 runs npm with cwd <home>/extensions, so `ndx extensions add ./ndx-recon-1.0.0.tgz` or `../checkout` fails with ENOENT ('nothing was added'); a private extension like recon is likely installed this way. A re-add by path reports 'is not an n-dx extension' because packageNameOf('./x') is './x'; flags like --registry= are dropped silently (:86-87). Fix: resolve specs starting with . / \\ or a drive letter, or ending in .tgz, against the caller's cwd before spawning; find the added package by diffing the listing; pass through or reject unknown flags explicitly."
acceptanceCriteria:
  - "ndx extensions add ./pkg.tgz and ../folder install from the caller's cwd"
  - "Re-adding an already-installed extension by path reports it as an extension"
  - "An unsupported flag is either passed to npm or refused with a message, never dropped silently"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
