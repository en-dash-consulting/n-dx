---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Rank placement candidates for a change from rules (package and path mentions, title word overlap, file evidence against realized-by) and an optional text model on the new `prd.place` task class; the model counts as agreeing only when it picks the rules' top candidate.
