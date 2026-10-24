---
id: "cccefd80-a8f7-4add-97cb-170f28008950"
type: "task"
title: "A wrong Gemini key is classified as an auth error"
slug: "a-wrong-gemini-key-is-classified-as-an"
description: "google-api-provider.ts routes only 401 and 403 responses to classifyAuthError. Google answers a bad key with 400 and a pretty-printed body carrying API_KEY_INVALID (and INVALID_ARGUMENT) across lines, so no auth signature matches and the user gets a generic failure instead of re-authentication guidance. The repo fixture uses code 401 for API_KEY_INVALID, which hides it. Surfaced by the layer 4 review of stack #855. Fix: treat a 400 whose body carries API_KEY_INVALID as an auth failure in the Google provider; correct the fixture to Google's real 400 shape."
acceptanceCriteria:
  - "A mocked Google 400 response with API_KEY_INVALID produces an AuthFailureError with re-auth guidance"
  - "The existing fixture is corrected to the 400 shape Google sends and still passes"
priority: "medium"
source: "codeql-triage"
---
