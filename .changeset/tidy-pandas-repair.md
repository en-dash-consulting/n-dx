---
"@n-dx/hench": patch
---

Ensure `--review` repairs reach the run's commit. The reviewer prompt now tells the reviewer to `git add` every file a must-fix repair touches, and after a review pass that reports `fixesApplied` the run restages tracked modifications (`git add -u`) before the commit prompt — so a repair the reviewer edited but never staged can no longer be dropped from the commit while the report claims it was applied.
