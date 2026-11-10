---
id: "6155c788-bef0-4fc6-be96-d7107e0dcfa8"
type: "task"
title: "Plan in this area keeps the Sidecar on the old area after the area view closes or another area opens"
slug: "plan-in-this-area-keeps-the-sidecar-on"
description: "Scenario: on Plan, open area A in the Product tile and press \"Plan in this area\". Then close the tile and open area B, or select a capability in A. The Sidecar stays on the Plan lens for area A. B's Explain item, or the capability, never attaches until the operator leaves the Plan page.\n\nCause: in main.ts, `planWith` is cleared only when the page view changes. pageItemFor (use-sidecar-attachment.ts) ranks `page.plan` above `page.areaView`. The capture bar's area-scoped \"Plan with Sidecar\" from SP4 has the same shape.\n\nReachable: yes, through the Plan page's Product tile.\n\nVerdict: should-fix. The operator can reattach by leaving the page, so no data is at risk.\n\nOptions:\n(a) Clear planWith (and any waiting planText) when the area view reports a different area or null. reportArea in main.ts is the one place for it. Cheap, but it would also cut short a capture-bar plan whose text is still waiting.\n(b) Clear planWith only once its first turn is sent, so the explicit request lasts one turn. This changes SP4's semantics.\nRecommend (a), and drop planText only when the area changes."
acceptanceCriteria:
  - "After Plan in this area on area A, opening area B attaches B with the Explain lens"
  - "After Plan in this area, closing the area view no longer leaves area A attached with the Plan lens"
  - "A unit test covers the attachment after the area view reports a different area following planIn"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
