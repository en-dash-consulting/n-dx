---
"@n-dx/web": patch
---

The dashboard Inbox's **Place best guesses** and **Accept** now commit what they placed, so a batch placement lands as one commit instead of hundreds of uncommitted renames.

The commit holds exactly the PRD files the placement moved, with an `N-DX-Item` trailer per change. Anything else in the working tree, staged or not, is left alone, and nothing is pushed. The result line shows the commit's sha, or why nothing was committed (for example, not a git repository); the placement stands either way.
