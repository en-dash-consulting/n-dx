---
"@n-dx/core": patch
---

Keep `AGENTS.md` inside the budget Codex reads it under, and guard it.

Codex reads the root `AGENTS.md` and a package's own together, up to `project_doc_max_bytes`, and silently drops whatever lies past that — no error, no log. `renderAgentsMd` puts the Codex-operational sections last (Workflow, Skills, MCP Servers, Troubleshooting), so an overrun takes exactly the half Codex cannot work without. The root had grown to 30,611 bytes against a ~32,768-byte limit, leaving 2,157 for any nested file: rex, core and llm-client were already over and hench had 127 bytes to spare.

**What moved.** Reference prose went to `docs/`; the rules stayed in-context. The web package's internal zone diagram is now a pointer to `packages/web/AGENTS.md`, where it already lived. The gateway table keeps the file addresses and links the export inventory to `docs/architecture/gateways.md`. The concurrency contract keeps its safety table, the PRD invariant and three one-paragraph rules, and links the full reasoning — including the bundle and narrative carve-outs — to a new `docs/architecture/prd-write-concurrency.md`. The root is now 26,628 bytes; rex, core, llm-client and hench fit again.

**The guard.** `tests/e2e/agents-md-size-budget.test.js` fails a pull request when the rendered root exceeds the limit minus a 2 KiB margin, or leaves a package file no room, naming the limit and saying that Codex drops the rest. The Codex docs confirm the setting and the truncation but publish no default number, so 32 KiB is treated as this project's budget rather than quoted as a documented constant.

Not yet fixed: `packages/web/AGENTS.md` (21,941 bytes) still overruns the chain by 15,329 and needs its own trim; the guard reports it as a warning and will assert on it once that lands.
