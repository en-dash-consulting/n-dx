---
id: "f5330af8-f470-4d06-bf27-55c21e9f2efc"
type: "task"
title: "Jev availability does not report an unrun helper as available"
slug: "jev-availability-does-not-report-an"
description: "Should-fix from the #952 review. jevAvailability in packages/llm-client/src/credential-store.ts calls credentialStatus without check, so a helper entry always yields source 'helper' and available: true. With op locked or missing, analyze falls back to the text model while manifest.lastAnalysis.jev records { available: true, source: 'helper' }, and ndx status and rex get_capabilities say 'available (helper)'. The schema comment in sourcevision/src/schema/v1.ts says the field records whether Jev's key resolved. Fix: for status and capabilities (no helper may run), report a distinct unverified state for helpers; for the manifest, record whether the key actually resolved during the analysis."
acceptanceCriteria:
  - "ndx status and rex get_capabilities distinguish a helper entry that was not run from a resolved key, and still run no helper"
  - "manifest.lastAnalysis.jev records available false when the helper failed during the analysis"
  - "Old manifests still validate"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
  - "sourcevision"
  - "rex"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
