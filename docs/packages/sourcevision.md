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

Detail for `@n-dx/lang-php`'s include, resolution and framework rules;
`packages/lang-php/AGENTS.md` keeps the summary.

- **Includes** (`src/php-includes.ts`): a path built only from literals, `.`, `__DIR__`, `__FILE__`, `dirname(x[, n])`, `DIRECTORY_SEPARATOR` and constants the repository defines once (`define()`, file-level `const` outside a namespace; two different values is not computable) resolves to a pack file, symbol `*`; anything else gives no edge. Search: `__DIR__`/constant-anchored paths as named; `./` and `../` against the working directory; other relative paths under each include-path root, then the including file's directory. Working directory, tried in order: the including file's directory, its ancestors holding an `index.php` (entry scripts) nearest first, then the docroot (`src/php-docroots.ts`'s `primaryDocroot`: first `PHP_DOCROOT_DIRECTORIES` entry holding `index.php`, else the root). Roots: literal `set_include_path()`/`ini_set('include_path', …)`, `.user.ini`/`.htaccess` (`php_value`) at or above the file nearest first, then any `php.ini`; default `.`; relative roots against the working directory; roots outside the repository are ignored with a notice. `preparePhpImports(...).includes(path)` gives each include's outcome. Fixture: `tests/fixtures/php-legacy-includes/`.

- **Dynamic includes** (a path not computable): no edge; counted with `file:line` in a `[php-dynamic-include]` notice, or `[php-host-include]` when the path reads `$_SERVER['HTTP_HOST']`/`['SERVER_NAME']`, itself or through a variable whose last assignment before the include, in its scope (`@guard.function` bodies, else the file; `src/php-assignments.ts`), reads it (`src/php-include-notices.ts`; `ResolvedPhpInclude.host`). The computable leading and trailing `.` operands (and an interpolated string's literal ends) give a prefix and suffix; pack files matching both, the prefix looked up as an include would be, fill `WrittenImport.candidates`, sorted, at most `MAX_INCLUDE_CANDIDATES` (50; the outcome keeps `total`). No prefix needs a suffix holding `/`; a leading `/` also matches at the repository root (`'/includes/x.inc'` → `includes/x.inc`). Candidates are never edges (`packages/sourcevision/tests/integration/php-pack-imports.test.ts`). Fixture: `tests/fixtures/php-dynamic-includes/`.

- **Resolution** (`src/php-resolver.ts`, class names from `queries/php/references.scm`): `use` imports and class references (`extends`, `implements`, trait `use`, `new`, `X::`, parameter/return/property/`catch` types, `instanceof`) are qualified as PHP does (per-namespace-block `use` aliases; `use function`/`use const` kept apart; `self`/`static`/`parent` dropped) and resolved through the owning Composer project's and its required in-repo packages' `autoload`/`autoload-dev` (lang-kit's `readComposerProjects`): PSR-4 longest prefix first, PSR-0, classmap (less `exclude-from-classmap`), then legacy loading, then a class declared in exactly one repository file (two or more and no pattern: `ambiguous`). Legacy loading (`src/php-autoloaders.ts`): the file an `__autoload` function or an `spl_autoload_register` closure, function or method callback would include, when an include in its body is computable from the class name (the parameter, body variables, `str_replace`/`strtr`/`strtolower`/`ltrim`…), then the PSR-0 path (`A_B_C` → `A/B/C.php`) under the referring file's include-path roots or the repository root; the file must declare the class, or be unparsed while nothing declares it. Any other autoloader or registration is a notice with its line. Fixture: `tests/fixtures/php-legacy-autoload/`. Unresolved, per D5: PHP's own and common PECL extensions' classes (`src/php-builtins.ts`, by manual book or PECL page), scalar type keywords in any case, and global functions and constants are nothing; a name a `composer.lock` package's autoload prefix covers is external with that package as `module`; a name that is the project's is unresolved — a namespaced name whose namespace (all but its last segment) the project declares or that a project PSR-4/PSR-0 prefix covers, an un-namespaced one whose PSR-0 prefix is the project's (`Zend_`), never a library merely sharing the root namespace (`Acme\Shared` beside `Acme\Billing`); any other is `php:<first namespace segment>` (`php:Zend` for `Zend_Db_Table`). Symbols are qualified names. `preparePhpImports(...).outcomes(path)` says what each reference resolved to, for `packages/sourcevision/scripts/php-resolve-report.mjs`. Fixture: `tests/fixtures/php-composer/`.

- **Linear scans**: repository text (`.htaccess` words and `include_path`, ini `include_path`, DSN `key=value` pairs, `PHP_SAPI` comparisons) is read by index scans, never by a regex that can backtrack, and trailing-character trims use lang-kit's `trimTrailing`. A `.htaccess`, `php.ini` or `.user.ini` line longer than 64 KiB (`MAX_CONFIG_LINE_LENGTH`, `src/php-line-cap.ts`) is skipped and counted in a notice. Pathological-input tests: `tests/unit/php-linear-scans.test.ts`.

- **Version sources** (`src/php-version-sources.ts`): every version a version-floor (`src/php-compat.ts`) or legacy-construct rule gives cites a php.net page. From 5.6 on that is the version's migration guide page, `https://www.php.net/manual/en/migrationXY.<section>.php`. php.net no longer hosts the 5.3, 5.4 and 5.5 guides, so those versions cite the release's anchor in the PHP 5 changelog, `https://www.php.net/ChangeLog-5.php#5.X.0`. No rule names an older version; a unit test accepts only these two forms, with the cited version equal to the rule's.

- **Version floor** (`src/php-compat.ts`, `queries/php-compat/compat.scm`): per file, the highest version of any syntax rule it matches, with the first use that set it. Two exceptions date nothing. Parse recovery: where the grammar cannot parse the source (a PHP 5 `$s{0}` offset), a node inside an ERROR node, or one recovery built beside or around an ERROR or MISSING node (such as `catch (Exception $e)` read as a call with a named argument), is not the source's syntax; a hit elsewhere in the file still counts. One-line attributes: an attribute group alone on its line, with only whitespace, a comment or another group after it, is a `#` line comment before PHP 8.0, so neither it nor anything inside it dates the file (Drupal 7's `#[\ReturnTypeWillChange]`); a group spanning lines, or followed on its line by code, is 8.0 `attributes`. Fixtures: `tests/fixtures/php-compat/` (one file per rule under `<version>/`, the exceptions under `exceptions/`).

- **Entry points** (`src/php-entry-points.ts`): `cli` for a `#!…php` shebang anywhere, or, under a `bin/`, `cli/`, `cron/`, `scripts/` or `jobs/` directory, a `PHP_SAPI`/`php_sapi_name()` comparison with `'cli'` or a `$argv`/`$_SERVER['argv']` read (`source` `shebang`, `PHP_SAPI check`, `$argv`). `cron` for each script a crontab-like file runs (`src/php-cron.ts`: `crontab`, `*.cron`, `cron.d/*`, found beside the PHP files and up to two directories below the root, a `cron.d/` one more; `php` options skipped, `-f` honoured; the script is the longest trailing part of its path that is a pack file), `source` `<crontab>:<line>`, `schedule` as written, `crontab` its file and line (classifications.json evidence `schedule`: `expression`, `file`, `line`); a script that is no pack file is a notice. Crontab text joins `.htaccess` in the resolver's `configFiles`. Fixture: `tests/fixtures/php-entry-points/`.
- **Outbound calls** (`src/php-outbound.ts`, rules in its module comment), all `certain`: `http` from curl, `file_get_contents()`/`fopen()`/`file()`/`get_headers()` on an `http(s)://` value, `fsockopen()`, `SoapClient` and Guzzle (methods only on a receiver bound to a client in its scope); `database`/`cache` from database and cache clients; `env` from `$_ENV`, and `getenv`/`$_SERVER` less request keys (`isRequestKey`), writes excluded. Targets: computable `literal` (a database host never partly), env reads `env`, `$config['a']` `config`. Fixtures: `tests/fixtures/php-outbound/`, `php-data-access/`.
- **Legacy constructs** (`src/php-legacy.ts`, `queries/php-legacy/legacy.scm`): each use of a construct a later PHP version removed or deprecated, as `legacyConstructs` facts with the php.net page (see version sources) of every version a rule names (`deprecated`, `removed`, `changed`). Removed: call-time pass-by-reference and the `session_register` family (5.4), `import_request_variables()` (5.4), the long arrays `$HTTP_*_VARS` and `$HTTP_POST_FILES` (5.4), `$HTTP_RAW_POST_DATA` (7.0; each read or write, in `global` and strings too, never a property, parameter or array key of that name), `set_magic_quotes_runtime()` (7.0), `mysql_*`, `ereg*`/`split`/`spliti`/`sql_regcase`, ASP and `<script language="php">` tags (7.0), `mcrypt_*` (7.2), PHP 4 constructors, `create_function`, `each`, `(unset)`, `__autoload`, `$s{0}` and `get_magic_quotes_*` (8.0). Deprecated: `${}` interpolation, dynamic properties (`likely`: a class that extends nothing, uses no trait, has no `__set` or `#[AllowDynamicProperties]`, assigning `$this->x` it does not declare) and `utf8_encode`/`utf8_decode` (8.2). Notices, never removals: `<?` (depends on `short_open_tag`) and `==`/`!=`/`<>` between a non-numeric string literal and a number (8.0 changed the result). A call of a function the repository declares itself (a polyfill) or a namespaced call is not PHP's. The grammar cannot parse ASP tags or `$s{0}`: the tags are read from inline HTML, an offset from a statement ending in a MISSING token right before `{` or from an ERROR node's text (strings and comments blanked). ASP tags count only outside script elements: a `<%` or `<%=` inside any `<script>` other than `<script language="php">`, whatever its `type`, is a JavaScript template (Underscore, EJS), tracked across inline-HTML segments a PHP block splits; one in a PHP string is not inline HTML. The count assumes `asp_tags` could have been on (it was off by default). `scripts/php-corpus-report.mjs` counts a file whose only parse errors are such offsets as clean and `legacy`, so it is not counted twice. Fixtures: `tests/fixtures/php-legacy/` (one file per rule under `rules/`), `php-legacy-polyfill/`.
- **Dynamic code** (`src/php-dynamic-code.ts`, `queries/php-dynamic/dynamic.scm`): each place code runs a string as code or chooses what to run from a value, as `dynamicCode` facts with the kind, construct, the expression as written, the enclosing function, `Class::method` or `{closure:…}`, and the position; never a value. `exec`: `eval`, `assert` with a string argument, `preg_replace` with a literal pattern carrying the `e` modifier, `create_function`; marked `literal` when the code is written as literals alone (`eval('return 1;')`). `dispatch`: `call_user_func`, `call_user_func_array`, `forward_static_call(_array)` and callback built-ins (`array_map`, `array_filter`, `usort`, `preg_replace_callback`, …) whose callable is not static, a callee that is not a name (`$f()`), `new $class`, `$o->$m()`, `$o->{$expr}()`, `$c::$m()` and `$c::{$expr}()`, and a static call on a class that is a value (`$c::run()`, construct `variable-static-class`; never `self`, `static`, `parent` or `$this`). A static callable is a string without interpolation, a closure, a name or `X::class`, `f(...)`, or an array of those and `$this` (`[$this, 'save']`; `[$this, $name]` is dynamic). `include`: an include whose path is not computable, `host-include` when it reads the request's host name, else `dynamic-include`; the resolver's `[php-dynamic-include]` and `[php-host-include]` notices already list them, so they are counted only. A named rule applies to the global name alone, never a namespaced call or a function the repository declares. Notices `[php-dynamic-exec]` and `[php-dynamic-dispatch]` list each kind's locations. Fixtures: `tests/fixtures/php-dynamic-code/` (one file per kind under `exec/`, `dispatch/`, `include/`; files with none under `lib/`).
- **Database-driven dynamic code** (`src/php-database-flow.ts`): an `exec` site whose code, or a `dispatch` site whose callable, callee, method name or class, is read from a database query result carries `database`: the tables its queries name, `table.column` for each plain column of a literal SELECT list (`SELECT *` gives the table alone; with several tables an unqualified column is left out), and the query or fetch calls the value comes from. Sources are a query call's result (`mysql_query`, `db_query_range` and the other embedded-SQL functions; a method or static call whose argument is SQL; `query()`, `prepare()` and wpdb's `get_var()`, `get_row()`, `get_col()`, `get_results()` on a database client: a variable assigned `new PDO`, `new mysqli`, `new wpdb`, `mysqli_connect()` or `mysqli_init()`, or `$wpdb`); a fetch (`mysql_fetch_*`, `mysql_result`, `mysqli_fetch_*`, `pg_fetch_*`, `oci_fetch_*`, `sqlsrv_fetch_*`, `odbc_fetch_*`, mysqli_result's `fetch_assoc` and kin on any receiver, and `fetch…` or CodeIgniter's `result()`/`row()` on a database-derived receiver); and a call of a repository function or method whose return value is database-derived (functions by namespace-qualified name, `$this->m()`, `self::m()`, `static::m()`, `Name::m()`, and `$obj->m()` when one repository class alone declares `m`), summarised across the repository to a fixed point within 10 rounds. Within one function, method, closure or top level, a forward pass carries a value through `=` and `= &` (in an `if` condition too), `.=`, element and property assignment (kept per `$a['k']`, `$a[0]` or `$o->p`, one level deep: a write replaces that path's value, a literal clearing it; a write by any other key or deeper adds and never clears; a literal path never assigned reads the variable's own value, never a sibling's), `list()`/`[…]` destructuring, `foreach`, `$row['x']`, `$row->x`, `.` and interpolation; any other call or operator, a parameter, a property of `$this`, and a value merged across branches or loop iterations is not a source, so an undecidable flow is missed rather than guessed. Notices `[php-db-exec]` and `[php-db-dispatch]` list the database-driven sites and the tables they read. Fixtures: `tests/fixtures/php-database-flow/` (a WordPress-like app and Drupal 7's menu router shape).

### Terraform pack facts

Detail for how `@n-dx/lang-terraform`'s facts are used;
`packages/sourcevision/AGENTS.md` keeps the summary.

**The Terraform model in infrastructure.json.** The Terraform pack produces
`resources` facts, not imports. `enrichTerraformInfrastructure` (called by
`analyze` after `computeInfrastructure`) adds optional `module`, `provider`
(`{ name, version? }`), `references` (`infra:<type>.<name>` ids of listed
resources in the same module directory) and `attributes` (`engine`,
`engineVersion`, `runtime`, `image`, `clusterVersion`) to each resource it
lists from a `.tf` file whose file and `<type>.<name>` match a fact. Values
are as written, never normalised; a field appears only when the pack supplied
it. When the pack resolved a module's attributes per instance (several facts
at one declaration), an attribute is stored resolved only when every instance
gives the same value, else as the expression written. It never adds or
removes a resource, link or seam or changes an existing field, so resources
only the model finds stay out. `analyzers/infrastructure.ts` and `IAC_KINDS`
are not involved, so the iso-map bundle does not change. Without the pack the
file is byte-identical. The field names await Sterling H's review (decision 3).

**Terraform as a database-engine source.** `language/database-engines.ts`
takes the Terraform pack's resource facts as
`DatabaseEngineInput.terraformFacts`, supplied by the caller (today only
`scripts/database-corpus-report.mjs`); it imports no pack, is not wired into
`analyze` and writes nothing. A database resource yields a `terraform`-signal
candidate: a mapped `engine` (Cloud SQL: `database_version`) is strong, an
engine implied by the type alone (Azure servers) is weak, and a resource that
gives neither (a reusable module's `var.engine` no call resolves) adds a
notice. A reusable module yields one candidate per engine its module calls
pass; the evidence text names where the value is written, and a
`conditional` value (`cond ? null : var.engine`) is weak. Engine strings and
resource types live in `TERRAFORM_ENGINE_TABLE` and
`TERRAFORM_RESOURCE_TABLE`, each entry with its provider page.

## Output Files

All output is written to `.sourcevision/`:

| File | Contents |
|------|----------|
| `manifest.json` | Analysis metadata, version, timestamps. `packs`: the language packs that loaded and ran in this analysis, `{ id, version }` sorted by id, the version being the pack package's (`[]` when none ran; no field in an analysis that predates it). An installed pack with no files of its language, or one that degraded, is not listed |
| `inventory.json` | File listing with classifications |
| `imports.json` | Dependency graph (edges + metadata). **New:** `summary.parseIssues`, keyed by pack id, one entry for every language pack that ran (zero counts when it parsed every file cleanly; no entry for a pack that did not run; no field when no pack ran or the analysis predates it): `files`, `clean`, `sizeLimitBytes`, and for `syntaxErrors` (parsed with error recovery; facts still read), `oversized` (over the size limit, not parsed), `unreadable` and `notUtf8` (parsed with replacement characters; may overlap `syntaxErrors`) a `count` and up to 50 sorted `examples`; `legacySyntax` (PHP 5's `$s{0}` offsets, rewritten to `$s[0]` in place and parsed cleanly, so facts are whole and positions are the source's; never under `syntaxErrors`) adds `constructs`, rewrites by construct. A `[<pack>-parse]` notice line sums it up. Field names are under review |
| `zones.json` | Architectural zone map with cohesion/coupling metrics |
| `components.json` | React component catalog |
| `sdlc-profile.json` | SDLC practices detected, each claim tied to the file proving it. With the PHP pack, an optional `ecosystem.php`: `versionFloors`, written whenever the pack read PHP files, the files it read (`files`) counted by the oldest PHP version whose syntax covers them (`floors`), files no rule dates (`none`) and the `highest` floor, absent when no file has one (a PHP 5.2-era repository gets `floors` `{}` and `none` equal to `files`); and `legacyConstructs`, written when a file has a use, uses of constructs later PHP versions removed or deprecated, by rule (`rules`, each with its php.net pages), by the version that removed them (`removedIn`) or deprecated them (`deprecatedIn`), with review `notices` counted apart; and `dynamicCode`, written when a file has a site, the repository's dynamic-code sites (`sites`, in `files` files) by kind (`kinds`: `exec`, `dispatch`, `include`), by construct (`constructs`), with `literal` counting `exec` sites whose code is literals alone, and `database`, written when a site is fed by a database query result, those sites (`sites`) by kind (`kinds`: `exec`, `dispatch`), by table (`tables`) and by `table.column` (`columns`) (see [PHP pack rules](#php-pack-rules)). Field names are under review |
| `readiness.json` | Readiness score computed from that profile, with the profile's `ecosystem` carried through unscored |
| `config.json` | **New.** Where code reads configuration and checks feature flags, per file, with indexes of flags (by normalized name, with the lines each gates) and config keys (with their consumer files). Names, keys and positions only, never values. Written only when a language pack produces config reads or flag checks (the PHP pack does); otherwise absent. Field names are under review. |
| `legacy.json` | **New.** The files behind `ecosystem`'s `versionFloors` and `legacyConstructs`, per language: each file's floor and every legacy-construct use (see [Legacy constructs per file](#legacy-constructs-per-file)). Written only when a language pack finds a floor or a use (the PHP pack does); otherwise absent. |
| `sites.json` | **New.** The sites behind `ecosystem`'s `dynamicCode`, per language and file: each site's notice code, construct and position, an include's candidate files (capped at 50, with the total) and a database-fed site's tables and columns (see [Dynamic-code sites per file](#dynamic-code-sites-per-file)). Written only when a language pack finds a site; otherwise absent. |
| `declarations.json` | **New.** What each file declares, per language: its namespaces and each named type's kind, name, fully qualified name and line, including types nothing imports (see [Declarations per file](#declarations-per-file)). Written only when a language pack reports declarations (the PHP pack does); otherwise absent. |
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
- a built-in fingerprint, reason `library <Name>`: a library's own header in the file's first 2 KiB (a `@package PHPExcel` docblock, a version banner where the library puts it, such as `/*! jQuery v3.6.0 |`; a comment like `// requires jQuery v1.7 or later` is not one), a directory named as a well-known library that also holds that library's evidence, or a directory where at least 80% of the files carry one library's header.

A folder named as a library (EditArea in edit_area, TinyMCE in tinymce, CKEditor in ckeditor, PHPExcel in PHPExcel) counts only when a file under it carries that library's header, or the library's entry file (`ckeditor.js`, `tinymce.min.js`, `PHPExcel.php`, …; `LIBRARY_ENTRY_FILES` in `third-party.ts`) sits under it (or beside it, for PHPExcel, HTML Purifier and SimplePie, which ship it that way: `Classes/PHPExcel.php` next to `Classes/PHPExcel/`). An application's own `src/ckeditor/plugins/` stays first-party. No library name marks a folder on its own.

Globs use `**`, `*` and `?`; a trailing `/` means the whole directory, and a name without `/` matches at any depth. A glob starting with `!` denies, overriding every rule, so a wrong fingerprint is undone with `"!lib/our-tinymce-plugin/**"`.

After the count line, analyze prints one `[third-party]` line per marked folder with the library and the reason: `directory+banner`, `directory+entry`, `header`, `config` or `flag` (a library's header marks spread over more than five folders share one line). A built-in mark's line names its deny glob, e.g. `[third-party] js/ckeditor/: CKEditor (directory+entry), 212 files; undo with "!js/ckeditor/**" in sourcevision.thirdParty or --third-party`. `vendor/` and other package-manager folders are skipped before marking, so they get no line.

A third-party file stays in the inventory, and imports to it still resolve. It is left out of zones (so never a zone entry point), classification and the model escalation pass, primary-language detection, readiness evidence and the call graph (`--include-third-party` maps it). Pack totals in `sdlc-profile.json` `ecosystem.<language>` count it apart, under `thirdParty`. An `outbound.json` call in it is kept, since a copied-in SDK's calls are still the repository's integrations, and marked `thirdParty`.

## Mirrored folders

A folder that is a near-copy of another (a legacy `edit/` kept beside `app/`) would double every count. Inventory finds such pairs from content hashes: identical files with the same name give candidate root pairs, and a pair counts when at least 10 files of one root, and at least half of its files, are identical to the file at the same relative path in the other. That root is the copy (for an exact copy, the smaller, then the later in path order). Each identical file of the copy gets `mirrorOf`, its counterpart's path, and `summary.mirrored` counts them; analyze prints one `[mirror]` line per pair. Files where the copy diverged stay first-party.

A mirror copy is left out of the same phases as third-party code, and its pack totals and outbound calls are dropped, since its source's are already counted. `sourcevision.mirrors` sets a pair (`{ "edit/": "app/" }`) or denies one (`{ "edit/": false }`).

## Legacy constructs per file

`legacy.json` lists, per language (the inventory's, lower-cased), each file with a version floor or a legacy-construct use, so an upgrade can be planned and split file by file. It is built from the same pack facts as `sdlc-profile.json`'s `ecosystem` in the same run (`src/analyzers/pack-legacy-files.ts`), with the same split: the application's own files under `files`, third-party files under `thirdParty` (absent when none), mirror copies left out.

```json
{ "languages": { "php": { "files": [
  { "path": "lib/db.php", "floor": { "version": "5.3", "rule": "closures", "line": 4 },
    "uses": 2, "notices": 0, "removedIn": { "7.0": 2 }, "deprecatedIn": {},
    "constructs": [ { "rule": "mysql-functions", "construct": "mysql_query()", "status": "removed",
                      "line": 7, "column": 2, "deprecated": "5.5", "removed": "7.0" } ] } ] } } }
```

Files are sorted by path, uses by line then column. `uses` counts removed and deprecated uses and `notices` the review notices; `removedIn` and `deprecatedIn` count a file's uses as `legacyConstructs` does. Summed over `files`, they equal the profile's `legacyConstructs` (files with a use, uses, notices, per-rule uses and files, `removedIn`, `deprecatedIn`) and the floors equal `versionFloors.floors`; summed over `thirdParty`, they equal `thirdParty.legacyConstructs`. Versions and positions only: each rule's php.net pages are in the profile, and no code is copied. Without a floor or a use no file is written, and one an earlier run left is removed.

## Dynamic-code sites per file

`sites.json` lists, per language and with `legacy.json`'s split (`src/analyzers/pack-sites-files.ts`), each file's dynamic-code sites behind `ecosystem.<lang>.dynamicCode`: code run from a string, what runs chosen by a value, and includes whose path is built at run time. Each site has `code`, the pack notice that counts it (`php-dynamic-include`, `php-host-include`, `php-dynamic-exec`, `php-dynamic-dispatch`, or `php-db-exec`/`php-db-dispatch` for a database-fed site), its `kind`, `construct`, `line` and `column`, and `scope` when it is inside a function.

```json
{ "languages": { "php": { "files": [
  { "path": "index.php", "sites": [
    { "code": "php-host-include", "kind": "include", "construct": "host-include", "line": 3, "column": 8,
      "candidates": { "files": ["config/a.example.com.php"], "total": 1 } },
    { "code": "php-db-dispatch", "kind": "dispatch", "construct": "call_user_func", "line": 6, "column": 0,
      "database": { "tables": ["hooks"], "columns": ["hooks.handler"] } } ] } ] } } }
```

An include's `candidates` are the files it could load, never edges: at most 50, sorted, with `total`, and `truncated: true` when `total` is larger. A database-fed site names the tables and `table.column`s its queries read. Never the expression as written, a value or row data. Files are sorted by path, sites by line then column. Without a site no file is written, and one an earlier run left is removed. The console notices are unchanged.

## Declarations per file

`declarations.json` lists, per language (the pack id) and with `legacy.json`'s split (`src/analyzers/pack-declarations-files.ts`), each file that opens a namespace or declares a named type. It comes from lang-kit's language-neutral `declarations` fact; the PHP pack fills it today (`packages/lang-php/src/php-declarations.ts`).

```json
{ "languages": { "php": { "files": [
  { "path": "src/Billing.php", "namespaces": ["Acme\\Billing"], "types": [
    { "kind": "interface", "name": "Payable", "qualifiedName": "Acme\\Billing\\Payable", "line": 4 },
    { "kind": "class", "name": "Invoice", "qualifiedName": "Acme\\Billing\\Invoice", "line": 6 } ] },
  { "path": "src/compat.php", "namespaces": [], "types": [
    { "kind": "class", "name": "Json_Encoder", "qualifiedName": "Json_Encoder", "line": 3 } ] } ] } } }
```

PHP types are classes, interfaces, traits and enums. A type's namespace is the braced `namespace A { … }` around it or the last `namespace A;` before it; outside both, `qualifiedName` is the name and `namespaces` is empty. A type declared in a conditional block, function or method is listed; an anonymous class is not. Files are sorted by path, types by line. imports.json shows only what something imports, and callgraph.json is JavaScript and TypeScript only; this file is the place to find an unreferenced class. Without declarations no file is written, and one an earlier run left is removed. It is a separate file rather than a field in inventory.json because inventory.json is written before packs run and stays language-neutral.

## Jev request size

Typed-finding judgment and Jev file classification send their items to TypeSafe in batches of at most 20 findings or 30 files, packed so each request's JSON also stays under a byte ceiling: 128 KiB by default (`JEV_REQUEST_BYTE_CEILING` in `src/analyzers/jev-split.ts`, which says how it was chosen). A zone's evidence shared by several findings counts once per request. Set `sourcevision.jev.requestByteCeiling` (a positive integer, in bytes) in the project config to change it:

```json
{ "sourcevision": { "jev": { "requestByteCeiling": 65536 } } }
```

A request TypeSafe still refuses as too large (`max_tokens_exceeded`) is sent again as two halves, until each fits. A typed finding refused on its own is asked again on less evidence, one level at a time: 1 drops the zone's file headers, 2 also its declarations and exported symbols, 3 cuts its file sample to 10, 4 cuts the finding's edges to 4. The cuts are fixed, never a model summary, so the judgment cache still hits on the next run. The judgment summary line counts findings judged on trimmed evidence (`, N on trimmed evidence`), and the too-large warning counts only those refused at every level, which keep their derived severity. With `--debug`, each request's size in bytes and whether it was refused is logged.

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
