---
"@n-dx/hench": patch
---

`.run-logs/` now gets its own `.gitignore` (`*`) when hench creates it. Before this, on a project's first run the live log was visible to git before the project `.gitignore` line was added, so `--review` committed it as a review repair and an agent's `git add -A` staged it.
