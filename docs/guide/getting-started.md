# Getting Started

## Installation

```sh
npm i -g @n-dx/core
```

Or build from source:

```sh
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
pnpm install && pnpm build
npm link
```

After installing, `ndx` (or `n-dx`) is available as the primary command. See the [Quickstart](./quickstart) for a 5-minute walkthrough.

## Initialize a Project

```sh
ndx init .
```

This creates `.sourcevision/`, `.rex/`, and `.hench/` directories in the target project.

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

Found a bug or have a feature idea? Use the `/ndx-feedback` skill in Claude Code to submit it directly:

```
/ndx-feedback ndx init keeps prompting for provider even though it's already configured
```

This creates a GitHub issue with your environment details automatically included.
