---
id: "6cd9b40e-bacd-4708-9fda-67bbe5e4aef1"
type: "task"
title: "A repository's graview.app is not run until the checkout is trusted"
slug: "a-repository-s-graview-app-is-not-run"
description: "Fix for change 77433115, found by the adversarial review of 083c929b (run 379b94ea). readGraviewConfig resolves graview.app with no trust gate, and ndx graview serve runs that directory's bin/serve.js, or npm run dev in it, with the user's environment and NDX_TOKEN_FILE. Fix: the same gate 083c929b gave graview.bin. graview.app becomes a trust-gated field (collected, a finding, in the digest); a shared value, or one in a git-tracked .n-dx.local.json, applies only once trusted; an untracked .n-dx.local.json value keeps applying. Also check the default face lookup used when graview.app is unset ('beside this package or in node_modules'): if it can resolve into the checkout's own node_modules, a repository can ship a face there, so that path must not run repository code while untrusted either. Kept in layer 2 by the session on 2026-10-27, applying Ryan's call on graview.bin (same class, same fix); runs last."
acceptanceCriteria:
  - "Closes #635 (follow-up): ndx graview serve runs no repository-chosen face before the checkout is trusted"
  - "In an untrusted checkout whose .n-dx.json sets graview.app to a directory with a sentinel bin/serve.js, `ndx graview serve .` does not run the sentinel (test fails today)"
  - "A graview.app in a git-tracked .n-dx.local.json is likewise not used until the checkout is trusted"
  - "The trust review lists a repository-set graview.app as a finding and it enters the trust digest; accepting it makes serve run that face"
  - "A graview.app in an untracked .n-dx.local.json keeps applying"
  - "The default face lookup (graview.app unset) never runs a face from the checkout's own node_modules while untrusted, or the task records why it cannot"
  - "This repository's own trust state does not change"
  - "Tests fail on the code before the fix"
priority: "critical"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
