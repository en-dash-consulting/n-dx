---
id: "cd67dfc1-0053-43fd-8e4f-1722d6b6a982"
type: "change"
title: "Audit and remediate deprecated npm dependencies across all monorepo packages"
slug: "audit-and-remediate-deprecated-npm"
intent: "Run pnpm audit and inspect each package.json for npm packages marked as deprecated, unmaintained, or superseded across packages/core, packages/rex, packages/hench, packages/sourcevision, packages/llm-client, and packages/web. Produce a prioritized remediation list distinguishing direct from transitive hits and flagging CVEs, then execute: upgrade packages with semver-compatible replacements, swap deprecated packages for their published successors, and update all call sites where replacement APIs have changed. Verify the full test suite passes after each replacement."
acceptanceCriteria:
  - "pnpm audit output reviewed and all deprecation notices catalogued across all six packages"
  - "Each deprecated direct dependency has either been replaced or has a documented justification for deferral"
  - "Transitive-only deprecations are noted separately with no action required unless they surface a CVE"
  - "No direct dependency in any package.json resolves to an npm-deprecated package"
  - "pnpm audit reports zero high/critical advisories after upgrades"
  - "Full monorepo test suite (pnpm test) passes with no new failures introduced by replacements"
  - "Any breaking API changes in upgraded packages are handled at all call sites within the monorepo"
touches:
  - "f6c36dec-764a-4a56-adc7-cb11e66890c9"
priority: "high"
tags:
  - "dependencies"
  - "audit"
  - "upgrade"
  - "security"
source: "smart-add"
---
