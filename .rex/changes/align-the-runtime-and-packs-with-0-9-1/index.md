---
id: "630a0d34-8a28-4e8e-a332-4524735486b5"
type: "change"
title: "Align the runtime and packs with 0.9.1, check their builds, and place Packs correctly in the tier diagram"
slug: "align-the-runtime-and-packs-with-0-9-1"
intent: "Stack review (#760, #771): (1) lang-runtime, lang-java, lang-go, lang-sql and lang-terraform are 0.9.0 while sourcevision is 0.9.1, and loadPack requires an exact match, so in the workspace every pack is refused (Java inventory-only, Go on regex); set all five to 0.9.1 (the fixed-group version test from the lang-kit task must pass). (2) tests/e2e/verify-build.js: add REQUIRED_ARTIFACTS entries for lang-runtime and the packs the e2e tests load. (3) packages/core/assistant-assets/project-guidance.md puts the Packs row under Foundation in a diagram titled each layer imports only from the layer below; place Packs beside Domain (loaded at run time by sourcevision's loader, never imported), matching tests/e2e/domain-isolation.test.js, then regenerate the root CLAUDE.md and AGENTS.md (renderAgentsMd/renderClaudeMd from packages/core/assistant-assets.js). Keep the root+web AGENTS.md chain within tests/e2e/agents-md-size-budget.test.js."
acceptanceCriteria:
  - "All five packages are 0.9.1 and the workspace loads the Java and Go packs again"
  - "verify-build.js checks lang-runtime and pack dists"
  - "The tier diagram places Packs beside Domain in project-guidance.md and the regenerated root files, within the size budget"
touches:
  - "2bc7ded9-e12e-4297-bdca-42355e4c7645"
priority: "high"
source: "review"
---
