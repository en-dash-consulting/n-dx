---
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-terraform": patch
"@n-dx/sourcevision": patch
---

The Terraform pack now reads Terraform. `@n-dx/lang-terraform` ships structure
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
