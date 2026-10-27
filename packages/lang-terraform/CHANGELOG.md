# @n-dx/lang-terraform

## 0.10.0

### Patch Changes

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the parser runtime (`@n-dx/lang-runtime`) and the Java, Go, SQL and Terraform language packs. sourcevision loads them at run time; the Go pack installs by default as an optional dependency.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The SQL grammar, its table query and the schema reader move into `@n-dx/lang-sql`, and the HCL grammar pin and build into `@n-dx/lang-terraform` (structure only; it produces no fact kinds yet). Both packs are opt-in and not wired into analysis. `@n-dx/sourcevision` ships no grammar or query. `@n-dx/lang-runtime`'s `build-grammars.mjs` now requires `--out`: each pack builds its own grammar with its `build:grammars` script.

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
- Updated dependencies [[`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2), [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4), [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03), [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676), [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a), [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e), [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74), [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f), [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413), [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b), [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5), [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73), [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92), [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6), [`7e3cded`](https://github.com/en-dash-consulting/n-dx/commit/7e3cdedf02eb5ac2ef6daeaa11e02e20ef8c8725), [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92), [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e)]:
  - @n-dx/lang-kit@0.10.0
  - @n-dx/lang-runtime@0.10.0
