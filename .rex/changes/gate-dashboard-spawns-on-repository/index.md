---
id: "a7168cf9-9cbb-4f6a-bcfe-c2bfa346661a"
type: "change"
title: "Gate dashboard spawns on repository trust"
slug: "gate-dashboard-spawns-on-repository"
intent: "The dashboard spawns executables and scripts resolved from repository content (node_modules/.bin CLIs, tracked cli paths, package.json scripts, the pair-programming test command) without consulting evaluateRepoTrust, several on automatic GETs. Resolve CLIs from the server's own install and gate every repo-derived spawn on trust. Also add the missing response headers and confine /data."
acceptanceCriteria:
  - "CLIs are resolved from this server's own module graph or NDX_CLI_PATH, never from the analyzed project's node_modules/.bin"
  - "Every route whose binary or argv derives from repository content, and ndx pair-programming's test command, checks evaluateRepoTrust(projectDir).restricted and refuses with a message naming ndx trust while restricted"
  - "Side-effect GET routes (commands manifest, auth, init preflight, LLM catalog and local-status, ndx-config) call isForeignSiteRequest, and /api/commands/auth becomes a POST"
  - "/data/* serves only the known data-file set as JSON or plain text with X-Content-Type-Options: nosniff and is realpath-confined inside .sourcevision; X-Frame-Options: DENY and a CSP are set on every response; the hub proxy forwards an untrusted Origin unchanged"
touches:
  - "6f8afa48-7f03-4faa-82de-81af5c7db69e"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "8a92c826-c075-4e0b-8140-96c8b46f385c"
---
