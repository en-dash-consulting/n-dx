# Troubleshooting

Common issues and how to fix them. If your issue isn't listed here, use `/ndx-feedback` in Claude Code to report it — it'll file a GitHub issue with your environment details automatically.

## "Unknown command" when running rex/sourcevision/hench commands

**Problem**: Running `rex plan` or `sourcevision init` fails with "unknown command."

**Cause**: Some commands are orchestrator-level and only available through `ndx`. The package CLIs (`rex`, `sourcevision`, `hench`) only expose their own domain commands.

**Fix**: Use `ndx` for all commands:
```sh
ndx plan .        # not "rex plan"
ndx work .        # not "hench run"
ndx analyze .     # not "sourcevision analyze"
```

Run `ndx --help` to see all available commands.

## Init prompts for provider on re-run

**Problem**: Running `ndx init .` on an already-initialized project still asks which LLM provider to use.

**Cause**: The init flow may not detect your existing configuration if `.n-dx.json` is missing or malformed.

**Fix**: Pass the provider explicitly to skip the prompt:
```sh
ndx init --provider=claude .
```

Or check that `.n-dx.json` exists with a valid `llm.vendor` field.

## API key / CLI authentication failures

**Problem**: Commands fail with authentication errors even though you've configured a provider.

**Cause**: The API key or CLI path isn't set, or the environment variable isn't exported.

**Fix**:
```sh
# For Claude API mode
ndx config llm.claude.api_key sk-ant-... .
# or
export ANTHROPIC_API_KEY=sk-ant-...

# For Claude CLI mode
ndx config llm.claude.cli_path claude .
claude login

# For Codex
ndx config llm.codex.cli_path codex .
codex login
```

Check current config with `ndx config .`

## Claude init / vendor preflight error codes

When `ndx init --provider=claude .` or `ndx config llm.vendor claude .` fails before setup completes, use the emitted code to pick the right fix:

- `NDX_CLAUDE_PREFLIGHT_NOT_INSTALLED`: Claude Code is not installed or the configured executable does not exist. Install it with `npm install -g @anthropic-ai/claude-code`, then verify with `claude --version`.
- `NDX_CLAUDE_PREFLIGHT_NOT_ON_PATH`: `ndx` was given a command name it cannot resolve from the current shell. Check `command -v <your-configured-command>`, fix `PATH`, or set `llm.claude.cli_path` to an absolute executable path.
- `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`: Claude is installed but not authenticated. Run `claude login` and retry.
- `NDX_CLAUDE_PREFLIGHT_INVOKE_FAILED`: Claude appears present, but `ndx` could not launch a usable executable. Verify the exact binary `ndx` resolves with `command -v claude` or `ndx config llm.claude.cli_path`, then run that executable directly with `--version` before retrying.

## Dashboard shows blank PRD tree

**Problem**: The Tasks view in the web dashboard shows nothing.

**Cause**: If all tasks are completed and the status filter defaults to hiding completed items, the tree appears empty.

**Fix**: This has been fixed in recent versions — the default now shows all items. If you're on an older version, click the status filter chips to enable "Completed" visibility, or upgrade:
```sh
npm i -g @n-dx/core@latest
```

## Port conflict with `ndx start`

**Problem**: `ndx start` fails because port 3117 is already in use.

**Cause**: Another instance of the server (or another application) is using the default port.

**Fix**:
```sh
# Use a different port
ndx start --port=3118 .

# Or stop the existing server
ndx start stop .
```

## MCP tools not updating after rebuild

**Problem**: After rebuilding packages, MCP tools in Claude Code still show old schemas or behavior.

**Cause**: The HTTP MCP server caches tool schemas at startup. Rebuilding packages doesn't automatically reload them.

**Fix**: Restart the server:
```sh
ndx start stop .
ndx start .
```

If using stdio MCP transport, remove and re-add the servers:
```sh
claude mcp remove rex
claude mcp remove sourcevision
ndx init .   # re-registers MCP servers
```

## Analysis takes a long time

**Problem**: `ndx analyze` runs for several minutes on large codebases.

**Cause**: The analysis pipeline runs multiple passes including LLM-powered enrichment.

**Fix**: Use lite mode for faster results (skips LLM enrichment):
```sh
ndx analyze --lite .
```

For the full multi-pass analysis, `--deep` is the default. The first run is slowest; subsequent runs are faster because unchanged files are cached.
