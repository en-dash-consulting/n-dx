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
rex add task --title="..." --criterion="..." --criterion="..." --source="..." .  # add with criteria and source
rex update <id> --status=completed . # update item
rex update <id> --criterion="..." --criterion="..." .  # replace acceptance criteria
rex update <id> --criterion= .       # clear acceptance criteria
rex update <id> --run='{"tier":"heavy","models":{"claude":"claude-opus-5-5"},"review":true}' .  # save run settings (replaces the whole block)
rex update <id> --run=null .         # clear saved run settings (--run= does the same)
rex move <id> --parent=<parent-id> . # reparent item
rex remove <id> .                    # remove item and descendants
rex reshape .                        # LLM-powered PRD restructuring
rex prune .                          # remove completed subtrees
rex validate .                       # check PRD integrity
rex fix .                            # auto-fix common PRD issues
rex usage .                          # token usage analytics
rex report .                         # JSON health report for CI
rex verify .                         # run acceptance criteria tests
rex analyze .                        # scan project, generate proposals
rex recommend .                      # show SourceVision recommendations
rex recommend --accept .             # add recommendations to PRD
rex reorganize .                     # detect and fix structural issues
rex health .                         # PRD structure health score
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

## Product Layer and Changes (v2 PRD)

On a v2 PRD (`product/` and `changes/`) the product layer holds the standing requirements, and every add is a change:

```sh
rex add --title="Refund card payments" --criterion="A refund reaches the card" .  # a change in the Inbox, with its suggested placement
rex add task --title="Write the refund call" --parent=CH-2 .                        # a task under a change
rex product show .                                   # areas, capabilities, constraints with status and health
rex product show A1.1 .                              # one capability: statement, capability criteria, changes
rex product edit A1.1 --capability-criterion="c3: A refund reaches the card" .     # revise it; drafts a change
rex product edit A1.1 --statement="..." --editorial .                              # reword it; stays met
rex change place CH-2 .                              # the placement shortlist
rex change place CH-2 --target=A1.1 --relation=amends --capability-criterion="c3: ..." .
rex change apply CH-2 .                              # apply its amendments to the product layer
```

```sh
rex tree-diff .                                      # what this branch changed, against the default branch
rex tree-diff --format=markdown --out=prd-diff.md .  # the pull-request comment, for a CI step to post
```

When either side of `rex tree-diff` is a v2 tree, a product map section lists the capabilities and constraints added, modified (title, statement or capability criteria) and retired beside the change list; `--json` carries it as `map`. A v1 diff has no such section. `--format=markdown` renders the report as host-neutral CommonMark (headings, lists and inline code only; no HTML, tables or host markers), capped at 50 entries per section. `--out=<file>` writes any format to a file instead of stdout, and is refused inside `.rex/`.

`--criterion` is always a work item's acceptance criteria (done when). A capability's capability criteria use `--capability-criterion="<id>: <text>"` (and `--remove-capability-criterion=<id>`), on `rex product edit` and `rex change place` only. A description passed to `rex add` becomes one change, without LLM decomposition. On a v1 PRD, `rex add` is unchanged and `rex product` / `rex change` refuse.

`rex reshape`, `rex reorganize` and `rex prune` restructure the change layer as they do a v1 PRD, and never write under `product/`. On the product layer, `rex reshape` drafts its accepted proposals as one change with removed and added amendments (a move is a removal plus an added copy) for `rex change apply`. A move or split the copy would not carry whole is not drafted and the output says why: a node with tags, a body, or capability requirements or dependsOn, or one another node names in dependsOn or appliesTo; `rex reorganize` only reports; `rex prune` does not apply.

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
| `.rex/prd_tree/` | PRD folder tree (epics → features → tasks; subtasks are sections in the parent task's `index.md`) |
| `.rex/config.json` | Project configuration |
| `.rex/execution-log.jsonl` | Execution history (append-only, auto-rotated at 1 MB) |
| `.rex/workflow.md` | Human-readable workflow state |
| `.rex/acknowledged-findings.json` | Acknowledged SourceVision findings |
| `.rex/pending-proposals.json` | Proposals awaiting acceptance |
| `.rex/archive.json` | Pruned/reshaped item archive |

## MCP Tools

Available via `rex mcp .` (stdio) or `ndx start .` (HTTP). Claude Code prefixes these as `mcp__rex__{tool}`; Codex uses bare names. The stdio server follows the client's MCP roots, so a worktree session writes its own tree; `get_capabilities` reports the resolved `workspace` (`source`, `projectDir`, `refused`). See [MCP integration](/guide/mcp#worktree-sessions).

| Tool | Description |
|------|-------------|
| `get_prd_status` | PRD title, overall stats, and per-epic stats |
| `get_next_task` | Next actionable task based on priority and dependencies (skips tasks claimed by another worktree) |
| `claim_task` | Hold a task for this worktree so other worktrees skip it |
| `release_task` | Give back a claim without changing the task's status |
| `update_task_status` | Update item status. While a `hench run` in this worktree holds the task, `completed` is recorded for the run to apply after its test gate rather than written |
| `add_item` | Add epic/feature/task/subtask (optional `run` block of saved run settings: portable `tier` plus optional per-vendor `models` pins) |
| `edit_item` | Edit item content (title, description, priority, tags, `run`). A `run` object replaces the whole saved block; `null` removes it |
| `get_item` | Full item details with parent chain |
| `move_item` | Reparent an item in the PRD tree |
| `merge_items` | Consolidate duplicate sibling items |
| `get_recommendations` | SourceVision-based recommendations |
| `verify_criteria` | Map acceptance criteria to test files |
| `reorganize` | Detect and fix structural issues |
| `health` | PRD structure health score |
| `facets` | List configured facets with distribution |
| `append_log` | Write structured log entry |
| `get_token_usage` | Roll up hench run token totals per PRD item |
| `get_capabilities` | Server capabilities and configuration, plus the `workspace` block (resolved project dir, source, refusal) |
