---
id: "bacc0de7-7052-4dcd-b34d-743e48453418"
type: "change"
title: "containerDirFor's doc in infrastructure.ts still says the module may import nothing but node: builtins"
slug: "containerdirfor-s-doc-in"
intent: "Verdict: out-of-scope (low), pre-existing. Found by the adversarial review of run 6073b14d (task ec304126), which reworded the file header but not this second copy of the claim.\n\npackages/sourcevision/src/analyzers/infrastructure.ts:54-57 (doc of the `.ndx/` container helper) says \"This module bundles into the standalone skill script and may import nothing but `node:` builtins\". Since 4a1a2c31 the module also imports `IAC_KINDS` from @n-dx/lang-kit, which scripts/build-iso-skill.mjs aliases to packages/lang-kit/src/iac-kinds.ts. No failure today; the comment contradicts the header two screens above and could mislead the next editor about what the bundle allows.\n\nThe reason the comment gives (cannot reach @n-dx/llm-client's resolver) is still true; only the \"nothing but node: builtins\" wording is wrong.\n\nFix (recommended): reword to \"may import only `node:` builtins, type-only imports and lang-kit's IAC_KINDS (see the header)\", keeping the llm-client explanation. Cost: comment only. Risk: none."
acceptanceCriteria:
  - "infrastructure.ts no longer contains the phrase \"may import nothing but `node:`\""
  - "The container helper's doc still explains why it cannot import @n-dx/llm-client's resolver, and points at the header's import list"
  - "Comment-only: git diff touches no code line; node scripts/build-iso-skill.mjs --check passes"
touches:
  - "62f9bb19-c606-422d-b643-a4877b6dfcfd"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pr-11"
source: "ndx-adversarial-review"
---
