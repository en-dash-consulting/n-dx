---
"@n-dx/llm-client": patch
---

The repository trust assessment lists the PRD's saved run blocks as one directory source (`.rex/changes/`, or the rex directory when blocks sit in more than one PRD root) instead of one path per file. Every `sources` entry stays a real path, and the new `prdRunBlocksPath` field names the PRD entry. The trust report prints the count beside it (`.rex/changes/ (214 PRD items with saved run settings)`). The `run-settings` finding names at most five blocks before "and N more". The trust report, the dashboard's source list and the readiness evidence no longer grow with the number of PRD files. The trust digest is unchanged, so no accepted checkout re-prompts.
