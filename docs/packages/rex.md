<img src="/rex.png" alt="Rex" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# Rex

PRD management with hierarchical epics, features, tasks, and subtasks. LLM-powered analysis turns codebase findings into structured work items.

## Data Model

```
Epic
  └── Feature
        └── Task
              └── Subtask
```

Each item has: `id`, `title`, `status`, `priority`, `description`, `acceptanceCriteria`, `tags`, `blockedBy`, timestamps.

**Status:** `pending` | `in-progress` | `completed` | `failed`

**Priority:** `critical` | `high` | `medium` | `low`

## CLI

```sh
rex init .                           # initialize .rex/
rex status .                         # PRD tree with completion stats
rex next .                           # next actionable task
rex add "description" .              # smart add via LLM
rex add --file=ideas.txt .           # import from file
rex update <id> --status=completed . # update item
rex remove <id> .                    # remove item and descendants
rex validate .                       # check PRD integrity
rex analyze .                        # scan project, generate proposals
rex recommend .                      # show SourceVision recommendations
rex recommend --accept .             # add recommendations to PRD
rex mcp .                            # start MCP server (stdio)
```

## Smart Add

`rex add` uses an LLM to decompose natural language descriptions into structured proposals:

```sh
rex add "Add SSO support with Google and Okta, admin config UI, audit logs" .
```

Produces structured epic/feature/task proposals with duplicate detection. When duplicates are found:

- **Cancel** — write nothing
- **Merge** — update matched items, add only non-duplicates
- **Proceed** — create duplicates with override markers

## Recommend

```sh
rex recommend .                      # show findings
rex recommend --accept .             # add all to PRD
rex recommend --actionable-only .    # anti-patterns, suggestions, move-files only
rex recommend --acknowledge=1,2 .    # skip specific findings
rex recommend --acknowledge-completed .  # acknowledge completed tasks' findings
```

## Baseline Detection

When scanning an existing codebase for the first time (empty PRD), Rex detects this as a baseline scan. The LLM marks:

- **Completed** — functionality already implemented in the code
- **Pending** — gaps and improvements to build

This prevents existing code from appearing as a wall of pending tasks.

## Files

| File | Purpose |
|------|---------|
| `.rex/prd.json` | PRD tree (epics → features → tasks → subtasks) |
| `.rex/config.json` | Project configuration |
| `.rex/execution-log.jsonl` | Execution history (append-only, auto-rotated at 1 MB) |
| `.rex/workflow.md` | Human-readable workflow state |
| `.rex/acknowledged-findings.json` | Acknowledged SourceVision findings |
| `.rex/pending-proposals.json` | Proposals awaiting acceptance |
| `.rex/archive.json` | Pruned/reshaped item archive |

## MCP Tools

| Tool | Description |
|------|-------------|
| `rex_status` | PRD tree with completion stats |
| `rex_next` | Next actionable task |
| `rex_add` | Add epic/feature/task/subtask |
| `rex_update` | Update item status/priority/title |
| `rex_validate` | Check PRD integrity |
| `rex_analyze` | Scan project and propose PRD items |
| `rex_recommend` | Get SourceVision-based recommendations |
