---
id: "9156347e-7193-4d2e-9108-635e9e3705ad"
type: "task"
title: "rex validate flags stale release plans"
slug: "rex-validate-flags-stale-release-plans"
description: "Add a v2 rule to checkV2Rules (rex/src/schema/v2-rules.ts or the rule module that owns release checks): warn for each open change whose plannedRelease is a release some change carries as shippedIn, or is older by semver than the newest shipped release. Report it through rex validate (CLI) and MCP health/validation with the change ids and releases. Changes with no plannedRelease are never flagged. A warning, not an error."
acceptanceCriteria:
  - "An open change planned for a release that another change shipped in is reported"
  - "An open change planned for a release older than the newest shipped release is reported"
  - "An open change with no planned release, and an applied change, are not reported"
  - "The finding appears in rex validate output and in the MCP health response, as a warning"
priority: "medium"
source: "ndx-capture"
---
