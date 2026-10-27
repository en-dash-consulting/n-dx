---
id: "d8b6399f-f670-4018-a9c9-366534f485ae"
type: "capability"
title: "Git-Independent PR Markdown Generation"
slug: "git-independent-pr-markdown-generation"
statement: "The product generates reviewer-ready PR markdown from the active branch's completed Rex tasks and Hench execution history, without relying on repository diff connectivity."
criteria: [{"id":"c1","text":"When generating PR markdown, the PR markdown generator shall draw its work evidence from the Rex and Hench artifacts of the active branch."},{"id":"c2","text":"The PR markdown generator shall produce PR markdown without depending on repository diff connectivity."},{"id":"c3","text":"The PR markdown generator shall build the PR narrative from completed Rex tasks and their Hench execution history."},{"id":"c4","text":"The PR markdown generator shall lay out the generated PR markdown in a consistent, reviewer-ready structure."}]
source: "smart-add"
---
