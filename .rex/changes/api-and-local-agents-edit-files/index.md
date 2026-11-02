---
id: "980a9f3e-f3f3-4edd-a38d-21be000a06ac"
type: "change"
title: "API and local agents edit files without rewriting them whole"
slug: "api-and-local-agents-edit-files"
intent: "Seen while running ndx work on a local model: hench's tool set for API and local providers (hench/src/tools/dispatch.ts) has read_file and a whole-file write_file and no edit tool, so a model changing one line of a 500-line file must send the whole file back. gpt-oss-20b wrote a 2-line stub to a wrong path, then overwrote src/infra/extract.ts (506 lines) with one line and then with an empty string; only the test gate stopped it. Fix: add an edit_file tool (replace an exact old string with a new one, which must match exactly once, with a clear error otherwise) and tell API and local agents to use it for existing files; guard write_file so overwriting an existing file with content that drops most of it (configurable ratio) is refused unless the call sets an explicit rewrite flag, returning an error that points the model at edit_file."
acceptanceCriteria:
  - "An edit_file tool replaces one exact match and refuses zero or several matches with an error naming the count"
  - "write_file refuses to overwrite an existing file with content under the configured share of its size unless rewrite is set, and the error points at edit_file"
  - "The API and local system prompts say to use edit_file for existing files"
  - "A test runs the tool loop with a scripted model that tries to blank a file and shows the file unchanged"
touches:
  - "9b9564f6-acd1-418a-a388-fa0c22d4d6f4"
priority: "high"
source: "ndx-capture"
---
