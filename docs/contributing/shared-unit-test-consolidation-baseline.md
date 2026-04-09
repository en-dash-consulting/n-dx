# Shared Unit Test Consolidation Baseline

This note fixes the scope for the shared unit-test utility refactor and records
the pre-change coverage inventory that later tasks must preserve.

## Scope

The consolidation work is limited to **test-only paths**. Shared utilities for
this refactor must not be added under `src/`, `dist/`, or any other production
path.

Allowed locations for shared unit-test utilities in this pass:

- `packages/web/tests/helpers/`
- `packages/rex/tests/helpers/`

Already-shared test-only utilities that remain valid baselines:

- `packages/sourcevision/tests/unit/analyzers/zones-helpers.ts`
- `packages/web/tests/helpers/crash-detector-test-support.ts`

Out of scope for this pass:

- Moving helper code into production modules just to make tests share it
- Changing production imports or public package exports
- Changing assertions, deleting cases, or narrowing test coverage to make the
  extraction easier

Decision rule for later refactor tasks:

- If a duplicated helper is only used inside one package, keep the shared module
  inside that package's `tests/` tree.
- If a helper would require a production-file change to become shared, do not
  move it in this refactor.

## Baseline Inventory

Baseline capture date: 2026-04-02

Measurement rules used for the before-change snapshot:

- Test files: every repo file matching `*.test.*` or `*.spec.*`
- Test cases: every line in those files matching a top-level `it(...)` or
  `test(...)` form, including common Vitest modifiers such as `.only`,
  `.skip`, `.todo`, `.fails`, `.concurrent`, `.runIf`, and `.skipIf`
- Unit subset: files located under any `tests/unit/` directory

Before-change totals:

| Inventory | Count |
| --- | ---: |
| Total test files | 470 |
| Total test cases | 9,514 |
| Unit-test files | 395 |
| Unit-test cases | 8,555 |

Current file-distribution snapshot:

| Bucket | Count |
| --- | ---: |
| `packages/*/tests/unit/` | 391 |
| `packages/*/tests/integration/` | 32 |
| `packages/*/tests/e2e/` | 14 |
| `tests/integration/` | 5 |
| `tests/e2e/` | 24 |
| Other `*.test.*` or `*.spec.*` files | 4 |

## Reproduction Commands

Use the same commands after the refactor so the comparison stays apples-to-apples.

Count files and cases:

```sh
node --input-type=module <<'EOF'
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const exts = ["js", "jsx", "ts", "tsx", "mjs", "cjs"];
const globArgs = exts.map((ext) => `-g '*.{test,spec}.${ext}'`).join(" ");
const filesRaw = execSync(`rg --files ${globArgs}`, { encoding: "utf8" });
const files = filesRaw.trim().split("\n").filter(Boolean).sort();
const testCasePattern =
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|runIf|skipIf))*\s*\(/gm;

let totalCases = 0;
let unitFiles = 0;
let unitCases = 0;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const matches = content.match(testCasePattern);
  const count = matches ? matches.length : 0;
  totalCases += count;

  if (/(^|\/)tests\/unit\//.test(file)) {
    unitFiles += 1;
    unitCases += count;
  }
}

console.log(JSON.stringify({
  totalTestFiles: files.length,
  totalTestCases: totalCases,
  unitTestFiles: unitFiles,
  unitTestCases: unitCases
}, null, 2));
EOF
```

Count file buckets:

```sh
node --input-type=module <<'EOF'
import { execSync } from "node:child_process";

const exts = ["js", "jsx", "ts", "tsx", "mjs", "cjs"];
const globArgs = exts.map((ext) => `-g '*.{test,spec}.${ext}'`).join(" ");
const filesRaw = execSync(`rg --files ${globArgs}`, { encoding: "utf8" });
const files = filesRaw.trim().split("\n").filter(Boolean).sort();
const buckets = {
  root: 0,
  packageUnit: 0,
  packageIntegration: 0,
  packageE2E: 0,
  rootIntegration: 0,
  rootE2E: 0
};

for (const file of files) {
  if (/^packages\/[^/]+\/tests\/unit\//.test(file)) buckets.packageUnit += 1;
  else if (/^packages\/[^/]+\/tests\/integration\//.test(file)) buckets.packageIntegration += 1;
  else if (/^packages\/[^/]+\/tests\/e2e\//.test(file)) buckets.packageE2E += 1;
  else if (/^tests\/integration\//.test(file)) buckets.rootIntegration += 1;
  else if (/^tests\/e2e\//.test(file)) buckets.rootE2E += 1;
  else buckets.root += 1;
}

console.log(JSON.stringify(buckets, null, 2));
EOF
```
