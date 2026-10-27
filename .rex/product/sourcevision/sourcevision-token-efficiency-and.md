---
id: "ede8a6b4-dff8-4576-abea-3af9fbd7eaba"
type: "capability"
title: "SourceVision Token Efficiency and Prompt Compaction"
slug: "sourcevision-token-efficiency-and"
statement: "SourceVision sends compact prompts and deduplicated data payloads to its LLM calls, and still gives the model every instruction and piece of information it needs for correct output."
criteria: [{"id":"c1","text":"SourceVision prompt templates for scan, enrich, findings, next-steps and zone analysis shall keep every instruction required for correct model output."},{"id":"c2","text":"SourceVision shall use fewer tokens in a standard analysis run, as recorded in the token tracking log, than the baseline from before prompt compaction."},{"id":"c3","text":"When SourceVision assembles a data payload for an LLM call, SourceVision shall leave out fields that are duplicated, unused by the model or trivially derivable."},{"id":"c4","text":"SourceVision shall include each piece of content only once within a single prompt context."},{"id":"c5","text":"SourceVision shall give the model the same information after payload trimming as before it."},{"id":"c6","text":"SourceVision analysis functions shall produce the same outputs for the same inputs as they did before compaction."}]
requirements: [{"id":"ede8a6b4-dff8-4576-abea-3af9fbd7eaba:c1","title":"SourceVision prompt templates for scan, enrich, findings, next-steps and zone analysis shall keep every instruction required for correct model output","description":"Linked to: packages/sourcevision/tests/unit/analyzers/prompt-output-contract.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["SourceVision prompt templates for scan, enrich, findings, next-steps and zone analysis shall keep every instruction required for correct model output."]}]
source: "smart-add"
---

Reduce the number of tokens consumed during sourcevision LLM calls by compacting prompt templates, trimming redundant data payloads, and simplifying analysis code paths — without changing observable behavior or breaking existing tests.
