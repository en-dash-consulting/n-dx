---
id: "e134b60b-703b-424e-9f4a-5f4c1074ac67"
type: "task"
title: "Streamline core and the root scripts"
slug: "streamline-core-and-the-root-scripts"
description: "packages/core and scripts/: deduplicated config set/get, color through cli-brand, split runExport and runWeb, one pid probe, stale allowlist entries removed."
acceptanceCriteria:
  - "Typecheck and the affected packages' tests pass at this layer, with no test expectation changed"
source: "ndx-capture"
---
