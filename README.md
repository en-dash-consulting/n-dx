# n-dx

AI-powered development toolkit. Analyze a codebase, build a PRD, execute tasks autonomously.

| | | |
|:---:|:---:|:---:|
| [![SourceVision](packages/sourcevision/SourceVision.png)](packages/sourcevision) | [![Rex](packages/rex/Rex.png)](packages/rex) | [![Hench](packages/hench/Hench.png)](packages/hench) |
| **[SourceVision](packages/sourcevision)** | **[Rex](packages/rex)** | **[Hench](packages/hench)** |
| Static analysis & zone detection | PRD management & task tracking | Autonomous agent execution |

## Requirements

**Node.js ≥ 18** (Node 22 LTS recommended) · **pnpm ≥ 10**

### Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| macOS | ✅ Supported | CI smoke tests on `macos-latest` |
| Linux | ✅ Supported | Full CI (build, typecheck, unit tests) on `ubuntu-latest` |
| Windows — WSL2 | ✅ Supported | Runs as Linux; no separate CI coverage needed |
| Windows — native | ⚠️ Experimental | CLI smoke tests pass in CI with macOS parity checks; process group management and shell spawning differ from POSIX; `ndx work` agent loop has reduced native test coverage |

For a supported Linux environment on Windows, use **WSL2** (recommended) or the Docker infrastructure in [`.local_testing/`](.local_testing/).

## Local Platform Testing

If you're on **native Windows** or want to test against multiple platforms, use the Docker-based local test suite:

### Prerequisites

- **Docker Desktop** ≥ 20 (download from [docker.com](https://www.docker.com/products/docker-desktop))
- **Disk space:** ~2GB for Windows Server Core image; Linux image is smaller
- **Docker daemon must be running** before starting tests

### Quick Test

Run tests in an isolated environment matching native Windows or macOS:

**macOS / Linux (bash):**
```sh
./.local_testing/run-gauntlet.sh
```

**Windows (PowerShell):**
```powershell
.\.local_testing\run-gauntlet.ps1
```

Both scripts:
- Detect your platform automatically
- Build the Docker image (cached after first run)
- Run `pnpm test` inside the container
- Clean up automatically on completion
- Return meaningful exit codes

### Exit Codes

- **0** — All tests passed ✓
- **1** — Tests failed (one or more test case failed)
- **2** — Docker error (build, run, or daemon issue)
- **3** — Configuration error (Docker not found, invalid options)

### Advanced Options

See [`.local_testing/README.md`](.local_testing/) for advanced usage:
- Custom image tags and container names
- Keeping containers for inspection (`--keep-container`)
- Background execution (`--detach`)
- Verbose debugging (`--verbose`)
- CI/CD pipeline integration examples
- Troubleshooting Docker and container issues

## Quick Start

**Prerequisites:** Node.js ≥ 18 (22 LTS recommended) and pnpm ≥ 10.

```sh
pnpm add -g @n-dx/core      # install from npm

ndx init .                  # initialize project (.sourcevision/.rex/.hench)
ndx config llm.vendor claude .

ndx analyze .               # run SourceVision codebase analysis
ndx recommend --accept .    # turn findings into PRD tasks
ndx add "Add SSO support" . # add custom feature requests
ndx work --auto .           # execute the next task autonomously
ndx status .                # check progress
```

## Workflow

The core loop: **analyze** your codebase, **build** a PRD from findings and ideas, **execute** tasks with an autonomous agent.

### 1. Analyze

```sh
ndx analyze .
```

Runs SourceVision static analysis: file inventory, import graph, zone detection (Louvain community detection), and React component catalog. Outputs `.sourcevision/CONTEXT.md`, `llms.txt`, zones, and architectural findings.

### 2. Recommend

```sh
ndx recommend .                # show findings and recommendations
ndx recommend --accept .       # add all recommendations to PRD
ndx recommend --acknowledge=1,2 .  # skip specific findings
ndx recommend --actionable-only .  # only anti-patterns, suggestions, move-files
```

Translates SourceVision findings into concrete PRD tasks. The `--actionable-only` flag filters out non-actionable observations (metrics, patterns, relationships) and keeps only findings that describe concrete problems to fix.

### 3. Add Ideas

```sh
ndx add "Add SSO support with Google and Okta" .    # natural language
ndx add --file=ideas.txt .                           # import from file
```

Smart add uses an LLM to decompose descriptions into structured epic/feature/task proposals with duplicate detection against existing PRD items.

### 4. Plan (Full Pipeline)

```sh
ndx plan .                  # analyze + generate PRD proposals (interactive)
ndx plan --accept .         # analyze + auto-accept proposals
ndx plan --file=spec.md .   # import PRD from a document (skips analysis)
```

`plan` combines analysis and proposal generation in one step. For existing codebases scanned for the first time, baseline detection automatically marks implemented functionality as "completed" and only gaps/improvements as "pending."

### 5. Execute

```sh
ndx work --auto .                          # next highest-priority task
ndx work --auto --iterations=4 .           # run 4 tasks sequentially
ndx work --epic="Auth System" --auto .     # scope to an epic
ndx work --task=abc123 .                   # specific task
ndx work --auto --yes .                    # unattended: auto-confirm commit + rollback prompts
```

Hench picks a task, builds a brief with codebase context, runs an LLM tool-use loop to implement it, then records the run. Pass `--yes` to skip the interactive commit-confirmation prompt (the agent's proposed message is committed automatically).

### 6. Self-Heal

```sh
ndx self-heal 3 .           # 3 iterations of analyze → recommend → execute
ndx self-heal 3 --yes .     # unattended: forward --yes to the inner hench loop
```

Iterative improvement loop: re-analyze the codebase, accept new recommendations (filtered to actionable findings), execute tasks, acknowledge completed findings, and repeat. Fuzzy acknowledgment matching prevents fixed findings from regenerating as "new" after code changes alter zone names.

### 7. Monitor

```sh
ndx status .                # PRD tree with completion stats
ndx start .                 # dashboard + MCP server (port 3117)
ndx start --background .    # daemon mode
ndx usage .                 # token usage analytics
```

## LLM Configuration

**Claude (recommended):**
```sh
ndx config llm.vendor claude .
# API mode (recommended):
ndx config llm.claude.api_key sk-ant-... .
# CLI mode (no API key):
ndx config llm.claude.cli_path claude .
```

**Codex:**
```sh
ndx config llm.vendor codex .
ndx config llm.codex.cli_path codex .
```

## Commands

### Primary

| Command | Description |
|---------|-------------|
| `ndx init [dir]` | Initialize all tools (sourcevision + rex + hench) |
| `ndx analyze [dir]` | Run SourceVision codebase analysis (`--deep`, `--full`, `--lite`) |
| `ndx recommend [dir]` | Show/accept SourceVision recommendations (`--accept`, `--actionable-only`) |
| `ndx add "<desc>" [dir]` | Add PRD items from descriptions, files, or stdin |
| `ndx work [dir]` | Run next task (`--task=ID`, `--epic=ID`, `--auto`, `--loop`, `--yes`) |
| `ndx self-heal [N] [dir]` | Iterative improvement loop (analyze + recommend + execute) |
| `ndx start [dir]` | Start server: dashboard + MCP (`--port=N`, `--background`, `stop`, `status`) |

### More

| Command | Description |
|---------|-------------|
| `ndx plan [dir]` | Analyze codebase and generate PRD proposals (`--guided`, `--accept`) |
| `ndx status [dir]` | Show PRD status (`--format=json`, `--since`, `--until`) |
| `ndx refresh [dir]` | Refresh dashboard artifacts (`--ui-only`, `--data-only`, `--no-build`) |
| `ndx usage [dir]` | Token usage analytics (`--format=json`, `--group=day\|week\|month`) |
| `ndx sync [dir]` | Sync local PRD with remote adapter (`--push`, `--pull`) |
| `ndx dev [dir]` | Start dev server with live reload |
| `ndx ci [dir]` | Run analysis pipeline and validate PRD health |
| `ndx config [key] [value]` | View and edit settings (`--json`, `--help`) |
| `ndx export [dir]` | Export static deployable dashboard (`--out-dir`, `--deploy=github`) |

### Direct Tool Access

```sh
ndx rex <command> [args]          # or standalone: rex <command> [args]
ndx hench <command> [args]        # or standalone: hench <command> [args]
ndx sourcevision <command> [args] # or standalone: sv <command> [args]
```

Both `n-dx` and `ndx` work identically. `sv` is an alias for `sourcevision`.

## MCP Servers

Rex and SourceVision expose MCP servers for any MCP-compatible assistant (Claude Code, Codex, etc.).

### HTTP transport (recommended)

```sh
ndx start .
# Claude example:
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

### stdio transport

`ndx init` auto-registers stdio MCP servers for both Claude Code and Codex. After init, MCP works out of the box.

Manual Claude registration:

```sh
claude mcp add rex -- rex mcp .
claude mcp add sourcevision -- sv mcp .
```

Codex reads `.codex/config.toml` automatically — no manual registration required.

### Tools

**Rex:** `get_prd_status`, `get_next_task`, `add_item`, `update_task_status`, `edit_item`, `get_item`, `move_item`, `merge_items`, `get_recommendations`, `verify_criteria`, `reorganize`, `health`, `facets`, `append_log`, `sync_with_remote`, `get_capabilities`

**SourceVision:** `get_overview`, `get_next_steps`, `get_zone`, `get_findings`, `get_file_info`, `search_files`, `get_imports`, `get_classifications`, `set_file_archetype`, `get_route_tree`

## Packages

| Package | Description |
|---------|-------------|
| **[@n-dx/sourcevision](packages/sourcevision)** | Static analysis: file inventory, import graph, zone detection (Louvain), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt`. |
| **[@n-dx/rex](packages/rex)** | PRD management: hierarchical epics/features/tasks/subtasks, LLM-powered analysis and recommendations. Stores state in `.rex/prd.json`. |
| **[@n-dx/hench](packages/hench)** | Autonomous agent: picks rex tasks, builds briefs, runs LLM tool-use loops with security guardrails. Records runs in `.hench/runs/`. |
| **[@n-dx/llm-client](packages/llm-client)** | Vendor-neutral LLM foundation: Claude and Codex adapters, provider registry, token usage tracking. |
| **[@n-dx/web](packages/web)** | Dashboard and unified MCP HTTP server: browser-based project dashboard with zone maps and PRD status. |

## Output Files

| Directory | Owner | Contents |
|-----------|-------|----------|
| `.sourcevision/` | sourcevision | `manifest.json`, `inventory.json`, `imports.json`, `zones.json`, `components.json`, `llms.txt`, `CONTEXT.md` |
| `.rex/` | rex | `prd.json`, `config.json`, `execution-log.jsonl`, `workflow.md`, `acknowledged-findings.json` |
| `.hench/` | hench | `config.json`, `runs/` |

> **Legacy PRD migration.** The PRD is a single canonical file at `.rex/prd.json`. If you are upgrading from a previous layout that produced branch-scoped files (`.rex/prd_{branch}_{date}.json`), the first rex read after upgrade merges every such file into `prd.json` and renames the sources to `<name>.backup.<timestamp>`. The migration runs once, is idempotent, and requires no user action — delete the `.backup.*` files once the merged `prd.json` looks correct.

![prd_design](./documentation/Indexed_PRD.drawio.png)

*Figure placeholder — replace `img_here` with the final image path. The diagram should depict the legacy branch-scoped multi-file PRD layout (`.rex/prd_{branch}_{date}.json` per branch/date) on the left, the single canonical `.rex/prd.json` on the right, and arrows showing each legacy file being merged into `prd.json` and renamed to `<name>.backup.<timestamp>` on first store resolution.*

## Security

n-dx runs an autonomous agent (hench) that reads, writes, and executes commands on your behalf. The security model is designed to keep all operations scoped to the project directory with no ambient access to the rest of your system.

### Filesystem boundary

Every file operation passes through a guard that validates the resolved path stays within the project directory. Directory traversal (`..`), null-byte injection, and symlink escapes are rejected before any I/O occurs. Additionally, `.hench/`, `.rex/`, `.git/`, and `node_modules/` are blocked by default — the agent cannot modify its own configuration or PRD state through file tools.

### Shell execution

Shell commands are restricted to an allowlist of executables: `npm`, `npx`, `node`, `git`, `tsc`, `vitest` by default. Shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`) are rejected outright to prevent command injection. Git subcommands are separately allowlisted — `push`, `reset`, `clean`, `fetch`, and `rebase` are blocked by default. Dangerous patterns (`sudo`, `chmod 777`, `rm` with absolute paths, `eval`) are caught even for allowed executables.

### Network access

The only outbound network connections are to the configured LLM API (Anthropic by default) through `@n-dx/llm-client`. No other HTTP clients, fetch calls, or socket connections exist in the agent runtime.

### Rate limiting

A policy engine enforces per-minute rate limits on commands (60/min) and file writes (30/min). Cumulative budgets for total bytes written and total commands are configurable in `.hench/config.json` under `guard.policy`.

### No install-time hooks

All packages use only `prepare` scripts (TypeScript compilation). There are no `preinstall`, `postinstall`, or native code compilation steps.

### Configuration

Guard settings are loaded once per agent run and cannot be modified mid-execution. All defaults are restrictive — you can loosen them in `.hench/config.json` under `guard`, but the agent itself cannot write to that file.

See the [hench README](packages/hench#security) for the full configuration reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor setup guide,
including Node.js / pnpm version requirements, workspace bootstrap, platform-
specific notes (macOS, Linux, Windows/WSL2), and Docker testing infrastructure.

Quick start:

```sh
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
pnpm install && pnpm build
```

### Build & test

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages
```

### Issue triage

The `/triage` skill in Claude Code prioritizes and reprioritizes GitHub issues against strategic goals. See `.claude/skills/triage/` for the goals matrix and process.

### Resources

See [PACKAGE_GUIDELINES.md](PACKAGE_GUIDELINES.md) for package conventions, gateway patterns, and dependency hierarchy. See [TESTING.md](TESTING.md) for test tier requirements.

## Community

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

[Elastic License 2.0](LICENSE)
