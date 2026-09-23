/**
 * A setup hook must never be given less time than the test it prepares.
 *
 * Vitest defaults `testTimeout` to 5s and `hookTimeout` to 10s, so the default
 * pair already satisfies that. Raising `testTimeout` alone silently inverts it:
 * every config in this repository that raised the test budget left the hook
 * budget on the 10s default, which gave a `beforeEach` a third (hench, rex,
 * sourcevision) or a twelfth (root) of the budget of the test it exists to set
 * up. Those hooks do the same work the tests do — `mkdtemp`, then
 * `initGitFixtureRepo`'s `git init`/`add`/`commit` as subprocesses — and on a
 * loaded Windows CI runner that legitimately exceeds 10s, which is what
 * produced `Hook timed out in 10000ms` in the hench integration suites while
 * the tests themselves had 30s to spare.
 *
 * That is an oversight rather than a policy, so it is pinned here: raising
 * `testTimeout` in a future config without raising `hookTimeout` with it fails
 * this test instead of surfacing as an intermittent CI failure months later.
 *
 * @see ENFORCEMENT.md
 * @see TESTING.md — "Timeout Guardrails"
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Every vitest config the repository's own suites run under. */
function discoverConfigs() {
  const found = [];
  const collect = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (/^vitest\..*config\.(js|ts|mjs)$/.test(entry)) found.push(join(dir, entry));
    }
  };

  collect(ROOT);
  const packagesDir = join(ROOT, "packages");
  for (const pkg of readdirSync(packagesDir)) {
    collect(join(packagesDir, pkg));
  }
  return found.sort();
}

/**
 * Drop comments before reading settings out of a config.
 *
 * Every config here explains its timeouts in a comment directly above them, so
 * without this a sentence like "set hookTimeout: 30000" would read as the
 * setting itself and report a budget nothing applies.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Read a numeric option out of the config source.
 *
 * Deliberately textual rather than importing the config: the package configs
 * are TypeScript, rex's bench config re-imports its sibling through a `.js`
 * specifier that only resolves under that package's own alias table, and this
 * check is about what a reader of the file sees. Underscore separators
 * (`30_000`) are how these files are written, so they are stripped.
 *
 * Three outcomes, not two. `undefined` means the key is absent. `"unreadable"`
 * means it is present but its value is not a plain numeric literal — an
 * expression, say, or a constant. The distinction is the whole point: an
 * earlier revision returned `undefined` for both and skipped the config, so a
 * `testTimeout` this parser could not read disabled the check for that file and
 * the suite stayed green. A config the policy cannot verify must fail it, not
 * be waved through.
 */
function readTimeout(source, key) {
  const value = source.match(new RegExp(`\\b${key}\\s*:\\s*([0-9_]+)\\b`));
  if (value) return Number(value[1].replaceAll("_", ""));
  return new RegExp(`\\b${key}\\s*:`).test(source) ? "unreadable" : undefined;
}

/** The violations a single config's source produces, empty when it complies. */
function violationsFor(label, source) {
  const clean = stripComments(source);
  const testTimeout = readTimeout(clean, "testTimeout");
  const hookTimeout = readTimeout(clean, "hookTimeout");

  // A config that raises neither runs on Vitest's defaults, where the hook
  // budget is already the larger of the two. Nothing to check.
  if (testTimeout === undefined) return [];

  if (testTimeout === "unreadable") {
    return [`${label}: testTimeout is set to something this policy cannot read as a number`];
  }
  if (hookTimeout === undefined) {
    return [
      `${label}: testTimeout ${testTimeout} with no hookTimeout ` +
        `(Vitest would use its 10000ms default)`,
    ];
  }
  if (hookTimeout === "unreadable") {
    return [`${label}: hookTimeout is set to something this policy cannot read as a number`];
  }
  if (hookTimeout < testTimeout) {
    return [`${label}: hookTimeout ${hookTimeout} < testTimeout ${testTimeout}`];
  }
  return [];
}

describe("vitest timeout policy", () => {
  const configs = discoverConfigs();

  it("finds the repository's vitest configs", () => {
    // Guards the discovery itself: a glob that silently matched nothing would
    // make every assertion below vacuously true.
    expect(configs.length).toBeGreaterThanOrEqual(6);
    expect(configs.map((c) => relative(ROOT, c))).toContain("vitest.config.js");
  });

  it("never gives a hook less time than the test it prepares", () => {
    const violations = configs.flatMap((path) =>
      violationsFor(relative(ROOT, path), readFileSync(path, "utf-8")),
    );

    expect(violations).toEqual([]);
  });

  // The check above is only worth as much as its parser. Every shape below was
  // a way past an earlier revision of it, so each one is pinned: a config that
  // raises testTimeout must be *caught*, never quietly skipped, however it is
  // punctuated.
  describe("the parser cannot be walked past", () => {
    const cases = [
      ["a trailing comma", `  test: {\n    testTimeout: 30_000,\n  },`],
      ["no trailing comma on the last property", `  test: {\n    testTimeout: 30000\n  },`],
      ["everything on one line", `  test: { include: [], testTimeout: 30000 },`],
      ["a computed value", `  test: {\n    testTimeout: CI ? 60000 : 30000,\n  },`],
    ];

    for (const [shape, source] of cases) {
      it(`reports a missing hookTimeout written with ${shape}`, () => {
        expect(violationsFor("fixture", source)).toHaveLength(1);
      });
    }

    it("reads a compliant pair whatever the punctuation", () => {
      expect(violationsFor("fixture", `  test: {\n    testTimeout: 30000\n    hookTimeout: 30000\n  },`)).toEqual([]);
      expect(violationsFor("fixture", `  test: { testTimeout: 30_000, hookTimeout: 30_000 },`)).toEqual([]);
    });

    it("ignores a comment that merely mentions a timeout", () => {
      const source = `  test: {\n    // Was hookTimeout: 5000, before this comment existed.\n    testTimeout: 30000,\n    hookTimeout: 30000,\n  },`;
      expect(violationsFor("fixture", source)).toEqual([]);
    });

    it("still catches an inverted pair", () => {
      expect(violationsFor("fixture", `  testTimeout: 30000,\n  hookTimeout: 10000,`)).toHaveLength(1);
    });
  });
});
