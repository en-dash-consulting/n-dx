---
id: "1412df6f-8627-464d-ae2e-cb49371c3074"
type: "task"
title: "Two projects using the same connection id share one connection:<id> credential and refuse each other's binding"
slug: "two-projects-using-the-same-connection"
description: "From the review of 39667967. connection:<id> lives in the per-user store, so two projects that both declare id 'caos' at different URLs share one entry; with origin binding, the second project's connection is refused. Options: scope the credential name by origin (connection:<id>@<origin>) or by project; or document one id per server per user and name the conflict in Settings."
acceptanceCriteria:
  - "Two projects declaring the same connection id at different servers each connect with their own credential, or Settings names the conflict and how to resolve it (test)"
priority: "low"
source: "ndx-adversarial-review"
---
