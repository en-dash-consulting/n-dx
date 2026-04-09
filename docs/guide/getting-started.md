# Getting Started

## Installation

```sh
pnpm add -g @n-dx/core
```

After installing, `ndx` (or `n-dx`) is available as the primary command. See the [Quickstart](./quickstart) for a 5-minute walkthrough. To build from source, see [Contributing](https://github.com/en-dash-consulting/n-dx#contributing).

## Initialize a Project

```sh
ndx init .
```

This creates `.sourcevision/`, `.rex/`, and `.hench/` directories in the target project — plus assistant-specific artifacts for Claude and Codex. See [Assistant Surfaces](#assistant-surfaces) below for details on what is generated for each assistant.

### Selecting Assistants

By default, `ndx init` provisions both Claude and Codex surfaces. Use flags to control which assistants are set up:

```sh
ndx init .                       # both Claude and Codex (default)
ndx init --claude-only .         # only Claude surfaces
ndx init --codex-only .          # only Codex surfaces
ndx init --assistants=claude .   # equivalent to --claude-only
ndx init --no-codex .            # skip Codex provisioning
```

::: tip Re-init is safe
Running `ndx init` again detects existing assistant surfaces and reuses them. If only Claude artifacts exist, re-init skips Codex (and vice versa) unless you explicitly pass an assistant flag.
:::

## Configure Your LLM

### Claude (recommended)

```sh
ndx config llm.vendor claude .

# API mode (recommended — best token accounting and reliability)
ndx config llm.claude.api_key sk-ant-... .
# or set the environment variable:
export ANTHROPIC_API_KEY=sk-ant-...

# Optionally pin a model (default: claude-sonnet-4-6)
ndx config llm.claude.model claude-opus-4-20250514 .
```

```sh
# CLI mode (no API key required)
ndx config llm.claude.cli_path claude .
claude login
```

### Codex

```sh
ndx config llm.vendor codex .
ndx config llm.codex.cli_path codex .
codex login
```

## Assistant Surfaces

`ndx init` generates assistant-specific artifacts so that each AI coding assistant can discover your project's workflow, skills, and MCP servers. Both assistants share the same underlying skills and MCP tools — the only difference is the file format each assistant expects.

### Claude

| Artifact | Path | Purpose |
|----------|------|---------|
| Instructions | `CLAUDE.md` | Project guidance, architecture docs, workflow rules |
| Skills | `.claude/skills/{name}/SKILL.md` | Slash-command skills (YAML frontmatter format) |
| Settings | `.claude/settings.local.json` | Auto-approved read-only MCP tool permissions |
| MCP servers | Registered via `claude mcp add` (or auto-configured for Codex) | Rex and SourceVision stdio servers |

To start working with Claude Code after init:

```sh
claude    # open Claude Code — it reads CLAUDE.md automatically
```

Claude discovers skills from `.claude/skills/` and MCP servers from `.claude/settings.local.json`. For HTTP MCP transport (recommended for production), see [MCP Integration](./mcp).

### Codex

| Artifact | Path | Purpose |
|----------|------|---------|
| Instructions | `AGENTS.md` | Project guidance, workflow, available skills, MCP server docs |
| Skills | `.agents/skills/{name}/SKILL.md` | Task skills (plain markdown format) |
| MCP config | `.codex/config.toml` | MCP server definitions (stdio transport) |

To start working with Codex after init:

```sh
codex     # open Codex — it reads AGENTS.md automatically
```

Codex discovers MCP servers from `.codex/config.toml` and skill documentation from `AGENTS.md`.

### Shared Skills

Both assistants receive the same set of workflow skills, rendered in their respective formats:

| Skill | Description |
|-------|-------------|
| `ndx-work` | Execute PRD tasks with workflow discipline |
| `ndx-plan` | Analyze codebase and generate PRD proposals |
| `ndx-status` | Show PRD progress and task tree |
| `ndx-capture` | Capture ideas and add to PRD |
| `ndx-zone` | Explore architectural zones |
| `ndx-config` | View and edit project configuration |
| `ndx-reshape` | Restructure the PRD tree |
| `ndx-feedback` | File a GitHub issue with project context |

## Your First Run

```sh
# 1. Analyze your codebase
ndx analyze .

# 2. Turn findings into PRD tasks
ndx recommend --accept .

# 3. Execute the next task
ndx work --auto .

# 4. Check progress
ndx status .
```

That's it. See the [Workflow](./workflow) page for the full development loop, or [Commands](./commands) for the complete reference.

## Feedback

Found a bug or have a feature idea? Use the `/ndx-feedback` skill in your assistant to submit it directly:

```
/ndx-feedback ndx init keeps prompting for provider even though it's already configured
```

This creates a GitHub issue with your environment details automatically included.
