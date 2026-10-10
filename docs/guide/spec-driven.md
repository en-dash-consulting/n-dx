# Spec-Driven Development

You have a product spec, a requirements doc, or a design document. This guide takes it from written text to an executing autonomous agent in one session.

## The scenario

You've written a 200-line `spec.md` describing a new feature set: API design, data models, acceptance criteria, edge cases. You want to turn that into a structured backlog and start executing — without manually translating each requirement into a PRD item.

## Where a spec lands in the PRD

The PRD is the product's requirements plus the changes being made to them (see [The PRD](./concepts/)). A spec feeds both layers:

| In the spec | In the PRD |
|-------------|-----------|
| What the product must do ("a shopper can pay by card") | A **capability** in the product layer: a statement plus its **capability criteria**, the standing spec it is checked against |
| Rules that hold everywhere ("all card data stays server-side") | A **constraint** in the product layer |
| The work to build it | A **change** that adds or amends those capabilities, split into tasks. Each change and task has its own **acceptance criteria**: when that piece of work is done |

New capabilities are never written straight into the product layer. They arrive as changes that *add* them, and [apply](./concepts/changes-and-apply) writes them in when the change completes. Until then they read as *proposed*.

On a v2 PRD, `ndx add --file=spec.md` creates one change from the file, with no LLM call. Place it, then record what it adds or amends:

```sh
rex change place <change>                 # the shortlist of capabilities it could amend or touch
rex change place <change> --target=<node> --relation=amends \
  --capability-criterion="c3: A refund reaches the card"
```

::: info v1 projects
Until the storage migration ships, `ndx init` creates v1 projects, which have no product layer. On a v1 project an LLM decomposes the spec into a tree of epics, features, tasks and subtasks, and the steps below walk through that path.
:::

## Step 1: Initialize (if you haven't)

```sh
ndx init .
```

Creates `.sourcevision/`, `.rex/`, and `.hench/` directories. Skip this if n-dx is already initialized for the project.

## Step 2: Import the spec

There are two ways to import, depending on whether you want sourcevision analysis mixed in.

### Option A: `ndx add --file` (spec only, no analysis)

Use this when your spec is self-contained and you don't need architectural findings mixed into the PRD:

```sh
ndx add --file=spec.md .
```

On a v1 project, the LLM reads the spec, decomposes it into a tree of items, and adds them to your PRD. Duplicate detection runs automatically — if your PRD already has overlapping items, you'll be prompted to merge, skip, or proceed.

You can import multiple files in one pass:

```sh
ndx add --file=spec.md --file=api-contracts.md .
```

Or combine with freeform descriptions:

```sh
ndx add --file=spec.md "Also add rate limiting as a separate item" .
```

### Option B: `ndx plan --file` (spec + codebase analysis)

Use this when the spec describes improvements to an existing codebase and you want both the spec requirements and architectural findings in the same PRD:

```sh
ndx plan --file=spec.md .
```

This runs SourceVision analysis first, then feeds both the spec and the analysis findings to the LLM to generate a unified proposal. The proposal is shown for review — you accept it in the next step.

**When to choose which:**

| Situation | Use |
|-----------|-----|
| Greenfield project or isolated feature | `ndx add --file` |
| Brownfield: spec touches existing code | `ndx plan --file` |
| You already ran `ndx analyze` | `ndx add --file` (analysis context is already in `.sourcevision/`) |
| You want interactive proposal review | `ndx plan --file` |

## Step 3: Review and reshape the PRD

Before executing anything, read what was generated:

```sh
ndx status .
```

This prints the full PRD tree. Look for:

- **Missing items** — did the LLM miss something from the spec?
- **Vague tasks** — tasks without clear acceptance criteria won't execute well
- **Wrong granularity** — tasks that are too large for a single agent run (scope a task to "can be done in one hour of focused work")
- **Wrong priority** — the LLM assigns priority from spec signal; override where you disagree

### Adding missing items

If the import missed something:

```sh
ndx add "Implement webhook signature verification" .
ndx add "Webhook verification" --parent=<item-id> .    # under an existing item
```

For larger gaps, add another file:

```sh
ndx add --file=edge-cases.md .
```

### Reordering and reprioritizing

Update priority with the rex CLI:

```sh
rex update <task-id> --priority=critical
rex update <task-id> --priority=low
```

Or use the dashboard (if `ndx start .` is running) to drag and drop items or edit fields in-place.

### Level of effort estimation

Tasks with vague scope are risky. Before accepting, audit your task descriptions for effort signals. If a task says "Build the authentication system," that's too large — break it down:

```sh
ndx add "Implement JWT token generation" --parent=<auth-item-id> .
ndx add "Add session refresh logic" --parent=<auth-item-id> .
ndx add "Write auth middleware tests" --parent=<auth-item-id> .
```

A well-scoped task has:
- A single verb in the title ("Implement", "Add", "Write", "Fix")
- 2–5 concrete acceptance criteria (its "done when")
- Enough context that an agent with codebase access can succeed without asking questions

### Structural cleanup

If the LLM created a flat list when you expected nesting, or mixed concerns into a single item:

```sh
ndx reshape .   # LLM-powered restructuring — proposes reorganization
```

Or use `rex move <id>` to reparent items manually:

```sh
rex move <task-id> --parent=<new-parent-id>
```

## Step 4: Lock in scope

Once the PRD looks right, record the state. If you used `ndx plan --file`, explicitly accept the proposals:

```sh
ndx plan --accept .
```

If you used `ndx add --file`, the items are already in the PRD — no acceptance step needed. Review with `ndx status .` and validate structural integrity:

```sh
ndx validate .
```

This checks for orphaned items, missing acceptance criteria, empty containers, and broken parent references. Fix any flagged issues before proceeding.

## Step 5: Preview before executing

Before the agent starts working, preview the brief it will receive:

```sh
ndx work --dry-run .
```

The dry-run shows the task title, acceptance criteria, relevant files from codebase analysis, and the full context block sent to the LLM. If the brief looks thin (no relevant files, no context), consider running `ndx analyze .` first so the agent has better grounding.

If the top task isn't the one you want to start with:

```sh
ndx work --task=<task-id> --dry-run .   # preview a specific task
```

## Step 6: Execute

With the PRD shaped and validated, run the agent:

```sh
ndx work --auto .                          # execute the highest-priority task
ndx work --auto --iterations=5 .           # run 5 tasks back-to-back
ndx work --epic="Auth System" --auto .     # scope to one top-level item
```

The agent picks the next pending task, builds a brief with codebase context and acceptance criteria, runs a tool-use loop to implement it, commits the changes, and marks the task complete.

## Tracking spec coverage

### Terminal status

```sh
ndx status .
```

Shows the full PRD tree with per-item status (`pending`, `in_progress`, `completed`, `failing`). At a glance you can see how much of the spec has been implemented.

### Dashboard view

```sh
ndx start .
```

Open `http://localhost:3117`. On a v1 project the PRD view shows the item tree with completion percentages per top-level item. Use this to track spec coverage over time without running commands.

Filter to one top-level item to see how a specific spec section is progressing. The status updates in real time as the agent completes tasks (the dashboard polls and self-corrects within seconds of each task completion).

### Coverage at a glance

```sh
ndx status . | grep -E "completed|pending|failing"
```

Or get structured output for scripting:

```sh
ndx status --format=json .
```

The JSON output includes per-item completion status, IDs, and parent references — useful for generating progress reports or feeding into other tools.

## Updating the spec mid-flight

Requirements change. Here's how to add new requirements without duplicating existing PRD structure.

### Adding new requirements

Always use `ndx add` for new requirements — never re-import the original spec file, which would create duplicates:

```sh
ndx add "Add audit logging for all admin actions" .
ndx add --file=new-requirements.md .
```

The duplicate detection runs automatically. If a new requirement overlaps with an existing PRD item, you'll be prompted to merge, skip, or create a new item.

### Handling changed requirements

If a spec item changed and an existing task needs updating:

```sh
rex update <task-id> --title="New title"
```

For changes to a task's acceptance criteria, use the CLI, MCP tools (if the server is running), or the dashboard:

```sh
rex update <task-id> --criterion="Criterion 1" --criterion="Criterion 2"  # replace all acceptance criteria
rex update <task-id> --criterion=                                       # clear all acceptance criteria
```

On a v2 PRD, a changed *requirement* is an edit to the capability, not to a task: `rex product edit <node> --statement="…"` or `--capability-criterion="<id>: <text>"`. The capability then reads *revised* and rex drafts a change in the Inbox to build the edit.

Or use the dashboard task editor — click any task to open its detail panel and edit in-place.

### Removing out-of-scope items

If a spec requirement was cut:

```sh
rex update <task-id> --status=deferred     # preserve for later
rex remove <task-id>                        # remove entirely
```

`deferred` keeps the item in the tree but out of task selection. Use it when a requirement is delayed rather than cancelled.

### Checking for spec drift

After several mid-flight additions, recheck the structure:

```sh
ndx status .
ndx validate .
ndx health .      # PRD health score + structure warnings
```

If the structure has become unbalanced (a top-level item with 20 tasks and nothing between, orphaned items, etc.):

```sh
ndx reorganize .  # auto-detect and propose structural fixes
```

## Keeping the PRD as source of truth

The key discipline of spec-driven development is that the PRD is the single place where work is tracked. Avoid:

- Adding tasks directly to a ticket system without a PRD entry
- Marking things done in your head without updating the PRD
- Running `ndx add` and `ndx plan` concurrently (both write the PRD; the lock serializes the writes, but the last writer's version wins)

After each working session:

```sh
ndx status .           # confirm status is accurate
git log --oneline -10  # confirm commits match what completed
```

If a task the agent marked complete actually needs more work, reset it:

```sh
rex update <task-id> --status=pending
```

The agent will pick it up again in the next `ndx work` run.

## One-session fast path

From spec file to executing agent:

```sh
ndx init .                          # 10 seconds
ndx add --file=spec.md .            # 1–3 minutes (LLM decomposition)
ndx status .                        # review what was generated
ndx validate .                      # check integrity
ndx work --dry-run .                # preview the first brief
ndx work --auto --iterations=5 .    # execute the first 5 tasks
```

Total setup: under 5 minutes. The agent does the rest.

For a brownfield codebase where the spec touches existing code:

```sh
ndx init .
ndx analyze .                       # 5–10 minutes (SourceVision analysis)
ndx plan --file=spec.md .           # propose from spec + findings
ndx plan --accept .                 # lock in
ndx work --dry-run .
ndx work --auto --iterations=5 .
```

Total setup: 15–20 minutes including analysis time.

## Skills used in this guide

Each skill below maps to a step in this guide. Edit the linked file in your project to customize that step's behavior in your assistant session.

| Skill | Source | Role in this guide |
|-------|--------|--------------------|
| `/ndx-plan` | [`.agents/skills/ndx-plan/SKILL.md`](./skills#ndx-plan) | Step 2B & 4: runs analysis alongside spec import and generates a unified proposal for review |
| `/ndx-capture` | [`.agents/skills/ndx-capture/SKILL.md`](./skills#ndx-capture) | Step 3: adds missing spec items as structured PRD entries with correct parent placement |
| `/ndx-reshape` | [`.agents/skills/ndx-reshape/SKILL.md`](./skills#ndx-reshape) | Step 3 structural cleanup (v1): regroups items when the LLM generates a flat list instead of a nested one |
| `/ndx-work` | [`.agents/skills/ndx-work/SKILL.md`](./skills#ndx-work) | Step 6: picks the next spec task and executes it autonomously |
| `/ndx-status` | [`.agents/skills/ndx-status/SKILL.md`](./skills#ndx-status) | Tracking spec coverage: shows PRD completion and the next recommended task |

Related guides: [Workflow](./workflow) (the core loop this guide extends), [Run While You Sleep](./overnight) (for multi-iteration overnight runs), [n-dx vs Spec Kit](./n-dx-vs-spec-kit) (how n-dx differs from Spec Kit, OpenSpec, and Kiro).

For the full skill inventory and customization guidance, see the [Skills Reference](./skills).
