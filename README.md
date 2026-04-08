# n-dx

AI-powered development toolkit. Analyze a codebase, build a PRD, execute tasks autonomously.

| | | |
|:---:|:---:|:---:|
| [![SourceVision](packages/sourcevision/SourceVision.png)](packages/sourcevision) | [![Rex](packages/rex/Rex.png)](packages/rex) | [![Hench](packages/hench/Hench.png)](packages/hench) |
| **[SourceVision](packages/sourcevision)** | **[Rex](packages/rex)** | **[Hench](packages/hench)** |
| Static analysis & zone detection | PRD management & task tracking | Autonomous agent execution |

## Quick Start

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
ndx add "Add retries" --parent=<item-id> .           # under specific parent
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
```

Hench picks a task, builds a brief with codebase context, runs an LLM tool-use loop to implement it, then records the run.

### 6. Self-Heal

```sh
ndx self-heal 3 .           # 3 iterations of analyze → recommend → execute
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
| `ndx work [dir]` | Run next task (`--task=ID`, `--epic=ID`, `--auto`, `--loop`) |
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

Rex and SourceVision expose MCP servers for Claude Code tool use.

### HTTP transport (recommended)

```sh
ndx start .
claude mcp add --transport http rex http://localhost:3117/mcp/rex
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
```

### stdio transport

After installing `@n-dx/core`, the `rex` and `sv` commands are available:

```sh
claude mcp add rex -- rex mcp .
claude mcp add sourcevision -- sv mcp .
```

### Tools

**Rex:** `rex_status`, `rex_next`, `rex_add`, `rex_update`, `rex_validate`, `rex_analyze`, `rex_recommend`

**SourceVision:** `sv_inventory`, `sv_imports`, `sv_zones`, `sv_components`, `sv_context`

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

### Build from source

```sh
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
pnpm install && pnpm build
cd packages/core && pnpm link --global  # register CLI globally
```

When developing locally, link from `packages/core` (not the monorepo root) so the global package name matches the published `@n-dx/core`. Use `pnpm ls -g` to verify.

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
