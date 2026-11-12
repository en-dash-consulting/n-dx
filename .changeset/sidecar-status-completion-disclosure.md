---
"@n-dx/web": patch
---

Sidecar status cards (experimental, off by default; enable with `web.sidecar`) reject deletion and disclose completion effects before approval.

Deletion is also rejected when approving older deletion cards. V2 completion cards now disclose enclosing-change completion, product amendment apply policy and test-gate holds before approval. Completion continues through Rex's existing policy.
