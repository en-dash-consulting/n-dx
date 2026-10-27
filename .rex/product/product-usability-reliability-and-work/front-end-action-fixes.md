---
id: "6d2c0c1c-9ac7-4aef-932f-c0b76f1407ff"
type: "capability"
title: "Front-End Action Fixes"
slug: "front-end-action-fixes"
statement: "The front-end action controls start the supported N-DX operations they name, explain failures to the user, and disable or clearly label actions that are unavailable or unsupported."
criteria: [{"id":"c1","text":"When a user triggers a supported front-end action, the UI shall start the expected N-DX operation."},{"id":"c2","text":"If a front-end action fails, the UI shall display an error that lets the user understand what went wrong."},{"id":"c3","text":"While a front-end action is unavailable or unsupported, the UI shall show its control as disabled or clearly labeled as such."}]
priority: "high"
---

Type: Bug. Fix front-end actions that do not reliably execute expected N-DX operations.

User Story: As an N-DX user, I want front-end action buttons to work correctly, so that I can run supported actions from the UI.

Acceptance Criteria:
- Given a user selects a supported front-end action, when the action is triggered, then the expected operation starts.
- Given an action fails, when the error is displayed, then the user can understand what went wrong.
- Given an action is unavailable or unsupported, when the UI is displayed, then the control is disabled or clearly labeled.

Notes: Examples discussed included actions such as recommend, plan, or related UI commands, but exact failing actions need validation.
