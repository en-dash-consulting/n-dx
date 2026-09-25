---
"@n-dx/hench": patch
---

Allow the rex MCP write tools hench's own prompts direct the agent to call.

A run attaches its own rex MCP server (`--mcp-config … --strict-mcp-config`) and
its brief directs the agent to `update_task_status`, `append_log` and `add_item`.
Nothing granted those tools: `--allowed-tools` carried only `Bash(<cmd>:*)` plus
the file tools, and `ndx init` deliberately auto-approves just rex's *read* tools,
so a headless `claude -p` spawn had nobody to approve the rest. The agent was
being pointed at tools the run had not allowed.

Both failure shapes were seen in a consumer project. One run's agent, denied,
hand-edited the task's `index.md` frontmatter and committed it — recording a
completion outside hench's hold, which exists to apply it only after the test
gate passes. Another was denied twice and ended its turn asking for permission;
with `autoCommit: false` it never wrote `.hench-commit-msg.txt`, so the run
failed with all of its work uncommitted.

The three tools are now granted on every Claude CLI spawn — the work spawn, its
retries, the adversarial review pass and the reviewer's background-wait resume
all build their args through one function. Nothing else is granted, and the tool
names are derived from the server name the run registers, so renaming the server
cannot silently orphan the grant.

Granting the write tools does not weaken the PRD: while a run holds a task's
claim, rex records the agent's status request on the claim and hench applies it
only once the test gate passes. Denying the tool added no safeguard — it pushed
the agent into hand-editing the task file, which has none.
