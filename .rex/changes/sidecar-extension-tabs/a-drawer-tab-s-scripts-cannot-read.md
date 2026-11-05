---
id: "e6241dbf-f601-41e3-9fab-5761e940b71c"
type: "task"
title: "A drawer tab's scripts cannot read their own sidecar's API: the opaque-origin page needs CORS nobody tells extension authors about"
slug: "a-drawer-tab-s-scripts-cannot-read"
description: "Failure scenario: an extension's tab page, served at /x/<name>/~f/<key>/ with Content-Security-Policy: sandbox (no allow-same-origin) and loaded in a sandboxed iframe, runs fetch(\"api/data\") against its own sidecar. The page's origin is opaque, so the request is cross-origin with Origin: null; unless the response carries Access-Control-Allow-Origin, the browser hides it and the tab's app silently shows nothing. Navigations, forms and subresources work; script reads do not. Decided (Ryan's assistant, 2026-11-03, for Hal to confirm in the PR): the hub adds CORS on keyed responses, so an extension needs no change to work in a tab (§17: 'without any change to the extension'). On a keyed request whose Origin is exactly \"null\", the proxy sets Access-Control-Allow-Origin: null and Vary: Origin on the response, never Access-Control-Allow-Credentials (the key in the path is the credential; no cookie is involved). A keyed OPTIONS preflight with Origin: null is answered by the hub itself with 204, Access-Control-Allow-Origin: null, Access-Control-Allow-Methods echoing the requested method, Access-Control-Allow-Headers echoing the requested headers, and Access-Control-Max-Age: 600, without reaching the sidecar. Unkeyed /x/<name>/ responses are unchanged. Found by ndx-adversarial-review of task 4a463baa (verdict should-fix, severity medium)."
acceptanceCriteria:
  - "docs/extensions/hub-api.md \"Frame keys\" states that a tab page's own script requests arrive with Origin: null and what the sidecar must answer (or what the hub answers) for the page to read them"
  - "The fixture extension's tab page reads data from its sidecar with fetch through the keyed URL, and an e2e asserts the page received it"
  - "The decision between sidecar-owned CORS and hub-added CORS for keyed responses is recorded in the change's PR"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
