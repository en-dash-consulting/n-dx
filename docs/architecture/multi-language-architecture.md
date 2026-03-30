# Multi-Language Architecture

> How n-dx supports analysis of codebases in multiple programming languages.

---

## Overview

n-dx's analysis pipeline was originally built for TypeScript/JavaScript. Rather than forking the pipeline per language, multi-language support is implemented as a **language registry** that parameterizes every language-specific decision through a single configuration interface. The core algorithms (Louvain zone detection, PRD management, agent execution) remain language-agnostic.

---

## Language Registry

The registry is the backbone of multi-language support. Every downstream subsystem — inventory, imports, archetypes, test detection, guard configuration — reads from the same `LanguageConfig` interface rather than hardcoding language-specific constants.

**Location:** `packages/sourcevision/src/language/`

```
language/
  registry.ts      # LanguageConfig interface definition
  go.ts            # Go configuration
  typescript.ts    # TypeScript/JavaScript configuration (backward-compatible defaults)
  detect.ts        # Auto-detection, multi-language detection, config merging
  index.ts         # Barrel exports
```

### LanguageConfig Interface

```typescript
interface LanguageConfig {
  id: string;                       // "go", "typescript"
  displayName: string;              // "Go", "TypeScript"
  extensions: Set<string>;          // Source file extensions
  parseableExtensions: Set<string>; // Extensions the import parser handles
  testFilePatterns: RegExp[];       // Test file detection patterns
  configFilenames: Set<string>;     // Build/config file names
  skipDirectories: Set<string>;     // Directories to skip during traversal
  generatedFilePatterns: RegExp[];  // Machine-generated file patterns
  entryPointPatterns: RegExp[];     // Entry point file patterns
  moduleFile?: string;              // Package manifest filename
}
```

Each language provides a complete configuration. The registry does not use inheritance — configurations are flat and self-contained. This avoids subtle bugs from partial overrides and makes each language's behavior fully inspectable.

---

## Language Detection

Detection runs at the start of `ndx analyze` and writes the result to `manifest.json`.

### Detection Chain

1. **Explicit override** — `.n-dx.json` contains `"language": "go"` → use that
2. **Single marker** — `go.mod` present without `package.json` → Go
3. **Single marker** — `package.json` present without `go.mod` → TypeScript
4. **Both present** — count `.go` vs `.ts`/`.tsx`/`.js`/`.jsx` files in top 2 directory levels → majority wins as primary
5. **Neither present** — TypeScript fallback (backward compatible)

### Single-Language vs Multi-Language

Two detection functions serve different needs:

| Function | Returns | Use Case |
|----------|---------|----------|
| `detectLanguage()` | Single `LanguageConfig` | Primary language for manifest, archetypes, Hench guard defaults |
| `detectLanguages()` | `LanguageConfig[]` (primary first) | Import parsing — both parsers run when both languages present |

### Manifest Fields

```json
{
  "language": "go",
  "languages": ["go", "typescript"]
}
```

- `language` — the resolved primary language (drives archetype selection, Hench templates)
- `languages` — all detected languages, primary first (drives import parser dispatch)

---

## Import Parser Dispatch

The import analyzer uses language detection to route files to the correct parser. This is the key integration point — it allows a single `ndx analyze` run to produce a unified import graph from multiple languages.

### Dispatch Logic

```
For each source file in inventory:
  if extension is .go        → extractGoImports()
  if extension is .ts/.tsx/… → TypeScript compiler API

Merge results into unified imports.json
```

Both parsers produce the same output types (`ImportEdge[]`, `ExternalImport[]`), so the zone detection algorithm receives a single merged graph regardless of how many languages contributed edges.

### Cross-Language Isolation

Files from different languages never produce edges to each other. A `.go` file cannot import a `.ts` file and vice versa. The merged graph contains two disconnected subgraphs — one per language. The zone algorithm naturally clusters each language's files into separate zones.

### Config Merging

When multiple languages are detected, `mergeLanguageConfigs()` produces a unified config:

- **Extensions** — union of all language extensions
- **Test patterns** — concatenation of all language test patterns
- **Config filenames** — union of all config filenames
- **Skip directories** — union of all skip directories
- **Parseable extensions** — union (both `.go` and `.ts`/`.tsx` become parseable)

This merged config is used by the inventory analyzer so that files from both languages are correctly classified.

---

## Archetype Language Scoping

Archetype signals support an optional `languages` field that restricts when a signal fires:

```typescript
{
  kind: "filename",
  pattern: "^main\\.go$",
  weight: 0.9,
  languages: ["go"]    // Only fires in Go projects
}
```

| `languages` value | Behavior |
|-------------------|----------|
| Absent/undefined | Fires for all projects (backward compatible) |
| `["go"]` | Fires only when primary language is Go |
| `["typescript", "javascript"]` | Fires only for TS/JS projects |

This prevents false positives — `main.go` shouldn't trigger the entrypoint archetype in a JS project that happens to have a stray `.go` file, and `useAuth.ts` shouldn't trigger the hook archetype in a Go project's vendored JS dependencies.

### Language-Scoped Archetypes

| Archetype | Go Signals | React/TS Signals |
|-----------|-----------|-----------------|
| `entrypoint` | `main.go`, `/cmd/` | `index.[tj]sx?`, `main.[tj]sx?` |
| `types` | `types.go`, `models.go`, `entities.go` | `types.[tj]sx?`, `.d.ts` |
| `route-handler` | `handler.go`, `/handler/`, `/handlers/` | `routes?[-.]`, `router.[tj]sx?` |
| `route-module` | *(none — N/A for Go)* | convention exports (`loader`, `action`) |
| `component` | *(none — N/A for Go)* | `.tsx$`, `/components/` |
| `hook` | *(none — N/A for Go)* | `use[A-Z]*.[tj]sx?` |
| `page` | *(none — N/A for Go)* | `/pages/`, `/views/` |

Archetypes without language-scoped signals (utility, middleware, model, service, config, gateway, schema, cli-command, store, test-helper) use directory-based signals that work identically across languages.

---

## Hench Guard Templates

Hench's security guard uses language-specific defaults for allowed commands and blocked paths:

| Setting | TypeScript/JS | Go |
|---------|--------------|-----|
| Allowed commands | `npm`, `npx`, `node`, `git`, `tsc`, `vitest` | `go`, `make`, `git`, `golangci-lint` |
| Blocked paths | `.hench/**`, `.rex/**`, `.git/**`, `node_modules/**` | `.hench/**`, `.rex/**`, `.git/**`, `vendor/**` |

The `guardDefaultsForLanguage(language)` function returns the appropriate template. The resolved language from `manifest.language` drives the selection.

---

## Adding a New Language

To add support for a new language (e.g., Python, Rust):

### 1. Create language config

Add `packages/sourcevision/src/language/python.ts`:

```typescript
export const pythonConfig: LanguageConfig = {
  id: "python",
  displayName: "Python",
  extensions: new Set([".py"]),
  parseableExtensions: new Set([".py"]),
  testFilePatterns: [/^test_.*\.py$/, /_test\.py$/],
  configFilenames: new Set(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"]),
  skipDirectories: new Set(["__pycache__", ".venv", "venv", ".tox"]),
  generatedFilePatterns: [/_pb2\.py$/, /_pb2_grpc\.py$/],
  entryPointPatterns: [/^main\.py$/, /^__main__\.py$/],
  moduleFile: "pyproject.toml",
};
```

### 2. Register in detection chain

Update `detect.ts`:
- Add `pyproject.toml` / `setup.py` as project markers
- Add file-count tiebreak for `.py` extensions

### 3. Write import parser

Create `packages/sourcevision/src/analyzers/python-imports.ts`:
- Parse `import x` and `from x import y` statements
- Classify stdlib vs third-party vs internal
- Return `ImportEdge[]` and `ExternalImport[]`

### 4. Add import dispatch

Update `imports.ts` to route `.py` files to the new parser.

### 5. Add archetype signals

Update `archetypes.ts` with language-scoped signals for Python conventions.

### 6. Add Hench guard template

Add `PYTHON_GUARD_DEFAULTS` with allowed commands (`python`, `pip`, `pytest`, `mypy`).

### 7. Write tests and fixture

Create a fixture project and unit/integration tests covering all phases.

---

## Known Limitations

1. **Primary language drives archetype selection** — in mixed-language projects, only the primary language's scoped archetypes fire. A Go+TS project with Go as primary won't detect React hooks in the TS files.

2. **No cross-language edges** — the import graph has disconnected subgraphs per language. The zone algorithm cannot detect architectural relationships between a Go API server and its TypeScript frontend.

3. **Hench guard is single-language** — the agent gets either Go or TS/JS allowed commands, not both. In a mixed project, the agent can only run toolchain commands for the primary language.

4. **Language detection is project-level** — subdirectories cannot have different primary languages. A monorepo with `backend/` (Go) and `frontend/` (TS) is treated as one project with a single primary.
