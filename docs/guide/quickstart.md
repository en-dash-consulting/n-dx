# Quickstart

![En-d-Rex](../../documentation/n-d-rex.png)

Get from zero to a working PRD in under 5 minutes.

::: tip Onboarding an existing repo?
This guide assumes a **new or empty project**. If you're adding ndx to a codebase that already has real history, see [Existing project onboarding](./existing-project) — it adds a pre-flight cleanup pass and `.gitignore` setup.
:::

## Prerequisites

- **Node.js ≥ 18** (Node 22 LTS recommended)
- **pnpm ≥ 10** — [install pnpm](https://pnpm.io/installation)

## 1. Install

```sh
# npm
npm install -g @n-dx/core

# pnpm
pnpm add -g @n-dx/core

# yarn
yarn global add @n-dx/core
```

## 2. Initialize

Navigate to your project and run:

```sh
ndx init
```

You'll first be asked to choose an **LLM provider** (Claude or Codex):

![choose LLM provider prompt](../../documentation/ndx_choose_vendor_init.png)

Then you'll pick a **model** for that provider, after which init runs to completion:

![init local response example](../../documentation/ndx_init.png)

The init command sets up everything — analysis metadata, PRD storage, agent configuration, and assistant-specific artifacts:

- **Claude**: `CLAUDE.md`, `.claude/skills/`, `.claude/settings.local.json`, MCP server registration
- **Codex**: `AGENTS.md`, `.agents/skills/`, `.codex/config.toml`

By default both surfaces are provisioned. Use `--claude-only` or `--codex-only` to limit to one assistant.

::: tip Already initialized?
Running `ndx init` again is safe. It detects existing assistant surfaces and reuses them. If only one assistant's artifacts exist, re-init skips the other unless you explicitly request it.
:::

## 3. Add to the PRD

```sh
ndx add "<describe what you want to create>"
```

![ndx add #1](../../documentation/ndx_add_1.png)
![ndx add #2](../../documentation/ndx_add_2.png)

`ndx add` takes your natural-language description, asks the configured LLM to draft a PRD proposal (epics → features → tasks), and prints it for review. At the bottom you'll see:

```
accept proposals? (y=all / n=none / b#=break down / c=consolidate / 1,2,…=select)
```

Press `y` to accept everything into `.rex/prd_tree/`, or pick specific items.

## 4. Work on the PRD

```sh
ndx work --auto
```

![ndx work example](../../documentation/ndx_work.png)

The agent picks the highest-priority pending task, builds a brief with codebase context, runs an LLM tool-use loop to implement it, and records the results.

## 5. Check progress

```sh
ndx status
```

![ndx status example](../../documentation/ndx_status.png)

You'll see a tree of epics, features, and tasks with completion stats.

## 6. Analyze your changes (optional)

Check how your PRD has been implemented:

```sh
ndx analyze
```

![ndx analyze example](../../documentation/ndx_analyze.png)

Analyze writes only to `.sourcevision/` — file inventory, import graph, zones, findings. No PRD changes yet. Then read what it found:

```sh
ndx recommend --actionable-only
```

![ndx analyze example](../../documentation/ndx_reccomend_1.png)

Skim `.sourcevision/CONTEXT.md` for the AI-readable summary, and use the recommend output to see what ndx thinks needs work. The goal here is a mental model — you don't need to act on anything yet.

## 7. Start the dashboard

```sh
ndx start
```

![ndx start example](../../documentation/ndx_start.png)

Opens a web dashboard at `http://localhost:3117` with interactive views of your codebase analysis, PRD tree, and agent runs.

## What's next?

- **Open your assistant**: `claude` or `codex` — your assistant reads its instruction file and discovers skills automatically
- **Add your own ideas**: `ndx add "Add SSO support with Google" .`
- **Run multiple tasks**: `ndx work --auto --iterations=4 .`
- **Self-healing loop**: `ndx self-heal 3 .` (analyze → recommend → work, repeated)
- **Submit feedback**: `/ndx-feedback "description"` — files a GitHub issue with context
- **Assistant surfaces**: [Getting Started — Assistant Surfaces](./getting-started#assistant-surfaces)
- **Full command reference**: [Commands](./commands)
- **Workflow guide**: [Workflow](./workflow)
