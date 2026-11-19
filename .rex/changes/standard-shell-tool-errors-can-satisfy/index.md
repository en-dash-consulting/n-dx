---
id: "90a9cc59-70d3-479a-a53c-4e4a412da942"
type: "change"
title: "Standard shell tool errors can satisfy the Sidecar provider probe"
slug: "standard-shell-tool-errors-can-satisfy"
intent: "Out-of-scope, medium severity. In the standard function_call_output path of packages/web/scripts/sidecar-provider-probe-checks.mjs:58, a shell error naming an unreadable snapshot beneath a directory named PR9_PROVIDER_HEADERS_HIDDEN satisfies the marker check. This substring check predates the custom protocol retry. The audited host trace uses the custom tool. Require unambiguous success evidence for each supported standard shell output format and retain a genuine success fixture."
acceptanceCriteria:
  - "A standard shell result reporting a failed snapshot read under a marker-named directory fails the isolation check."
  - "A regression test pairs the failed standard shell result with a genuine successful check for the same call ID."
touches:
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
