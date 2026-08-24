# Rex -- Developer context

This document is for AI agents and developers working on the rex codebase itself.

## Architecture

```
src/
  schema/           Type definitions (PRDItem, PRDDocument, RexConfig, LogEntry)
                    Zod validation schemas with .passthrough() for extensibility
  store/            Storage abstraction: PRDStore interface + adapters
                    FolderTreeStore (canonical) + FileStore (legacy migration path)
                    folder-tree-{store,serializer,parser,mutations,index-generator}.ts
                    Remote adapters: notion, jira, asana, github-projects
                    Factory: createStore("file", rexDir)
  core/             Pure logic with no I/O
    tree.ts         Tree traversal, find, insert, update, remove, stats
    dag.ts          Dependency graph validation (cycles, orphans, duplicates)
    next-task.ts    Priority-ordered depth-first search for next actionable task
    canonical.ts    Canonical JSON formatting, priority-based sorting
  fix/              Auto-fix engine for `rex fix`
  recommend/        SourceVision finding -> PRD proposal translation
  analyze/          Project analysis pipeline
    scanners.ts     Three scanners: tests, docs, sourcevision
    reconcile.ts    Dedup proposals against existing PRD items
    propose.ts      Group scan results into epic/feature/task hierarchy
  cli/
    index.ts        Arg parser and command dispatch (switch + dynamic import)
    mcp.ts          MCP server (17 tools, 3 resources, stdio + HTTP transport)
    mcp-tools.ts    Tool definitions and handlers
    commands/       One file per command, each exports cmdX(dir, flags)
  workflow/
    default.ts      Default agent workflow text
```

## Patterns

**Command signature:** `async function cmdX(dir: string, flags: Record<string, string>): Promise<void>`

Commands that take positional args (add, update) receive them as extra parameters between dir and flags.

**Store access:** `createStore("file", join(dir, ".rex"))` resolves to the folder-tree
store, which writes `.rex/prd_tree/` — the sole writable PRD surface. Load document,
mutate, save. Log actions via `store.appendLog()`. Commands that touch the PRD call
`ensureLegacyPrdMigrated()` first so pre-tree projects convert on first use.

**Tree operations:** Use helpers from `core/tree.ts`. The tree is a `PRDItem[]` where each item may have `children: PRDItem[]`. `walkTree()` yields `{ item, parents }` for depth-first traversal.

**Validation:** Zod schemas in `schema/validate.ts`. All schemas use `.passthrough()` so custom fields survive round-trips. `validateDocument()`, `validateConfig()`, `validateLogEntry()` return `{ ok, data }` or `{ ok: false, errors }`.

**Output:** Check `flags.format === "json"` for JSON output, otherwise print human-readable text. Errors go to `console.error` + `process.exit(1)`.

**Imports:** All internal imports use `.js` extensions (TypeScript with bundler module resolution). Vitest config aliases `.js` back to `.ts` for tests.

## Item hierarchy

```
epic (parent: none)
  feature (parent: epic)
    task (parent: feature)
      subtask (parent: task)
```

Enforced by `LEVEL_HIERARCHY` in `schema/v1.ts`. The `add` command and MCP `add_item` tool both validate parent-child relationships.

## Priority ordering

`critical > high > medium > low` -- used by `next-task.ts` and `canonical.ts` `sortItems()`.

## Dependencies

Items can declare `blockedBy: string[]` referencing other item IDs. The DAG validator checks for self-references, missing references, and cycles. `findNextTask` skips items whose blockers aren't all completed.

## Analyze pipeline

1. Scanners produce flat `ScanResult[]` arrays with `{ name, source, sourceFile, kind, ... }`
2. `reconcile()` filters out proposals that fuzzy-match existing PRD item titles
3. `buildProposals()` groups results into `Proposal[]` (epic > feature > task hierarchy)
4. `cmdAnalyze` orchestrates: run scanners in parallel, reconcile, build proposals, format output, optionally accept into PRD

Lite mode (`--lite`) skips file content reading -- scanners use filenames and directory structure only.

## Testing

Vitest. Three test tiers:

- `tests/unit/` -- pure logic, temp dirs for file-dependent tests
- `tests/integration/` -- store round-trips with real files
- `tests/e2e/` -- spawn `node dist/cli/index.js` as subprocess, verify stdout

Helper pattern: `makeItem({ id, title, ...overrides })` for test data.

Build before e2e: `npm run build` then `npx vitest run`.

## .rex/ file formats

| File | Format | Notes |
|------|--------|-------|
| `config.json` | JSON, 2-space indent | RexConfig schema |
| `prd.json` | JSON, 2-space indent | PRDDocument, nested tree |
| `execution-log.jsonl` | JSONL (one entry/line) | Append-only |
| `workflow.md` | Markdown | Agent instructions |

All JSON files end with a trailing newline (via `toCanonicalJSON`).

## MCP server

Started with `rex mcp [dir]`. Uses `@modelcontextprotocol/sdk` over stdio. Tools accept Zod-validated parameters and return `{ content: [{ type: "text", text: JSON }] }`. Resources serve `rex://prd`, `rex://workflow`, `rex://log`.
