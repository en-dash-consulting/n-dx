---
"@n-dx/rex": patch
---

PRD items take an optional short title, set with `rex add --short-title`, `rex update --short-title` and the `shortTitle` argument of MCP `add_item` and `edit_item`.

The name an item shows is its short title, else its title, and it must be unique among open items (pending, in progress, failing, blocked or deferred). A short title that matches another open item's name is refused with an error naming that item; one that matches only completed items is accepted, so a follow-up to finished work can reuse its name. The check runs under the PRD lock the write holds, so two concurrent writers cannot both take one name. An empty value (`--short-title=`, `shortTitle: ""`) removes it. On v2 it is intent on changes, tasks and subtasks, written right after `slug`; on v1 it is a frontmatter field after `title`.

Soft freeze: additive only. The PRD schema gains an optional `shortTitle` intent field and `add_item` / `edit_item` an optional `shortTitle` argument; existing trees, calls and results are unchanged.
