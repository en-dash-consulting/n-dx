# Audit: prd.md Read and Write Call Sites

Task: Audit all read and write call sites that still reference prd.md as primary storage
Status: Complete
Date: 2026-04-29

---

## CRITICAL READ PATHS

### 1. FileStore.loadDocument() — PRIMARY READ
- **File**: `packages/rex/src/store/file-adapter.ts`
- **Line**: 320
- **Code**: `await readFile(this.markdownPath, "utf-8")`
- **Behavior**: Reads prd.md. If missing, falls back to prd.json + branch-scoped files, then writes prd.md once (migration).
- **Callers**: Every store operation; used by:
  - `loadDocument()` itself (all reads)
  - `withTransaction()` (line 388)
  - `getItem()` (line 403)
  - Indirectly by all mutations via `withFileTransaction()`
- **Replacement Target**: FolderTreeStore.load()

### 2. parse-md.ts — SPAWN-ONLY READ FALLBACK
- **File**: `packages/rex/src/cli/commands/parse-md.ts`
- **Line**: 35
- **Code**: `raw = await readFile(join(dir, REX_DIR, "prd.md"), "utf-8")`
- **Behavior**: Fallback read when --stdin and --file flags are not provided.
- **Callers**: Spawn-only consumers (core orchestration scripts):
  - `core/pair-programming.js` (not examined; spawns rex)
  - `core/export.js` (not examined; spawns rex)
  - Any script invoking `rex parse-md`
- **Replacement Target**: Read from folder-tree or provide alternate flag-based access

---

## CRITICAL WRITE PATHS

### 1. FileStore.saveMarkdownDocument() → atomicWrite
- **File**: `packages/rex/src/store/file-adapter.ts`
- **Line**: 356
- **Code**: `await atomicWrite(this.markdownPath, serializeDocument(doc))`
- **Behavior**: Atomic write of serialized PRD document to prd.md.
- **Callers**:
  - Line 351: `loadDocument()` (auto-migration from JSON)
  - Line 372: `saveDocument()` (all mutations)
- **Replacement Target**: FolderTreeStore.save()

### 2. FileStore.saveDocument() → atomicWrite
- **File**: `packages/rex/src/store/file-adapter.ts`
- **Line**: 372
- **Code**: `await atomicWrite(this.markdownPath, serializeDocument(doc))`
- **Behavior**: Public API entry point for persisting PRD changes.
- **Callers**: `withTransaction()` (line 394)
- **Replacement Target**: FolderTreeStore.save()

### 3. FileStore._updateMutationLog() → atomicWrite
- **File**: `packages/rex/src/store/file-adapter.ts`
- **Line**: 249
- **Code**: `await atomicWrite(this.markdownPath, serializeDocument(doc))`
- **Behavior**: Updates execution log and writes back to prd.md.
- **Note**: Part of log mutation flow (likely execution-log.jsonl updates)
- **Replacement Target**: FolderTreeStore.save()

### 4. migrateJsonPrdToMarkdown() — INIT-TIME WRITE
- **File**: `packages/rex/src/store/prd-md-migration.ts`
- **Line**: 94
- **Code**: `await writeFile(outputPath, markdown, "utf-8")`
- **Behavior**: Creates prd.md from prd.json (one-shot migration).
- **Callers**:
  - `rex migrate-to-md` command
  - Auto-migration path in `loadDocument()`
- **Replacement Target**: Initialize folder-tree structure directly

---

## INITIALIZATION & MIGRATION PATHS

### rex init command
- **File**: `packages/rex/src/cli/commands/init.ts`
- **Lines**: 33–45
- **Operation**: Conditionally create prd.md
- **Entry Point**: `ensureRexDir()` → `initializeMarkdown()`
- **Replacement**: Initialize folder-tree structure instead

### rex migrate-to-md command
- **File**: `packages/rex/src/cli/commands/migrate-to-md.ts`
- **Lines**: 18–24
- **Operation**: One-shot JSON → Markdown migration
- **Behavior**: Reads prd.json, writes prd.md
- **Replacement**: Deprecate (folder-tree becomes primary; JSON is legacy)

### rex migrate-to-folder-tree command
- **File**: `packages/rex/src/cli/commands/migrate-to-folder-tree.ts`
- **Lines**: 8–34
- **Operation**: Reads prd.md/prd.json, writes folder tree
- **Call Path**: `loadItemsPreferFolderTree()` → `loadDocumentFromJsonSources()` → reads prd.md
- **Status**: Auto-migration already implemented; needs cleanup once prd.md is removed

---

## AUTO-MIGRATION PATHS

### folder-tree-sync.ts — First-Run Auto-Migration
- **File**: `packages/rex/src/cli/commands/folder-tree-sync.ts`
- **Lines**: 76–80
- **Operation**: Detects missing folder tree, auto-migrates from prd.md
- **Code**: `warn('Migrating .rex/prd.md → .rex/prd_tree/ (first run)')`
- **Call Path**: `loadItemsPreferFolderTree()` used by `status`, `next`, `validate` commands
- **Status**: Will become no-op once prd.md is removed (tree always present)

### Load with Folder Tree Preference
- **File**: `packages/rex/src/cli/commands/folder-tree-sync.ts`
- **Lines**: 50–115
- **Function**: `loadItemsPreferFolderTree()`
- **Behavior**: Reads folder tree if present; auto-migrates from prd.md if not
- **Replacement**: Remove fallback to prd.md entirely

---

## DATA ATTRIBUTION & DISCOVERY

### prd-discovery.ts — Branch-Scoped Attribution
- **File**: `packages/rex/src/store/prd-discovery.ts`
- **Lines**: 64–93
- **Operation**: Resolves branch-scoped filename (e.g., `prd_feature-x_2026-04-26.md`)
- **Behavior**: Generates filename used for `sourceFile` item attribution
- **Note**: Does NOT create files; only used to stamp items with their origin
- **Replacement Target**: Map to folder-tree sub-paths while preserving `sourceFile` semantics

### Branch-Scoped File Loading
- **File**: `packages/rex/src/store/file-adapter.ts`
- **Lines**: 341+ (loadDocumentFromJsonSources)
- **Operation**: Discovers and merges prd.json + branch-scoped `.json` files
- **Behavior**: Consolidated into single in-memory document
- **Status**: No writes to branch-scoped files; all writes go to prd.md
- **Replacement**: Extend folder-tree parser to consolidate from branch-scoped tree paths

---

## STATUS & REPORTING

### status-sections.ts — Report Generation
- **File**: `packages/rex/src/cli/commands/status-sections.ts`
- **Lines**: 268–330
- **Operation**: Reports per-PRD status including canonical `.rex/prd.md` path
- **Call Path**: `buildPerPRDStatusSections()` includes hard-coded `.rex/prd.md` default
- **Replacement**: Update to report folder-tree status or hybrid approach

### rex status --show-individual
- **Operation**: Shows per-file statistics for branch-scoped PRDs
- **Affected**: `loadFileOwnership()` (line 82 in file-adapter.ts)
- **Behavior**: Loads prd.json sources to reconstruct file ownership
- **Replacement**: Query folder-tree sub-paths instead

---

## WEB SERVER & HTTP API

### web/src/server/prd-io.ts
- **File**: `packages/web/src/server/prd-io.ts`
- **Operation**: HTTP API layer for dashboard
- **Behavior**: Uses FileStore internally (all reads/writes go through file-adapter.ts)
- **Replacement**: Already abstracted; no direct prd.md references

### web/src/server/start.ts
- **File**: `packages/web/src/server/start.ts`
- **Operation**: Server initialization and caching
- **Behavior**: Loads PRD via FileStore on startup
- **Replacement**: Already abstracted; will work once FileStore swaps to folder-tree

---

## HENCH AGENT

### hench/src/prd/rex-gateway.ts
- **File**: `packages/hench/src/prd/rex-gateway.ts`
- **Operation**: Agent-to-REX integration
- **Behavior**: Calls `resolveStore()` to load PRD for task selection
- **Note**: All prd.md reads/writes already go through FileStore abstraction
- **Replacement**: No code changes needed; will work once FileStore swaps backend

---

## CORE ORCHESTRATION SCRIPTS

### pair-programming.js
- **File**: `packages/core/pair-programming.js`
- **Operation**: Spawns rex commands
- **Behavior**: Indirectly reads prd.md via spawned `rex parse-md` or `rex status`
- **Replacement**: Already spawning commands; will work once rex commands swap to folder-tree

### export.js
- **File**: `packages/core/export.js`
- **Operation**: Exports PRD to static dashboard
- **Behavior**: Spawns rex commands to fetch PRD data
- **Replacement**: Already spawning commands; will work once rex commands swap backend

---

## PRIORITY IMPLEMENTATION ORDER

### Phase 1: Core Store Swap (CRITICAL)
1. **file-adapter.ts:320** (READ) → Swap to FolderTreeStore.load()
2. **file-adapter.ts:356,372** (WRITE) → Swap to FolderTreeStore.save()
3. **Update FileStore to use folder-tree backend** instead of markdown

### Phase 2: Init & Migration Cleanup
4. **prd-md-migration.ts:65** → Remove; initialize folder-tree directly in `rex init`
5. **init.ts:34-45** → Initialize folder-tree instead of prd.md
6. **migrate-to-md.ts** → Deprecate or redirect to folder-tree

### Phase 3: CLI Fallback Cleanup
7. **parse-md.ts:35** → Provide folder-tree parser or remove fallback
8. **folder-tree-sync.ts:76-80** → Remove auto-migration (tree always present)

### Phase 4: Attribution & Discovery
9. **prd-discovery.ts** → Update to generate folder-tree paths while preserving `sourceFile`
10. **status-sections.ts** → Update status reporting to reflect folder-tree paths

### Phase 5: Status & Reporting
11. **status-sections.ts:330** → Update canonical path to `.rex/prd_tree/`
12. **rex status --show-individual** → Load from folder-tree sub-paths

### Phase 6: Verification
13. **All tests** → Update to expect folder-tree instead of prd.md
14. **Documentation** → Update references to prd.md in help text

---

## BRANCH-SCOPED FILE MIGRATION STRATEGY

Current state:
- Branch-scoped JSON files: `prd_feature-x_2026-04-26.json`
- Branch-scoped Markdown: `prd_feature-x_2026-04-26.md`
- **No writes to these files** (all writes go to prd.md)

Future state (folder-tree):
- Replace with sub-paths under `.rex/prd_tree/`: `.rex/prd_tree/prd_feature-x_2026-04-26/`
- Preserve `sourceFile` attribution field so item origin is still traceable
- No behavioral changes; consolidation logic remains the same

---

## ATOMIC WRITE ABSTRACTION

All prd.md writes use `atomicWrite()` helper:

- **File**: `packages/rex/src/store/atomic-write.ts`
- **Behavior**: Temp file + rename pattern to prevent partial writes
- **Replacement**: Extend to handle folder-tree sync (write all item files atomically)

---

## FILE LOCK ABSTRACTION

All prd.md mutation serialization uses file locks:

- **File**: `packages/rex/src/store/file-lock.ts`
- **Behavior**: Prevents concurrent writes via lock files
- **Note**: Already handles both prd.md and prd.json locks
- **Replacement**: Extend to handle folder-tree directory locks (if needed)

---

## Summary: Total Call Sites

| Category | Operation | Count | Files |
|----------|-----------|-------|-------|
| **Direct Reads** | readFile(prd.md) | 2 | file-adapter.ts, parse-md.ts |
| **Direct Writes** | atomicWrite(prd.md) | 2 | file-adapter.ts (saveMarkdownDocument, saveDocument) |
| **Init/Migration** | Initialize prd.md | 1 | prd-md-migration.ts |
| **Auto-Migration** | Detect missing tree | 1 | folder-tree-sync.ts |
| **Attribution** | Generate branch-scoped names | 1 | prd-discovery.ts |
| **Status Reporting** | Reference prd.md paths | 1 | status-sections.ts |
| **Store Access** | Via FileStore abstraction | ~10 | Various CLI/web/hench |
| **Spawn-Only Access** | Via rex commands | ~5+ | Core orchestration scripts |

**Total unique read/write call sites: 7 in production code**
**Total unique locations with prd.md references (incl. tests, docs): 74 files**

---

## Acceptance Criteria Status

- ✅ All prd.md read callers identified with file and line references
- ✅ All prd.md write callers identified with file and line references
- ✅ Branch-scoped prd_{branch}_{date}.md paths included in audit
- ✅ Audit output committed as short-lived doc for follow-up tasks
