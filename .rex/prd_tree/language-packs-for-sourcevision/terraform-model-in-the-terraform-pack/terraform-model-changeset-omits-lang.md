---
id: "64ba29c5-ebcb-4702-858c-4b46f1ec20e3"
level: "task"
title: "Terraform model changeset omits lang-kit's new ResourceFact.instance field"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The changeset's lang-kit paragraph names the optional `instance` field on `ResourceFact`"
  - "It says `attributes` may hold a value resolved through a module instance rather than the value as written"
description: "Out-of-scope finding from the adversarial review of e4c27923. The review covered only the changeset's infrastructure.json paragraphs.\n\nScenario: .changeset/terraform-model-pack.md says `ResourceFact` gains optional module, provider, references and attributes. 5989d45e6 also added an optional `instance` (`ResourceInstance`: path, root call site, per-attribute resolved/written/confidence/from) to lang-kit's `ResourceFact`; see packages/lang-kit/src/pack-contract.ts:275. A lang-kit consumer reading the release note would not learn it exists. It also would not learn that `attributes` may carry resolved values rather than the values as written.\n\nReachable: only through the release notes for @n-dx/lang-kit. There is no runtime failure.\n\nFix: add one sentence to that paragraph naming `instance` and what it carries. It costs a line and carries no risk. Verdict: out-of-scope, because the paragraph predates e4c27923 and that task limited itself to the infrastructure.json note."
lastModified: "2026-10-17T01:36:47.894Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
