---
"@n-dx/llm-client": patch
---

Test workers drop git's command-line config and repository-location variables inherited from the host, so the bare-repository `listWorktrees` test passes when the suite runs from a shell that exports `GIT_CONFIG_PARAMETERS='safe.bareRepository=explicit'`.
