# CLI Hint Audit Checklist

Audit of hint/suggestion text across all n-dx CLI packages.
Date: 2026-04-13
Auditor: hench agent

## Summary

All hint text verified against the current CLI surface. One breakage found and fixed:
`hench config guard.memoryThrottle.rejectThreshold` and `hench config guard.memoryThrottle.enabled`
were referenced in error hints but rejected by `hench config` (unknown key). Fixed by adding
`guard.memoryThrottle.{enabled,rejectThreshold,delayThreshold}` to `CONFIG_FIELDS` in
`packages/hench/src/cli/commands/config.ts`.

---

## ndx (packages/core)

### Error hint patterns (`cli.js` ERROR_HINTS)

| Pattern | Hint text | Valid? |
|---------|-----------|--------|
| `ENOENT.*\.(rex\|hench\|sourcevision)` | `Run 'ndx init' to set up the project.` | ✅ `ndx init` is valid |
| `ENOENT.*prd\.json` | `Run 'ndx init' to create the initial PRD.` | ✅ |
| `ENOENT.*config\.json` | `Run 'ndx init' to create default configuration.` | ✅ |
| `EACCES` | `Check file permissions for the project directory.` | ✅ |
| `Unexpected token` | `...re-initialize with 'ndx init'` | ✅ |
| `EADDRINUSE` | `Try a different port with --port=N.` | ✅ `--port=N` is a valid `ndx start` flag |

### Unknown command handler (`cli.js`)

- Uses Levenshtein-based `formatTypoSuggestion()` against `getOrchestratorCommands()` + "help"
- Fallback: `Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.`
- ✅ Both `ndx --help` and `ndx help <keyword>` are valid

### Timeout hint (`cli-timeout.js` line 91)

- `Increase the limit with: ndx config cli.timeouts.<command> <ms>`
- ✅ `cli.timeouts.<command>` is a documented config key (config.js line 799)

### Work command vendor hint (`cli.js` line 1112)

- `Run 'ndx config llm.vendor claude' or 'ndx config llm.vendor codex'`
- ✅ `llm.vendor` accepts "claude" and "codex" (config.js line 752)

### Config help text (`config.js`)

| Hint | Valid? |
|------|--------|
| `n-dx config llm.claude.cli_path /absolute/path/to/claude` | ✅ |
| `n-dx config claude.cli_path /usr/local/bin/claude` | ✅ (legacy key, still supported) |
| `n-dx config claude.api_key sk-ant-...` | ✅ |
| `n-dx config llm.vendor claude` / `llm.vendor codex` | ✅ |
| `n-dx config llm.claude.api_key sk-ant-...` | ✅ |
| `n-dx config llm.codex.cli_path /usr/local/bin/codex` | ✅ |
| `n-dx config hench.guard.allowedCommands` | ✅ |

---

## rex (packages/rex)

### Error hint patterns (`src/cli/errors.ts`)

| Pattern | Hint text | Valid? |
|---------|-----------|--------|
| `ENOENT.*\.rex` | `Run 'n-dx init' to set up the project.` | ✅ |
| `ENOENT.*prd\.json` | `Run 'n-dx init' to create the initial PRD.` | ✅ |
| `ENOENT.*config\.json` | `Run 'n-dx init' to create default configuration.` | ✅ |
| `Invalid prd\.json` | `...re-initialize with 'n-dx init'.` | ✅ |
| `EACCES` | `Check file permissions for the .rex/ directory.` | ✅ |
| `not found` | `Check the ID or path and try again.` | ✅ |

### `requireRexDir` suggestion

- `Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.`
- ✅ Both `n-dx init` / `ndx init` and `rex init` are valid commands

### `BudgetExceededError` suggestion

- `Adjust budget with: n-dx config rex.budget.tokens <value> or rex.budget.cost <value>`
- ✅ `rex.budget.tokens` and `rex.budget.cost` are valid config keys

### Health warning (`src/cli/commands/health-warning.ts`)

- `Run 'ndx reshape' or 'ndx reorganize' to fix.`
- ✅ Both `ndx reshape` and `ndx reorganize` are valid commands (cli.js lines 1691–1692)

### Unknown command handler (`src/cli/index.ts`)

- Uses `formatTypoSuggestion(command, REX_COMMANDS, "rex ")`
- Candidates: `["init", "status", "next", "add", "update", "remove", "move", "reshape",`
  `"prune", "usage", "validate", "fix", "report", "verify", "recommend", "analyze",`
  `"import", "reorganize", "health", "sync", "adapter", "mcp"]`
- ✅ All candidates are implemented commands

---

## hench (packages/hench)

### Error hint patterns (`src/cli/errors.ts`)

| Pattern | Hint text | Valid? |
|---------|-----------|--------|
| `System memory.*exceeds rejection threshold` | `hench config guard.memoryThrottle.rejectThreshold <number>` | ✅ **Fixed** (field added to CONFIG_FIELDS) |
| `System memory.*exceeds rejection threshold` | `hench config guard.memoryThrottle.enabled false` | ✅ **Fixed** (field added to CONFIG_FIELDS) |
| `Concurrent process limit reached` | `hench config guard.maxConcurrentProcesses <number>` | ✅ Already in CONFIG_FIELDS |
| `ENOENT.*\.hench` | `Run 'n-dx init' to set up the project.` | ✅ |
| `ENOENT.*\.rex` | `Run 'n-dx init' to set up the project.` | ✅ |
| `claude.*not found` | `npm install -g @anthropic-ai/claude-code` + `n-dx config hench.provider api` | ✅ `hench.provider` is a valid key |
| `ANTHROPIC_API_KEY` | `n-dx config claude.api_key <key>` + `n-dx config hench.provider cli` | ✅ Both keys valid |

### `requireLLMCLI` suggestion (`src/cli/errors.ts`)

- Claude: `n-dx config claude.cli_path /path/to/claude` + `n-dx config hench.provider api`
- Codex: `n-dx config llm.codex.cli_path /path/to/codex`
- ✅ All config keys are valid

### `requireHenchDir` suggestion

- `Run 'n-dx init' to set up the project, or 'hench init' if using hench standalone.`
- ✅ Both commands valid

### `MemoryThrottleRejectError` message (`src/process/memory-throttle.ts` line 71)

- `hench config guard.memoryThrottle.rejectThreshold <number>`
- ✅ **Fixed** (field added to CONFIG_FIELDS)

### Unknown command handler (`src/cli/index.ts`)

- Detects ndx-only commands and redirects
- Uses `formatTypoSuggestion(command, HENCH_COMMANDS, "hench ")`
- Candidates: `["init", "run", "status", "show", "config", "template"]`
- ✅ All candidates are implemented commands

---

## sourcevision (packages/sourcevision)

### Error hint patterns (`src/cli/errors.ts`)

| Pattern | Hint text | Valid? |
|---------|-----------|--------|
| `ENOENT.*\.sourcevision` | `Run 'n-dx init' or 'sourcevision init' to set up analysis.` | ✅ |
| `ENOENT.*manifest\.json` | `Run 'sourcevision analyze' to generate analysis output.` | ✅ |
| `EACCES` | `Check file permissions for the .sourcevision/ directory.` | ✅ |
| `Unexpected token` | `...run 'sourcevision reset' to start fresh.` | ✅ `sourcevision reset` is valid |
| `ENOENT` | `Check the path and try again.` | ✅ |

### `requireSvDir` suggestion

- `Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.`
- ✅ Both commands valid

### Unknown command handler (`src/cli/index.ts`)

- Uses `formatTypoSuggestion(command, SV_COMMANDS, "sourcevision ")`
- Candidates: `["init", "analyze", "serve", "validate", "reset", "export-pdf",`
  `"pr-markdown", "git-credential-helper", "mcp", "workspace"]`
- ✅ All candidates are implemented commands

---

## web dashboard FAQ (`packages/web/src/viewer/components/faq.ts`)

| Hint text | Valid? |
|-----------|--------|
| `ndx init .` | ✅ |
| `ndx plan` / `ndx plan --accept` | ✅ |
| `ndx work .` / `ndx work --task=ID` | ✅ |
| `sourcevision analyze` (multiple passes) | ✅ |
| `ndx sync .` with `--push` / `--pull` | ✅ |
| `ndx status .` | ✅ |
| `ndx work --dry-run` | ✅ (handled in `handleWork`, line 1107) |
| `ndx web --background .` | ✅ (`ndx web` is valid alias for `ndx start`) |
| `ndx web stop` | ✅ |
| `ndx web status` | ✅ |

---

## Fix Applied

**File:** `packages/hench/src/cli/commands/config.ts`

Added three fields to `CONFIG_FIELDS`:
- `guard.memoryThrottle.enabled` (boolean) — enable/disable memory throttling
- `guard.memoryThrottle.rejectThreshold` (number, 0–100) — rejection threshold %
- `guard.memoryThrottle.delayThreshold` (number, 0–100) — delay threshold %

These fields were referenced by error hints in `errors.ts` and `memory-throttle.ts` but
rejected by `hench config <key> <value>` because the SET path requires keys to be in
`CONFIG_FIELDS`. The underlying schema already supported these fields; the config command
just lacked entries for them.

## Typo Correction Coverage

All packages implement Levenshtein-based typo correction via `formatTypoSuggestion()` from
`@n-dx/llm-client/suggest`. The suggestion threshold is edit distance ≤ 2. All command
candidate lists reflect the current implemented command surface.
