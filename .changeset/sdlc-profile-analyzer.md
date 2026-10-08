---
"@n-dx/sourcevision": patch
---

Build the sdlc-profile analyzer, and write `sdlc-profile.json` on every analyze.

`analyzers/sdlc-profile.ts` discovers what a repository can actually do — its commands, CI pipelines with classified jobs and steps, deployments, containers, migrations, quality gates, test suites, observability and feature flags — each claim carrying the file that proves it.

It walks for itself rather than reading the inventory, because the `codeOnly` filter drops the YAML, TOML and Dockerfiles it needs and widening it would pollute zone detection. `inventory.ts` is untouched; its `IgnoreFilter` is reused so there is no second `.gitignore` interpreter. The walk is bounded on depth, file count and per-file size, and each bound is covered by a test.

The four CI dialects share one small YAML-subset parser rather than four line scanners. It refuses anchors, aliases, merge keys, tags and multi-document streams instead of returning a half-read document — a job silently missing its steps would read downstream as "this project does not test".

A recognised file that cannot be read is recorded in a new `parseFailures` section with its path, so "no CI is configured" and "CI is configured and unreadable" stay distinguishable. `SdlcCiPipeline.jobs` now carries jobs with their steps rather than job names, which the schema as first declared could not express.

Deterministic throughout: no LLM call, no network, no clock, and two runs over an unchanged tree produce byte-identical output.
