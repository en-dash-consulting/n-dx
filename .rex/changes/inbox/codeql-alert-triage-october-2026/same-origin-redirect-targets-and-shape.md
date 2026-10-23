---
id: "3983fd13-776b-4a52-b409-507b317cc847"
type: "task"
title: "Same-origin redirect targets and shape-validated LLM probe host and port"
slug: "same-origin-redirect-targets-and-shape"
description: "Layer 5 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 5). CodeQL alerts 38, 39 (js/server-side-unvalidated-url-redirection) and 23, 64 (js/request-forgery, critical by CodeQL's scale). splitTokenQuery in packages/web/src/shared/auth.ts returns req.url up to the query verbatim, and a request line of GET //evil.com/?ndx_token=T reaches req.url unchanged, so the token-cookie redirect in request-security.ts and hub/request-guard.ts can send the browser off-origin; it fires only when the presented token is correct, so the attacker already holds the credential. Fix: constrain the location to a same-origin absolute path (one leading slash, not followed by a slash or backslash), else /. The LLM probe endpoints in routes-llm.ts build http://host:port/v1/... from POST /api/llm/local-test and the stored local profiles with typeof-only checks; the feature is probing the LLM server the user configured and a LAN GPU box is supported, so no loopback allowlist. Fix the shape: isPlausibleLlmHost (URL round-trip, no slash, question mark, hash, at-sign, backslash or whitespace) and isValidPort (integer 1 to 65535) at every intake, answering 400, and the config-read probes returning an error object instead of fetching. A shape check does not satisfy the request-forgery query, so dismiss 23 and 64 as won't fix once this lands. Branch fix/web-redirect-and-llm-host."
acceptanceCriteria:
  - "A token-in-query request whose path is //evil.com/, http://evil.com/x or a backslash form redirects to / with the cookie set; /p/app/ still redirects to /p/app/"
  - "local-test and local-profiles answer 400 for a host holding a path, userinfo, a second port or whitespace, and for a non-integer or out-of-range port; localhost, 127.0.0.1, a bracketed IPv6 literal and a LAN hostname are still accepted"
  - "Patch changeset for @n-dx/web"
priority: "medium"
source: "codeql-triage"
---
