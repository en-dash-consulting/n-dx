# Working with n-dx in this repository

This repository is set up for [n-dx](https://github.com/en-dash-consulting/n-dx): a product requirements document (PRD) records what to build, a static analysis describes the codebase, and an agent works through the PRD one task at a time.

## n-dx tools

- **rex** keeps the PRD. The product layer holds areas, capabilities and constraints, which are the standing requirements. The change layer holds changes, tasks and subtasks, which is the work in flight. Acceptance criteria say when a task is done.
- **sourcevision** analyses the code: its file inventory, import graph, architectural zones and findings.
- **hench** is the agent `ndx work` drives. It picks the next rex task, works on it, and records the run.

## Where things live

- **PRD:** `{{rexDir}}/product/` and `{{rexDir}}/changes/` hold Markdown intent plus a committed `state.yaml`. Change them through rex (the MCP tools or `ndx rex`), not by hand.
- **Analysis:** `{{sourcevisionDir}}/CONTEXT.md` and `{{sourcevisionDir}}/llms.txt` summarise the codebase. Read them before a large change.
- **Agent runs:** `{{henchDir}}/runs/`.
- **Config:** `{{configFile}}`.

## Commands

- `ndx status .` shows PRD progress.
- `ndx plan .` analyses the code and proposes PRD changes. `ndx analyze .` refreshes the analysis only.
- `ndx work .` runs the next task through hench. **Code changes go through `ndx work`**, so each change lands against a PRD task with its log and commit trailer.
- `ndx start .` serves the dashboard and the HTTP MCP endpoints.
- `ndx <command> --help` gives full usage for any command.

<!-- ADDENDUM -->
## MCP Servers

`.mcp.json` registers two stdio servers, `ndx rex mcp .` and `ndx sv mcp .`.

- **rex:** `get_next_task`, `claim_task`, `get_item`, `update_task_status`, `add_item`, `edit_item`, `append_log`, `get_prd_status`.
- **sourcevision:** `get_overview`, `get_file_info`, `get_imports`, `search_files`, `get_zone`, `get_findings`.

## Development Workflow

Follow `{{rexDir}}/workflow.md`. The steps are:

1. Take a task with `get_next_task` and `claim_task`.
2. Implement it against its acceptance criteria and run the project's tests.
3. Mark it with `update_task_status`, then record what you did with `append_log`.
4. Commit.
