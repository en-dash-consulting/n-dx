---
id: "71b2eac7-f338-4955-9bb9-7b0555f575ce"
type: "task"
title: "Architecture doc says an out-of-range ndxVersion exits 2; the code and user docs exit 1 with the Unknown command hint"
slug: "architecture-doc-says-an-out-of-range"
description: "Verdict: should-fix (doc). The Process contract bullet in docs/architecture/extensions.md says out-of-range ndxVersion exits 2; the same doc, docs/extensions/environment.md, versioning.md, the code and tests/e2e/cli-extensions.test.js:162 treat incompatible as Unknown command with a hint, exit 1. Fix: correct the architecture doc bullet."
acceptanceCriteria:
  - "docs/architecture/extensions.md states one exit behaviour for incompatible extensions, matching the code"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
