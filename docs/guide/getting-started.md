# Getting Started

## Installation

```sh
# Clone and build
git clone https://github.com/en-dash-consulting/n-dx.git
cd n-dx
pnpm install
pnpm build

# Register CLI globally
npm link
```

After linking, both `ndx` and `n-dx` are available as commands. `sv` is a shorthand for `sourcevision`.

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
ndx config rex.model gpt-5.3-codex .
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
