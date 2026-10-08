/**
 * Layout-literal policy — production code must ask the resolver where n-dx
 * keeps its files, not spell the folder out.
 *
 * Where n-dx keeps its state is one decision, and `resolveLayout` owns it:
 * `.ndx/rex` or `.rex`, `.ndx/config.json` or `.n-dx.json`, depending on which
 * layout the project is on. A literal `.rex/execution-log.jsonl` is that
 * decision taken a second time, in a file that has no idea which layout it is
 * running under — and it is taken *silently*. Nothing throws. A `.ndx/`
 * project gets a path nothing writes to, and whatever the literal was guarding
 * is simply skipped:
 *
 *  - `rex init` wrote `.ndx/rex/execution-log.jsonl` while adding only
 *    `.rex/execution-log*.jsonl` to `.gitignore`, so a generated log stayed
 *    trackable and got committed by accident.
 *  - Every sourcevision reader of the project config guessed `.n-dx.json`, so
 *    risk justifications, zone types, language and inventory overrides,
 *    archetype overrides, workspace members and the declared architecture on
 *    the iso map were all ignored on a new-layout project — and the analysis
 *    still succeeded, with different results and nothing to say why.
 *
 * Both were found by review, not by a test, which is what this file is for.
 *
 * ## A wall
 *
 * The rule is absolute, for the three tool directories and the loose `.n-dx*`
 * config files alike: no literal outside {@link ALLOWED}, and nowhere to
 * register an exception. Any site fails with its file and line. Adding a
 * literal back means editing the allow-list and saying why.
 *
 * It was not always both. The directories reached zero first and became a wall
 * while the config files were still a **ratchet** — 29 sites across
 * llm-client, hench and web, each registered in an inventory with the count it
 * was allowed, so a new file failed and a listed one could only shrink. That
 * sweep has landed, so the two halves have collapsed into one wall with no
 * change to the detector, and the inventory no longer carries a count.
 *
 * The `.n-dx*` family is in scope even though the task that asked for this
 * rule names only the three directories: the resolver owns those paths too,
 * and the config-reader defect above was `.n-dx.json`, so a rule that let it
 * through would not have caught the bug that prompted the rule.
 *
 * ## Why the detector looks the way it does
 *
 * Comments are blanked before scanning, because a docstring naming `.rex/` is
 * documentation, not a path — and the files that explain the layout are
 * exactly the ones that mention it most.
 *
 * A match must also be *path-shaped*: quoted and free of whitespace. Prose in
 * string form (`".hench/ already initialized, skipping"`) names a folder
 * without deciding where it lives, and flagging it would train people to add
 * exemptions rather than read them.
 *
 * @see packages/llm-client/src/layout.ts — the resolver and its lookup order
 * @see tests/layout-literal-inventory.md — how to comply, and how the sweep got here
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Files that are *allowed* to name a layout path, because naming it is their
 * job. Everything else asks one of these.
 */
const ALLOWED = [
  // The resolver, and the hand-written twin the orchestration tier needs
  // because it may not import a package.
  "packages/llm-client/src/layout.ts",
  "packages/core/layout.js",
  // The single source of truth for the three directory names.
  "packages/llm-client/src/project-dirs.ts",
  // These bundle into the dependency-free standalone skill script and may
  // import nothing but `node:` builtins, so they carry their own twins.
  // `tests/integration/layout-resolver-contract.test.js` pins them.
  "packages/sourcevision/src/export/iso-sources.ts",
  // Infrastructure discovery moved out of `src/export/iso-declared.ts` when it
  // became an analyzer, and the constraint moved with it: it is still bundled
  // into the skill, so it still cannot reach the resolver in `@n-dx/llm-client`.
  "packages/sourcevision/src/analyzers/infrastructure.ts",
  // The command whose entire purpose is moving a project between layouts.
  // Listed ahead of its arrival so the rule does not have to be edited when it
  // lands.
  "packages/rex/src/cli/commands/migrate-layout.ts",
  "packages/core/migrate-layout.js",
  // The viewer's twin. The viewer is a browser bundle and cannot import
  // `layout.ts`, which reaches for `node:fs` at module scope. Pinned to
  // `layoutStateNames()` by the same contract test as the copies above.
  "packages/web/src/viewer/state-paths.ts",
  // `LEGACY_SOURCE_FILE_PREFIX`, the `.rex/` prefix carried by `sourceFile`
  // attributions written by the flat `prd.md`/`prd.json` backends. It is a
  // value in data already on disk, not a path this process constructs, and
  // those backends only ever existed under `.rex/` — resolving it would
  // orphan every attribution already recorded. The file's own docstring
  // carries the argument.
  "packages/rex/src/store/prd-md-migration.ts",
];

/** A paths module answers the resolver's question for one package. */
const PATHS_MODULE = /\/src\/(?:[^/]+\/)?paths\.ts$/;

/**
 * A path-shaped literal naming something the layout owns: the three tool
 * directories, or one of the loose `.n-dx*` files that moved with them.
 *
 * One pattern for both, because the rule is now one wall. The detector did not
 * change when the config half stopped being a ratchet — only what the suite
 * does with what it finds.
 */
const LAYOUT_LITERAL =
  /(["'`])(\.(?:rex|hench|sourcevision)(?:\/[^"'`\s]*)?|\.n-dx(?:\.local)?\.json|\.n-dx-web[^"'`\s]*)\1/g;

/**
 * Blank out comment bodies, preserving newlines so line numbers still line up
 * with the file on disk — the failure message has to be able to point at one.
 *
 * ## Why this is line-by-line, and why it tracks quotes
 *
 * A glob is full of characters that look like comment delimiters: `".hench/**"`
 * contains `/*`. The first version of this scanned for delimiters without
 * knowing whether it was inside a string, so that glob opened a comment which
 * ran to the next `*\/` — in practice most of the rest of the file. Fourteen
 * sites across seven files were silently exempt, among them every
 * `blockedPaths` entry in hench's guard defaults and the whole config-secrets
 * section of `ci.js`. That is the vacuous-detector failure the self-test above
 * is written against, arriving through the blanking pass rather than the
 * pattern.
 *
 * Tracking quotes fixes that but introduces the mirror failure, because this
 * is not a JavaScript parser: an apostrophe in prose (`// Don't`) or a quote
 * inside a regex literal (`/["']/`) opens a string that never closes, and
 * everything after it is misread. Resetting the quote state at every newline
 * is what bounds that. A line this cannot parse costs one line of accuracy
 * instead of a file, and no construct in this repository spans a line *and*
 * hides a layout literal.
 */
function blankComments(src) {
  const lines = src.split("\n");
  let inBlockComment = false;

  const blanked = lines.map((line) => {
    let out = "";
    let i = 0;
    const n = line.length;

    while (i < n) {
      if (inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          out += " ".repeat(n - i);
          i = n;
        } else {
          out += " ".repeat(end + 2 - i);
          i = end + 2;
          inBlockComment = false;
        }
        continue;
      }

      const c = line[i];
      const d = line[i + 1];

      if (c === "/" && d === "*") {
        inBlockComment = true;
        continue;
      }
      if (c === "/" && d === "/") {
        out += " ".repeat(n - i);
        i = n;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        out += c;
        i++;
        while (i < n) {
          if (line[i] === "\\") {
            out += line[i] + (line[i + 1] ?? "");
            i += 2;
            continue;
          }
          out += line[i];
          if (line[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      out += c;
      i++;
    }

    return out;
  });

  return blanked.join("\n");
}

function walkSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
    if (entry.name === "assistant-assets" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, files);
    } else if (/\.(?:ts|tsx|js)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Production source: each package's `src/`, plus core's orchestration scripts. */
function collectScanRoots() {
  const roots = [];
  const packagesDir = join(ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(packagesDir, entry.name, "src");
    if (existsSync(src)) roots.push(src);
  }
  roots.push(join(packagesDir, "core"));
  return roots;
}

function toPosixRelative(file) {
  return relative(ROOT, file).split(sep).join("/");
}

/**
 * Every production file the rule applies to, exemptions included.
 *
 * Separate from {@link findLayoutLiterals} so the self-test can assert the
 * walker actually reached the tree. A floor on the *findings* cannot do that
 * job any more: the directory half is at zero by design, and the config half
 * is meant to reach zero too, so a walker that silently collected nothing
 * would read as the sweep succeeding.
 */
export function scanProductionFiles() {
  const seen = new Set();
  for (const root of collectScanRoots()) {
    for (const file of walkSourceFiles(root)) seen.add(toPosixRelative(file));
  }
  return [...seen];
}

/**
 * Every layout literal in one file's source, with the line it sits on.
 *
 * Shared with the self-tests below so they exercise the scan the wall runs,
 * rather than a second copy of it that can agree with itself while the real
 * one has gone blind.
 */
function findSites(source) {
  const code = blankComments(source);
  const sites = [];
  for (const match of code.matchAll(LAYOUT_LITERAL)) {
    sites.push({
      line: code.slice(0, match.index).split("\n").length,
      text: match[0],
    });
  }
  return sites;
}

/** Every flagged file, with the line and text of each literal in it. */
export function findLayoutLiterals() {
  const found = new Map();
  const seen = new Set();
  for (const root of collectScanRoots()) {
    for (const file of walkSourceFiles(root)) {
      const relPath = toPosixRelative(file);
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      if (ALLOWED.includes(relPath) || PATHS_MODULE.test(relPath)) continue;

      const sites = findSites(readFileSync(file, "utf8"));
      if (sites.length > 0) found.set(relPath, sites);
    }
  }
  return found;
}

/**
 * The wall's report: one `file:line  literal` line per site.
 *
 * Separate from the assertion so the self-test can drive it with a fixture.
 * On a clean tree the wall's own expectation is `[] === []`, which proves the
 * rule holds but not that it can still name an offender — and naming one is
 * the whole of its value on the day it fires.
 */
function offenders(found) {
  const lines = [];
  for (const [file, sites] of found) {
    for (const site of sites) lines.push(`  ${file}:${site.line}  ${site.text}`);
  }
  return lines;
}

describe("layout-literal policy", () => {
  it("reaches the whole production tree (walker self-test)", () => {
    // A walker that silently collects nothing turns every check below
    // vacuously green — which has happened on this lane before, to a scan
    // whose filter read `\+` as a quantifier and dropped every line.
    //
    // This used to be a floor on the *findings*, which worked only while the
    // debt was large: the directory half is now zero by design and the config
    // half is meant to follow it, so a findings floor would fail on the sweep
    // succeeding, exactly as an earlier version did when A6 took `cli.js` from
    // 50 literals to 1. A floor on the files *visited* says the same thing
    // about the scan and never has to be relaxed again.
    const scanned = scanProductionFiles();

    expect(scanned.length).toBeGreaterThan(500);
    // Reached inside the packages, not just their top level.
    expect(scanned).toContain("packages/llm-client/src/layout.ts");
    expect(scanned).toContain("packages/web/src/viewer/views/files.ts");
    expect(scanned).toContain("packages/core/cli.js");
  });

  it("still matches a literal when it sees one (detector self-test)", () => {
    // The pattern half of the same guard, on a fixture rather than the tree,
    // so it keeps its teeth now that the tree is clean and the wall's own
    // assertion is `[] === []`.
    const sites = findSites(
      [
        'const a = join(dir, ".rex/prd_tree");',
        'const b = ".n-dx.json";',
        'const c = resolveLayout(root).henchDir;',
      ].join("\n"),
    );

    // Both halves, one pattern: a directory and a config file are the same
    // kind of finding now.
    expect(sites.map((s) => s.text)).toEqual(['".rex/prd_tree"', '".n-dx.json"']);
    expect(sites.map((s) => s.line)).toEqual([1, 2]);
  });

  it("reports a new .n-dx* literal with its file and line (wall self-test)", () => {
    // The acceptance criterion the ratchet's retirement has to meet: a config
    // literal anywhere outside ALLOWED fails, and the failure says where. The
    // wall below cannot show this on a clean tree, so it is shown here against
    // the same `findSites` the real scan uses.
    const sites = findSites(
      [
        'const cfg = join(root, ".n-dx.json");',
        "const unrelated = 1;",
        'const local = join(root, ".n-dx.local.json");',
        'const port = join(root, ".n-dx-web.port");',
      ].join("\n"),
    );

    expect(offenders(new Map([["packages/web/src/server/example.ts", sites]]))).toEqual([
      '  packages/web/src/server/example.ts:1  ".n-dx.json"',
      '  packages/web/src/server/example.ts:3  ".n-dx.local.json"',
      '  packages/web/src/server/example.ts:4  ".n-dx-web.port"',
    ]);
  });

  it("does not flag the resolver, the paths modules or the twins", () => {
    const found = findLayoutLiterals();

    for (const allowed of [
      "packages/llm-client/src/layout.ts",
      "packages/core/layout.js",
      "packages/llm-client/src/project-dirs.ts",
      "packages/rex/src/store/paths.ts",
      "packages/sourcevision/src/export/iso-sources.ts",
      "packages/web/src/viewer/state-paths.ts",
    ]) {
      expect(found.has(allowed), `${allowed} should be exempt`).toBe(false);
    }
  });

  it("ignores a layout path named in a comment", () => {
    // Guards the blanking pass: the files that explain the layout mention it
    // most, and flagging their prose would make the rule unusable.
    const code = blankComments(
      ['/** The PRD lives in `.rex/prd_tree/`. */', '// and `.hench/runs/` too', 'const x = 1;'].join("\n"),
    );

    expect([...code.matchAll(LAYOUT_LITERAL)]).toEqual([]);
    // Blanking must not move any line.
    expect(code.split("\n").length).toBe(3);
  });

  it("does not read a glob's slash-star as the start of a comment", () => {
    // The blanking pass used to scan for `/*` without knowing it was inside a
    // string, so the `/**` in a blockedPaths glob opened a comment that ran to
    // the next `*/` — in practice, most of the rest of the file. Fourteen
    // sites across seven files were silently exempt, including the two this
    // asserts on.
    const code = blankComments(
      ['const blocked = [".hench/**", ".rex/**"];', 'const after = ".sourcevision/zones.json";'].join("\n"),
    );

    expect([...code.matchAll(LAYOUT_LITERAL)].map((m) => m[0])).toEqual([
      '".hench/**"',
      '".rex/**"',
      '".sourcevision/zones.json"',
    ]);
  });

  it("ignores prose that merely names a folder", () => {
    const prose = 'info(".hench/ already initialized, skipping");';
    const path = 'join(dir, ".hench/runs");';

    expect([...prose.matchAll(LAYOUT_LITERAL)]).toEqual([]);
    expect([...path.matchAll(LAYOUT_LITERAL)]).toHaveLength(1);
  });

  it("allows no literal .rex/, .hench/, .sourcevision/ or .n-dx* path at all", () => {
    // The wall, both halves. The sweep is finished and there is no inventory
    // to register a site in, so anything here is a new one and the only way to
    // keep it is to edit ALLOWED above and say why.
    const found = offenders(findLayoutLiterals());

    expect(
      found,
      `Literal layout path(s). Ask the resolver instead:\n` +
        `${found.join("\n")}\n\n` +
        `  import { resolveLayout } from "@n-dx/llm-client";\n` +
        `  const { rexDir, henchDir, sourcevisionDir } = resolveLayout(root);\n` +
        `  const { configFile, localConfigFile } = resolveLayout(root);\n\n` +
        `A package with a paths module (rex, sourcevision, hench, web) asks that\n` +
        `instead; hench reaches the resolver through src/prd/llm-gateway.ts.\n` +
        `Display copy that cannot reach a resolver — viewer text, static help —\n` +
        `names the command or the tool rather than the directory, or takes the\n` +
        `resolved name from the server; see\n` +
        `packages/web/src/viewer/views/hench-config.ts for the worked example.\n` +
        `If the file genuinely owns the layout decision, add it to ALLOWED in\n` +
        `${toPosixRelative(join(ROOT, "tests/e2e/layout-literal-policy.test.js"))} and say why.`,
    ).toEqual([]);
  });
});
