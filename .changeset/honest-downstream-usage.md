---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

`n-dx usage` and the Token Usage dashboard preserve incomplete Hench and Sourcevision measurements instead of presenting them as measured zero spend.

Sourcevision persists measurement completeness when finalizing analysis. Aggregate, model, command, time and budget reports retain missing usage diagnostics while counting recorded tokens once. Older manifests remain readable.
