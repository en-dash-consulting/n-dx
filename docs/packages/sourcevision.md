<img src="/sourcevision.png" alt="SourceVision" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# SourceVision

Static analysis engine that inventories files, maps imports, detects architectural zones, and catalogs React components.

## What It Does

SourceVision runs a 4-phase analysis pipeline:

1. **Inventory** — Scan all files, classify by type and role
2. **Imports** — Build the dependency graph
3. **Zones** — Detect architectural communities via Louvain algorithm, then enrich with AI
4. **Components** — Catalog React components with props and usage patterns

## CLI

```sh
sourcevision analyze .                    # full analysis
sourcevision analyze --fast .             # skip AI enrichment
sourcevision analyze --phase zones .      # run specific phase
sourcevision serve .                      # interactive browser viewer
sourcevision validate .                   # validate analysis output
sourcevision readiness .                  # SDLC readiness scorecard
sourcevision readiness --json .           # machine-readable score, evidence and gaps
sourcevision export-pdf .                 # export analysis as PDF report
sourcevision pr-markdown .                # regenerate PR markdown summary
sourcevision git-credential-helper .      # interactive GitHub credential setup
sourcevision reset .                      # clear analysis data
sourcevision workspace .                  # aggregate multiple repos into unified view
sourcevision mcp .                        # start MCP server (stdio)
```

The `sv` command is an alias for `sourcevision`.

## Output Files

All output is written to `.sourcevision/`:

| File | Contents |
|------|----------|
| `manifest.json` | Analysis metadata, version, timestamps |
| `inventory.json` | File listing with classifications |
| `imports.json` | Dependency graph (edges + metadata) |
| `zones.json` | Architectural zone map with cohesion/coupling metrics |
| `components.json` | React component catalog |
| `sdlc-profile.json` | SDLC practices detected, each claim tied to the file proving it |
| `readiness.json` | Readiness score computed from that profile |
| `llms.txt` | AI-readable codebase summary |
| `CONTEXT.md` | Detailed AI context document |
| `zones/{zone-id}/` | Per-zone context and summary files |

## Findings

SourceVision produces findings in several categories:

| Type | Description | Actionable? |
|------|-------------|-------------|
| `anti-pattern` | Architectural violations (circular deps, high coupling) | Yes |
| `suggestion` | Improvement recommendations | Yes |
| `move-file` | File placement recommendations | Yes |
| `observation` | Metric descriptions ("Cohesion is 0.36") | No |
| `pattern` | Detected code patterns | No |
| `relationship` | Dependency descriptions | No |

The `--actionable-only` flag on `ndx recommend` filters to only the first three types.

## SDLC Readiness

`ndx analyze` answers "how is this code structured". `sourcevision readiness`
answers a different question: **how ready is this repository to be worked by an
autonomous agent?** That is effectively a CI/CD maturity reading — tests, CI, CD,
rollback, migrations, feature flags, quality gates, observability, and whether the
checkout's own agent configuration is safe to run.

```sh
sourcevision readiness .          # scorecard
sourcevision readiness --json .   # score, per-dimension evidence and gaps
ndx readiness .                   # same command through the orchestrator
```

Both artifacts are written by `analyze`; the command requires a prior analysis.

::: warning The scorecard is heuristic
It detects whether a practice **exists and is wired up** — not whether it is any
good. It will tell you that tests exist, that they run in CI, and where the holes
are. It will not tell you whether they assert anything useful. Reading
infrastructure files is configuration review, not a pentest or a CVE scan. Treat
a high score as "nothing obvious is missing", never as "this is well engineered".
:::

### Two artifacts, kept separate

Detection and judgement are deliberately not mixed, so that changing a weight
cannot alter what was *observed*, and improving a detector cannot quietly move a
score without the evidence to go with it.

| Artifact | What it is |
|---|---|
| `sdlc-profile.json` | Deterministic record of what was detected. No LLM, no network, no clock. Every claim carries the file that proves it and a confidence of `certain`, `likely` or `inferred`. |
| `readiness.json` | The weighted score computed from that profile, with per-dimension evidence and gaps. |

`sourcevision readiness` **recomputes** from the profile rather than printing
`readiness.json`, so a change to the weights shows up without a re-analysis. The
persisted file exists for readers that only want the headline — the dashboard's
status poll, and the hub card.

A detection that is absent means the analyzer looked and found nothing. A file it
recognised but could not read is reported in `parseFailures` with its path — never
silently as absence. The scorecard keeps that distinction: when every CI file is
unparseable, CI and CD still score zero, but their gap names the file and the
reason and tells you to fix it rather than to add a pipeline, and
`sourcevision readiness` lists every parse failure under "Could not parse".

### Dimensions and weights

| Dimension | What raises it |
|---|---|
| Testing | A test command, a known framework, and test suites on disk |
| CI | A parsed pipeline, jobs that run the tests, triggers on push/PR |
| CD | A deploy job in a pipeline, triggered automatically, to more than one named environment |
| Rollback | A rollback job, blue-green or canary deployment, or a down-migration path |
| Migrations | A migrations directory for a recognised tool |
| Feature flags | A feature-flag SDK dependency |
| Quality gates | `CODEOWNERS`, pre-commit hooks, merge-blocking checks |
| Observability | Logging, metrics, tracing or error-reporting dependencies |
| Agent safety | A reviewed execution config — subtractive, penalised per repo-trust finding |

Weights live in one exported constant (`READINESS_WEIGHTS` in
`analyzers/readiness-score.ts`) and are not restated anywhere, this table
included. `sourcevision readiness` prints each dimension's weight beside its
score, so the command is the place to read the current values.

Every gap names the evidence that would raise the score, so the output reads as a
next step rather than a complaint.

### Detectors

Every detector is a file-existence or file-parse check over the analyzer's own
bounded walk — separate from the inventory, whose `codeOnly` filter drops the
YAML, TOML and Dockerfiles this needs.

| Section | Detected from | Confidence |
|---|---|---|
| Commands (test/lint/typecheck/build/deploy/migrate) | `package.json` scripts, `Makefile` targets, `pyproject.toml`, `go.mod` | `certain` |
| Test frameworks | Dependencies: vitest, jest, mocha, jasmine, playwright, cypress, ava, pytest, unittest | `certain` |
| Test suites | Test file paths, bucketed into unit / integration / e2e / contract / performance / smoke | `likely` |
| CI pipelines | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile` | `certain` |
| CD deployments | Jobs within a parsed pipeline containing a step classified as a deploy | `likely` |
| Rollback | Not yet detected — always empty, and scores 0 with a gap saying what would move it | — |
| Migrations | `prisma/migrations/`, `alembic/`, `db/migrate/`, or a bare `migrations/` directory | `likely` (`inferred` when the tool is unknown) |
| Feature flags | Dependencies: LaunchDarkly, Unleash, Split, Flagsmith | `certain` |
| Quality gates | `CODEOWNERS`, `.pre-commit-config.yaml` | `certain` |
| Observability | Dependencies: OpenTelemetry, Sentry, Prometheus, Pino, Winston, Bunyan, Datadog | `certain` |
| Containers | `Dockerfile*`, with orchestration from `docker-compose*.yml`, `Chart.yaml` or `k8s/` | `certain` |
| IaC | Terraform and CloudFormation resources, reusing the iso-map's existing parser | `certain` |
| Agent safety | `.hench/config.json`, `.mcp.json` and the project config, judged by `@n-dx/llm-client`'s repo-trust | — |

Known limits, stated rather than papered over:

- **Rollback always scores zero today.** The section is wired up and empty; no
  rollback detector has been written yet. That is the honest reading of an empty
  section, not a bug in the scorer.
- **Branch protection is invisible.** It lives behind the host's API, and this
  analysis makes no network calls — so a repository with strict required reviews
  scores no higher on quality gates than one without.
- **A repository with no database legitimately scores zero on migrations.** The
  gap text says so; a zero is not automatically a deficiency.
- **Agent safety scores zero when no execution config exists.** Defaults being in
  force is safe, but it is not evidence that anyone reviewed the checkout.

## Viewer

```sh
sourcevision serve .    # opens browser viewer
ndx start .             # includes viewer in dashboard
```

The viewer provides 8 views: Overview, Imports, Zones, Files, Routes, Architecture, Problems, and Suggestions.

## Zone Detection

Zones are detected using Louvain community detection on the import graph, then refined through multiple post-processing passes (small zone absorption, satellite merging, large zone splitting). AI enrichment optionally names zones, writes descriptions, and generates per-zone context files.

For a thorough explanation of the Louvain algorithm, findings system, risk assessment, and all configuration options, see [SourceVision Analysis Deep Dive](./sourcevision-analysis).

See [Zone Naming Conventions](/architecture/zone-naming-conventions) for naming standards.

## MCP Tools

Available via `sourcevision mcp .` (stdio) or `ndx start .` (HTTP). Claude Code prefixes these as `mcp__sourcevision__{tool}`; Codex uses bare names.

| Tool | Description |
|------|-------------|
| `get_overview` | Project summary statistics |
| `get_next_steps` | Prioritized improvement recommendations |
| `get_zone` | Architectural zone details |
| `get_findings` | Analysis findings (anti-patterns, suggestions, observations) |
| `get_file_info` | File inventory entry, zone, and imports |
| `search_files` | Search inventory by path, role, or language |
| `get_imports` | Import graph edges |
| `get_classifications` | File archetype classifications |
| `set_file_archetype` | Override archetype classification for a file |
| `get_route_tree` | Route structure (pages, API routes, layouts) |
| `get_readiness` | SDLC readiness scorecard — the same artifact `sourcevision readiness` prints (heuristic) |
