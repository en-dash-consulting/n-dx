---
id: "8327401a-6629-49c4-aa66-d2746d0ad07b"
type: "task"
title: "Extension state lookups read inherited properties: an extension named constructor can never be enabled"
slug: "extension-state-lookups-read-inherited"
description: "Verdict: should-fix (cheap). extension-state.js:239 reads file.disabled[stateKey(ext)], which returns Object.prototype.constructor; once any extension is disabled, a valid extension named 'constructor' reports disabled and `enable constructor` prints Enabled without changing state (reproduced). Fix: Object.hasOwn in the disabled and approvals lookups (preferred), or reserve the name."
acceptanceCriteria:
  - "Approval and disabled lookups ignore inherited properties"
  - "An extension named constructor can be enabled and disabled, covered by a test"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
