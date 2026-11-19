---
id: "b90af881-42e8-4b47-9805-57ab95fadde2"
type: "change"
title: "Remediate PR3 catalog probe caching and tier upgrade guidance"
slug: "remediate-pr3-catalog-probe-caching"
summary: "Keep model choices stable between selection and saving, and explain how to retain prior light and heavy models during an upgrade."
intent: "User-authorized on 2026-11-19: check and remediate actionable review comments on draft PR #1062. Two current unresolved should-fix threads are confirmed at remote head5920d1c0a8cce73a8e2807152a3b4fc40af09a27. https://github.com/en-dash-consulting/n-dx/pull/1062#discussion_r4631642537 identifies uncached Codex probes, duplicate concurrent app-server spawns, transient probe failures rejecting a previously offered live-only model, and lost failure reasons. https://github.com/en-dash-consulting/n-dx/pull/1062#discussion_r4631642555 identifies incomplete upgrade advice: llm.codex.model covers standard only, and preserving prior heavy/light tiers requires llm.tiers.codex.heavy / llm.tiers.codex.light (or llm.codex.lightModel). Execute only this corrective unit through actual checkout-local ndx work in the isolated checkout. Do not reopen completed PR3 tasks. Do not implement the PR9 custom-provider finding or propagate merges/restacks into other PRs without explicit direction. No merge/auto-merge."
acceptanceCriteria:
  - "Codex catalog probes use a bounded short-lived cache with single-flight coalescing so concurrent catalog/Prepare/save/launch lookups under the same effective identity start only one version/catalog probe and an offered live-only model remains consistently accepted while fresh."
  - "Cache identity and invalidation cover the effective configured/resolved binary, CLI auth mode, configuration fingerprint, account/auth-home change signals, environment/PATH and repository trust changes as applicable, without logging credentials or raw secret-bearing configuration. Config/account/binary changes must not serve stale identity results."
  - "Explicit refresh bypasses cached results; clearing or refreshing prevents older in-flight probes from repopulating or overwriting a newer identity result. Probe failures retain honest bounded fallback behavior and validateCatalogModel surfaces an actionable live.listing.reason rather than only not-in-catalog. Preserve supported explicit model pins, provider compatibility controls, and provenance/entitlement distinctions."
  - "Add meaningful regression coverage for repeated/concurrent hits, TTL expiration, refresh and config/account/binary invalidation/races, plus picker-to-save/launch acceptance of live-only models and actionable probe failures. Update stale cache docstrings."
  - "Update .changeset/codex-unpinned-defaults.md and the Codex defaults and upgrades section of docs/guide/configuration.md to state standard pin scope and provide exact light/heavy tier pin commands, including llm.tiers.codex.heavy and llm.tiers.codex.light or llm.codex.lightModel, so users can retain prior tier models and heavy reviewers. No automatic rewrites of settings or new effort plumbing."
  - "Scoped checks, required cli-dev and scheduler-startup suites, relevant builds/typechecks, scoped patch changeset, mandatory fresh Astra self-review and affected gate pass; let Hench claim/log/complete and atomically commit with final bare N-DX-Item attribution. Preserve all dirty work and do not merge."
touches:
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
discoveredFrom: {"item":"2331ee7c-5a4b-488e-8cab-82d4fe1506dc"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"maxTurns":200,"contextNotes":"Model rationale: heavy Astra for account/auth/binary-sensitive caching identity and async single-flight/refresh races; mandatory fresh heavy Astra review. Coordinator Sol medium verified. User authorized these two concrete PR3 comments only. Use this isolated checkout and checkout-bound MCP, never original-bound desktop Rex or shared PR9 checkout. Do not read/print credential contents; identity signals may use safe file metadata or bounded fingerprints, with no raw secrets in cache keys/logs. No subagents or nested Codex reviews: Hench launches fresh review. Report new findings without unapproved PRD capture. Keep normal n-dx sandbox.mode=on/network=allow and actual Codex workspace-write/approval never; do not use NDX_SANDBOX=off or bypass flags in this new clone. Honor host validation slot and two-worker cap. Validation fixture auth homes must be external disposable directories. The source branch predates PR6 effort plumbing: leave client effort defaults; record actual session settings. Read package instructions/release-notes skill, prefer existing modules and no gateway expansion. Run focused tests including pure/in-process cases under inner network-disabled confinement and required startup checks, changed web build/typecheck. Mandatory outer affected gate must actually execute listener-based coverage; honestly report any exclusions/OS sandbox limitations, do not clear truthful sandbox markers inside Codex. Write .hench-commit-msg.txt sentinel; do not manufacture completion or coordinator source fixes."}
tags:
  - "codex-parity"
  - "codex-parity-pr-3"
  - "approved"
  - "review-remediation"
source: "ndx-capture"
blockedBy:
  - "2331ee7c-5a4b-488e-8cab-82d4fe1506dc"
---
