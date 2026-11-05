---
"@n-dx/web": patch
---

Tracker sync fills each move's workflow facts from their named source (reviewer from the profile default or CODEOWNERS, review link from the PR URL, delivery note from the release, blocked reason from the run diagnosis). A missing fact, or a feature the tracker's declared limits say a person must create, becomes a card naming it instead of a guessed call.
