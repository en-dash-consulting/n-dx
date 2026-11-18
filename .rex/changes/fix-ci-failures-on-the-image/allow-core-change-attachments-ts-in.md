---
id: "60218746-fbc5-4786-9452-a1af5a2e1fa1"
type: "task"
title: "Allow core/change-attachments.ts in the rex v2 isolation test"
slug: "allow-core-change-attachments-ts-in"
description: "packages/rex/tests/unit/schema/v2.test.ts 'no runtime module imports the v2 modules yet' fails with ['core/change-attachments.ts'] because it imports store/prd-model-reader.js. Add it to the v2Files set and extend the comment above it with why (attachments live in a v2 change's folder, which only the reader can locate)."
acceptanceCriteria:
  - "rex test 'no runtime module imports the v2 modules yet' passes"
priority: "high"
source: "ndx-capture"
---
