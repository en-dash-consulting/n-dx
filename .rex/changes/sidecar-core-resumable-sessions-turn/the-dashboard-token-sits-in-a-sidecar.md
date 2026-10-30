---
id: "5845d911-1724-41f8-8376-267f917a0fa0"
type: "task"
title: "The dashboard token sits in a Sidecar MCP config file the session's own Read tool can open"
slug: "the-dashboard-token-sits-in-a-sidecar"
description: "Verdict: should-fix (medium). Found by an adversarial review of story 04 (run 78b578bd).\n\nEvidence: writeBrokerMcpConfig (packages/web/src/server/sidecar/spawn-policy.ts) writes the broker's headers, including X-Ndx-Token, the per-user dashboard token, to <henchDir>/sidecar/<id>.mcp.json with mode 0600. The Sidecar's Claude CLI runs as the same user with Read, Grep and Glob enabled, and those tools are not limited to the working directory.\n\nScenario: a prompt-injected document asks the session to read .hench/sidecar/<id>.mcp.json. The token then lands in the session transcript (.hench/sidecar/<id>.jsonl) and in vendor-side session history. The model could also carry it into a draft_github_post body or a ledger entry. The session has no network tool, so it cannot use the token directly. But the token unlocks every dashboard route for any local client, and credential-injection C7 keeps such secrets out of a session's readable paths.\n\nReachable: every Sidecar session while ndx start runs with auth (the default).\n\nOptions:\n(a) Mint a per-session broker secret, have the request gate accept it only on /api/sidecar/sessions/<that id>/mcp, and write that secret instead of the user token. A leaked secret then grants only the calls the session can already make. Cost: a narrow, tested exemption in request-security.ts. Recommended.\n(b) Use the CLI's ${VAR} env expansion in the MCP config headers and pass the token through the child env, which the session cannot read without a shell. This depends on the CLI expanding variables for --mcp-config, which is unverified (see probe task 6a764d20).\n(c) Write the config outside every path the session can read. Not possible: Read has no path restriction under --tools."
acceptanceCriteria:
  - "the MCP config file a Sidecar session is spawned with contains no copy of the dashboard's per-user token"
  - "a request presenting a session's broker credential is refused on every route except that session's /mcp endpoint"
  - "a test asserts both"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sidecar"
source: "ndx-adversarial-review"
---
