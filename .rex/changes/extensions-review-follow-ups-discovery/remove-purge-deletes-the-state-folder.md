---
id: "436bdb1a-8bc0-4250-8405-b506aa4590e3"
type: "task"
title: "remove --purge deletes the state folder a shadowed copy of the same extension still uses"
slug: "remove-purge-deletes-the-state-folder"
description: "Verdict: should-fix. extensions-command.js:338-359 guards the case where a non-user copy wins but not the reverse: when the user copy wins over a shadowed global or dev copy, `remove x --purge` deletes ext/x/ and the shadowed copy takes over with its state gone. Fix: when ext.shadowed lists a non-user copy, skip the purge (or ask) and say which copy now takes over."
acceptanceCriteria:
  - "remove --purge keeps ext/<name>/ when another copy of the extension remains installed, and says which copy now applies"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
