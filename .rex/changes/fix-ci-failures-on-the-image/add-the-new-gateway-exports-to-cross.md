---
id: "9a92e145-bb91-4061-85d6-d444a9233e2c"
type: "task"
title: "Add the new gateway exports to cross-package-contracts.test.js"
slug: "add-the-new-gateway-exports-to-cross"
description: "tests/integration/cross-package-contracts.test.js fails 'gateway export auto-detection': the hench rex-gateway list lacks listAttachments (line ~913) and the web rex-gateway list lacks attachImages and AttachmentError (line ~1083). Add them to the GATEWAY_FUNCTIONS/GATEWAY_CONSTANTS lists for each gateway, classifying AttachmentError as the other error classes there are classified."
acceptanceCriteria:
  - "Both 'gateway source exports match contract test list' tests pass"
priority: "high"
source: "ndx-capture"
---
