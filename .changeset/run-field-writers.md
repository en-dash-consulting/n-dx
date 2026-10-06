---
"@n-dx/rex": patch
"@n-dx/web": patch
---

The saved `run` block is writable through MCP `add_item` / `edit_item` (`edit_item` replaces the whole block, `run: null` removes it) and `rex update --run='<json>'` (`--run=` or `--run=null` clears it); invalid JSON or an unknown key exits non-zero listing the valid keys. `PATCH /api/rex/items/:id` now accepts only status, failureReason, priority, tags, title, description, acceptanceCriteria and requirements (any other key is a 400 naming it) and does its read-modify-write inside the PRD lock, answering 409 when another process holds it.
