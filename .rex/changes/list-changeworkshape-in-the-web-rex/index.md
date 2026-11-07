---
id: "723bade3-7910-4c28-a1f4-90637ad9ea55"
type: "change"
title: "List changeWorkShape in the web rex-gateway contract test"
slug: "list-changeworkshape-in-the-web-rex"
intent: "Follow-up to change c1cea4f6 (P1, PR #1002). tests/integration/cross-package-contracts.test.js fails 'web rex-gateway source exports match contract test list' on this branch: packages/web/src/server/rex-gateway.ts exports changeWorkShape (added in 689729e63, a change with no tasks runs as one task on the dashboard), but the web -> rex gateway contract list does not name it. Add changeWorkShape to that list, with a one-line comment (Ready to run shows a change with no tasks as one task), and to the web gateway's list in the 'gateway export auto-detection' block of the same file, matching how the other exports are listed. Test-file change only: no product code and no gateway change. Run that test file to confirm. Add no changeset, because this touches tests only. Do not write under .claude/."
acceptanceCriteria:
  - "tests/integration/cross-package-contracts.test.js passes on this branch"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
discoveredFrom: {"item":"c1cea4f6-bf60-4e78-a038-49994901772f"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
