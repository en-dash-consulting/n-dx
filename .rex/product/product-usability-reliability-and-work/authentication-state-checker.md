---
id: "4e17b4f7-e45e-4d54-a720-db4591816850"
type: "capability"
title: "Authentication State Checker"
slug: "authentication-state-checker"
statement: "N-DX checks authentication before a command continues and stops with a clear error when authentication is invalid or expired."
criteria: [{"id":"c1","text":"When a user runs an N-DX command and authentication is invalid or expired, N-DX shall detect the authentication failure before the command continues."},{"id":"c2","text":"If authentication has failed, N-DX shall show an error message that explains how to re-authenticate."},{"id":"c3","text":"While authentication is valid, N-DX shall run commands normally."}]
priority: "critical"
---

Type: Bug/Story. Detect authentication/session loss before commands continue and cause cascading failures.

User Story: As an N-DX user, I want authentication problems detected early, so that commands fail clearly instead of triggering cascading errors.

Acceptance Criteria:
- Given a user runs an N-DX command, when authentication is invalid or expired, then the system detects the issue before continuing.
- Given authentication has failed, when the user receives an error, then the message explains how to re-authenticate.
- Given authentication is valid, when commands are run, then execution proceeds normally.

Notes: The transcript described session/auth loss causing downstream failures.
