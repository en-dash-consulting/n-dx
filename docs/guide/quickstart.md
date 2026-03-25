# Quickstart

Get from zero to a working PRD in under 5 minutes.

## 1. Install

```sh
npm i -g @n-dx/core
```

## 2. Initialize

Navigate to your project and run:

```sh
ndx init .
```

You'll be asked to choose an LLM provider (Claude or Codex). The init command sets up everything — analysis metadata, PRD storage, and agent configuration.

::: tip Already initialized?
Running `ndx init` again is safe. It detects existing configuration and reuses it without prompting.
:::

## 3. Analyze your codebase

```sh
ndx analyze .
```

This scans your project: file inventory, import graph, architectural zones, React components. Results are written to `.sourcevision/` and used by subsequent commands.

## 4. Generate a PRD

```sh
ndx plan --accept .
```

This runs the analysis and generates PRD proposals based on findings — anti-patterns, missing features, architectural gaps. The `--accept` flag adds them to your PRD automatically. Without it, you'll review proposals interactively.

## 5. Check progress

```sh
ndx status .
```

You'll see a tree of epics, features, and tasks with completion stats.

## 6. Execute a task

```sh
ndx work --auto .
```

The agent picks the highest-priority pending task, builds a brief with codebase context, runs an LLM tool-use loop to implement it, and records the results.

## 7. Start the dashboard

```sh
ndx start .
```

Opens a web dashboard at `http://localhost:3117` with interactive views of your codebase analysis, PRD tree, and agent runs.

## What's next?

- **Add your own ideas**: `ndx add "Add SSO support with Google" .`
- **Run multiple tasks**: `ndx work --auto --iterations=4 .`
- **Self-healing loop**: `ndx self-heal 3 .` (analyze → recommend → work, repeated)
- **Submit feedback**: `/ndx-feedback "description"` — files a GitHub issue with context
- **Full command reference**: [Commands](./commands)
- **Workflow guide**: [Workflow](./workflow)
