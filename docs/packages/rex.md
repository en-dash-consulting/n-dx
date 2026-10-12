<img src="/rex.png" alt="Rex" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# Rex

PRD management. The PRD is the product's requirements plus the changes being made to them; rex stores both, computes each requirement's build status, and turns codebase findings and ideas into changes. The model is explained in [The PRD](/guide/concepts/).

## Data Model

Two layers, stored side by side in `.ndx/rex/`:

```
product/                      changes/
  Area                          Change
    Capability                    Task
      Capability (one deeper)       Subtask
    Constraint
```

| Layer | Nodes | Each carries |
|-------|-------|--------------|
| Product | area, capability, constraint | A statement, and for a capability its **capability criteria** (the standing spec). Status (*proposed*, *changing*, *met*, *revised*, *retired*) and health (*ok*, *defective*) are computed, never set |
| Change | change, task, subtask | Title, description, **acceptance criteria** (done when), priority, `blockedBy`, a work status. A change also names what it **amends** (with an added, modified or removed delta) or **touches**, and its `plannedRelease` / `shippedIn` |

**Work status:** `pending` | `in_progress` | `completed` | `failing` | `deferred` | `blocked` | `cancelled` | `deleted`

**Priority:** `critical` | `high` | `medium` | `low`

::: info v1 projects
Until the storage migration ships, `ndx init` creates v1 projects. A v1 PRD (`.rex/prd_tree/`) has no product layer: it is one tree of work items, each with a `level` (epic › feature › task › subtask) instead of a type. The commands below say where they differ.
:::

## CLI

```sh
rex init .                           # initialize .rex/
rex status .                         # PRD tree with completion stats (v1)
rex next .                           # next actionable task
rex add "description" .              # a change in the Inbox (v1: smart add via LLM)
rex add --file=ideas.txt .           # import from file
rex add task --title="..." --criterion="..." --criterion="..." --source="..." .  # add with acceptance criteria and source
rex update <id> --status=completed . # update item
rex update <id> --criterion="..." --criterion="..." .  # replace acceptance criteria
rex update <id> --criterion= .       # clear acceptance criteria
rex update <id> --run='{"tier":"heavy","models":{"claude":"claude-opus-5-5"},"review":true}' .  # save run settings (replaces the whole block)
rex update <id> --run=null .         # clear saved run settings (--run= does the same)
rex move <id> --parent=<parent-id> . # reparent item
rex remove <id> .                    # remove item and descendants
rex reshape .                        # LLM-powered PRD restructuring
rex prune .                          # remove completed subtrees
rex restore .                        # list tree snapshots; --latest or --id=<snapshot> rolls back (v1)
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

## Smart Add (v1)

On a v1 PRD, `rex add` uses an LLM to decompose natural language descriptions into structured proposals:

```sh
rex add "Add SSO support with Google and Okta, admin config UI, audit logs" .
```

Produces epic/feature/task proposals with duplicate detection. When duplicates are found:

- **Cancel** — write nothing
- **Merge** — update matched items, add only non-duplicates
- **Proceed** — create duplicates with override markers

On a v2 PRD a description becomes one change, with no LLM call; see below.

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

`rex reshape`, `rex reorganize` and `rex prune` restructure the change layer as they do a v1 PRD, and never write under `product/`. On the product layer, `rex reshape` drafts its accepted proposals as one change with removed and added amendments (a move is a removal plus an added copy) for `rex change apply`. A move or split the copy would not carry whole is not drafted and the output says why: a node with tags, notes in its body outside History, or capability requirements or dependsOn, or one another node names in dependsOn or appliesTo. A body holding only the History section that `rex change apply` writes does not stop a move: the retired original keeps that History, and the copy's starts with a line naming the original's id. A merge is not drafted on the same grounds when a merged node has any of these (requirements, dependsOn or appliesTo included) or another node names it, since the survivor takes over only its capability criteria. Proposals are drafted one at a time, so one that `rex change apply` would refuse together with those before it (a move under an area another proposal removes, say) is not drafted either, with apply's reason, and the rest still are; `rex reorganize` only reports; `rex prune` does not apply, and keeps (reporting why) an applied change that carries removed or added amendments, because product status reads a node as retired only while that change exists. On the change layer, all three skip, with the reason, a merge that would fold away any applied change (its id is what N-DX-Item trailers, rex health and its shippedIn release refer to) and a split, delete or collapse that would remove a change prune keeps; the other accepted proposals still apply, and the change-layer store refuses any other write that removes such a change.

On a v2 PRD, `rex health` runs the tree rules instead of scoring, and prints the reader's warnings and the landing check beside them; `--format=json` prints `{ treeRules, warnings, landings }`. It exits 1 when a tree rule reports an error or the reader skipped a node (a missing or invalid root `index.md`, a folder with no `index.md`, or invalid node intent), and 0 when there are only warnings. `ndx ci` fails its structure-health step on that exit code and shows the error, warning and skipped-node counts. On a v1 PRD, `rex health` prints the score and exits 0, and `ndx ci` fails the step below a score of 50.

## Recommend

```sh
rex recommend .                      # show findings
rex recommend --accept .             # add all to PRD
rex recommend --actionable-only .    # anti-patterns, suggestions, move-files only
rex recommend --acknowledge=1,2 .    # skip specific findings
rex recommend --acknowledge-completed .  # acknowledge completed tasks' findings
```

## Baseline Detection (v1)

When scanning an existing codebase for the first time (empty v1 PRD), Rex detects this as a baseline scan. The LLM marks:

- **Completed** — functionality already implemented in the code
- **Pending** — gaps and improvements to build

This prevents existing code from appearing as a wall of pending tasks. On a v2 PRD, functionality the code already has belongs in the product layer as capabilities that read *met*.

## Files

Rex's directory is `.ndx/rex/` on the `.ndx/` layout and `.rex/` on the older one; paths below use `.rex/`.

| File | Purpose |
|------|---------|
| `product/` and `changes/` | v2 PRD: the product layer and the change layer. Intent in each node's Markdown, tool state in each folder's committed `state.yaml`. See [PRD Storage Layout](/guide/prd-storage) |
| `.rex/prd_tree/` | v1 PRD folder tree: a folder per item with children, a `<slug>.md` file per item without |
| `.rex/config.json` | Project configuration |
| `.rex/execution-log.jsonl` | Execution history (append-only, auto-rotated at 1 MB) |
| `.rex/workflow.md` | Human-readable workflow state |
| `.rex/acknowledged-findings.json` | Acknowledged SourceVision findings |
| `.rex/pending-proposals.json` | Proposals awaiting acceptance |
| `.rex/archive.json` | Items removed by `prune`, `reshape` and `reorganize` (audit only; no command restores from it) |
| `.rex/.backups/` | v1 tree snapshots taken before `add` and `reshape`; `rex restore` rolls back to one |

## MCP Tools

Available via `rex mcp .` (stdio) or `ndx start .` (HTTP). Claude Code prefixes these as `mcp__rex__{tool}`; Codex uses bare names. The stdio server follows the client's MCP roots, so a worktree session writes its own tree; `get_capabilities` reports the resolved `workspace` (`source`, `projectDir`, `refused`). See [MCP integration](/guide/mcp#worktree-sessions).

| Tool | Description |
|------|-------------|
| `get_product` | v2: the product layer, each node with computed status and health |
| `get_capability` | v2: one capability or constraint with its capability criteria and the changes on it |
| `place_change` | v2: a change's placement shortlist, or record a placement (`touches` or `amends`) |
| `apply_change` | v2: apply a change's amendments to the product layer, as a steward |
| `get_prd_status` | PRD title and stats. v2: change counts, Inbox count, product status per area, changes per release. v1: per-epic stats |
| `get_next_task` | Next actionable task based on priority and dependencies (skips tasks claimed by another worktree) |
| `claim_task` | Hold a task for this worktree so other worktrees skip it |
| `release_task` | Give back a claim without changing the task's status |
| `update_task_status` | Update item status. While a `hench run` in this worktree holds the task, `completed` is recorded for the run to apply after its test gate rather than written |
| `add_item` | Add an item: v2 `type` (change, task, subtask), v1 `level` (epic, feature, task, subtask). Optional `run` block of saved run settings: portable `tier` plus optional per-vendor `models` pins |
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
