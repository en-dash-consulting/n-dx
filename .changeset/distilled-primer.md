---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

Add a distilled repo primer and prefer it over CONTEXT.md as agent startup
context.

`ndx work` pipes CONTEXT.md plus a PRD excerpt into every task spawn. Even
capped, that document is written for breadth — zone metrics, findings, route
tables, import summaries — while a task starting work needs where things live,
how to build and test, and what the conventions are. It needs that on every
task and every retry, which is what makes distilling it worth one LLM call.

`sourcevision analyze` now writes `.sourcevision/PRIMER.md`, and the
orchestrator reads it in preference to CONTEXT.md, falling back silently when
absent. The distiller lives in sourcevision rather than beside the pipe it
feeds: orchestration is only allowed to spawn CLIs, and sourcevision already
owns artifact generation, content-hash caching, and the one `callClaude` choke
point with task-class routing. A side benefit is that the primer is now an
artifact any consumer can read.

Everything about it fails soft. The primer is cached against the analysis
fingerprint, so it is regenerated only when the repository is re-analysed.
Generation is skipped entirely unless the analysis already made successful LLM
calls — the vendor and auth-mode getters both fall back to defaults when
nothing is configured, so consulting them would have this attempt a spawn in
every environment without a model, including CI. Output shorter than 200 or
longer than 12,000 characters is rejected rather than truncated, because a
primer cut mid-sentence would be inherited by every task in the loop while a
missing one simply falls back to CONTEXT.md.
