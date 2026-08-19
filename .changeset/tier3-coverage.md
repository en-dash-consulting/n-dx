---
"@n-dx/web": patch
---

Close the remaining small coverage gaps: a new Activity view (REX → Activity) renders the PRD execution log with event filtering and search, Settings → General gains a credential status chip backed by `ndx auth`, the Runs view gains a token-reporting validation trigger, and the Export panel gains a PDF report control. A facet distribution view was scoped and deliberately skipped — facets are MCP-only and unconfigured in practice; the rationale is recorded in docs/cli-ui-gap.md.
