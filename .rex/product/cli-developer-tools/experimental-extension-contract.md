---
id: "3a95f9ce-cc60-4ca1-a2f9-89cdbfc7f14d"
type: "capability"
title: "Experimental extension contract"
slug: "experimental-extension-contract"
statement: "Separately installed extensions add CLI commands, hub sidecars and project links through a declared versioned contract and spawned processes, with explicit approval and no imports of extension code."
criteria: [{"id":"manifest","text":"Extensions declare an ndx.extension manifest whose apiVersion identifies the current experimental compatibility contract."},{"id":"approval","text":"Approval is bound to the installed copy, version and manifest; disabled or unapproved extensions cannot run or remain mounted."},{"id":"dispatch","text":"Built-ins take precedence; approved commands receive the documented environment, terminal signals, arguments and exit handling."},{"id":"sidecar","text":"Enabled sidecars mount under /x/<name>/ through an authenticated hub proxy, with per-launch authentication, revocation and parent-lifetime shutdown."},{"id":"drawer-tab","text":"An enabled extension may declare one Sidecar drawer tab; the hub serves it only through a frame key accepted on that extension's own /x/<name>/ paths, and the page never runs same-origin with a dashboard or the hub."}]
---

## History

- 2026-10-28 82ba22fb-9601-4205-8b22-f9e8f10ec433 added: Declare the experimental extension contract as a standing requirement
- 2026-11-03 1adb4370-bc12-4322-9e21-e375e70e2131 modified: Extensions can declare a Sidecar drawer tab served through a scoped frame key
