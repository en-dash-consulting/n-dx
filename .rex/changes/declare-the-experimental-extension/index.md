---
id: "82ba22fb-9601-4205-8b22-f9e8f10ec433"
type: "change"
title: "Declare the experimental extension contract as a standing requirement"
slug: "declare-the-experimental-extension"
intent: "PR #881 review: record the manifest, approval, dispatch and hub-sidecar contract in the product layer, with experimental stability until explicitly promoted."
acceptanceCriteria:
  - "The extension contract is declared in the public-surface policy and has standing product criteria."
amends: [{"target":"3a95f9ce-cc60-4ca1-a2f9-89cdbfc7f14d","delta":"added","summary":"Declare the experimental extension contract as a standing requirement","criteria":{"add":[{"id":"manifest","text":"Extensions declare an ndx.extension manifest whose apiVersion identifies the current experimental compatibility contract."},{"id":"approval","text":"Approval is bound to the installed copy, version and manifest; disabled or unapproved extensions cannot run or remain mounted."},{"id":"dispatch","text":"Built-ins take precedence; approved commands receive the documented environment, terminal signals, arguments and exit handling."},{"id":"sidecar","text":"Enabled sidecars mount under /x/<name>/ through an authenticated hub proxy, with per-launch authentication, revocation and parent-lifetime shutdown."}]},"proposed":"Separately installed extensions add CLI commands, hub sidecars and project links through a declared versioned contract and spawned processes, with explicit approval and no imports of extension code.","under":"9af1c83c-cf4d-4f8f-b343-6857cb6b66a6","title":"Experimental extension contract","type":"capability"}]
source: "pr-review"
---
