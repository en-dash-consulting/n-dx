---
id: "08464700-9955-4338-87b6-afea0646a6f8"
level: "feature"
title: "PR Build Pipeline and Cross-Platform CLI Validation"
status: "completed"
source: "smart-add"
startedAt: "2026-04-07T14:28:53.235Z"
completedAt: "2026-04-07T14:28:53.235Z"
acceptanceCriteria: []
description: "Extend the existing PR validation pipeline with additive cross-platform execution stages that run the same n-dx install and smoke-command flow in MacOS and Windows containerized environments, then verify parity against each other and against the repository's existing static expected responses and exit codes."
---

## Children

| Title | Status |
|-------|--------|
| [Add MacOS pipeline stage for ndx install-and-run smoke validation](./add-macos-pipeline-stage-for-d10a17.md) | completed |
| [Add Windows pipeline stage for ndx install-and-run smoke validation](./add-windows-pipeline-stage-for-1a72b5.md) | completed |
| [Implement cross-platform parity assertions for deterministic CLI responses](./implement-cross-platform-parity-e1319d.md) | completed |
