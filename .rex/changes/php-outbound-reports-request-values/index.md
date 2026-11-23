---
id: "27c3c72f-f411-408f-a7fa-aa506c0b8b6a"
type: "change"
title: "PHP outbound reports request values read with getenv and a partial literal mysqli target"
slug: "php-outbound-reports-request-values"
summary: "Legacy PHP reads request details such as HTTPS and REQUEST_URI with getenv, and the analysis listed them as environment dependencies; a persistent mysqli connection showed the target \"p:\". Both make outbound.json misleading for the legacy repositories being consolidated."
intent: "Found by the operator's corpus check of PR 6 (change 38abed61): `sv analyze` on ~/.cache/ndx-php-corpus/oscommerce2/catalog with the worktree CLI. 15 of its env outbound calls are request values read through getenv (HTTPS, REQUEST_URI, PATH_INFO, HTTP_USER_AGENT, HTTP_ACCEPT_LANGUAGE, SSL_SESSION_ID), and both of its mysqli_connect calls report the literal target \"p:\". Ships in PR 6 of the PHP stack."
acceptanceCriteria:
  - "getenv of a request key is not an env outbound call, as $_SERVER already is not"
  - "A database target built from a literal and a value that is not computable is never reported as literal with the partial value"
touches:
  - "f49c3876-4fb7-45a0-8619-86b1cda30748"
priority: "medium"
source: "operator-corpus-check"
---
