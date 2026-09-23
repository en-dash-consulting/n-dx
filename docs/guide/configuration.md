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
| `claude` | `claude-sonnet-5` | Claude Sonnet 5 | yes |
| `claude` | `claude-opus-5` | Claude Opus 5 | |
| `claude` | `claude-fable-5` | Claude Fable 5 | |
| `claude` | `claude-haiku-4-5` | Claude Haiku 4.5 | |
| `codex` | `gpt-5.6-terra` | GPT-5.6 Terra | yes |
| `codex` | `gpt-5.6-sol` | GPT-5.6 Sol | |
| `codex` | `gpt-5.6-luna` | GPT-5.6 Luna | |
| `codex` | `gpt-5.5` | GPT-5.5 | |
| `google` | `gemini-2.5-pro` | Gemini 2.5 Pro | yes |
| `google` | `gemini-3.7-flash` | Gemini 3.7 Flash | |
| `google` | `gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | |
| `local` | _(discovered at runtime)_ | — | — |

For the `local` vendor there is no static catalog — available models are fetched
live from the running LM Studio / Ollama server at `/v1/models` during `ndx init`.
If the server isn't running, the model prompt is skipped.

Gemini's heavy tier stays on `gemini-2.5-pro` (the newest *stable* Pro model)
rather than `gemini-3.1-pro-preview`, because preview model IDs can be renamed or
withdrawn. You can still select a preview model explicitly with
`ndx config llm.google.model gemini-3.1-pro-preview .`.

The model catalog is curated and local — init works offline without querying vendor APIs. Unknown model IDs are accepted with a warning, so you can use models not yet in the catalog.

### Non-Interactive (Flag-Based) Configuration

Three flags control LLM selection without prompts:

| Flag | Description |
|------|-------------|
| `--provider=<claude\|codex\|google\|local>` | Set the active LLM vendor |
| `--model=<model-id>` | Set the model for the active vendor |
| `--claude-model=<model-id>` | Set the Claude model (independent of active vendor) |
| `--codex-model=<model-id>` | Set the Codex model (independent of active vendor) |

Examples:

```sh
# Fully non-interactive init (CI / scripting)
ndx init --provider=claude --model=claude-sonnet-5 .

# Configure both vendors in a single call
ndx init --provider=claude --claude-model=claude-sonnet-5 --codex-model=gpt-5.6-terra .

# A lone vendor-specific flag implies the provider
ndx init --claude-model=claude-opus-5 .   # implies --provider=claude
```

**Flag rules:**

- `--model` cannot be combined with `--claude-model` or `--codex-model` (ambiguous target vendor).
- `--claude-model` and `--codex-model` can be used together. When both are present without `--provider`, the active vendor falls through to existing config or the interactive prompt.
- A lone `--claude-model` implies `--provider=claude`; a lone `--codex-model` implies `--provider=codex`.

### Config Keys (`.n-dx.json`)

LLM settings are persisted under the `llm` namespace in `.n-dx.json`:

| Key | Type | Description |
|-----|------|-------------|
| `llm.vendor` | `"claude"` \| `"codex"` \| `"google"` \| `"local"` | Active LLM vendor |
| `llm.claude.model` | string | Claude model ID |
| `llm.codex.model` | string | Codex model ID |

Example `.n-dx.json` after init:

```json
{
  "llm": {
    "vendor": "claude",
    "claude": {
      "model": "claude-sonnet-5"
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

# Pin a model (default: claude-sonnet-5)
ndx config llm.claude.model claude-opus-5 .

# CLI mode
ndx config llm.claude.cli_path /path/to/claude .
```

::: warning Where keys are stored
`*.api_key` and `*.cli_path` values are written to `.n-dx.local.json`, which `ndx init` gitignores — never to the shared `.n-dx.json`. Every reader merges the local file over the shared one, so nothing else changes. If a project configured before this routing still has a key in `.n-dx.json`, `ndx config` warns on every run and `ndx ci` fails when that file is git-tracked; re-run `ndx config <key> <value>` to move it (and rotate the key if it was ever committed).
:::

## Codex Configuration

```sh
ndx config llm.codex.cli_path /path/to/codex .
ndx config rex.model gpt-5.6-terra .
```

## TypeSafe Jev for Judgment Calls

Some sourcevision calls are judgments, not text generation, and those go to [TypeSafe's Jev](https://docs.typesafe.ai), which answers typed questions with a probability per option instead of free-text JSON. Setting `TYPESAFE_API_KEY` opts in; without it every prompt and output is exactly as before.

| Task class | Judgment | What changes |
|---|---|---|
| `code.classify` | Choice over the archetype catalog | A file's classification confidence is Jev's probability for that archetype, not a fixed 0.7. A confident `none` leaves the file unclassified; an unsure answer is **escalated** to the text classifier with the file's leading doc comment as extra evidence |
| `finding.judge` | Score for severity, Choice for category, Nouls for support and metric-paraphrase, Choices for anchor file, type and scope | Enrichment prompts stop asking the text model for `severity`, `category`, `type` and `scope`. Findings the evidence contradicts are dropped (support below 0.3 — this replaces the hedge-phrase regex), undecided ones (0.3–0.7) are kept with the support probability recorded as their confidence, paraphrases of pass 0 metrics are dropped, `Finding.anchors` and `Finding.confidence` are filled. The meta pass re-rates existing findings the same way instead of returning `severityUpdates` |
| `zone.judge` | Choice over deterministic name candidates, Nouls over merge-candidate pairs, two fragility Nouls per zone | Zone names are **selected** from the package name, dominant directories and dominant archetype (a `none` or spread Choice escalates to three generated names, verified by a Noul); zones the graph links are merged at ≥ 0.8 and reported as an observation between 0.4–0.6; fragility above 0.7 is a structural finding |

### The cascade

With the key present, `ndx analyze` runs the **cascade** by default: facts are computed, Jev judges them, and the text model is asked only about what a judgment left uncertain. Fragility probabilities at or above 0.7 become templated findings; a zone whose probability falls in 0.4–0.6 is **escalated** — the per-zone generative prompt runs for that zone alone (at most six zones per run, highest probability first), and its findings are then judged like any other. Zone descriptions are templated from facts. `PRIMER.md` is not regenerated in this mode (a cached one is still served).

Generation is one call per kind and off the critical path: the zones that need generated names go to the text model in one prompt, the escalated zones are narrated in one prompt, and `analyze` returns as soon as the judged results are on disk — narration continues in a detached `sv narrate` child (log at `.sourcevision/.cache/narration.log`; `manifest.narration` is `pending` until its insights and findings are merged into `zones.json`, then `done` or `failed` with a reason). Pass `--wait` to narrate before returning (CI), or run `sv narrate .` by hand to retry.

Only one narrator runs at a time. A new `analyze` stops a narrator that is still working and queues whatever it had not finished, along with its own escalations; a narrator that died without finishing is re-queued the same way, so a second `analyze` never drops narration. A failed narration *call* is not retried automatically. `ndx status` prints a line while narration is pending or after it failed, and the dashboard overview shows the same. `ndx plan` passes `--wait`, because `rex analyze` reads the zone names.

A re-run with no changes is cache hits and no text-model calls: judged state carries no zone names, a zone whose generated-name fallback already failed on the same files is not asked again, and an escalated zone narrated on the same files last time keeps its insights.

Two more judgments run over the heuristics on every keyed run, whichever mode: each warning-level pass 0 finding is asked whether it is a real problem or a detection artifact (≤ 0.3 demotes it to `info`, in between records its confidence), and the files with the most cross-zone imports are asked which zone they belong in — a confident answer for another zone becomes a `move-file` finding with `moveReason: "zone-judgment"`.

`--narrate` keeps the multi-pass generative machinery (`--full`, `--target-pass`, the meta pass); it is the whole pipeline for repositories without a key, so it is not reduced to the cascade's per-zone prompt.

```sh
export TYPESAFE_API_KEY=...
ndx analyze .              # cascade: judgments first, narration in the background
ndx analyze --wait .       # cascade, narration before returning
ndx analyze --narrate .    # the full generative pass over every zone, as before the key
ndx analyze --fast .       # no LLM at all

# Send a class back to the vendor tier, or name the route explicitly
ndx config llm.routes.code.classify light .
ndx config llm.routes.finding.judge typesafe .
```

Thresholds — 0.4 classification probability, 0.5 finding confidence, the 0.3/0.7 support bands, 0.7 paraphrase, 0.8 rescope, 0.8 merge, 0.6 generated-name fit, 0.3/0.7 heuristic bands, 0.7 move, and the 0.4–0.6 escalation band with its cap of six — live in code, not config. `enforceSeverityRules` still runs last and pass 0 heuristic findings are never re-graded. A class explicitly routed to `typesafe` without the key prints one notice naming the fallback.

### What a run records

**Partition review.** A zone partition is reused when the analysis inputs are unchanged, and otherwise used to seed the next one. Before either happens it is checked. A partition where at least 40% of zones hold two files or fewer is rejected outright. When the signals are only borderline (20% small zones, or a quarter of ids with a numeric suffix like `routes-7`), Jev is asked one question about the whole map, and a probability of 0.3 or below rejects it. A rejected partition is re-derived from scratch with no stability bias, and only zones with at least 80% file overlap keep their old id and name. The review is stored as `zones.partitionReview` and `manifest.lastAnalysis.partition`, and happens at most once per input fingerprint, so a project whose fresh partition is no better does not re-partition on every run. A sourcevision upgrade therefore reaches a stale partition without `sv reset`. The partitioning algorithm's version is stored as `zones.algorithmVersion`. A partition from another version is re-derived without stability bias, and names chosen earlier carry over to the new zones.

**Route-aware zones.** React Router/Remix (`react-router.config.*`, `app/routes.ts`), Next (`next.config.*`) and SvelteKit (`svelte.config.*`) route roots are detected from the file list and recorded as `projectProfile.routeConventions`. Route directories (`routes`, and containers like `app/routes/apps/`) never name a zone. Each route feature's files are grouped together rather than by the shared components they import, and the route a zone serves is offered as its name.

**Balance.** A subdivision whose largest child keeps 70% or more of its parent is rejected. It is retried at a finer Louvain resolution, then by directory; if neither balances, the zone keeps no sub-zones. A top-level zone above `max(2 × maxZonePercent, 30%)` of files without a balanced subdivision makes the partition borderline. Test files in a nested `__tests__`/`tests` directory form one zone per parent directory (or per suite for a `tests/<suite>/` root). The iso map draws balanced sub-zones as tiles on their parent's top face.

**Areas.** Above the zones, `zones.areas` groups them into 4–10 areas. The grouping starts from structure: route-container children like `app/routes/apps/*` begin together, and in a monorepo each package root is its own area. The rest are merged by import weight, with no area allowed past about 35% of files while another merge is possible. Test zones join the area whose code they mostly import; a suite spread across areas goes to a Tests area. An area whose name would only be a combination of its members is named by Jev, or by the background narrator when no candidate fits. The iso map opens on the areas, with each area's zones as tiles. Double-clicking an area, or **Expand here**, expands it in place: its zones appear on a platform where the area was, and several areas can be open at once. **Open on its own** shows one area by itself, and the URL hash keeps you there across reloads.

**Ids.** A numbered zone id (`routes-7`) with a chosen name takes its id from the name. The old id stays in `previousIds` and still resolves in pins and `get_zone`.

Every `ndx analyze` writes `manifest.lastAnalysis` — mode (`fast` · `generative` · `narrate` · `cascade`), wall-clock per phase, and calls, tokens and time per LLM task class, so you can see which model answered what and how long it took (a class served by two vendors in one run, such as `code.classify` with its escalations, appears once per vendor). The same record is appended to `.sourcevision/.cache/analyses.jsonl` (last 200 runs). Jev answers are cached in `.sourcevision/.cache/judgments.json`, keyed by the question and only the slice of state it references, so a re-run re-asks only what changed; the CLI's token report shows hits and misses. Both cache files are machine-local and safe to delete.

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

## Skills used in this guide

| Skill | Source | Role in this guide |
|-------|--------|--------------------|
| `/ndx-config` | [`.agents/skills/ndx-config/SKILL.md`](./skills#ndx-config) | Interactive view, explanation, and validation of n-dx configuration settings |

For the full skill inventory and customization guidance, see the [Skills Reference](./skills).
