---
"@n-dx/web": patch
---

The LLM catalog reports a saved `llm.local` host or port that fails the shape check as `needs-setup`, with the shape error as the vendor card's line, instead of claiming "Not reachable" for a server the probe never contacted. `routes-workflow.ts` drops its private copies of the guarded config path helpers and the forbidden-segment set in favour of the shared ones in `hench-config-fields.ts`. The error-message policy test now sees `String(e as Error)`, `${err}`, `err.toString()`, other catch-variable names and the ternary wrapped across lines.
