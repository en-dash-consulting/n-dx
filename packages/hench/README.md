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
  "maxTurns": 200,
  "maxTokens": 8192,
  "rexDir": ".rex"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `provider` | `"cli"` | `"cli"` (Claude CLI) or `"api"` (Anthropic SDK) |
| `model` | — | Model override (omit to use provider default) |
| `maxTurns` | `200` | Maximum agent turns per run |
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

Hench enforces multi-layered guardrails on the autonomous agent. All defaults are restrictive and configurable via `.hench/config.json` under the `guard` key.

### Filesystem

All file operations (read, write, list, search) pass through `guard.checkPath()` before any I/O. The validation chain:

1. **Null-byte rejection** — prevents poison-null-byte path truncation attacks
2. **Directory escape detection** — `path.relative()` rejects any resolved path outside the project directory
3. **Glob blocklist** — configurable patterns for off-limits paths

| Setting | Default | Description |
|---------|---------|-------------|
| `blockedPaths` | `.hench/**`, `.rex/**`, `.git/**`, `**/node_modules/**` and the other ecosystems' dependency directories at any depth, credential files | Glob patterns the agent cannot read or write |
| `maxFileSize` | 1 MB | Maximum file size for read/write operations |

### Shell execution

| Setting | Default | Description |
|---------|---------|-------------|
| `allowedCommands` | `npm`, `npx`, `node`, `git`, `tsc`, `vitest` | Executable allowlist (base name matched) |
| `allowedGitSubcommands` | `status`, `add`, `commit`, `diff`, `log`, `branch`, `checkout`, `stash`, `show`, `rev-parse` | Git subcommand allowlist |
| `commandTimeout` | 30s | Per-command timeout |
| `spawnTimeout` | 5 min | Long-running spawn timeout |
| `maxConcurrentProcesses` | 3 | Concurrent child process limit |

Shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`) are rejected before the allowlist is checked. Dangerous patterns (`sudo`, `chmod 777`, `rm` with absolute paths, `eval`, `exec`) are blocked even for allowed executables.

### Rate limiting

The policy engine enforces sliding-window and cumulative limits:

| Setting | Default | Description |
|---------|---------|-------------|
| `policy.maxCommandsPerMinute` | 60 | Sliding-window command rate limit |
| `policy.maxWritesPerMinute` | 30 | Sliding-window file write rate limit |
| `policy.maxTotalBytesWritten` | 0 (unlimited) | Cumulative bytes written per run |
| `policy.maxTotalCommands` | 0 (unlimited) | Cumulative commands per run |

All guard decisions are recorded in an audit log accessible after each run.

### Network

The only outbound network access is to the configured LLM API through `@n-dx/llm-client`. No other HTTP clients or socket connections exist in the agent runtime.

## Development

```sh
npm run build       # tsc
npm test            # vitest
npm run dev         # tsc --watch
```
