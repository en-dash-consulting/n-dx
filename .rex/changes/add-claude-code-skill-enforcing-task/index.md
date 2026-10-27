---
id: "0b75c98d-cbee-49d2-9cda-0fa3946e057f"
type: "change"
title: "Add Claude Code skill enforcing task-repetition and completion-advancement invariants"
slug: "add-claude-code-skill-enforcing-task"
intent: "Author a new assistant skill (sibling to existing ndx-* skills) that documents and enforces the run-loop invariants introduced by this feature: never re-pick a completed task, advance after three repeats, transition status before next selection. The skill should be discoverable via the standard skill list and referenced from the hench run loop's contributor docs so future changes preserve the invariants."
acceptanceCriteria:
  - "New skill is registered and appears in the available-skills list"
  - "Skill documents the three invariants with concrete examples of correct vs incorrect behavior"
  - "Skill references the run-loop code paths that enforce each invariant"
  - "Hench contributor docs link to the skill from the run-loop section"
amends: [{"target":"03266251-06ef-4864-960a-0cb02986ff1d","delta":"modified","summary":"Add Claude Code skill enforcing task-repetition and completion-advancement invariants","base":"3df33565e7c75e9ae2fad9cc3629cae5ad8178a01ee2a83bf9dc7f96ed2a25c2"}]
priority: "medium"
tags:
  - "skills"
  - "documentation"
  - "hench"
source: "smart-add"
---
