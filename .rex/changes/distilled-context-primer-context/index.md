---
id: "3ca4e4da-6a00-4139-a413-872c9d482702"
type: "change"
title: "Distilled context primer (context.distill) replacing the untrimmed CONTEXT.md pipe"
slug: "distilled-context-primer-context"
intent: "Replace ndx work's untrimmed CONTEXT.md + full-PRD-tree pipe with a distilled 5-10 KB repo primer produced by a context.distill call and cached by sourcevision content hash. This is the vendor-neutral startup-context floor from the design: it works for every provider and every session strategy, unlike forking which needs a resume-capable CLI. The task class already exists in DEFAULT_ROUTES (standard tier). Cache invalidation should reuse the sourcevisionFingerprint helper already built for the session cache."
acceptanceCriteria:
  - "A context.distill call produces a primer within a stated size bound from sourcevision output"
  - "The primer is cached and reused until the sourcevision fingerprint changes"
  - "ndx work injects the primer instead of the full CONTEXT.md plus PRD tree"
  - "A distill failure degrades to the previous behaviour rather than failing the run"
  - "The primer covers layout, build and test commands, and conventions"
touches:
  - "eda61028-981e-4196-9555-8100e9e65ebf"
priority: "medium"
tags:
  - "hench"
  - "sourcevision"
  - "context"
  - "model-routing"
source: "ndx-work"
---
