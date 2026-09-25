---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Keep a worktree run's MCP PRD writes in its own worktree.

A run in a linked worktree could have its `update_task_status` write the task
file in a different checkout. `claude mcp add --scope local` — the pre-0.7
`ndx init` path — records the project directory absolutely, and Claude Code
applies a repository's local-scope entry to sessions started in that
repository's *other* worktrees, shadowing the tracked `.mcp.json` that resolves
`.` per worktree. The per-workspace PRD lock cannot help: the write never
reaches the right workspace to contend for its lock.

Three changes close it:

- A Claude run now writes its own MCP config to `.hench/mcp/<runId>.json`
  and spawns with `--mcp-config <file> --strict-mcp-config`, so the session's
  rex and sourcevision servers name the run's project directory absolutely and
  nothing inherited can shadow them. Both servers are spawned through the core
  CLI that launched the run, which keeps the agent's rex the same build as
  hench's own. That CLI is taken from `NDX_CLI_PATH` only after confirming it
  resolves back to the running hench; otherwise the run keeps today's behaviour
  and says why. The Codex adapter is unchanged.
- `ndx init` no longer registers an absolute project directory under
  `--mcp-scope=local`; it records `.`, as the tracked `.mcp.json` already did.
  It removes the pinned entries it can reach and reports the ones it cannot,
  with the `claude mcp remove --scope local` command.
- The `ndx work` pre-flight warns when a local-scope registration pins another
  checkout of this repository. It is silent for Claude runs, which already
  override it, and applies to Codex runs and interactive sessions.

Note that `--strict-mcp-config` drops the operator's user-scope and other MCP
servers from autonomous Claude runs — the spawned session sees only rex and
sourcevision.

Known gap: the agent's shell `rex` / `ndx` / `n-dx` commands still resolve from
`PATH`, which can reach a different install than the one running hench. Pinning
those behind per-run shims is not part of this change.
