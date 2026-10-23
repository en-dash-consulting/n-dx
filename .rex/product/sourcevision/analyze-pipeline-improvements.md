---
id: "e4868f49-5256-4fb7-a775-ac5bf06dbb47"
type: "capability"
title: "Analyze pipeline improvements"
slug: "analyze-pipeline-improvements"
statement: "The analyze pipeline turns sourcevision findings into deduplicated, prioritised and filtered PRD work. Status views hide completed items by default, and rex prune reconsolidates the items left after it archives completed subtrees."
criteria: [{"id":"c1","text":"When rex status runs without --all, the CLI shall hide completed items."},{"id":"c2","text":"When rex status runs with --all, the CLI shall show all items, including completed ones."},{"id":"c3","text":"The web PRD tree shall open with the Active Work filter, which shows pending, in_progress and blocked items."},{"id":"c4","text":"When the user selects the All Items filter, the web PRD tree shall show all items, including completed ones."},{"id":"c5","text":"rex prune shall archive completed subtrees."},{"id":"c6","text":"After rex prune archives completed subtrees, rex prune shall run a reshape pass on the remaining items with a consolidation-focused prompt."},{"id":"c7","text":"The post-prune consolidation prompt shall instruct the LLM to regroup orphaned items under logical parents, merge similar remaining items, reparent misplaced items and split overly broad items."},{"id":"c8","text":"When rex prune runs interactively, rex prune shall show each consolidation proposal with y/n/a/q prompts."},{"id":"c9","text":"When rex prune runs with --accept, rex prune shall accept all consolidation proposals without prompting."},{"id":"c10","text":"When rex prune runs with --dry-run, rex prune shall show the prune targets and the consolidation proposals without changing the PRD."},{"id":"c11","text":"rex prune shall allow consolidation proposals to use the full reshape action set: merge, reparent, split, update and obsolete."},{"id":"c12","text":"When findings from different enrichment passes have similar text, the zones scanner shall merge them into one finding and keep the highest-severity version."},{"id":"c13","text":"deriveNextSteps shall score next-step priority from zone cohesion and coupling metrics as well as the related-count threshold."},{"id":"c14","text":"scanSourceVision shall include specific file paths in the tasks it produces from zone findings."},{"id":"c15","text":"scanSourceVision shall give concrete fix suggestions in the tasks it produces from zone findings."},{"id":"c16","text":"scanSourceVision shall link each architectural issue it reports to the code locations involved."},{"id":"c17","text":"The scanner shall leave type-only imports out of the mostImported rankings."},{"id":"c18","text":"The scanner shall leave info-severity findings out of the CONTEXT.md next-steps."},{"id":"c19","text":"The scanner shall leave test files out of zone cohesion and coupling calculations."}]
tags:
  - "prune"
  - "rex"
  - "status"
  - "ux"
source: "llm"
---

Two related UX improvements: (1) prune should reconsolidate remaining items after archiving completed ones, not just remove them; (2) completed items should be hidden by default in both CLI and web views so active work isn't buried.
