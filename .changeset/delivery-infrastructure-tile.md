---
"@n-dx/web": patch
"@n-dx/core": patch
---

The Analyze dashboard and the Overview page gain a Delivery & infrastructure panel. It shows the SDLC readiness score from `readiness.json`, with each practice's score (tests, CI, CD, rollback, migrations, feature flags, quality gates, observability, agent safety), and the resources in `infrastructure.json` counted by kind. Opened, it lists each practice's evidence and gaps and every resource with the file that declares it. When an analysis has not written either file, it says to run `ndx analyze`. `ndx export` now copies both files, so a static dashboard shows the panel too.
