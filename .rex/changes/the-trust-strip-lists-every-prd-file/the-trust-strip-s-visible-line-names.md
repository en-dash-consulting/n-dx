---
id: "6c7e1f04-9a07-4c59-8287-83ebe13c08c6"
type: "task"
title: "The trust strip's visible line names the config files and counts PRD items; the source list moves under Details"
slug: "the-trust-strip-s-visible-line-names"
description: "packages/web/src/viewer/components/repo-trust-strip.ts `buildTrustNotice` prints every entry of `view.sources` in the always-visible detail line. The previous task groups the PRD run blocks into one source entry at the assessment (llm-client `collectRepoExecutionConfig`), but the strip must stay compact whatever the server sends (an older server, or many config files).\n\n- The always-visible line names at most a few config sources (e.g. `.n-dx.json`, `.hench/config.json`) and summarises the rest as a count, e.g. 'and 214 PRD items with saved run settings' or '+N more'. Hard-cap its length.\n- The full source list moves under 'Details', next to the findings, collapsed by default (rendered only when Details is open). Showing a capped number with a '+N more' line is fine.\n- Return the sources for the Details list from `buildTrustNotice` (e.g. a `sources` field on RepoTrustNotice) so it stays the pure, tested computation; keep the exported type names.\n\nTests in packages/web/tests/unit/viewer/repo-trust-strip.test.ts: a view with 300 PRD sources (one path per file, as the old server sent) keeps `headline + detail` under a fixed length (e.g. 400 characters); the sources appear only after Details is opened; the existing tests keep passing (update the '(.hench/config.json, .mcp.json)' expectation only if the wording changes).\n\npackages/web/src/viewer/styles/repo-trust.css holds the strip's styles; the next task caps the strip's height, so keep layout changes here to what the new list needs. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from packages/web/src/viewer/styles/tokens.css, in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md; do not change what is trusted or restricted, the trust digest, or the 'Not now' behaviour (it hides the strip for one page load, by design for now); run the static root policy suites (tests/e2e/architecture-policy, domain-isolation) before finishing; add a `@n-dx/web` patch changeset."
acceptanceCriteria:
  - "With 300 PRD sources the strip's visible text stays under a fixed length (viewer test)"
  - "The full source list shows only under Details, collapsed by default (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "f7cdcaab-b2f2-4495-8c98-e62e27e4e3dd"
---
