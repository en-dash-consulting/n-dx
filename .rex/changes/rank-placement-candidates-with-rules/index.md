---
id: "8ac55bc6-c995-479d-8043-935199d6b764"
type: "change"
title: "Rank placement candidates with rules and the text model"
slug: "rank-placement-candidates-with-rules"
intent: "Rules: package and path mentions, title token overlap, file evidence looked up against realized by. Text model: prd.place task class, uncalibrated, so auto-accepted only when it agrees with the rules."
acceptanceCriteria:
  - "A shortlist is returned with no model configured (test)"
  - "Agreement between rules and model is detected (test)"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "medium"
tags:
  - "pr-12"
  - "lane-rex-domain"
  - "rex"
  - "llm-client"
source: "roadmap"
---
