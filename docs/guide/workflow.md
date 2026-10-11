# Workflow

The core n-dx loop: **analyze** your codebase, **build** a PRD from findings and ideas, **execute** tasks with an autonomous agent, **repeat**.

The PRD is the product's requirements (the product layer: areas, capabilities, constraints) plus the changes being made to them (the change layer: changes, tasks, subtasks). Findings and ideas enter as changes; completed changes update the requirements. See [The PRD](./concepts/).

::: info v1 projects
Until the storage migration ships, `ndx init` creates v1 projects: the PRD is one tree of epics, features, tasks and subtasks in `.rex/prd_tree/`, with no product layer. The steps below note where a v1 project behaves differently.
:::

## 1. Analyze

```sh
ndx analyze .
```

Runs SourceVision static analysis: file inventory, import graph, zone detection (Louvain community detection), and React component catalog. Outputs to `.sourcevision/`:

- `CONTEXT.md` and `llms.txt` — AI-readable codebase summaries
- `zones.json` — architectural zone map with cohesion/coupling metrics
- `inventory.json` — file inventory with classifications
- Findings — anti-patterns, suggestions, architectural observations

## 2. Recommend

```sh
ndx recommend .                      # show findings
ndx recommend --accept .             # add all to PRD
ndx recommend --acknowledge=1,2 .    # skip specific findings
ndx recommend --actionable-only .    # only concrete problems
```

Translates SourceVision findings into PRD tasks. The `--actionable-only` flag filters to finding types that represent concrete problems: `anti-pattern`, `suggestion`, and `move-file`. This excludes non-actionable observations (metrics, patterns, relationships).

## 3. Add Ideas

```sh
ndx add "Add SSO support with Google and Okta" .
ndx add --file=ideas.txt .
```

Each description becomes a change in the Inbox, with the rules' suggested placement: the capabilities and constraints it could add to, amend or touch. Record the placement, then add tasks to the change:

```sh
rex change place <change>                                   # the shortlist
rex change place <change> --target=<node> --relation=amends # record it
rex add task --title="Add the Okta provider" --parent=<change> .
```

A change that amends a capability updates it when the change completes; see [Changes and apply](./concepts/changes-and-apply).

::: info v1 projects
On a v1 PRD, smart add uses an LLM to decompose descriptions into epic/feature/task proposals, and `--parent=<item-id>` nests the result under an existing item. If duplicates are detected against existing PRD items:

- **Cancel** — write nothing
- **Merge** — update matched items, add only non-duplicates
- **Proceed** — create duplicates with override markers for auditing
:::

## 4. Plan (Full Pipeline)

```sh
ndx plan .                  # analyze + generate proposals (interactive)
ndx plan --accept .         # analyze + auto-accept
ndx plan --file=spec.md .   # import from a document (skips analysis)
```

Combines analysis and proposal generation in one step. Use `analyze` + `recommend` for more control over each stage.

### Baseline Detection

When scanning an existing codebase for the first time (empty PRD + existing code), the LLM automatically detects this as a **baseline scan** and marks:

- **Completed** — functionality that already exists in the code
- **Pending** — gaps, improvements, and missing features to build

This prevents a wall of "pending" tasks for code that's already implemented.

## 5. Execute

```sh
ndx work --auto .                          # highest-priority task
ndx work --auto --iterations=4 .           # 4 tasks sequentially
ndx work --epic="Auth System" --auto .     # scope to one top-level item (an epic on v1)
ndx work --task=abc123 .                   # specific task by ID
```

Hench picks a task, builds a brief with codebase context (relevant files, acceptance criteria, related code), runs an LLM tool-use loop to implement it, then records the run in `.hench/runs/`.

## 6. Self-Heal

```sh
ndx self-heal 3 .
```

Iterative improvement loop that runs N cycles of:

1. Re-analyze the codebase (`ndx analyze`)
2. Accept new actionable recommendations (`ndx recommend --accept --actionable-only`)
3. Execute tasks (`ndx work --auto`)
4. Acknowledge completed findings

See [Self-Heal Loop](./self-heal) for details on fuzzy acknowledgment and finding lifecycle.

## 7. Monitor

```sh
rex product show .           # requirements with computed status and health (v2)
ndx status .                 # PRD tree with completion stats (v1)
ndx start .                  # web dashboard + MCP server
ndx start --background .     # daemon mode
ndx usage .                  # token usage analytics
```

## Repeat

The typical development loop:

```
analyze → recommend → work → status → repeat
```

Or use `self-heal` to automate the entire cycle.

## Skills used in this guide

Each skill below maps to a step in this loop. Edit the linked file in your project to customize that step's behavior in your assistant session.

| Skill | Source | Role in this guide |
|-------|--------|--------------------|
| `/ndx-plan` | [`.agents/skills/ndx-plan/SKILL.md`](./skills#ndx-plan) | Steps 2–4: translates SourceVision findings into PRD proposals and accepts them |
| `/ndx-capture` | [`.agents/skills/ndx-capture/SKILL.md`](./skills#ndx-capture) | Step 3: turns a freeform idea into a PRD item under the right parent (v1 PRDs today) |
| `/ndx-work` | [`.agents/skills/ndx-work/SKILL.md`](./skills#ndx-work) | Step 5: picks the next task and drives an LLM tool-use loop to implement it |
| `/ndx-status` | [`.agents/skills/ndx-status/SKILL.md`](./skills#ndx-status) | Step 7: shows combined PRD completion, zone health, and next recommended action |
| `/ndx-reshape` | [`.agents/skills/ndx-reshape/SKILL.md`](./skills#ndx-reshape) | Structural cleanup of a v1 PRD tree: reparents, merges, and rebalances items when the tree drifts |

Related guides that share these skills: [Spec-Driven Development](./spec-driven), [Codebase Onboarding](./onboarding), [Run While You Sleep](./overnight), [Self-Heal Loop](./self-heal).

For the full skill inventory and customization guidance, see the [Skills Reference](./skills).

## See it on a real project

n-dx runs this loop on itself. Its repository is still a v1 project, and two
artifacts show both ends of the loop:

- [`prd.md`](https://github.com/en-dash-consulting/n-dx/blob/main/prd.md) — the
  hand-written spec that seeded the project
- [`.rex/prd_tree/`](https://github.com/en-dash-consulting/n-dx/tree/main/.rex/prd_tree)
  — the live v1 tree the agent reads from and writes back to

The [PRD storage layout guide](./prd-storage) walks through how one becomes the
other, and which commands and MCP tools you use to interact with the result.
