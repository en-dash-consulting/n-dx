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
sourcevision analyze --fast .             # static only: no model or network calls
sourcevision analyze --phase zones .      # run specific phase
sourcevision analyze --third-party='lib/Sheet/**' .  # treat a copied-in library as third-party
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

**A bundle is trusted like any npm tarball.** No npm call is not no code: to
validate a bundle, `add --from` imports its entry module from a staging
directory, running its top level before anything is installed, so only add
bundles from a trusted source. Its manifest is written by whoever made it, so
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
python, php, sql; only `KNOWN_PACKS`, all but sql, are analyzed with today, and
php reports its imports as written but resolves none into edges yet). npm
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

### PHP pack rules

Detail for `@n-dx/lang-php`'s framework rules; `packages/lang-php/AGENTS.md`
keeps the summary.

- **Linear scans**: repository text (`.htaccess` words and `include_path`, ini `include_path`, DSN `key=value` pairs, `PHP_SAPI` comparisons) is read by index scans, never by a regex that can backtrack, and trailing-character trims use lang-kit's `trimTrailing`. A `.htaccess`, `php.ini` or `.user.ini` line longer than 64 KiB (`MAX_CONFIG_LINE_LENGTH`, `src/php-line-cap.ts`) is skipped and counted in a notice. Pathological-input tests: `tests/unit/php-linear-scans.test.ts`.

- **Version sources** (`src/php-version-sources.ts`): every version a version-floor (`src/php-compat.ts`) or legacy-construct rule gives cites a php.net page. From 5.6 on that is the version's migration guide page, `https://www.php.net/manual/en/migrationXY.<section>.php`. php.net no longer hosts the 5.3, 5.4 and 5.5 guides, so those versions cite the release's anchor in the PHP 5 changelog, `https://www.php.net/ChangeLog-5.php#5.X.0`. No rule names an older version; a unit test accepts only these two forms, with the cited version equal to the rule's.

- **Version floor** (`src/php-compat.ts`, `queries/php-compat/compat.scm`): per file, the highest version of any syntax rule it matches, with the first use that set it. Two exceptions date nothing. Parse recovery: where the grammar cannot parse the source (a PHP 5 `$s{0}` offset), a node inside an ERROR node, or one recovery built beside or around an ERROR or MISSING node (such as `catch (Exception $e)` read as a call with a named argument), is not the source's syntax; a hit elsewhere in the file still counts. One-line attributes: an attribute group alone on its line, with only whitespace, a comment or another group after it, is a `#` line comment before PHP 8.0, so neither it nor anything inside it dates the file (Drupal 7's `#[\ReturnTypeWillChange]`); a group spanning lines, or followed on its line by code, is 8.0 `attributes`. Fixtures: `tests/fixtures/php-compat/` (one file per rule under `<version>/`, the exceptions under `exceptions/`).

- **Entry points** (`src/php-entry-points.ts`): `cli` for a `#!…php` shebang anywhere, or, under a `bin/`, `cli/`, `cron/`, `scripts/` or `jobs/` directory, a `PHP_SAPI`/`php_sapi_name()` comparison with `'cli'` or a `$argv`/`$_SERVER['argv']` read (`source` `shebang`, `PHP_SAPI check`, `$argv`). `cron` for each script a crontab-like file runs (`src/php-cron.ts`: `crontab`, `*.cron`, `cron.d/*`, found beside the PHP files and up to two directories below the root, a `cron.d/` one more; `php` options skipped, `-f` honoured; the script is the longest trailing part of its path that is a pack file), `source` `<crontab>:<line>`, `schedule` as written; a script that is no pack file is a notice. Crontab text joins `.htaccess` in the resolver's `configFiles`. Fixture: `tests/fixtures/php-entry-points/`.
- **Outbound calls** (`src/php-outbound.ts`, rules in its module comment), all `certain`: `http` from curl, `file_get_contents()`/`fopen()`/`file()`/`get_headers()` on an `http(s)://` value, `fsockopen()`, `SoapClient` and Guzzle (methods only on a receiver bound to a client in its scope); `database`/`cache` from database and cache clients; `env` from `$_ENV`, and `getenv`/`$_SERVER` less request keys (`isRequestKey`), writes excluded. Targets: computable `literal` (a database host never partly), env reads `env`, `$config['a']` `config`. Fixtures: `tests/fixtures/php-outbound/`, `php-data-access/`.
- **Legacy constructs** (`src/php-legacy.ts`, `queries/php-legacy/legacy.scm`): each use of a construct a later PHP version removed or deprecated, as `legacyConstructs` facts with the php.net page (see version sources) of every version a rule names (`deprecated`, `removed`, `changed`). Removed: call-time pass-by-reference and the `session_register` family (5.4), `import_request_variables()` (5.4), the long arrays `$HTTP_*_VARS` and `$HTTP_POST_FILES` (5.4), `$HTTP_RAW_POST_DATA` (7.0; each read or write, in `global` and strings too, never a property, parameter or array key of that name), `set_magic_quotes_runtime()` (7.0), `mysql_*`, `ereg*`/`split`/`spliti`/`sql_regcase`, ASP and `<script language="php">` tags (7.0), `mcrypt_*` (7.2), PHP 4 constructors, `create_function`, `each`, `(unset)`, `__autoload`, `$s{0}` and `get_magic_quotes_*` (8.0). Deprecated: `${}` interpolation, dynamic properties (`likely`: a class that extends nothing, uses no trait, has no `__set` or `#[AllowDynamicProperties]`, assigning `$this->x` it does not declare) and `utf8_encode`/`utf8_decode` (8.2). Notices, never removals: `<?` (depends on `short_open_tag`) and `==`/`!=`/`<>` between a non-numeric string literal and a number (8.0 changed the result). A call of a function the repository declares itself (a polyfill) or a namespaced call is not PHP's. The grammar cannot parse ASP tags or `$s{0}`: the tags are read from inline HTML, an offset from a statement ending in a MISSING token right before `{` or from an ERROR node's text (strings and comments blanked). ASP tags count only outside script elements: a `<%` or `<%=` inside any `<script>` other than `<script language="php">`, whatever its `type`, is a JavaScript template (Underscore, EJS), tracked across inline-HTML segments a PHP block splits; one in a PHP string is not inline HTML. The count assumes `asp_tags` could have been on (it was off by default). `scripts/php-corpus-report.mjs` counts a file whose only parse errors are such offsets as clean and `legacy`, so it is not counted twice. Fixtures: `tests/fixtures/php-legacy/` (one file per rule under `rules/`), `php-legacy-polyfill/`.
- **Dynamic code** (`src/php-dynamic-code.ts`, `queries/php-dynamic/dynamic.scm`): each place code runs a string as code or chooses what to run from a value, as `dynamicCode` facts with the kind, construct, the expression as written, the enclosing function, `Class::method` or `{closure:…}`, and the position; never a value. `exec`: `eval`, `assert` with a string argument, `preg_replace` with a literal pattern carrying the `e` modifier, `create_function`; marked `literal` when the code is written as literals alone (`eval('return 1;')`). `dispatch`: `call_user_func`, `call_user_func_array`, `forward_static_call(_array)` and callback built-ins (`array_map`, `array_filter`, `usort`, `preg_replace_callback`, …) whose callable is not static, a callee that is not a name (`$f()`), `new $class`, `$o->$m()`, `$o->{$expr}()`, `$c::$m()` and `$c::{$expr}()`, and a static call on a class that is a value (`$c::run()`, construct `variable-static-class`; never `self`, `static`, `parent` or `$this`). A static callable is a string without interpolation, a closure, a name or `X::class`, `f(...)`, or an array of those and `$this` (`[$this, 'save']`; `[$this, $name]` is dynamic). `include`: an include whose path is not computable, `host-include` when it reads the request's host name, else `dynamic-include`; the resolver's `[php-dynamic-include]` and `[php-host-include]` notices already list them, so they are counted only. A named rule applies to the global name alone, never a namespaced call or a function the repository declares. Notices `[php-dynamic-exec]` and `[php-dynamic-dispatch]` list each kind's locations. Fixtures: `tests/fixtures/php-dynamic-code/` (one file per kind under `exec/`, `dispatch/`, `include/`; files with none under `lib/`).
- **Database-driven dynamic code** (`src/php-database-flow.ts`): an `exec` site whose code, or a `dispatch` site whose callable, callee, method name or class, is read from a database query result carries `database`: the tables its queries name, `table.column` for each plain column of a literal SELECT list (`SELECT *` gives the table alone; with several tables an unqualified column is left out), and the query or fetch calls the value comes from. Sources are a query call's result (`mysql_query`, `db_query_range` and the other embedded-SQL functions; a method or static call whose argument is SQL; `query()`, `prepare()` and wpdb's `get_var()`, `get_row()`, `get_col()`, `get_results()` on a database client: a variable assigned `new PDO`, `new mysqli`, `new wpdb`, `mysqli_connect()` or `mysqli_init()`, or `$wpdb`); a fetch (`mysql_fetch_*`, `mysql_result`, `mysqli_fetch_*`, `pg_fetch_*`, `oci_fetch_*`, `sqlsrv_fetch_*`, `odbc_fetch_*`, mysqli_result's `fetch_assoc` and kin on any receiver, and `fetch…` or CodeIgniter's `result()`/`row()` on a database-derived receiver); and a call of a repository function or method whose return value is database-derived (functions by namespace-qualified name, `$this->m()`, `self::m()`, `static::m()`, `Name::m()`, and `$obj->m()` when one repository class alone declares `m`), summarised across the repository to a fixed point within 10 rounds. Within one function, method, closure or top level, a forward pass carries a value through `=` and `= &` (in an `if` condition too), `.=`, element and property assignment (kept per `$a['k']`, `$a[0]` or `$o->p`, one level deep: a write replaces that path's value, a literal clearing it; a write by any other key or deeper adds and never clears; a literal path never assigned reads the variable's own value, never a sibling's), `list()`/`[…]` destructuring, `foreach`, `$row['x']`, `$row->x`, `.` and interpolation; any other call or operator, a parameter, a property of `$this`, and a value merged across branches or loop iterations is not a source, so an undecidable flow is missed rather than guessed. Notices `[php-db-exec]` and `[php-db-dispatch]` list the database-driven sites and the tables they read. Fixtures: `tests/fixtures/php-database-flow/` (a WordPress-like app and Drupal 7's menu router shape).

## Output Files

All output is written to `.sourcevision/`:

| File | Contents |
|------|----------|
| `manifest.json` | Analysis metadata, version, timestamps |
| `inventory.json` | File listing with classifications |
| `imports.json` | Dependency graph (edges + metadata). **New:** `summary.parseIssues`, keyed by pack id, written only when a language pack's file did not parse cleanly: `files`, `clean`, `sizeLimitBytes`, and for `syntaxErrors` (parsed with error recovery; facts still read), `oversized` (over the size limit, not parsed), `unreadable` and `notUtf8` (parsed with replacement characters; may overlap `syntaxErrors`) a `count` and up to 50 sorted `examples`; `legacySyntax` (PHP 5's `$s{0}` offsets, rewritten to `$s[0]` in place and parsed cleanly, so facts are whole and positions are the source's; never under `syntaxErrors`) adds `constructs`, rewrites by construct. A `[<pack>-parse]` notice line sums it up. Field names are under review |
| `zones.json` | Architectural zone map with cohesion/coupling metrics |
| `components.json` | React component catalog |
| `sdlc-profile.json` | SDLC practices detected, each claim tied to the file proving it. With the PHP pack, an optional `ecosystem.php`: `versionFloors`, written whenever the pack read PHP files, the files it read (`files`) counted by the oldest PHP version whose syntax covers them (`floors`), files no rule dates (`none`) and the `highest` floor, absent when no file has one (a PHP 5.2-era repository gets `floors` `{}` and `none` equal to `files`); and `legacyConstructs`, written when a file has a use, uses of constructs later PHP versions removed or deprecated, by rule (`rules`, each with its php.net pages), by the version that removed them (`removedIn`) or deprecated them (`deprecatedIn`), with review `notices` counted apart; and `dynamicCode`, written when a file has a site, the repository's dynamic-code sites (`sites`, in `files` files) by kind (`kinds`: `exec`, `dispatch`, `include`), by construct (`constructs`), with `literal` counting `exec` sites whose code is literals alone, and `database`, written when a site is fed by a database query result, those sites (`sites`) by kind (`kinds`: `exec`, `dispatch`), by table (`tables`) and by `table.column` (`columns`) (see [PHP pack rules](#php-pack-rules)). Field names are under review |
| `readiness.json` | Readiness score computed from that profile, with the profile's `ecosystem` carried through unscored |
| `config.json` | **New.** Where code reads configuration and checks feature flags, per file, with indexes of flags (by normalized name, with the lines each gates) and config keys (with their consumer files). Names, keys and positions only, never values. Written only when a language pack produces config reads or flag checks (the PHP pack does); otherwise absent. Field names are under review. |
| `llms.txt` | AI-readable codebase summary |
| `CONTEXT.md` | Detailed AI context document |
| `zones/{zone-id}/` | Per-zone context and summary files |

**No credential from source.** Strings copied out of the code (outbound
targets, config keys, expressions as written, findings) are redacted before
any of these files is written, for every language
(`src/util/redact-literals.ts`):

- **URLs lose their userinfo:** `https://u:pw@host/v1` becomes `https://host/v1`, and a password holding `/`, `?`, `#` or `@` goes whole (`mysql://app:pa/ss@db/app` becomes `mysql://db/app`). A value of `=` padding alone (`abcKey==`) is kept.
- **Secret values are replaced:** a secret-shaped query parameter or
  key=value connection-string entry (`password`, `pwd`, `pass`, `secret`,
  `token`, `api_key`, `access_key`, `auth`, `key`, `sig`, `signature`,
  `credentials`, in any case, with `_`/`-` variants) keeps its name and gets
  the value `REDACTED`.

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

## Copied-in third-party code

A library copied into the repository by hand (a spreadsheet library in `lib/`, an old JS framework in `js/`) is not under `vendor/` and no manifest installs it, so analysis used to read it as the application. Inventory now marks such files `thirdParty` with the reason, and `summary.thirdParty` counts them; analyze prints one line with the count per reason. A file is third-party when no deny glob matches it and one of these does:

- a glob in `sourcevision.thirdParty` (project config), reason `config <glob>`;
- a glob passed as `--third-party=<glob>` or listed in `--third-party-file=<path>` (one per line, or a JSON array), reason `cli <glob>`; a caller with its own library catalogue passes it this way;
- a built-in fingerprint, reason `library <Name>`: a library's own header in the file's first 2 KiB (a `@package PHPExcel` docblock, a YUI or Highcharts version banner), a directory named as a well-known library (`edit_area`, `tinymce`, `PHPExcel`), or a directory where at least 80% of the files carry one library's header.

Globs use `**`, `*` and `?`; a trailing `/` means the whole directory, and a name without `/` matches at any depth. A glob starting with `!` denies, overriding every rule, so a wrong fingerprint is undone with `"!lib/our-tinymce-plugin/**"`.

A third-party file stays in the inventory, and imports to it still resolve. It is left out of zones (so never a zone entry point), classification and the model escalation pass, primary-language detection, readiness evidence and the call graph (`--include-third-party` maps it). Pack totals in `sdlc-profile.json` `ecosystem.<language>` count it apart, under `thirdParty`. An `outbound.json` call in it is kept, since a copied-in SDK's calls are still the repository's integrations, and marked `thirdParty`.

## Mirrored folders

A folder that is a near-copy of another (a legacy `edit/` kept beside `app/`) would double every count. Inventory finds such pairs from content hashes: identical files with the same name give candidate root pairs, and a pair counts when at least 10 files of one root, and at least half of its files, are identical to the file at the same relative path in the other. That root is the copy (for an exact copy, the smaller, then the later in path order). Each identical file of the copy gets `mirrorOf`, its counterpart's path, and `summary.mirrored` counts them; analyze prints one `[mirror]` line per pair. Files where the copy diverged stay first-party.

A mirror copy is left out of the same phases as third-party code, and its pack totals and outbound calls are dropped, since its source's are already counted. `sourcevision.mirrors` sets a pair (`{ "edit/": "app/" }`) or denies one (`{ "edit/": false }`).

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
