---
id: "5392be41-1f99-42d2-8f70-fe6185663517"
type: "change"
title: "Define OS-agnostic CLI error code taxonomy"
slug: "define-os-agnostic-cli-error-code"
intent: "Introduce a stable set of unique error codes for comparable failure classes so macOS and Windows smoke runs can be matched by semantics instead of platform-specific text output."
acceptanceCriteria:
  - "Each cross-platform-comparable CLI failure class has a unique, stable error code"
  - "The same logical failure produces the same error code on macOS and Windows"
  - "Human-readable error output includes the code alongside the existing diagnostic message"
  - "Unknown or uncategorized failures fall back to an explicit generic code path rather than omitting a code"
touches:
  - "08464700-9955-4338-87b6-afea0646a6f8"
priority: "critical"
tags:
  - "ci"
  - "cli"
  - "cross-platform"
  - "diagnostics"
source: "smart-add"
---
