---
id: "f5e0f107-d475-44f7-8c20-7e01dec68557"
type: "capability"
title: "SourceVision PR Markdown Git Preflight and Credential Diagnostics"
slug: "sourcevision-pr-markdown-git-preflight"
statement: "SourceVision checks the git prerequisites before it generates PR markdown, and when a check fails it reports the exact root cause along with remediation guidance specific to that error."
criteria: [{"id":"c1","text":"Before PR markdown generation, SourceVision shall validate the git prerequisites so that a refresh failure is detected before generation begins."},{"id":"c2","text":"If a git preflight check fails, SourceVision shall report the precise root cause of the failure."},{"id":"c3","text":"If a git preflight check fails, SourceVision shall return remediation guidance specific to that error, so the operator can recover without inspecting raw git errors."}]
source: "smart-add"
---
