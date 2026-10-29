---
id: "e1559fb6-7446-43a3-801b-edd47b1e2078"
type: "change"
title: "Add the repository-trust constraint to the product layer"
slug: "add-the-repository-trust-constraint-to"
intent: "The security stack (#816, #817) closes ways an untrusted checkout could widen what n-dx runs or which credentials reach a child process (#686, #635). The product layer had no node for that rule: the Security & Data Safety epic was dissolved by the v2 migration, so its changes sit in the Inbox. This policy change adds the rule as a constraint under Hench, so the open security changes can be placed on it. Wording approved by Ryan on 2026-10-27."
amends: [{"target":"1bb0333a-d834-4e68-81d6-d728c2f8fcef","delta":"added","summary":"Add the repository-trust constraint","proposed":"Until the user accepts a checkout's execution config with `ndx trust accept .`, nothing the repository ships may widen what n-dx runs, the binaries it spawns, the paths the agent may write, where credentials are sent, or which credentials reach a child process. That covers config files, marker files, PRD content, binary paths and endpoints. Repository content can only tighten the user's defaults.","under":"4fc05c48-48b0-4da3-8126-4fa237b924d9","title":"Untrusted repository content cannot widen what n-dx runs or which credentials reach a child process","type":"constraint","appliesTo":"all"}]
priority: "high"
discoveredFrom: {"item":"5d6f42fa-0b0a-4dfd-b87e-2dbe2f068a62"}
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
---
