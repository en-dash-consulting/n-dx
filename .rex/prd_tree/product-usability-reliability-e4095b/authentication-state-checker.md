---
id: "4e17b4f7-e45e-4d54-a720-db4591816850"
level: "task"
title: "Authentication State Checker"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "Type: Bug/Story. Detect authentication/session loss before commands continue and cause cascading failures.\n\nUser Story: As an N-DX user, I want authentication problems detected early, so that commands fail clearly instead of triggering cascading errors.\n\nAcceptance Criteria:\n- Given a user runs an N-DX command, when authentication is invalid or expired, then the system detects the issue before continuing.\n- Given authentication has failed, when the user receives an error, then the message explains how to re-authenticate.\n- Given authentication is valid, when commands are run, then execution proceeds normally.\n\nNotes: The transcript described session/auth loss causing downstream failures."
---
