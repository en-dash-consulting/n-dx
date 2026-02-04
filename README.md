# n-dx

AI-powered development toolkit. Three packages that chain together: analyze a codebase, build a PRD, execute tasks autonomously.

| | | |
|:---:|:---:|:---:|
| [![SourceVision](packages/sourcevision/SourceVision.png)](packages/sourcevision) | [![Rex](packages/rex/Rex.png)](packages/rex) | [![Hench](packages/hench/Hench.png)](packages/hench) |
| **[SourceVision](packages/sourcevision)** | **[Rex](packages/rex)** | **[Hench](packages/hench)** |
| Static analysis & zone detection | PRD management & task tracking | Autonomous agent execution |

## Quick Start

```sh
pnpm install
pnpm build

# Register CLI to globally
npm link
# or
pnpm link --global

# Initialize all tools in a project
n-dx init .

# Analyze codebase and generate PRD proposals
n-dx plan .

# Accept proposals into the PRD
n-dx plan --accept .

# Execute the next task autonomously
n-dx work .

# Check progress
n-dx status .
```

## Packages

**[sourcevision](packages/sourcevision)** — Static analysis: file inventory, import graph, zone detection (Louvain community detection), React component catalog. Produces `.sourcevision/CONTEXT.md` and `llms.txt` for AI consumption. Includes an interactive browser-based viewer.

**[rex](packages/rex)** — PRD management: hierarchical epics/features/tasks/subtasks, `analyze` scans project + sourcevision output to generate proposals, `status` shows completion tree. Stores state in `.rex/prd.json`. MCP server for AI tool integration.

**[hench](packages/hench)** — Autonomous agent: picks next rex task, builds a brief, calls Claude API or CLI in a tool-use loop with security guardrails, records runs in `.hench/runs/`.

## Orchestration Commands

```
n-dx init [dir]            sourcevision init + rex init + hench init
n-dx plan [dir]            sourcevision analyze + rex analyze (show proposals)
n-dx plan --accept [dir]   ...then accept proposals into PRD
n-dx plan --file=<path>    import PRD from a document (skips sourcevision)
n-dx work [dir]            hench run (interactive task selection by default)
n-dx work --auto [dir]     autoselect highest-priority task
n-dx work --iterations=N   run N tasks sequentially (stops on failure)
n-dx status [dir]          rex status (pass --format=json)
```

## Direct Tool Access

```sh
n-dx rex <command> [args]
n-dx hench <command> [args]
n-dx sourcevision <command> [args]
n-dx sv <command> [args]          # alias
```

## MCP Servers

Rex and sourcevision expose MCP servers for Claude Code tool use:

```sh
claude mcp add rex -- node packages/rex/dist/cli/index.js mcp .
claude mcp add sourcevision -- node packages/sourcevision/dist/cli/index.js mcp .
```

## Development

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages
```

## Output Files

| Directory | Owner | Contents |
|-----------|-------|----------|
| `.sourcevision/` | sourcevision | `manifest.json`, `inventory.json`, `imports.json`, `zones.json`, `components.json`, `llms.txt`, `CONTEXT.md` |
| `.rex/` | rex | `prd.json`, `config.json`, `execution-log.jsonl`, `workflow.md` |
| `.hench/` | hench | `config.json`, `runs/` |

## License

ISC
