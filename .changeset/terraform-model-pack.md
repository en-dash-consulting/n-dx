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
written. `@n-dx/lang-runtime`'s `createPackEntry` takes a `projectFacts` reader for
fact kinds that need the whole project.

In a Terraform-first repository, Terraform files under `tests/` or `test/` and
`.tftest.hcl` files now get the test role. Repositories led by any other language
keep their roles. Nothing is written to `infrastructure.json` yet.
