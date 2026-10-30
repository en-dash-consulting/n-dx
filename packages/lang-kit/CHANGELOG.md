# @n-dx/lang-kit

## 0.10.2

### Patch Changes

- [#891](https://github.com/en-dash-consulting/n-dx/pull/891) [`19816b7`](https://github.com/en-dash-consulting/n-dx/commit/19816b719a347f36cb8c96831089836cc62584f7) Thanks [@endash-shal](https://github.com/endash-shal)! - Correct outbound and workspace connection evidence: respect JavaScript scopes, retain configured HTTP paths, ignore Go documentation strings and SQL/cache payloads, and withhold ambiguous endpoints or repository-local infrastructure identities. Preserve YAML script bodies and nested flow collections, record executable coverage configuration, and recognize explicitly manual deployment jobs.

## 0.10.1

No changes in this release.

## 0.10.0

### Patch Changes

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Gradle build reader continues a Groovy statement past a line that ends in a comma or a binary operator, as Groovy does. `implementation group: 'g',` followed by `name: 'a', version: '1'` on the next line is read as one dependency instead of a "computed group or name" notice, and the second coordinate of `implementation 'a:b:1',` followed by `'c:d:2'` is no longer dropped.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java build file readers no longer take seconds or longer on a tag with no closing tag followed by long whitespace, an unterminated `<!--`, unclosed `<plugins>`/`<parent>`/`<modules>` blocks or an unterminated `/*` in a Gradle script. An unterminated XML comment now runs to the end of the file. A `pom.xml` or Gradle script over 1 MiB is skipped with a notice.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java's `target/`, `build/`, `out/` and `generated/` are skipped only as build output: at the project root or beside `pom.xml`, `build.gradle` or `build.gradle.kts`, never below `src/`. A Java package with one of those names (Spring's `org.springframework.aop.target`) is now in the inventory. Repositories without Java are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java resolver links a test file to another module's test code only when the build lets javac do so: a Maven dependency of type `test-jar` or classifier `tests` on that module, a Gradle `testFixtures(project(':x'))` (its `testFixtures` set) or a project dependency on a test configuration such as `testArtifacts` (its `test` set). Otherwise a test in `svc-a` that names a class declared only in `svc-b/src/test` gets no edge to it, and a name declared in `svc-b/src/test` and `svc-c/src/main` resolves to the main declaration alone. Main code never links to test code. Build files that cannot be read lose only these links: every other Java import still resolves, and the analysis records a notice naming the failure. lang-kit's Gradle build model gains `projects`, the module's dependencies on other projects of the build.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Move language ids and configs, detection, the Go/Maven/Gradle build-file readers and the TOML/XML/YAML parsers from sourcevision into `@n-dx/lang-kit`. lang-kit's detection takes the config override and the Terraform search as arguments; sourcevision supplies both. Analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Define the facts-out pack contract in `@n-dx/lang-kit`: per-file `FileFacts` with imports, symbols and calls produced today and routes, components, outbound calls and resources declared for later packs. sourcevision's Java, Go and SQL packs fill it through a new adapter, and the Java and Go import graph is built from the imports facts. Analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `@n-dx/lang-kit`, a foundation-tier package for language facts and the pack contract; sourcevision depends on it.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - lang-kit reads Python project metadata as text: `pyproject.toml` (PEP 621, dependency groups, Poetry, setuptools, hatch, uv workspace), `setup.cfg`, requirements files with `-r`/`-c` includes, and the literal arguments of `setup.py`'s `setup(...)`, which is never executed. Each project gives its name, source roots, listed packages and PEP 503-named dependencies with file and line; malformed input becomes a notice. The TOML reader now accepts arrays of tables, multi-line strings and digit separators. Nothing in sourcevision uses the readers yet, so analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack resolves imports: absolute, from-import submodule or attribute, relative, src-layout and namespace-package imports become edges to project files across each project's source roots, so Python files join the import graph and zones, beside TypeScript in a mixed repository. Externals are named `python:<top-level module>`, so npm and PyPI packages of the same name stay apart; stdlib is `python:stdlib:<module>` from a pinned Python 3.13 list, and a third-party module is matched to a declared dependency by PEP 503 name only. A target imported only under `TYPE_CHECKING` is a `type` edge. Without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack reads structure: the pinned tree-sitter-python 0.25.0 grammar, imports as written (relative dots kept, `TYPE_CHECKING` and `ImportError`-guarded imports marked, `from __future__` skipped), classes, functions, methods, decorators, module-level names and literal `__all__`, and calls; dynamic imports are counted in its notices. `ndx sv pack add python` installs it. Its imports are not resolved yet, so Python files still get no edges, and without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Python project's `env`, `build` or `dist` directory is now skipped only when it is not a package: one holding `__init__.py` (poetry's `src/poetry/utils/env/`) is inventoried, while virtualenvs and build output are still skipped. This changes `inventory.json` for Python projects with such packages, whether or not the Python pack is installed; other projects are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java pack reads Spring Boot request routes and outbound calls (RestTemplate, WebClient, RestClient, Feign, `java.net.http`, Kafka, JMS, Rabbit, gRPC channels and `System.getenv`). With the pack installed, sourcevision records them in `components.json` server routes and `outbound.json`, reading them in the same parse as Java imports. lang-kit's outbound-call fact gains an optional `confidence`, and lang-runtime's framework-pack slot is implemented.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Terraform pack now reads Terraform. `@n-dx/lang-terraform` ships structure
  queries and an in-memory model of resources, data sources, module calls, provider
  requirements, the backend, variables, outputs, locals and references. Its pack entry
  produces `resources` facts.
  
  `@n-dx/lang-kit` now lists `resources` as a produced fact kind. `ResourceFact` gains
  optional `module`, `provider`, `references` and `attributes` fields. The attributes
  are engine, engine version, runtime, image and cluster version, each kept exactly as
  written, except when the optional `instance` field is set: then an attribute may hold
  the value resolved through that module instance rather than the value as written.
  `instance` carries the call path, the root call site and, per resolved attribute, the
  `written` expression, its `confidence` and the `from` location. A resource gets one
  fact per distinct resolution. `@n-dx/lang-runtime`'s `createPackEntry` takes a
  `projectFacts` reader for fact kinds that need the whole project.
  
  In a Terraform-first repository, Terraform files under `tests/` or `test/` and
  `.tftest.hcl` files now get the test role. Repositories led by any other language
  keep their roles.
  
  With the Terraform pack installed (`ndx sv pack add terraform`), Terraform
  resources that `infrastructure.json` already lists gain optional fields: `module`
  (the module call path, absent in a root module), `provider` (`{ name, version? }`,
  the version constraint as written), `references` (ids of listed resources in the
  same module directory) and `attributes` (`engine`, `engineVersion`, `runtime`,
  `image`, `clusterVersion`). Values are as written; an attribute set through a
  module call keeps its resolved value only when every instance agrees. No resource,
  link or seam is added or removed, and without the pack `infrastructure.json` is
  unchanged. The field names are proposals for review.
  
  Terraform database resources are now a database-engine candidate source alongside
  dependencies, images and config. Those candidates stay in memory and are not
  written to any analysis artifact.
