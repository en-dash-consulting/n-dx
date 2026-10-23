---
id: "47b55bf8-f68b-48c0-b7bb-c469ff552436"
type: "change"
title: "Document error code meanings and remediation expectations"
slug: "document-error-code-meanings-and"
intent: "Provide a maintained reference for the new error codes so engineers can interpret smoke failures quickly and understand which issues are intended to compare across platforms."
acceptanceCriteria:
  - "Documentation lists each exported cross-platform error code with its failure meaning"
  - "The docs explain which artifact fields are parity-critical versus OS-specific"
  - "Contributor guidance describes how to assign a code for newly introduced comparable failures"
  - "CI or test coverage fails if a newly emitted comparable error code is missing from the reference list"
touches:
  - "4ee969d6-cb9e-41c1-85ac-f79b3b6a6ac3"
priority: "high"
tags:
  - "docs"
  - "diagnostics"
  - "ci"
  - "developer-experience"
source: "smart-add"
---
