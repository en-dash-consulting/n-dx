# Spec-Driven Development

You have a product spec, a requirements doc, or a design document. This guide takes it from written text to an executing autonomous agent in one session.

## The scenario

You've written a 200-line `spec.md` describing a new feature set: API design, data models, acceptance criteria, edge cases. You want to turn that into a structured backlog and start executing — without manually translating each requirement into a PRD item.

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

The LLM reads the spec, decomposes it into epics, features, tasks, and subtasks, and adds them to your PRD. Duplicate detection runs automatically — if your PRD already has overlapping items, you'll be prompted to merge, skip, or proceed.

You can import multiple files in one pass:

```sh
ndx add --file=spec.md --file=api-contracts.md .
```

Or combine with freeform descriptions:

```sh
ndx add --file=spec.md "Also add rate limiting as a separate epic" .
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
ndx add "Webhook verification" --parent=<epic-id> .    # under specific epic
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
ndx add "Implement JWT token generation" --parent=<auth-feature-id> .
ndx add "Add session refresh logic" --parent=<auth-feature-id> .
ndx add "Write auth middleware tests" --parent=<auth-feature-id> .
```

A well-scoped task has:
- A single verb in the title ("Implement", "Add", "Write", "Fix")
- 2–5 concrete acceptance criteria
- Enough context that an agent with codebase access can succeed without asking questions

### Structural cleanup

If the LLM created a flat list when you expected hierarchy, or mixed concerns into a single epic:

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

This checks for orphaned items, missing acceptance criteria, empty epics, and broken parent references. Fix any flagged issues before proceeding.

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
ndx work --epic="Auth System" --auto .     # scope to one epic
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

Open `http://localhost:3117`. The PRD view shows the hierarchy with completion percentages per epic. Use this to track spec coverage over time without running commands.

Filter by epic to see how a specific spec section is progressing. The status updates in real time as the agent completes tasks (the dashboard polls and self-corrects within seconds of each task completion).

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

For acceptance criteria changes, use the MCP tools (if the server is running) or edit `.rex/prd.json` directly:

```sh
rex update <task-id> --criteria="New criterion 1; New criterion 2"
```

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

If the structure has become unbalanced (epics with 20 tasks and no features, orphaned items, etc.):

```sh
ndx reorganize .  # auto-detect and propose structural fixes
```

## Keeping the PRD as source of truth

The key discipline of spec-driven development is that the PRD is the single place where work is tracked. Avoid:

- Adding tasks directly to a ticket system without a PRD entry
- Marking things done in your head without updating the PRD
- Running `ndx add` and `ndx plan` concurrently (concurrent writes corrupt `.rex/prd.json`)

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
