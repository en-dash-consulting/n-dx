# Workflow

The core n-dx loop: **analyze** your codebase, **build** a PRD from findings and ideas, **execute** tasks with an autonomous agent, **repeat**.

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
ndx add "Add retries" --parent=<item-id> .
```

Smart add uses an LLM to decompose descriptions into structured epic/feature/task proposals. If duplicates are detected against existing PRD items:

- **Cancel** — write nothing
- **Merge** — update matched items, add only non-duplicates
- **Proceed** — create duplicates with override markers for auditing

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
ndx work --epic="Auth System" --auto .     # scope to an epic
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
ndx status .                 # PRD tree with completion stats
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
