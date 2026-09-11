---
id: "99467cbb-8f9d-4b98-8ac5-42194729aa09"
level: "task"
title: "Gemini provider sends the API key in the URL query string"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:low"
  - "llm-client"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "No URL built by `google-api-provider.ts` contains `key=`"
  - "All Gemini fetch calls set the `x-goog-api-key` header"
  - "Existing Google provider tests pass; a test asserts the request URL has no `key` query parameter and the header is present"
description: "**Severity:** low · **Verdict:** should-fix\n\n**Failure scenario.** Every Gemini request is built as `…/models/<model>:generateContent?key=<API_KEY>` (`buildUrl`) and auth validation hits `…/models?key=<API_KEY>`. Query strings are recorded by HTTP proxies, corporate egress logs, any `NDX_DEBUG` URL logging added later, and appear in error `cause` chains from some fetch implementations. Google supports the `x-goog-api-key` request header, which keeps the key out of the URL. Node's own `fetch failed` error message does not include the URL (verified), so the exposure today is via infrastructure logging rather than n-dx output.\n\n**Evidence.** `packages/llm-client/src/google-api-provider.ts:287-290` (`buildUrl`), `:425` (`validateAuth`).\n\n**Reachability.** Every Gemini call, for users behind a logging proxy.\n\n**Solution.** Send `x-goog-api-key: <key>` as a header on all three fetch sites and drop `?key=` from the URLs. Trivial; no behaviour change."
lastModified: "2026-09-11T17:38:01.851Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
