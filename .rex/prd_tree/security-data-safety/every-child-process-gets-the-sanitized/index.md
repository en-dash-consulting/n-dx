---
id: "82468601-c666-4943-a9ac-b11bb0149372"
level: "feature"
title: "Every child process gets the sanitized environment"
status: "pending"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #686 (finding 3) and #635"
  - "Each fix has a test that fails on the code before the fix and passes with it"
description: "Layer 2 of 2 for the security findings: #686 finding 3 (the test gate, post-task tests and dependency audit inherit the unsanitized parent environment) and #635 (the vendor CLI credential filter keeps credentials only for Claude's Bedrock and Vertex modes). Both still reproduce on origin/main 9f6a0e963, re-checked 2026-10-16 against the built code. Branch fix/security-child-env, stacked on layer 1 (fix/security-repo-trust); PR title \"Every child process gets the sanitized environment (security 2/2)\", which closes #635. Hal (Sterling H) wrote the vendor credential filter (#615, #623, #658) and reviews this layer. Credential names and values stay out of logs, PR text and test snapshots: tests use sentinel values and assert on presence, never print them."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:50:08.173Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A repository's .n-dx.json can choose which environment variable is sent as the Google API key, and where it is sent](./a-repository-s-n-dx-json-can-choose.md) | completed |
| [A repository's .n-dx.json cli_path chooses the binary ndx auth and ndx work run, while the repository is untrusted](./a-repository-s-n-dx-json-cli-path.md) | completed |
| [hench's .hench/config.json claudePath and the dashboard's codex --version probe choose a binary while the repository is untrusted](./hench-s-hench-config-json-claudepath.md) | pending |
| [hench's missing-credentials message tells a Codex env_key user the CLI falls back to default credential files](./hench-s-missing-credentials-message.md) | pending |
| [ndx auth's Google preflight reads llm.google.apiKeyEnv from the untrusted project config](./ndx-auth-s-google-preflight-reads-llm.md) | completed |
| [ndx config --test-connection sends the Claude API key to an untrusted project's api_endpoint](./ndx-config-test-connection-sends-the.md) | completed |
| [ndx init runs an untrusted repository's .n-dx.json cli.claudePath to probe the Claude CLI](./ndx-init-runs-an-untrusted-repository.md) | pending |
| [One sanitized-environment builder for every repository-command subprocess: tests, gate, audit and rex](./one-sanitized-environment-builder-for.md) | completed |
| [repoCommandEnv finds the trust store from the real process environment, not the one it filters](./repocommandenv-finds-the-trust-store.md) | pending |
| [The agent's shell keeps a repository-supplied guard.env.allow while the repository is untrusted, unlike repository commands](./the-agent-s-shell-keeps-a-repository.md) | pending |
| [The pair reviewer's shell test command honours a repository-supplied guard.env.allow in an untrusted checkout](./the-pair-reviewer-s-shell-test-command.md) | pending |
| [Vendor CLI environments keep each vendor mode's credentials from one mode table](./vendor-cli-environments-keep-each.md) | completed |
