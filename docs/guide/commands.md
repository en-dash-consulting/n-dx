# Commands Reference

## Primary Commands

| Command | Description |
|---------|-------------|
| `ndx init [dir]` | Initialize all tools (sourcevision + rex + hench) |
| `ndx analyze [dir]` | Run SourceVision codebase analysis |
| `ndx recommend [dir]` | Show or accept SourceVision recommendations |
| `ndx add "<desc>" [dir]` | Add PRD items from descriptions, files, or stdin |
| `ndx work [dir]` | Run next task autonomously |
| `ndx self-heal [N] [dir]` | Iterative improvement loop |
| `ndx start [dir]` | Start server: dashboard + MCP |

## More Commands

| Command | Description |
|---------|-------------|
| `ndx plan [dir]` | Analyze codebase and generate PRD proposals |
| `ndx status [dir]` | Show PRD status tree with completion stats |
| `ndx refresh [dir]` | Refresh dashboard artifacts |
| `ndx usage [dir]` | Token usage analytics |
| `ndx sync [dir]` | Sync local PRD with remote adapter |
| `ndx dev [dir]` | Start dev server with live reload |
| `ndx ci [dir]` | Run analysis pipeline and validate PRD health |
| `ndx config [key] [value]` | View and edit settings |
| `ndx export [dir]` | Export static deployable dashboard |

## Command Details

### analyze

```sh
ndx analyze .
ndx analyze --deep .        # full multi-pass analysis
ndx analyze --full .         # alias for --deep
ndx analyze --lite .         # fast single-pass
```

Runs SourceVision codebase analysis: file inventory, import graph, zone detection, component catalog. Results are written to `.sourcevision/`.

### recommend

```sh
ndx recommend .                      # show current findings
ndx recommend --accept .             # add all to PRD
ndx recommend --actionable-only .    # filter to anti-patterns, suggestions, move-files
ndx recommend --acknowledge=1,2 .    # skip finding numbers 1 and 2
ndx recommend --acknowledge-completed .  # acknowledge all completed tasks' findings
```

### add

```sh
ndx add "Add SSO support with Google and Okta" .
ndx add "Request A" "Request B" .     # multiple requests
ndx add --file=ideas.txt .            # import from file
ndx add "Add retries" --parent=ID .   # under specific parent
```

### plan

```sh
ndx plan .                  # interactive: analyze + propose
ndx plan --accept .         # auto-accept proposals
ndx plan --guided .         # step-by-step guided mode
ndx plan --file=spec.md .   # import from document (skips analysis)
```

### work

```sh
ndx work .                             # interactive task selection
ndx work --auto .                      # highest-priority task
ndx work --auto --iterations=4 .       # run 4 tasks sequentially
ndx work --task=abc123 .               # specific task
ndx work --epic="Auth System" --auto . # scope to epic
ndx work --dry-run .                   # preview without executing
ndx work --model=claude-opus-4-20250514 .  # override model
```

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
ndx status --since=7d .     # changes in last 7 days
```

### config

```sh
ndx config .                          # show all settings
ndx config llm.vendor claude .        # set vendor
ndx config llm.claude.api_key KEY .   # set API key
ndx config hench.provider api .       # API mode for hench
ndx config --json .                   # JSON output
```

## Direct Tool Access

Each tool can be accessed through the orchestrator or as a standalone command:

```sh
# Via orchestrator
ndx rex <command> [args]
ndx hench <command> [args]
ndx sourcevision <command> [args]
ndx sv <command> [args]           # alias for sourcevision

# Standalone
rex <command> [args]
hench <command> [args]
sourcevision <command> [args]
sv <command> [args]
```

### Rex Commands

`init`, `status`, `next`, `add`, `remove`, `update`, `validate`, `analyze`, `recommend`, `mcp`

### SourceVision Commands

`init`, `analyze`, `serve`, `validate`, `reset`, `mcp`

### Hench Commands

`init`, `run`, `status`, `show`
