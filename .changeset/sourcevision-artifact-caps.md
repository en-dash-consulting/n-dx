---
"@n-dx/sourcevision": patch
---

Cap the three sourcevision artifacts that grew without bound with repository
size.

These files are read by agents, not people, so their size is a token cost paid
on every run that consumes them — and each of the three had a section that
scaled with the repository while everything around it was already summarized.

The `llms.txt` file-inventory table is capped at 400 rows; it was the file's
largest section by far, measured at 75 KB of a 108 KB file. `CONTEXT.md`'s
routes section is capped at 15 handler groups and 15 routes per group, matching
the caps already applied to findings and next steps directly below it — it was
the one section in that file with no bound, at 54% of the file on a route-heavy
project. The `sourcevision://zones` MCP resource no longer returns the whole of
zones.json pretty-printed (~80K tokens in one tool result): it now returns the
cross-zone map — identity, cohesion, coupling, file counts, entry points,
crossings — as compact JSON, and names the `get_zone` tool for the per-zone
files and findings it omits.

Every cap states what it dropped, with both the omitted count and the total. A
silently truncated index is worse than a large one, because a reader cannot
tell whether a path is absent from the repository or merely unlisted.
