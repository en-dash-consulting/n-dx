# Configuration

n-dx uses a layered configuration system across its packages. The `ndx config` command provides unified access.

## LLM Setup During Init

`ndx init` includes a guided LLM configuration flow. In an interactive terminal it presents keyboard-driven selectors (arrow keys to navigate, Enter to confirm) for both provider and model. The flow follows a strict precedence order:

1. **Explicit CLI flags** — skip all prompts
2. **Existing project config** (`.n-dx.json`) — reuse previous selections
3. **Interactive prompt** (TTY only) — ask the user
4. **Runtime default fallback** — handled by downstream packages

On re-init, if the vendor and model are already configured the LLM prompts are skipped entirely.

### Available Models

| Vendor | Model ID | Label | Default |
|--------|----------|-------|---------|
| `claude` | `claude-sonnet-4-6` | Claude Sonnet 4.6 | yes |
| `claude` | `claude-opus-4-20250514` | Claude Opus 4 | |
| `claude` | `claude-haiku-4-20250414` | Claude Haiku 4 | |
| `codex` | `gpt-5-codex` | GPT-5 Codex | yes |

The model catalog is curated and local — init works offline without querying vendor APIs. Unknown model IDs are accepted with a warning, so you can use models not yet in the catalog.

### Non-Interactive (Flag-Based) Configuration

Three flags control LLM selection without prompts:

| Flag | Description |
|------|-------------|
| `--provider=<claude\|codex>` | Set the active LLM vendor |
| `--model=<model-id>` | Set the model for the active vendor |
| `--claude-model=<model-id>` | Set the Claude model (independent of active vendor) |
| `--codex-model=<model-id>` | Set the Codex model (independent of active vendor) |

Examples:

```sh
# Fully non-interactive init (CI / scripting)
ndx init --provider=claude --model=claude-sonnet-4-6 .

# Configure both vendors in a single call
ndx init --provider=claude --claude-model=claude-sonnet-4-6 --codex-model=gpt-5-codex .

# A lone vendor-specific flag implies the provider
ndx init --claude-model=claude-opus-4-20250514 .   # implies --provider=claude
```

**Flag rules:**

- `--model` cannot be combined with `--claude-model` or `--codex-model` (ambiguous target vendor).
- `--claude-model` and `--codex-model` can be used together. When both are present without `--provider`, the active vendor falls through to existing config or the interactive prompt.
- A lone `--claude-model` implies `--provider=claude`; a lone `--codex-model` implies `--provider=codex`.

### Config Keys (`.n-dx.json`)

LLM settings are persisted under the `llm` namespace in `.n-dx.json`:

| Key | Type | Description |
|-----|------|-------------|
| `llm.vendor` | `"claude"` \| `"codex"` | Active LLM vendor |
| `llm.claude.model` | string | Claude model ID |
| `llm.codex.model` | string | Codex model ID |

Example `.n-dx.json` after init:

```json
{
  "llm": {
    "vendor": "claude",
    "claude": {
      "model": "claude-sonnet-4-6"
    }
  }
}
```

::: tip .codex/config.toml remains MCP-only
Model configuration lives in `.n-dx.json`, not in `.codex/config.toml`. The Codex config file is used exclusively for MCP server definitions (stdio transport). `ndx init` does not write model or vendor settings to `.codex/config.toml`.
:::

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
| `.n-dx.json` | n-dx | Project-level overrides (LLM vendor/model, web port, etc.) |

### Assistant Artifacts

These files are generated by `ndx init` and managed by n-dx. They are safe to commit to version control.

| File | Assistant | Purpose |
|------|-----------|---------|
| `CLAUDE.md` | Claude | Project instructions (auto-generated, re-run `ndx init` to update) |
| `.claude/skills/*/SKILL.md` | Claude | Workflow skills in YAML frontmatter format |
| `.claude/settings.local.json` | Claude | Auto-approved read-only MCP tool permissions (merged, not overwritten) |
| `AGENTS.md` | Codex | Project instructions with embedded skill and MCP docs |
| `.agents/skills/*/SKILL.md` | Codex | Workflow skills in plain markdown format |
| `.codex/config.toml` | Codex | MCP server definitions (stdio transport) |

See [Getting Started — Assistant Surfaces](./getting-started#assistant-surfaces) for details on what each artifact contains.
