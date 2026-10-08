---
id: "e052cf8e-0feb-48e5-9b39-3f5fc3856f4c"
level: "task"
title: "Inventoried .tf files change zones, classifications and enrichment for TypeScript/Go repos that contain Terraform"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "terraform"
  - "sourcevision"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test analyzes a TS fixture with and without an infra/*.tf folder and asserts zones.json and classifications.json are identical (or the accepted difference is documented)"
  - "Terraform files are not sent to LLM enrichment unless a decision says they should be"
description: "Verdict: should-fix (adversarial review of 442fc751). Severity medium.\n\nScenario: a TypeScript repo with package.json and an infra/ folder of .tf files. Since 442fc751, packages/sourcevision/src/analyzers/inventory.ts maps .tf to \"Terraform\", adds it to PROGRAMMING_LANGUAGES, and classifies .tf as role \"source\". Those files then enter classify.ts (sourceFiles = role \"source\"), zones.ts (no import edges, so assignByProximity folds them into the nearest zone and changes its file list, line counts and description), llms.txt/CONTEXT.md, and LLM enrichment. The epic rule says \"Analysis output for TypeScript, JavaScript, Go, Swift and Python repos must not change\". The task's own criterion only covers repos *without* .tf, so this was not caught. infrastructure.json is protected by infrastructureLinkPaths; nothing else is.\n\nReachable: `sv analyze` / `ndx analyze` on any TS/Go repo that holds Terraform.\n\nOptions:\n1. Give Terraform files a non-source role (e.g. \"config\"/\"other\") until the structure model lands. This is cheap, but it blurs the meaning of roles.\n2. Exclude Terraform from zone, classification and enrichment inputs, as was done for the infra linker. This is precise but touches several analyzers.\n3. Accept the change and document it, plus capture a golden-output diff for a mixed repo.\nThe decision is the operator's: is a Terraform folder in a TS repo supposed to change zones? Recommend 2 if not.\n\nAwaiting the operator's decision (2026-10-08, side session): not run overnight. The epic rule points to option 2."
lastModified: "2026-10-08T07:57:31.183Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
