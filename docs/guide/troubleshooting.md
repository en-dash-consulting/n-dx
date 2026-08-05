# Troubleshooting

Common issues and how to fix them. If your issue isn't listed here, use the `/ndx-feedback` skill in your assistant (Claude Code or Codex) to report it — it'll file a GitHub issue with your environment details automatically.

## `ERR_MODULE_NOT_FOUND` on every `ndx` command

**Problem**: Any `ndx` command crashes immediately with a stack trace like:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../node_modules/assistant-assets/index.js' imported from
'.../node_modules/@n-dx/core/claude-integration.js'
```

**Cause**: You are on `@n-dx/core` 0.3.x, which shipped with an import path that
escaped the published tarball. The referenced file was never included, so Node
fails while linking the module graph — before any `ndx` code runs. Fixed in
0.4.0.

Reinstalling alone often does **not** help. pnpm records a caret range in its
global manifest, and for 0.x versions `^0.3.1` means `>=0.3.1 <0.4.0` — so
`pnpm add -g @n-dx/core` and `pnpm update -g` both re-resolve inside the broken
0.3 line and can never reach the fix.

**Fix**: reinstall with an explicit `@latest` tag, which pins past the recorded
range:

```sh
# pnpm — remove first so the stale caret range is dropped from the manifest
pnpm remove -g @n-dx/core
pnpm add -g @n-dx/core@latest

# npm
npm i -g @n-dx/core@latest
```

Then confirm the version actually changed:

```sh
ndx --version    # expect 0.4.0 or newer
```

Two things to watch for:

- **Run these from outside an n-dx checkout.** The repo's `.npmrc` sets
  `minimum-release-age`, and pnpm reads a local `.npmrc` even for `-g`
  operations — from inside the repo it will refuse recent releases.
- **Don't switch package managers to upgrade.** Installing with npm when your
  existing global install came from pnpm leaves *two* `ndx` shims on `PATH`.
  Whichever resolves first wins, so `ndx --version` can keep reporting the old
  version even though the upgrade succeeded. Upgrade with the same manager you
  installed with, or remove the other install first.

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

**Problem**: After rebuilding packages, MCP tools in Claude Code or Codex still show old schemas or behavior.

**Cause**: The HTTP MCP server caches tool schemas at startup. Rebuilding packages doesn't automatically reload them.

**Fix**: Restart the server:
```sh
ndx start stop .
ndx start .
```

If using stdio MCP transport, re-run init to regenerate configs:
```sh
ndx init .   # re-registers Claude MCP servers and regenerates the Codex config (.codex/config.toml)
```

For Claude Code specifically, you can also remove and re-add servers manually:
```sh
claude mcp remove rex
claude mcp remove sourcevision
ndx init .
```

## Analysis takes a long time

**Problem**: `ndx analyze` runs for several minutes on large codebases.

**Cause**: The analysis pipeline runs multiple passes including LLM-powered enrichment.

**Fix**: Use lite mode for faster results (skips LLM enrichment):
```sh
ndx analyze --lite .
```

For the full multi-pass analysis, `--deep` is the default. The first run is slowest; subsequent runs are faster because unchanged files are cached.

---

See the [Skills Reference](./skills) for the workflow slash commands available in your assistant session, including `/ndx-feedback` for filing issues.
