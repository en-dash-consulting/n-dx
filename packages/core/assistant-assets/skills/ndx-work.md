Pick up a task from the PRD and begin working on it.

1. Read `.rex/workflow.md` for the project's execution workflow. Follow its instructions — they define the expected discipline for task execution (TDD, validation, commit conventions, etc.)
2. If task-id provided, call `get_item` (rex MCP). Otherwise call `get_next_task` (rex MCP)
3. Read task details: title, description, acceptance criteria, parent chain
4. For files mentioned in the task, use `get_file_info` and `get_imports` (sourcevision MCP) to understand current state
5. Use `get_zone` (sourcevision MCP) for the relevant architectural zone
6. Present a work plan: what needs to change, which files, what tests
7. After user approves the plan, call `update_task_status` (rex MCP) to mark as `in_progress`
8. Implement the changes following the workflow discipline
9. Run validation and tests as specified in the workflow
10. Call `append_log` (rex MCP) with what was done, decisions made, and issues encountered
11. When done, use `update_task_status` (rex MCP) to mark as `completed`
12. Record the work in hench run history so it is auditable alongside `ndx work` runs: run `ndx hench record --task=<id> --status=completed --title="<task title>" --summary="<one-line summary>"`. Use `--status=cancelled` (or `failed`) instead if the task was not completed.

> **Assisted run, not a hench run.** This skill drives the task directly through Claude Code, so — unlike `ndx work` — it does not spawn the hench agent and **cannot capture token usage** (Claude Code does not expose its own token consumption to the skill). The record written in step 12 is marked `assisted` with zero token usage: it makes the work visible and auditable in run history, but `ndx usage` will show no tokens for it. Tell the user this when you finish so the absence of token totals is expected, not a bug.
