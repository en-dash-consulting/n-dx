# Commands Reference

All commands are run through `ndx` (or `n-dx`). The directory argument `[dir]` defaults to `.` (current directory).

## Setup

| Command | Description |
|---------|-------------|
| `ndx init [dir]` | Initialize a project for n-dx |
| `ndx config [key] [value]` | View or edit settings |

## Analyze

| Command | Description |
|---------|-------------|
| `ndx analyze [dir]` | Run codebase analysis |
| `ndx recommend [dir]` | Show or accept findings as PRD items |

## Plan

| Command | Description |
|---------|-------------|
| `ndx plan [dir]` | Analyze codebase and generate PRD proposals |
| `ndx add "<desc>" [dir]` | Add PRD items from natural language |

## Execute

| Command | Description |
|---------|-------------|
| `ndx work [dir]` | Run next task autonomously |
| `ndx self-heal [N] [dir]` | Iterative improvement loop (N cycles) |

## Manage

| Command | Description |
|---------|-------------|
| `ndx status [dir]` | Show PRD status tree |
| `ndx next [dir]` | Print next actionable task |
| `ndx update <id> [dir]` | Update item status, priority, or title |
| `ndx remove <id> [dir]` | Remove an item and its children |
| `ndx move <id> [dir]` | Reparent an item under a new parent |
| `ndx validate [dir]` | Check PRD integrity |
| `ndx fix [dir]` | Auto-fix common PRD issues |
| `ndx health [dir]` | Show PRD structure health score |
| `ndx verify [dir]` | Run acceptance criteria tests |
| `ndx reshape [dir]` | LLM-powered PRD restructuring |
| `ndx reorganize [dir]` | Detect and fix structural issues |
| `ndx prune [dir]` | Remove completed subtrees |
| `ndx reset [dir]` | Remove analysis data and start fresh |
| `ndx show <run-id> [dir]` | Show details of an agent run |
| `ndx usage [dir]` | Token usage analytics |
| `ndx sync [dir]` | Sync PRD with remote adapter |
| `ndx ci [dir]` | Run analysis pipeline and validate PRD health |

## Serve

| Command | Description |
|---------|-------------|
| `ndx start [dir]` | Start dashboard + MCP server |
| `ndx dev [dir]` | Start dev server with live reload |
| `ndx refresh [dir]` | Refresh dashboard artifacts |
| `ndx export [dir]` | Export static deployable dashboard |

---

## Command Details

### init

```sh
ndx init .                    # interactive provider selection
ndx init --provider=claude .  # skip prompt, use Claude
ndx init --provider=codex .   # skip prompt, use Codex
```

Initializes the project: creates analysis metadata, PRD storage, and agent configuration. On re-run, detects existing state and reuses it.

### analyze

```sh
ndx analyze .                # standard analysis
ndx analyze --deep .         # full multi-pass analysis
ndx analyze --lite .         # fast single-pass (skips LLM enrichment)
```

Scans the codebase: file inventory, import graph, zone detection (Louvain community detection), component catalog. Results drive recommendations and planning.

### recommend

```sh
ndx recommend .                      # show current findings
ndx recommend --accept .             # add all to PRD
ndx recommend --actionable-only .    # filter to concrete problems only
ndx recommend --acknowledge=1,2 .    # skip specific findings
ndx recommend --acknowledge-completed .  # acknowledge completed findings
```

### add

```sh
ndx add "Add SSO support with Google and Okta" .
ndx add "Request A" "Request B" .     # multiple requests
ndx add --file=ideas.txt .            # import from file
```

Uses an LLM to decompose natural language descriptions into structured PRD items (epics, features, tasks). Detects duplicates and offers merge/cancel/proceed options.

### plan

```sh
ndx plan .                  # interactive: analyze + propose
ndx plan --accept .         # auto-accept proposals
ndx plan --guided .         # step-by-step guided mode
ndx plan --file=spec.md .   # import from document (skips analysis)
```

Combines analysis and proposal generation in one step. Use `analyze` + `recommend` separately for more control.

### work

```sh
ndx work .                             # interactive task selection
ndx work --auto .                      # highest-priority task
ndx work --auto --iterations=4 .       # run 4 tasks sequentially
ndx work --task=abc123 .               # specific task
ndx work --epic="Auth System" --auto . # scope to epic
ndx work --dry-run .                   # preview without executing
ndx work --model=claude-opus-4-20250514 .  # override model
ndx work --auto --loop .               # run continuously until done
```

#### Task selection modes

By default on an interactive terminal, `ndx work` presents a menu to choose which task to work on. The `--auto` flag skips this and auto-selects the highest-priority pending task instead. Use `--task=<id>` to target a specific task directly (this overrides both interactive and auto selection).

| Flag | Behavior |
|------|----------|
| _(none, TTY)_ | Interactive menu — pick a task from the list |
| `--auto` | Auto-select highest-priority pending task |
| `--task=<id>` | Run a specific task by ID |

#### Running multiple tasks

`--iterations=N` runs N tasks back-to-back, auto-selecting the next highest-priority task after each one completes. Defaults to 1. Stuck detection skips tasks that have failed repeatedly (default: 3 consecutive failures) so iterations don't get stuck on the same broken task.

`--loop` runs tasks continuously until all tasks are complete or you hit Ctrl+C. Implies auto-selection. Use `--loop-pause=<ms>` to add a delay between iterations.

#### Scoping

`--epic=<name-or-id>` restricts task selection (both interactive and auto) to tasks within a specific epic. Combine with `--auto` or `--iterations` to work through an epic sequentially.

#### Other flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Build and display the brief without executing |
| `--model=<model>` | Override the LLM model for this run |
| `--priority=<level>` | Override task scheduling priority (critical, high, medium, low) |

### self-heal

```sh
ndx self-heal 3 .           # 3 improvement cycles
ndx self-heal .             # default: 1 cycle
```

Each cycle: analyze → recommend (actionable-only) → work → acknowledge completed.

### start

```sh
ndx start .                 # foreground on port 3117
ndx start --port=8080 .     # custom port
ndx start --background .    # daemon mode
ndx start status .          # check if running
ndx start stop .            # stop daemon
```

### status

```sh
ndx status .                # PRD tree
ndx status --format=json .  # machine-readable
ndx status --all .          # include completed items
```

### config

```sh
ndx config .                          # show all settings
ndx config llm.vendor claude .        # set vendor
ndx config llm.claude.api_key KEY .   # set API key
ndx config hench.provider api .       # API mode
ndx config --json .                   # JSON output
```

---

::: details Advanced: Direct Tool Access
For power users, individual tools can be accessed directly:

```sh
ndx rex <command> [args]          # PRD management
ndx hench <command> [args]        # Agent operations
ndx sourcevision <command> [args] # Analysis engine
ndx sv <command> [args]           # Alias for sourcevision
```

These are also available as standalone commands (`rex`, `hench`, `sourcevision`, `sv`) after installation.
:::
