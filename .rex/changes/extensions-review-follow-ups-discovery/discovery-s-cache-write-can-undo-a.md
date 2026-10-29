---
id: "52c9a605-a471-417c-b9dc-181af66e293a"
type: "task"
title: "Discovery's cache write can undo a concurrent disable, remove or approval in extensions.json"
slug: "discovery-s-cache-write-can-undo-a"
description: "Verdict: should-fix. extension-discovery.js:157,193 writes {...cache, discovery} from the file as read at the start of discovery; updateExtensionsFile (extension-state.js:113) takes no lock. Trigger: process B (ndx --help from a new directory, or the hub's list after an install) reads at T1, process A runs `ndx extensions disable foo`/`remove foo` at T2, B writes at T3: the disable is undone, or a removal's forgotten approval comes back so a reinstall runs unasked. Confirmed by reading. Fix (recommended): in writeCache re-read the file just before the rename and replace only the discovery key; optionally an O_EXCL lock around both writers."
acceptanceCriteria:
  - "A discovery cache write preserves approvals and disabled entries written after discovery started"
  - "A test interleaves a cache write with a disable and asserts the disable survives"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
