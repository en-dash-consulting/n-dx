---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

The v2 agent brief is built from the change and the product nodes it affects. `buildChangeBrief` renders the work, the change's intent and amendments (proposed text included), each amended or touched capability with its own and inherited capability criteria, requirements, health and whether its spec was reviewed, the constraints that bind them, depends-on neighbours one hop out, where the capabilities live in code, the last three changes to those nodes, and the project's commands, workflow and log.

One measured 4,000-token budget covers the whole brief. Sections are admitted capabilities-and-constraints first; a list that does not fit is trimmed in place — falling back to a compact form that still names every capability — rather than dropped, and every trim says what it left out. Nothing takes a vendor or model, and the sectioned and flat renders are byte-identical, so a CLI run and an API run send the same brief.

`@n-dx/llm-client` exports `estimateTokens` and `CHARS_PER_TOKEN`, the model-independent half of `budgetPreflight`, so a caller sizing text against its own budget needs no model id.
