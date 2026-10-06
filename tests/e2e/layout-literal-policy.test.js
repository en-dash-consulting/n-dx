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
 * ## What it can and cannot promise today
 *
 * The acceptance criterion this rule serves is absolute — *no* literal outside
 * the resolver and the migration command — and that is not reachable yet: the
 * sweep it depends on (`c64f053e`, routing hench, web and core through their
 * paths modules) has not run, and 160 sites across 68 files are still waiting
 * for it. So the rule is a ratchet rather than a wall: every one of those
 * files is named in `tests/layout-literal-inventory.md` with the count it is
 * allowed, a **new** file fails, and an existing file that grows fails. When
 * the sweep lands, the inventory is deleted and the allow-list below stands
 * alone — which is the rule as originally specified, with no change to the
 * detector.
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
 * @see tests/layout-literal-inventory.md — the debt, and what is being done about it
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const INVENTORY_PATH = join(ROOT, "tests", "layout-literal-inventory.md");

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
  // `src/export/` bundles into the dependency-free standalone skill script and
  // may import nothing but `node:` builtins, so it carries its own twins.
  // `tests/integration/layout-resolver-contract.test.js` pins them.
  "packages/sourcevision/src/export/iso-sources.ts",
  "packages/sourcevision/src/export/iso-declared.ts",
  // The command whose entire purpose is moving a project between layouts.
  // Listed ahead of its arrival so the rule does not have to be edited when it
  // lands.
  "packages/rex/src/cli/commands/migrate-layout.ts",
  "packages/core/migrate-layout.js",
];

/** A paths module answers the resolver's question for one package. */
const PATHS_MODULE = /\/src\/(?:[^/]+\/)?paths\.ts$/;

/**
 * A path-shaped literal naming something the layout owns: the three tool
 * directories, or one of the loose `.n-dx*` files that moved with them.
 *
 * The `.n-dx*` family is in scope even though the task names only the three
 * directories: the resolver owns those paths too, and the config-reader bug
 * described above was `.n-dx.json`, so a rule that let it through would not
 * have caught the defect that prompted the rule.
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

      const code = blankComments(readFileSync(file, "utf8"));
      const sites = [];
      for (const match of code.matchAll(LAYOUT_LITERAL)) {
        sites.push({
          line: code.slice(0, match.index).split("\n").length,
          text: match[0],
        });
      }
      if (sites.length > 0) found.set(relPath, sites);
    }
  }
  return found;
}

/** The heading after which rows describe files that have not merged yet. */
const PENDING_HEADING = "### Registered ahead of merge";

/**
 * `| path | count | …` rows of the inventory.
 *
 * `ceilings` is every row, because a ceiling applies wherever the file is.
 * `pending` is the subset below {@link PENDING_HEADING} — ceilings registered
 * for literals that arrive with a branch still in review. Those are exempt
 * from the stale-row check and nothing else: a file can already exist on the
 * default branch and be perfectly clean there, and still be about to gain a
 * literal from an open PR.
 */
function readInventory() {
  const ceilings = new Map();
  const pending = new Set();
  let inPending = false;
  for (const raw of readFileSync(INVENTORY_PATH, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("### ")) inPending = line === PENDING_HEADING;
    const row = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|/.exec(line);
    if (!row) continue;
    ceilings.set(row[1], Number(row[2]));
    if (inPending) pending.add(row[1]);
  }
  return { ceilings, pending };
}

describe("layout-literal policy", () => {
  it("still finds the literals it is meant to find (detector self-test)", () => {
    const found = findLayoutLiterals();
    const sites = [...found.values()].flat();

    // A detector that silently matches nothing turns every check below
    // vacuously green — which has happened on this lane before, to a scan
    // whose filter read `\+` as a quantifier and dropped every line.
    //
    // Deliberately not anchored to a named file. The first version asserted
    // that `packages/core/cli.js` held more than ten literals; A6 then routed
    // it through the resolver and took it from 50 to 1, so the self-test
    // failed on the sweep *working*. A floor on the whole scan says the same
    // thing about the detector without betting on which file is still dirty,
    // and it relaxes on its own as the debt falls — the inventory's own total
    // is the number that has to come down, and the rows below check that.
    expect(found.size).toBeGreaterThan(20);
    expect(sites.length).toBeGreaterThan(50);

    // Every site carries a line number, so a failure can point at one.
    for (const site of sites) expect(site.line).toBeGreaterThan(0);
  });

  it("does not flag the resolver, the paths modules or the iso twins", () => {
    const found = findLayoutLiterals();

    for (const allowed of [
      "packages/llm-client/src/layout.ts",
      "packages/core/layout.js",
      "packages/llm-client/src/project-dirs.ts",
      "packages/rex/src/store/paths.ts",
      "packages/sourcevision/src/export/iso-sources.ts",
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

  it("names no file that is not in the inventory", () => {
    const { ceilings } = readInventory();
    const unlisted = [...findLayoutLiterals().entries()]
      .filter(([file]) => !ceilings.has(file))
      .map(([file, sites]) => `  ${file}:${sites[0].line}  ${sites[0].text}`);

    expect(
      unlisted,
      `New literal layout path(s). Ask the resolver instead:\n` +
        `${unlisted.join("\n")}\n\n` +
        `  import { resolveLayout } from "@n-dx/llm-client";\n` +
        `  const { rexDir, henchDir, sourcevisionDir, configFile } = resolveLayout(root);\n\n` +
        `A package with a paths module (rex, sourcevision, hench, web) asks that\n` +
        `instead. If the file genuinely owns the layout decision, add it to\n` +
        `ALLOWED in ${toPosixRelative(join(ROOT, "tests/e2e/layout-literal-policy.test.js"))}\n` +
        `and say why. See tests/layout-literal-inventory.md.`,
    ).toEqual([]);
  });

  it("holds every file at or below its recorded count", () => {
    const { ceilings } = readInventory();
    const grown = [];
    for (const [file, sites] of findLayoutLiterals()) {
      const ceiling = ceilings.get(file);
      if (ceiling === undefined || sites.length <= ceiling) continue;
      grown.push(
        `  ${file}: ${sites.length} literals, inventory allows ${ceiling}\n` +
          sites.slice(ceiling).map((s) => `      ${file}:${s.line}  ${s.text}`).join("\n"),
      );
    }

    expect(
      grown,
      `File(s) added a literal layout path:\n${grown.join("\n")}\n\n` +
        `These files are already carrying layout debt, which is why they are in\n` +
        `tests/layout-literal-inventory.md — but the count may only go down.\n` +
        `Route the new call through the resolver or the package's paths module.`,
    ).toEqual([]);
  });

  it("carries no inventory row for a file that no longer has any", () => {
    // Keeps the debt figure honest as the sweep lands: a row left behind after
    // its file is clean would hold the total above the truth and hide the next
    // literal added to that file.
    //
    // A row for a file that does not exist is not stale — it is a ceiling
    // registered ahead of a branch that has not merged yet. Without that, this
    // rule could only land in one exact position in the review queue: three of
    // the four branches open when it was written add a file carrying literals,
    // and each would have failed the moment it merged. Pre-registering is the
    // difference between a policy that slots in anywhere and one that has to
    // be timed.
    const found = findLayoutLiterals();
    const { ceilings, pending } = readInventory();
    const stale = [...ceilings.keys()]
      .filter((file) => !pending.has(file))
      .filter((file) => !found.has(file));

    expect(
      stale,
      `tests/layout-literal-inventory.md lists file(s) with no literals left:\n` +
        stale.map((f) => `  - ${f}`).join("\n") +
        `\nDelete the row and lower the total — that is the ratchet working.`,
    ).toEqual([]);
  });
});
