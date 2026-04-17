---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Vendor-aware batch construction and response handling in self-heal

- **`llm-client`**: Add `VENDOR_CONTEXT_CHAR_LIMITS` — per-vendor safe prompt size constants (claude: 640K chars, codex: 400K chars) derived from each vendor's context window.
- **`hench/summary.ts`**: Recognise Codex CLI tool names (`shell`, `str_replace_editor`, `create_file`) in `buildRunSummary`. Fixes IC-1: file-change tracking now works for Codex runs.
- **`hench/cli-loop.ts`**: Bound the brief text to `VENDOR_CONTEXT_CHAR_LIMITS[vendor]` before each dispatch. Uses the vendor/model resolver from `llm-gateway` rather than a Claude-specific constant.
- **`hench/shared.ts`**: When `toolCalls` is empty in self-heal mode, fall back to `git diff --name-only HEAD` to populate `filesChanged`. Fixes IC-2: the mandatory test gate now runs for Codex (which does not emit structured tool events).
