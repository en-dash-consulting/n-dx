---
id: "07e4564e-e181-42c1-be5a-20a16c8d2649"
level: "feature"
title: "Auth Failure Detection and Re-Authentication Guidance"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "When an LLM provider preflight or runtime call returns a 401 or authentication error, ndx currently dumps the raw CLI JSON payload to the console. This feature adds structured detection for auth failures across all providers, maps them to a typed error, and replaces the raw-JSON dump with a concise, actionable message telling the user exactly which provider failed and what commands to run to fix their credentials."
---

## Children

| Title | Status |
|-------|--------|
| [Add ndx auth check command and credential verification surface](./add-ndx-auth-check-command-and-87c4d2.md) | pending |
| [Classify 401 and authentication errors from LLM provider preflight as a distinct typed error](./classify-401-and-authentication-4be48f.md) | completed |
| [Surface concise re-authentication guidance when provider auth fails](./surface-concise-re-86607f.md) | pending |
