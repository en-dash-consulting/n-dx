---
id: "dc534db9-7859-4d26-96b8-6e32a49cb6b9"
level: "task"
title: "Markerless polyglot repo with more .tf files than source loses the TypeScript fallback again (web/package.json + infra/*.tf)"
status: "completed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "lang-kit"
  - "pr-17"
source: "ndx-adversarial-review"
startedAt: "2026-10-17T02:25:15.658Z"
completedAt: "2026-10-17T02:30:49.522Z"
endedAt: "2026-10-17T02:30:49.522Z"
resolutionType: "code-change"
resolutionDetail: "isTerraformOnly = terraform > 0 && fallbackSource === 0; markerless repos with any fallback source keep TS primary beside Terraform. Docstrings, AGENTS.md and tests updated."
acceptanceCriteria:
  - "isTerraformOnly is true only with Terraform files and zero fallback source files; no count weighing"
  - "A markerless repo with any JS/TS (or other fallback) source keeps the fallback primary with Terraform secondary, however many .tf files it has"
  - "A pure-Terraform repo still detects as Terraform alone; existing detection fixtures pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Implement the exact rule in the description; do not reintroduce count weighing. The hench sandbox may block ~/.cache corpora; leave corpus and byte-identity checks to the session and do not capture follow-ups for them."}
description: "Found by the adversarial review of 4f696905 (commit 2fc80dcc), high. lang-kit's isTerraformOnly (packages/lang-kit/src/detect.ts, around line 295) is `counts.terraform > counts.fallbackSource`. A markerless polyglot repo with more .tf files than JS/TS or Ruby-style source files therefore becomes Terraform alone. An example is web/package.json not at the root, plus src/app.ts and three .tf files under infra/. That is 033b28e3's must-fix again: TS's skip dirs and its test and generated patterns are lost.\n\nExact rule (Ryan's brief for 033b28e3): a markerless repo is Terraform alone only when it has Terraform files and no fallback source at all.\n- isTerraformOnly(counts) = counts.terraform > 0 && counts.fallbackSource === 0. No count weighing.\n- detectLanguages, markerless branch: [terraformConfig] only when isTerraformOnly. Otherwise, with any Terraform file, it is [base, terraformConfig] with the fallback base (TS) primary. With no Terraform, it is [base].\n- detectLanguage: terraformConfig only when isTerraformOnly, else the fallback.\n- Keep 4f696905's inventory-walk counting, so the two probes agree.\n- Update the docstrings that say Terraform must outnumber the source.\n\nTests:\n- The polyglot case above: more .tf than source gives [typescript, terraform] with TS primary.\n- One source file and many .tf files keeps TS primary.\n- A pure-Terraform repo (no fallback source) stays Terraform alone.\n- The existing 033b28e3 and 4f696905 fixtures still pass."
lastModified: "2026-10-17T02:30:49.955Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
