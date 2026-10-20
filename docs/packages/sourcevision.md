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
sourcevision pack add java                # install a language pack (java, go, sql, terraform)
sourcevision pack add                     # install every pack the project lists (sourcevision.packs)
sourcevision pack list                    # each pack: installed, resolved, missing or refused; listed packs marked
sourcevision pack remove java             # remove a pack from the pack directory
sourcevision pack bundle java             # archive the pack and its dependencies for offline use
sourcevision pack add java --from <file> --sha256 <hex>  # verify and install a bundle with no network
```

The `sv` command is an alias for `sourcevision`.

Language packs other than the default Go pack are opt-in. `sv pack add <lang>`
runs this command (`--dry-run` prints it):

```sh
npm install --ignore-scripts --no-audit --no-fund --prefix <ndx home>/packs/<sourcevision version> @n-dx/lang-<lang>@<sourcevision version>
```

It then loads the pack and fails if it is of another version or will not load. Analysis looks
in that directory before module resolution. A missing or mismatched pack never
fails analysis; its notice names `ndx sv pack add <lang>`.

For a machine with no registry access, run `sv pack bundle <lang> [--out <file>]`
on a connected machine with the same sourcevision version. It installs the pack
into a temporary prefix and writes one `.tgz` (default
`n-dx-lang-<lang>-<version>.tgz`) holding the pack, its dependencies and a
manifest; grammars are WebAssembly, so a bundle serves every platform. It prints
the bundle's SHA-256 and writes it to `<file>.sha256`. On the offline machine,
`sv pack add <lang> --from <file> --sha256 <hex>` refuses the bundle unless its
SHA-256 is `<hex>`, before reading it; then it refuses a bundle of another pack
or version, replaces the installed copies of the pack and its dependencies and
loads the pack, with no npm call.

**A bundle is trusted like any npm tarball.** Its JavaScript runs as soon as
`add --from` loads the pack, and its manifest is written by whoever made it, so
reading the manifest is not verification: the hash is. Send the hash that
`bundle` printed by a channel separate from the bundle, and pass it as
`--sha256`. Without `--sha256`, `add --from` checks `<file>.sha256` when it
sits beside the bundle and says so; that catches a damaged copy, not a tampered
one, which can carry a matching `.sha256`. With neither, it prints the bundle's
hash and says the bundle was not verified.

A project can list the packs it wants in its config file (`.n-dx.json`, or
`.ndx/config.json`), by editing it; `ndx config` does not set the key:

```json
{ "sourcevision": { "packs": ["java", "go"] } }
```

`sv analyze` then reports, once per pack, a listed pack that is missing or
refused (naming `ndx sv pack add <lang>`), even before the project has files of
that language, and once for any id that is not a known pack. The list changes
nothing else: what is analysed, and its output, are the same as with no list.
`sv pack add` with no language installs each listed pack that is not already
found (and says so when the list is empty or absent), and `sv pack list` marks
the listed packs.

### Pack installation internals

`sv pack` (`src/cli/commands/pack.ts`, reached as `ndx sv pack …`) manages
the pack directory for every pack in `INSTALLABLE_PACKS` (java, go, terraform,
python, sql; only `KNOWN_PACKS`, all but sql, are analyzed with today). npm
never runs lifecycle scripts: no pack needs one (grammars are prebuilt WASM),
and a script anywhere in the dependency tree would otherwise run with the
user's privileges.

- `add <lang>` runs `npm install --ignore-scripts --no-audit --no-fund --prefix <pack dir> @n-dx/lang-<lang>@<sourcevision version>`,
  creating the directory, then loads the pack from it with `loadPack`; a
  mismatch, a load failure or a pack npm did not put there is an error carrying
  npm's output. `--dry-run` prints the command.
- `list [--json]` reports each pack as installed (pack directory), resolved
  (module resolution), missing or refused, with its version.
- `remove <lang>` runs `npm uninstall --ignore-scripts --prefix`; a pack found
  only by module resolution is left alone.

Offline, for a machine with no registry access:

- `bundle <lang> [--out <file>]` (connected machine) runs the same npm install
  into a fresh temporary prefix, loads the pack from it, writes
  `n-dx-pack-bundle.json` (pack, package, version, sourcevision version,
  `platform: "any"`: grammars are WASM) and archives the whole prefix as one
  `.tgz`, default `n-dx-lang-<lang>-<version>.tgz`, then writes its SHA-256 to
  `<bundle>.sha256` (`sha256sum` format) and prints it. The prefix is removed.
- `add <lang> --from <bundle> [--sha256 <hex>]` makes no npm call. It hashes
  the file first and refuses a mismatch with `--sha256` (or, without it, with a
  `<bundle>.sha256` beside the bundle) before parsing, extracting or importing
  anything; with no hash to check it prints the bundle's and says it was not
  verified. It then reads the manifest and refuses a bundle of another pack or
  version, or an archive that will not read, including one that inflates past
  512 MiB (`MAX_BUNDLE_BYTES`), refused before any entry is parsed (a manifest
  that is not a JSON object is "not a pack bundle"). It extracts into `.sv-pack-stage-*` beside
  the pack directory and loads the pack from there; only then does it rename
  the pack's dependency closure (`dependencyClosure`: the pack and what its
  `package.json` files name in `dependencies`, `optionalDependencies` and
  `peerDependencies`, resolved as Node resolves them, never another pack) over
  the installed copies, record the pack in the pack directory's
  `package.json` and load it as `add` does. Anything else the bundle carries
  is discarded with the stage. Any failure leaves the previous install
  untouched.

Run one `sv pack` writer at a time per pack directory. npm takes no lock on a
`--prefix`, and the pack directory is shared by every terminal, worktree and
CI job on one ndx home, so `add`, `add --from` and `remove` hold
`<pack dir>.lock` (PID, command and start time, published whole) for their
whole run; `--dry-run`, `list` and `bundle` take no lock. A second writer
fails at once naming the holder's PID and the lock file. A lock whose PID is
dead is taken over; one that cannot be read must be deleted by hand.
`add --from` counts a package as moved only after its rename succeeds, so a
failed move never deletes a copy another writer put in place.

The archive is written and read in Node (`src/cli/commands/pack-archive.ts`),
not by a `tar` process: regular files and directories only, with pax long
paths. `bundle` never follows a symbolic link in the installed prefix; it
leaves each one out and names it. Reading refuses links, bad checksums, truncation and any path that is
absolute or contains `..`.

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
