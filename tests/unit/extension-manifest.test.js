/**
 * The `ndx.extension` manifest validator (packages/core/extension-manifest.js).
 *
 * Every rule in `EXTENSION_MANIFEST_RULES` has a failing and a passing fixture
 * in `RULE_FIXTURES`, and the suite fails when a rule is added without them.
 * Each fixture is an edit of `BASE`, a manifest that passes every rule.
 *
 * @see docs/architecture/extensions.md — the contract these rules enforce
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateExtensionManifest,
  formatProblem,
  escapeControlCharacters,
  isSemverRange,
  satisfiesSemverRange,
  EXTENSION_MANIFEST_RULES,
  EXTENSION_MANIFEST_FIELDS,
  RESERVED_EXTENSION_NAMES,
  SUPPORTED_EXTENSION_API_VERSIONS,
} from "../../packages/core/extension-manifest.js";

const ROOT = join(import.meta.dirname, "../..");
const BUILTINS = ["init", "work", "status", "config", "start", "web", "graview"];

const BASE = Object.freeze({
  apiVersion: 1,
  name: "recon",
  displayName: "Recon",
  ndxVersion: ">=0.10.0 <0.12.0",
  commands: [{ name: "recon", bin: "bin/cli.js", summary: "Prepare and assess many repositories" }],
  sidecar: { bin: "bin/serve.js", health: "/healthz", idleStopMinutes: 15 },
  hub: { label: "Recon", description: "Batch-prepare repositories" },
  projectLinks: [{ label: "Assessment", path: "/project/{projectId}?root={repoRoot}" }],
  configSchema: "schema/config.json",
});

/**
 * A package.json around `BASE` after `edit` has changed a copy of it. `edit`
 * also receives the package.json, for the rules about the package itself.
 */
function pkg(edit = () => {}) {
  const block = structuredClone(BASE);
  const packageJson = { name: "@acme/ndx-recon", version: "1.0.0", ndx: { extension: block } };
  const result = edit(block, packageJson);
  if (result !== undefined) packageJson.ndx.extension = result;
  return packageJson;
}

function validate(packageJson) {
  return validateExtensionManifest(packageJson, { builtinCommands: BUILTINS });
}

/** @type {Record<string, { fail: (m: any, p: any) => any, pass: (m: any, p: any) => any }>} */
const RULE_FIXTURES = {
  "block-object": { fail: () => "recon", pass: () => {} },
  "api-version-integer": { fail: (m) => { m.apiVersion = "1"; }, pass: (m) => { m.apiVersion = 1; } },
  "api-version-supported": { fail: (m) => { m.apiVersion = 99; }, pass: (m) => { m.apiVersion = 1; } },
  "unknown-field": { fail: (m) => { m.comands = []; }, pass: (m) => { m.commands = BASE.commands; } },
  "required": { fail: (m) => { delete m.ndxVersion; }, pass: (m) => { m.ndxVersion = ">=0.10.0"; } },
  "name-slug": { fail: (m) => { m.name = "Recon_Tool"; }, pass: (m) => { m.name = "recon-tool"; } },
  "name-reserved": { fail: (m) => { m.name = "hub"; }, pass: (m) => { m.name = "hubble"; } },
  "name-builtin": {
    fail: (m) => { m.commands[0].name = "status"; },
    pass: (m) => { m.commands[0].name = "statuses"; },
  },
  "non-empty-string": { fail: (m) => { m.displayName = "  "; }, pass: (m) => { m.displayName = "Recon"; } },
  "control-character": {
    fail: (m) => { m.commands[0].bin = "bin/cli.js\n  source   user (/safe/place)"; },
    pass: (m) => { m.commands[0].bin = "bin/cli.js"; },
  },
  "package-version": { fail: (m, p) => { p.version = "1.0.0\u001b[2K"; }, pass: (m, p) => { p.version = "1.0.0-rc.1"; } },
  "summary-length": {
    fail: (m) => { m.commands[0].summary = "x".repeat(101); },
    pass: (m) => { m.commands[0].summary = "x".repeat(100); },
  },
  "ndx-version-range": { fail: (m) => { m.ndxVersion = "0.10 or later"; }, pass: (m) => { m.ndxVersion = "^0.10.0"; } },
  "array": { fail: (m) => { m.projectLinks = BASE.projectLinks[0]; }, pass: (m) => { m.projectLinks = []; } },
  "object": { fail: (m) => { m.sidecar = "bin/serve.js"; }, pass: (m) => { m.sidecar = { bin: "bin/serve.js" }; } },
  "nothing-declared": {
    fail: (m) => { m.commands = []; delete m.sidecar; delete m.hub; delete m.projectLinks; },
    pass: (m) => { delete m.sidecar; delete m.hub; delete m.projectLinks; },
  },
  "command-duplicate": {
    fail: (m) => { m.commands.push({ ...m.commands[0] }); },
    pass: (m) => { m.commands.push({ ...m.commands[0], name: "recon-batch" }); },
  },
  "package-path": { fail: (m) => { m.sidecar.bin = "../other/serve.js"; }, pass: (m) => { m.sidecar.bin = "./dist/serve.js"; } },
  "url-path": { fail: (m) => { m.sidecar.health = "healthz"; }, pass: (m) => { m.sidecar.health = "/ready"; } },
  "positive-integer": { fail: (m) => { m.sidecar.idleStopMinutes = 0; }, pass: (m) => { m.sidecar.idleStopMinutes = 1; } },
  "needs-sidecar": { fail: (m) => { delete m.sidecar; }, pass: (m) => { delete m.sidecar; delete m.hub; delete m.projectLinks; } },
  "link-placeholder": {
    fail: (m) => { m.projectLinks[0].path = "/project/{projectName}"; },
    pass: (m) => { m.projectLinks[0].path = "/project/{projectId}"; },
  },
};

describe("validateExtensionManifest", () => {
  it("accepts the base manifest", () => {
    const result = validate(pkg());
    expect(result.problems).toEqual([]);
    expect(result.status).toBe("valid");
    expect(result.manifest?.name).toBe("recon");
  });

  it("has a failing and a passing fixture for every rule", () => {
    expect(Object.keys(RULE_FIXTURES).sort()).toEqual(Object.keys(EXTENSION_MANIFEST_RULES).sort());
  });

  for (const [rule, { fail, pass }] of Object.entries(RULE_FIXTURES)) {
    it(`${rule}: the failing fixture breaks it and the passing one does not`, () => {
      const failed = validate(pkg(fail));
      expect(failed.problems.map((p) => p.rule)).toContain(rule);
      expect(failed.status).toBe(rule === "api-version-supported" ? "incompatible" : "invalid");

      const passed = validate(pkg(pass));
      expect(passed.problems).toEqual([]);
      expect(passed.status).toBe("valid");
    });
  }

  it("reports an unknown apiVersion as incompatible and checks nothing else", () => {
    const result = validate(pkg((m) => { m.apiVersion = 2; m.name = "Not A Slug"; m.futureField = true; }));
    expect(result.status).toBe("incompatible");
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].rule).toBe("api-version-supported");
    expect(result.name).toBe("Not A Slug");
  });

  it("rejects every reserved name and every built-in command, as extension name and as command", () => {
    for (const name of [...RESERVED_EXTENSION_NAMES, ...BUILTINS]) {
      const asExtension = validate(pkg((m) => { m.name = name; m.commands[0].name = "recon"; }));
      const asCommand = validate(pkg((m) => { m.commands[0].name = name; }));
      const rule = RESERVED_EXTENSION_NAMES.includes(name) ? "name-reserved" : "name-builtin";
      expect(asExtension.problems.map((p) => p.rule), name).toContain(rule);
      expect(asCommand.problems.map((p) => p.rule), name).toContain(rule);
    }
  });

  it("reports every problem, not just the first", () => {
    const result = validate(pkg((m) => {
      m.name = "Bad";
      m.ndxVersion = "soon";
      m.sidecar.health = "nope";
      m.commands[0].bin = "/abs/cli.js";
    }));
    expect(result.problems.map((p) => p.rule).sort()).toEqual(
      ["name-slug", "ndx-version-range", "package-path", "url-path"].sort(),
    );
  });

  it("names the package, the JSON path, the rule and the fix on one line", () => {
    const [problem] = validate(pkg((m) => { m.sidecar.idleStopMinutes = -5; })).problems;
    expect(problem).toMatchObject({ package: "@acme/ndx-recon", path: "ndx.extension.sidecar.idleStopMinutes" });
    const line = formatProblem(problem);
    expect(line).not.toMatch(/\n/);
    expect(line).toContain("@acme/ndx-recon");
    expect(line).toContain("ndx.extension.sidecar.idleStopMinutes");
    expect(line).toContain("[positive-integer]");
    expect(line).toContain(EXTENSION_MANIFEST_RULES["positive-integer"]);
  });

  it("uses packageLabel when given, for a package found by path", () => {
    const result = validateExtensionManifest(
      { ndx: { extension: "x" } },
      { builtinCommands: [], packageLabel: "/ext/node_modules/broken" },
    );
    expect(result.problems[0].package).toBe("/ext/node_modules/broken");
  });

  it("requires builtinCommands, so no caller silently skips the shadowing check", () => {
    // @ts-expect-error — the missing option is the point
    expect(() => validateExtensionManifest(pkg(), {})).toThrow(/builtinCommands/);
  });

  it("checks link placeholders in linear time, so a run of '{' cannot stall discovery", () => {
    // Quadratic before: each '{' restarted a scan to the end (CodeQL js/polynomial-redos).
    // At 2M characters the old regex blocks the worker for over ten minutes, so a regression
    // stalls this file until the run's own timeout; linear, it takes milliseconds.
    const result = validate(pkg((m) => { m.projectLinks[0].path = `/${"{".repeat(2_000_000)}`; }));
    expect(result.status).toBe("valid");
  });

  it("still reads the placeholder inside nested braces", () => {
    const result = validate(pkg((m) => { m.projectLinks[0].path = "/p/{{projectName}}"; }));
    expect(result.problems.map((p) => p.rule)).toEqual(["link-placeholder"]);
    expect(result.problems[0].message).toContain("{projectName}");
  });

  it("refuses a control character in every manifest string and in the package name", () => {
    const edits = {
      "ndx.extension.displayName": (m) => { m.displayName = "Recon\u001b[1A"; },
      "ndx.extension.ndxVersion": (m) => { m.ndxVersion = ">=0.10.0\t"; },
      "ndx.extension.commands[0].bin": (m) => { m.commands[0].bin = "bin/cli.js\r"; },
      "ndx.extension.commands[0].summary": (m) => { m.commands[0].summary = "Assess\u0085"; },
      "ndx.extension.sidecar.bin": (m) => { m.sidecar.bin = "bin/serve.js\u0007"; },
      "ndx.extension.sidecar.health": (m) => { m.sidecar.health = "/healthz\u007f"; },
      "ndx.extension.hub.label": (m) => { m.hub.label = "Recon\n"; },
      "ndx.extension.hub.description": (m) => { m.hub.description = "Batch\u0000"; },
      "ndx.extension.projectLinks[0].label": (m) => { m.projectLinks[0].label = "\u009b2J"; },
      "ndx.extension.projectLinks[0].path": (m) => { m.projectLinks[0].path = "/project/\u001b"; },
      "ndx.extension.configSchema": (m) => { m.configSchema = "schema/\u001bconfig.json"; },
      "name": (m, p) => { p.name = "@acme/ndx-recon\u001b[2K"; },
    };
    for (const [path, edit] of Object.entries(edits)) {
      const result = validate(pkg(edit));
      expect(result.status, path).toBe("invalid");
      expect(result.problems.find((p) => p.path === path)?.rule, path).toBe("control-character");
      for (const problem of result.problems) expect(formatProblem(problem), path).not.toMatch(/\p{Cc}/u);
    }
  });

  it("requires the package version to be a semver version", () => {
    for (const version of [undefined, 1, "", "1.0", "latest", "1.0.0 \n"]) {
      const result = validate(pkg((m, p) => { p.version = version; }));
      expect(result.problems.map((p) => p.rule), String(version)).toEqual(["package-version"]);
    }
  });

  it("escapeControlCharacters writes every control character as a visible escape", () => {
    expect(escapeControlCharacters("a\u001b[2Kb\nc\u009bd\u007f")).toBe("a\\x1b[2Kb\\x0ac\\x9bd\\x7f");
    expect(escapeControlCharacters("C:\\tools — ok")).toBe("C:\\tools — ok");
  });

  it("rejects package paths that escape the package on either platform", () => {
    for (const bin of ["/etc/cli.js", "C:\\tools\\cli.js", "..\\cli.js", "bin/../../cli.js", ".."]) {
      const result = validate(pkg((m) => { m.commands[0].bin = bin; }));
      expect(result.problems.map((p) => p.rule), bin).toContain("package-path");
    }
  });
});

describe("isSemverRange", () => {
  it.each([
    ">=0.10.0 <0.12.0", "^0.10.0", "~1.2", "1.x", "*", "0.10.0", ">= 0.10.0", "1.2.0 - 1.4.0",
    "^1.0.0 || ^2.0.0", ">=1.0.0-beta.1", "v1.2.3",
  ])("accepts %s", (range) => expect(isSemverRange(range)).toBe(true));

  it.each(["", "  ", "latest", "0.10 or later", ">=", "1.2.3.4", "^01.0.0", "1.0.0 -", "||"])(
    "rejects %j", (range) => expect(isSemverRange(range)).toBe(false),
  );
});

describe("satisfiesSemverRange", () => {
  // Each row was checked against npm's `semver.satisfies`.
  it.each([
    ["0.10.0", ">=0.10.0 <0.12.0", true],
    ["0.11.9", ">=0.10.0 <0.12.0", true],
    ["0.12.0", ">=0.10.0 <0.12.0", false],
    ["0.9.9", ">=0.10.0 <0.12.0", false],
    ["0.10.5", "^0.10.0", true],
    ["0.11.0", "^0.10.0", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.9.0", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["0.10.9", "^0.10", true],
    ["0.9.0", "^0", true],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.9.0", "~1", true],
    ["1.4.0", "1.x", true],
    ["2.0.0", "1.x", false],
    ["0.10.3", "0.10", true],
    ["5.0.0", "*", true],
    ["0.10.0", "0.10.0", true],
    ["0.10.1", "=0.10.0", false],
    ["1.0.0", ">0.10", true],
    ["0.10.9", ">0.10", false],
    ["0.10.9", "<=0.10", true],
    ["0.11.0", "<=0.10", false],
    ["1.4.9", "1.2.0 - 1.4", true],
    ["1.5.0", "1.2.0 - 1.4", false],
    ["2.1.0", "^1.0.0 || ^2.0.0", true],
    ["3.0.0", "^1.0.0 || ^2.0.0", false],
    ["0.10.0", ">= 0.10.0", true],
    ["v0.10.0", ">=0.10.0", true],
    ["0.11.0-rc.1", ">=0.10.0", false],
    ["0.11.0-rc.2", ">=0.11.0-rc.1", true],
    ["0.11.0-rc.1", ">=0.11.0-rc.2", false],
    ["0.11.0-rc.10", ">=0.11.0-rc.9", true],
    ["0.11.0", ">=0.11.0-rc.1", true],
    ["0.10.0", "latest", false],
    ["not-a-version", ">=0.0.0", false],
  ])("%s in %s is %s", (version, range, expected) => {
    expect(satisfiesSemverRange(version, range)).toBe(expected);
  });
});

describe("extension-manifest.schema.json", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "packages/core/extension-manifest.schema.json"), "utf8"));

  it("declares the same top-level fields as the validator", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...EXTENSION_MANIFEST_FIELDS].sort());
  });

  it("pins the same apiVersion, reserved names and name pattern", () => {
    expect([schema.properties.apiVersion.const]).toEqual([...SUPPORTED_EXTENSION_API_VERSIONS]);
    expect(schema.$defs.name.not.enum.sort()).toEqual([...RESERVED_EXTENSION_NAMES].sort());
    const pattern = new RegExp(schema.$defs.name.pattern);
    expect(pattern.test("recon-tool")).toBe(true);
    expect(pattern.test("Recon_Tool")).toBe(false);
  });

  it("ships with @n-dx/core", () => {
    const { files } = JSON.parse(readFileSync(join(ROOT, "packages/core/package.json"), "utf8"));
    expect(files).toContain("extension-manifest.js");
    expect(files).toContain("extension-manifest.schema.json");
  });
});
