---
id: "0b108590-b9ec-4d63-a98c-c0e974d1aaf2"
type: "change"
title: "Start a branch prefills and echoes a shell command from an unvalidated PRD slug"
slug: "start-a-branch-prefills-and-echoes-a"
intent: "Found by the adversarial review of task f6300273 (Start a branch). Verdict: should-fix, severity low.\n\nFailure scenario: a change's `slug` in its index.md front matter is repository content and the v2 schema only requires a non-empty string (packages/rex/src/schema/v2.ts:395). A hand-edited slug such as `x;touch$IFS/tmp/p` passes `git check-ref-format --branch`, because `;` and `$` are legal ref characters. The dialog prefills the name as `feat/x;touch$IFS/tmp/p` (packages/web/src/viewer/components/start-branch.ts, branchNameFor). On a dirty checkout or during a live run, the route answers `switchCommand: \"git switch feat/x;touch$IFS/tmp/p\"` (packages/web/src/server/routes-rex/branch-start.ts). The dialog shows that command next to a Copy button. If the user pastes it into a POSIX shell, it runs `touch /tmp/p` as well.\n\nReachability: through Work or Changes, then Start a branch, on a checkout that is dirty or has a live run. The user has to accept the prefilled name, which is visible and editable, and then paste the command. This is social engineering, not an automatic execution. It still conflicts with the constraint that untrusted repository content cannot widen what n-dx runs.\n\nOptions:\n(a) Server: refuse names outside [A-Za-z0-9._/-] with 400 INVALID_NAME, and have the viewer sanitise the prefilled slug to that set. Cost: small. Risk: it refuses some git-legal names. Recommended.\n(b) Shell-quote the switch command. The quoting differs between POSIX, PowerShell and cmd, so there is no single safe form.\n(c) Validate slugs in rex on read. Wider, and it touches the frozen-slug contract."
acceptanceCriteria:
  - "POST /api/rex/branch/start refuses a name containing a shell metacharacter (; $ & | ` ( ) ' \" < >) with 400 INVALID_NAME and creates no branch (web route test)"
  - "The Start a branch dialog prefills a name containing only [A-Za-z0-9._/-] when the first selected change's slug carries other characters (viewer test)"
  - "No switchCommand the route returns contains a shell metacharacter"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"f6300273-9ee4-46c2-8a4a-30cc4b200d69","run":"9dc7c904-feca-4dac-9ce0-3ada1db407e6"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
