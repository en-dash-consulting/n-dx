---
id: "b9d3a37a-9227-4a10-87ba-de286cec7fac"
level: "feature"
title: "Cross-repo meta-scan foundation: repo identity, persisted infrastructure, outbound dependencies, multi-source crossings"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "web"
  - "workspace"
  - "cross-repo"
  - "schema"
source: "ndx-capture"
acceptanceCriteria:
  - "`manifest.json` carries an optional `repo: { name, remoteUrl, remoteHost, remotePath, defaultBranch }`; `name` derives from the remote path when a remote exists and from the directory name otherwise, and analyses written before the field still pass `schema/validate.ts`."
  - "`infrastructure.json` and `outbound.json` are registered in `schema/data-files.ts` and written by every `sv analyze`; both analyzers are deterministic and make no LLM and no network call."
  - "The iso-map HTML is byte-identical for the existing fixtures before and after infrastructure discovery moves out of `export/iso-declared.ts`, and `scripts/build-iso-skill.mjs` is re-run rather than the generated skill script hand-edited, so `tests/e2e/iso-skill-drift.test.js` passes."
  - "Every cross-repo `ZoneCrossing` carries `source: \"npm\" | \"http\" | \"infra\"` plus evidence, and `sv workspace --status` prints edge counts broken down by source."
  - "A workspace fixture of two tiny members — where A calls B over HTTP via an env var and both read the same SQS queue declared in Terraform — produces all three edge sources, each with evidence."
  - "The sv section of `GET /api/status` reports `repo` from the manifest plus summary counts for `outbound` and `infrastructure`, and `readiness.overall` when that field exists or `null` when it does not."
  - "`ChildSnapshot` and `ProjectCard` in `packages/web/src/hub/overview.ts` carry the repo identity, and `hub/home.ts` shows repo name and remote host on each card; nothing else in the hub UI changes."
  - "Every sourcevision type and value web consumes passes through `packages/web/src/server/domain-gateway.ts` as a re-export with no logic; `packages/core` gains no imports; `tests/e2e/domain-isolation.test.js` and `architecture-policy.test.js` pass."
  - "`docs/architecture/iso-map-data-flow.md` documents the persistence move, `docs/packages/sourcevision.md` documents the new data files, and the stale lines in `docs/guide/mcp.md` claiming the multi-project hub has not landed are corrected."
  - "A changeset exists with patch bumps for `@n-dx/sourcevision` and `@n-dx/web` (scoped names only)."
description: "n-dx analyzes one repo at a time. Scanning many repos to see common patterns, discrepancies, and which repo calls which is impossible today for three reasons: analyses carry no stable repo identity, only the provider side of HTTP is detected (server routes) so consumers cannot be linked to producers, and infrastructure knowledge discovered from IaC lives only inside the generated iso-map HTML. This feature closes those three gaps and wires the hub to read per-project analysis. The portfolio UI is deliberately a later task.\n\nWhat already exists and must be extended rather than duplicated:\n- `cli/commands/workspace.ts` + `analyzers/workspace-aggregate.ts` + `analyzers/workspace-crossings.ts` already aggregate pre-analyzed repos listed under `workspace.members` in `.n-dx.json` and turn npm imports matching a sibling's package name into cross-repo `ZoneCrossing`s. That is the graph engine — add edge sources to it; do not build a second aggregator.\n- `export/iso-declared.ts` already discovers Terraform/CloudFormation resources (bucket, queue, topic, database, cache, stream, scheduler, secrets, compute), reads declared `injectionSeams` and `infrastructure` from `sourcevision.isoMap`, and links resources to zones by name literals. The logic is correct; it is simply unpersisted.\n- `analyzers/server-route-detection.ts` and `go-route-detection.ts` produce inbound `ServerRoute` entries. Mirror their shape for outbound.\n- The hub (`packages/web/src/hub/`) keeps its registry in `~/.ndx/hub.json` and `overview.ts` fans out to each child's `/api/status` via `fetchChildSnapshot`. The hub must keep never reading `.sourcevision/` directly — new data reaches it through the child's HTTP API.\n- `export/iso-sources.ts` already reads the git remote origin; the new repo-identity derivation shares that one helper rather than adding a second.\n\nOut of scope here, captured as follow-ups rather than items: the portfolio/comparison UI; discrepancy rules (the same concern solved differently across repos); Python/Rust/Java outbound detection; scanning repos that are not checked out locally; anything hosted.\n\nOpen questions to settle during the work: how to match env-var names to producers reliably, and what confidence threshold a cross-repo crossing should require before it is drawn."
lastModified: "2026-10-05T17:34:45.604Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add http and infra edge sources to workspace crossings](./add-http-and-infra-edge-sources-to.md) | pending |
| [Add repo identity to the analysis manifest](./add-repo-identity-to-the-analysis.md) | pending |
| [Detect outbound dependencies for JS/TS and Go into outbound.json](./detect-outbound-dependencies-for-js-ts.md) | pending |
| [Expose repo identity and scan counts through the child API and hub cards](./expose-repo-identity-and-scan-counts.md) | pending |
| [Persist IaC discovery as infrastructure.json and have the iso export read it](./persist-iac-discovery-as.md) | pending |
