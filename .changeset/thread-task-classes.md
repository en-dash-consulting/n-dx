---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Thread task classes through every package's LLM choke point, and pass the
routing config surfaces through the `.n-dx.json` loader.

rex's `spawnClaude`/`resolveConfiguredModel` accept `{ taskClass }` alongside
the legacy bare weight (the class wins; an explicit model still beats both),
and the analyze call sites now declare their classes — renames, merges,
consolidation checks, assessment, and clarify rounds route light by registry
default exactly as before, while proposals, modify, spec synthesis, smart-add,
and restructuring declare their standard-tier classes. `prd.decompose` is
deliberately not declared yet: its registry default is light, and that flip is
gated on the escalation ladder. sourcevision's `callClaude` gains the same
option, `resolveLightModel` now resolves through `zone.enrich-scan`, and the
enrichment passes and meta-evaluation declare their classes. hench resolves
the agent loop via `agent.execute` (standard by default — but
`llm.routes["agent.execute"] = "heavy"` now reroutes a run with no code
change), the pre-run commit message via `git.commit-message`, and CLI-path
run records carry the resolved tier in `weight` instead of always "standard".
`loadLLMConfig` passes `llm.tiers`, `llm.routes`, `llm.effort`, and
`llm.escalation` through its whitelist so the new config actually reaches
runtime. A repo-level contract test walks declared task classes and fails on
any class missing from `DEFAULT_ROUTES` or any choke point that stops
declaring its classes.
