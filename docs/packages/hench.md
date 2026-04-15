<img src="/hench.png" alt="Hench" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# Hench

Autonomous agent that picks Rex tasks, builds briefs with codebase context, runs an LLM tool-use loop to implement them, and records everything.

## How It Works

1. **Pick task** — selects the highest-priority pending task (or a specific one via `--task`)
2. **Build brief** — gathers relevant files, acceptance criteria, related code, and SourceVision context
3. **Execute** — runs an LLM tool-use loop with file operations, shell commands, and git
4. **Record** — saves the full run transcript, token usage, and outcome to `.hench/runs/`

## CLI

```sh
hench run .                          # interactive task selection
hench run --auto .                   # highest-priority task
hench run --task=abc123 .            # specific task
hench run --auto --iterations=4 .    # run 4 tasks sequentially
hench run --dry-run .                # preview brief without executing
hench run --model=claude-opus-4-20250514 .  # override model
hench config .                       # view workflow configuration
hench config hench.maxTurns 30 .     # edit a config value
hench template list .                # list workflow templates
hench template apply <name> .        # apply a saved template
hench status .                       # show recent runs
hench show <run-id> .                # detailed run transcript
```

Or through the orchestrator:

```sh
ndx work --auto .
ndx work --epic="Auth System" --auto --iterations=2 .
```

## Agent Tools

The agent has access to 9 tools during execution:

| Tool | Description |
|------|-------------|
| File read | Read files from the project |
| File write | Create or overwrite files |
| File edit | Make targeted edits to existing files |
| Shell | Execute shell commands (30s timeout) |
| Git | Git operations (status, diff, commit) |
| Search | Grep and glob for code search |
| Rex update | Update task status in the PRD |
| Log | Write to the execution log |
| Subtask | Create subtasks under the current task |

## Security Guardrails

- **Blocked paths** — cannot modify files outside the project directory
- **Allowed commands** — shell commands are restricted to a safe set
- **Timeouts** — 30-second timeout per shell command
- **File size limit** — 1 MB maximum per file write
- **No `.rex/` writes** — agent cannot directly modify PRD files; all mutations go through Rex's store layer

## Configuration

Stored in `.hench/config.json`:

```sh
ndx config hench.provider api .       # api or cli
ndx config hench.maxTurns 30 .        # max tool-use turns per task
ndx config hench.maxTokens 100000 .   # token budget per task
```

## Stuck Detection

If a task fails repeatedly (default threshold: 3 consecutive failures including completion rejections), stuck detection kicks in and moves to the next task. This prevents infinite loops on unfixable tasks.

## Run Records

Each run is saved to `.hench/runs/<run-id>/`:

- `run.json` — metadata, outcome, token usage
- `transcript.jsonl` — full conversation transcript
- `brief.md` — the brief that was sent to the LLM
