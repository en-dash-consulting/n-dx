---
id: "236c361f-30e9-49dd-a4df-5dff93151b95"
type: "task"
title: "A credential stored before origin binding existed is still sent to whatever server its id names"
slug: "a-credential-stored-before-origin"
description: "From the review of 39667967 (run for 'bind a connection's stored credential to the server it was stored for', 35fa39ec1). connection:<id> values stored before the binding was introduced carry no bound origin, so they are sent to whichever URL the id names now. Options: bind on first successful use; or refuse an unbound credential and ask the operator to store it again; or migrate by binding to the URL configured at upgrade time."
acceptanceCriteria:
  - "An unbound stored credential is either bound on first use to the configured server or refused with a message naming the fix; it is never sent to a server it was not stored for after a URL change (test)"
priority: "low"
source: "ndx-adversarial-review"
---
