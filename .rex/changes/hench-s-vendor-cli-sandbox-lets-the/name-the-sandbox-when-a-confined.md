---
id: "98d792a5-7fc5-4883-a0e3-3090c24c0a59"
type: "task"
title: "Name the sandbox when a confined Claude CLI cannot sign in, and keep the task pending"
slug: "name-the-sandbox-when-a-confined"
summary: "When the sandbox stops the Claude CLI from signing in, say so instead of telling the operator their login expired, and do not shelve the task."
description: "Today a confined run whose CLI prints 'Not logged in · Please run /login' or 'Authentication failed … Invalid or expired credentials' ends with the unclassified verdict (\"No recorded signal explains this run's failure.\") and the task is set to deferred. Make the vendor-auth signal reach classifyRun (packages/hench/src/agent/analysis/run-verdict.ts: VENDOR_CATEGORIES already has \"auth\" and a re-authenticate action), so these outputs classify as auth. When the run was confined (sandbox posture \"confined\"), the verdict summary says the sandboxed CLI could not read its login and names the operator's options (a CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or NDX_SANDBOX=off), and its action is not re-authenticate. An auth-class failure, confined or not, leaves the task pending, never deferred: the task did nothing wrong."
acceptanceCriteria:
  - "A run whose CLI output contains 'Not logged in' or 'Invalid or expired credentials' classifies as the auth vendor class, not unclassified"
  - "For a confined run, the verdict summary names the sandbox as the likely cause and suggests CLAUDE_CODE_OAUTH_TOKEN or NDX_SANDBOX=off"
  - "For an unconfined run, the verdict keeps the existing re-authenticate action"
  - "After an auth-class failure the task's status is pending, not deferred, and no failureReason blames the task"
  - "Unit tests in run-verdict cover the confined and unconfined auth cases"
priority: "high"
tags:
  - "hench"
  - "sandbox"
  - "run-verdict"
source: "ndx-capture"
---
