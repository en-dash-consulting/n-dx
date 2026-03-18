# @n-dx/hench

> **This is an internal package of [`@n-dx/core`](https://www.npmjs.com/package/@n-dx/core).** Install `@n-dx/core` instead — it includes this package and registers all CLI commands.

<img src="Hench.png" alt="Hench" width="128">

Autonomous AI agent for executing [Rex](../rex) PRD tasks. Picks the next actionable task, builds a brief, runs a Claude tool-use loop, and records results.

## Quick Start

```sh
hench init .
hench run .
```

## Commands

### `hench init [dir]`

Create `.hench/` with default config and runs directory.

### `hench run [dir]`

Execute tasks from the Rex PRD. By default, presents an interactive task picker sorted by priority. Use `--auto` to skip selection and autoselect the highest-priority task.

```sh
hench run .                    # interactive task selection (TTY)
hench run --task=<id> .        # run specific task
hench run --auto .             # autoselect highest-priority task
hench run --iterations=5 .     # run 5 tasks sequentially
hench run --dry-run .          # print brief, no API calls
hench run --max-turns=20 .     # limit turns
hench run --model=<model> .    # override model
hench run --provider=cli .     # use Claude CLI instead of API
```

Task selection precedence: `--task=<id>` > interactive picker (TTY) > autoselect. When using `--iterations`, the first iteration uses the selected task; subsequent iterations autoselect the next task by priority. Iteration stops early on failure or timeout.

The agent loop:
1. Reads the Rex PRD and picks the next actionable task
2. Assembles a task brief with parent chain, siblings, and project context
3. Runs a tool-use loop until the task is complete or turns are exhausted
4. Records the run with full metadata to `.hench/runs/`

### `hench status [dir]`

Show recent run history.

```sh
hench status .
hench status --last=20 .       # show more runs
hench status --format=json .
```

### `hench show <run-id> [dir]`

Display full details of a specific run including tool calls, token usage, and output.

## Configuration

`.hench/config.json`:

```json
{
  "schema": "hench/v1",
  "provider": "cli",
  "maxTurns": 50,
  "maxTokens": 8192,
  "rexDir": ".rex"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `provider` | `"cli"` | `"cli"` (Claude CLI) or `"api"` (Anthropic SDK) |
| `model` | — | Model override (omit to use provider default) |
| `maxTurns` | `50` | Maximum agent turns per run |
| `maxTokens` | `8192` | Max tokens per turn |
| `rexDir` | `".rex"` | Path to Rex directory |
| `apiKeyEnv` | `"ANTHROPIC_API_KEY"` | Env var for API key (api provider only) |

## Agent Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `list_directory` | List files and directories |
| `search_files` | Regex search across files |
| `run_command` | Execute shell commands |
| `git` | Run git operations |
| `rex_update_status` | Mark task in_progress/completed |
| `rex_append_log` | Log actions to Rex execution log |
| `rex_add_subtask` | Break down tasks into subtasks |

## Security

Hench enforces guardrails on the agent:
- **Blocked paths**: `.hench/`, `.rex/`, `.git/`, `node_modules/`
- **Allowed commands**: `npm`, `npx`, `node`, `git`, `tsc`, `vitest`
- **Command timeout**: 30 seconds
- **File size limit**: 1 MB

## Development

```sh
npm run build       # tsc
npm test            # vitest
npm run dev         # tsc --watch
```
