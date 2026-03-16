# Configuration

n-dx uses a layered configuration system across its packages. The `ndx config` command provides unified access.

## LLM Vendor

```sh
ndx config llm.vendor claude .    # or: codex
```

| Vendor | Rex Behavior | Hench Behavior | Token Accounting |
|--------|-------------|----------------|------------------|
| `claude` | Shared LLM client; API when key configured, CLI fallback | Both `api` and `cli` providers | Full support |
| `codex` | Codex CLI adapter (`codex exec`) | CLI-only (`api` rejected) | Limited (CLI doesn't return usage) |

## Claude Configuration

```sh
# API mode (recommended)
ndx config llm.claude.api_key sk-ant-... .
# or via environment variable:
export ANTHROPIC_API_KEY=sk-ant-...

# Pin a model (default: claude-sonnet-4-6)
ndx config llm.claude.model claude-opus-4-20250514 .

# CLI mode
ndx config llm.claude.cli_path /path/to/claude .
```

## Codex Configuration

```sh
ndx config llm.codex.cli_path /path/to/codex .
ndx config rex.model gpt-5.3-codex .
```

## Hench Configuration

```sh
ndx config hench.provider api .     # api or cli (api requires claude vendor)
ndx config hench.maxTurns 30 .      # max tool-use turns per task
ndx config hench.maxTokens 100000 . # token budget per task
```

Configuration is stored in `.hench/config.json`.

## Web Server

```sh
ndx config web.port 8080 .         # dashboard port (default: 3117)
```

Stored in `.n-dx.json` at the project root.

## Viewing Configuration

```sh
ndx config .              # show all settings
ndx config --json .       # machine-readable output
ndx config --help .       # show all available keys
```

## Configuration Files

| File | Owner | Purpose |
|------|-------|---------|
| `.rex/config.json` | Rex | PRD configuration, model settings |
| `.hench/config.json` | Hench | Agent configuration (provider, max turns, budget) |
| `.sourcevision/manifest.json` | SourceVision | Analysis metadata and version |
| `.n-dx.json` | n-dx | Project-level overrides (web port, etc.) |
