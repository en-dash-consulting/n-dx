---
"@n-dx/web": patch
---

Settings pages render immediately instead of waiting for the analysis data to load, so Robot Wrangler, Project, Workflow and Commands no longer sit blank on a busy repository. Robot Wrangler's stylesheet now uses the dashboard's defined design tokens, which restores its spacing, surfaces and the Automatic failover toggle track. A test now fails on any undefined design token used without a fallback.
