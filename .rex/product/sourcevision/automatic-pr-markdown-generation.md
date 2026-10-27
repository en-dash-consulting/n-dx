---
id: "7ce2cc2b-c2b8-49ea-a69e-a8e1fa5bedb0"
type: "capability"
title: "Automatic PR Markdown Generation"
slug: "automatic-pr-markdown-generation"
statement: "The product generates PR markdown from rex completion data as part of the sourcevision analyze command."
criteria: [{"id":"c1","text":"The PR markdown generator shall build PR markdown content from rex completion data rather than from git differences."},{"id":"c2","text":"The PR markdown generator shall center the generated content on completed work items and their significance."},{"id":"c3","text":"When the sourcevision analyze command runs, sourcevision shall generate the PR markdown as part of the analyze flow."},{"id":"c4","text":"Sourcevision shall generate PR markdown through the analyze command rather than through a manual refresh mechanism."}]
source: "smart-add"
---
