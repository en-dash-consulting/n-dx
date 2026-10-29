---
id: "3741f9ad-9493-4699-ac48-a16bda3a1ebe"
type: "change"
title: "The Codex CLI and shell commands cannot write n-dx's own config files"
slug: "the-codex-cli-and-shell-commands"
intent: "Follow-up to 208cd8c3. hench's guard now refuses NDX_CONFIG_BLOCKED_PATHS (.n-dx.json, .n-dx.local.json, .ndx/config*.json, .mcp.json, .claude/**, .codex/**) and the Claude CLI is spawned with --disallowed-tools Edit(...) rules for them. Two routes remain: (1) provider=cli with Codex: `codex exec` has no per-path deny (workspace-write only adds writable roots), so the spawned Codex agent can still write .n-dx.local.json; (2) an allowed command (node, npm, Bash(node:*) under Claude) can write any file, bypassing both the guard's path check and Claude's Edit rules. Candidate: a vendor-neutral backstop that snapshots the config files before each agent spawn and, after it, restores them and fails the task when any changed, before the completion test gate reads them."
acceptanceCriteria:
  - "A Codex CLI run whose agent writes .n-dx.local.json leaves the config the next command and the test gate read unchanged, and the run reports it"
  - "A shell command that writes a protected config file under any provider has the same outcome"
  - "Test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"208cd8c3-6262-4cfd-8602-be4fa1e5bb45"}
tags:
  - "security"
  - "ndx-adversarial-review"
---
