/**
 * The `ndx.extension` manifest: its v1 contract and the validator for it.
 *
 * An extension is any npm package whose `package.json` carries an
 * `ndx.extension` block (docs/architecture/extensions.md). n-dx reads that block
 * and nothing else from the package while discovering, so everything n-dx needs
 * to list, approve, dispatch to or mount an extension has to be checkable here,
 * from data alone, without running the package.
 *
 * `extension-manifest.schema.json` beside this file is the published JSON
 * Schema for the same block, for editors and publishers. This validator is what
 * n-dx itself runs: core is the orchestration tier and carries no schema
 * engine, and a schema engine could not say what a problem's fix is.
 * `tests/unit/extension-manifest.test.js` holds the two to the same field set.
 *
 * ## Three outcomes, not two
 *
 * - `valid` — the block follows a contract version this n-dx speaks, and every
 *   rule holds.
 * - `incompatible` — `apiVersion` is a version this n-dx does not speak. The
 *   rest of the block follows a contract we do not know, so it is not checked:
 *   the extension is listed with the reason and never run. An extension written
 *   for a newer n-dx is not broken, and must not be reported as if it were.
 * - `invalid` — the block breaks a rule of a contract this n-dx does speak.
 *
 * Every problem is one line naming the package, the JSON path, the rule and the
 * fix (`formatProblem`), so `ndx extensions doctor` can print them as they come.
 *
 * ## Strings reach the terminal
 *
 * Every manifest string, and the package's `name` and `version`, is printed by
 * `ndx extensions list`, `info` and the approval prompt, so a control character
 * in one could rewrite what the user approves. The validator refuses them
 * (`control-character`, `package-version`), and the printers pass what they
 * show through {@link escapeControlCharacters}, which also covers packages
 * that never validated.
 *
 * ## Built-in command names are passed in
 *
 * An extension name or command must not shadow a built-in command. The
 * built-in list is `cli.js`'s `COMMAND_DISPATCH` plus its tool delegations,
 * and `cli.js` cannot be imported (it runs on load), so callers pass
 * `builtinCommands`. It is required rather than defaulted to empty: an empty
 * default would let every caller that forgot it accept a shadowing extension
 * without a sound.
 *
 * @module n-dx/extension-manifest
 */

import { isAbsolute, posix, win32 } from "path";

/** Contract versions this n-dx speaks. A breaking change to the contract adds one. */
export const SUPPORTED_EXTENSION_API_VERSIONS = Object.freeze([1]);

/**
 * Names no extension and no extension command may take, beyond the built-in
 * commands the caller passes: n-dx's own bin aliases and the words the
 * extension surfaces themselves use (`ndx extensions`, the `/x/` mount, `hub`,
 * and `paths`, which discovery reads from the user config's `extensions`
 * object beside the per-extension config sections).
 */
export const RESERVED_EXTENSION_NAMES = Object.freeze([
  "ndx", "n-dx", "rex", "hench", "sourcevision", "sv",
  "ext", "x", "hub", "extensions", "paths",
]);

/** Placeholders a `projectLinks[].path` may carry; the hub fills them in. */
export const PROJECT_LINK_PLACEHOLDERS = Object.freeze(["projectId", "repoRoot"]);

/** Fields of the v1 `ndx.extension` block, in the order the docs list them. */
export const EXTENSION_MANIFEST_FIELDS = Object.freeze([
  "apiVersion", "name", "displayName", "ndxVersion", "commands",
  "sidecar", "hub", "projectLinks", "configSchema",
]);

const COMMAND_FIELDS = ["name", "bin", "summary"];
const SIDECAR_FIELDS = ["bin", "health", "idleStopMinutes"];
const HUB_FIELDS = ["label", "description"];
const PROJECT_LINK_FIELDS = ["label", "path"];

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 100;
const DRIVE_PREFIX = /^[A-Za-z]:/;
// C0, DEL and C1: newlines, tabs, ESC (terminal escape sequences) and the rest;
// plus the bidi embedding, override and isolate controls, which reorder a
// printed line visually without moving the cursor.
const CONTROL_CHARACTER = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;
const CONTROL_CHARACTERS = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Every rule the validator applies, with the fix it prints. The test suite
 * requires a failing and a passing fixture for each key.
 */
export const EXTENSION_MANIFEST_RULES = Object.freeze({
  "block-object": "make `ndx.extension` an object",
  "api-version-integer": "set `apiVersion` to an integer, e.g. 1",
  "api-version-supported": `use an n-dx that speaks this apiVersion, or target apiVersion ${SUPPORTED_EXTENSION_API_VERSIONS.join(" or ")}`,
  "unknown-field": "remove the field, or check its spelling against docs/architecture/extensions.md",
  "required": "add the field",
  "name-slug": `use a lowercase slug (a-z, 0-9, single hyphens, starting with a letter), at most ${MAX_NAME_LENGTH} characters`,
  "name-reserved": "choose a name that is not an n-dx bin alias or a reserved word",
  "name-builtin": "choose a name that is not a built-in ndx command",
  "non-empty-string": "set a non-empty string",
  "control-character": "remove the control characters (newlines, tabs, escape sequences, bidi controls) from the string",
  "package-version": "set package.json `version` to a semver version, e.g. 1.0.0",
  "summary-length": `keep the summary to one line of at most ${MAX_SUMMARY_LENGTH} characters`,
  "ndx-version-range": "use a semver range, e.g. \">=0.10.0 <0.12.0\"",
  "array": "make it an array",
  "object": "make it an object",
  "nothing-declared": "declare at least one command or a sidecar",
  "command-duplicate": "give each command a distinct name",
  "package-path": "use a relative path inside the package, e.g. bin/cli.js",
  "url-path": "use a path starting with /, e.g. /healthz",
  "positive-integer": "use a whole number of minutes, 1 or more",
  "needs-sidecar": "declare a sidecar, or remove the hub and projectLinks entries",
  "link-placeholder": `use only ${PROJECT_LINK_PLACEHOLDERS.map((p) => `{${p}}`).join(" and ")} as placeholders`,
});

/**
 * @typedef {object} ExtensionCommand
 * @property {string} name     Becomes `ndx <name>`.
 * @property {string} bin      Path inside the package, run with n-dx's own Node.
 * @property {string} summary  One line for `ndx --help`.
 */

/**
 * @typedef {object} ExtensionSidecar
 * @property {string} bin                 Path inside the package; the hub runs it with `PORT` set.
 * @property {string} [health]            Path the hub polls for a 200 before proxying.
 * @property {number} [idleStopMinutes]   Minutes without traffic before the hub stops it.
 */

/**
 * @typedef {object} ExtensionHubEntry
 * @property {string} label
 * @property {string} [description]
 */

/**
 * @typedef {object} ExtensionProjectLink
 * @property {string} label
 * @property {string} path  Under the extension's mount; may carry `{projectId}` and `{repoRoot}`.
 */

/**
 * The v1 `ndx.extension` block.
 *
 * @typedef {object} ExtensionManifest
 * @property {number} apiVersion
 * @property {string} name
 * @property {string} [displayName]
 * @property {string} ndxVersion
 * @property {ExtensionCommand[]} [commands]
 * @property {ExtensionSidecar} [sidecar]
 * @property {ExtensionHubEntry} [hub]
 * @property {ExtensionProjectLink[]} [projectLinks]
 * @property {string} [configSchema]  Path inside the package to a JSON Schema for the config section.
 */

/**
 * @typedef {object} ManifestProblem
 * @property {string} package  The package name, or its path when it has none.
 * @property {string} path     JSON path of the offending value, from `ndx.extension`.
 * @property {keyof typeof EXTENSION_MANIFEST_RULES} rule
 * @property {string} message  What is wrong, in a few words.
 * @property {string} fix
 */

/**
 * @typedef {object} ManifestValidation
 * @property {"valid" | "invalid" | "incompatible"} status
 * @property {string | undefined} name  The manifest's `name` when it is a string, even if invalid — for listing.
 * @property {ExtensionManifest | undefined} manifest  The block, set only when `status` is `valid`.
 * @property {ManifestProblem[]} problems
 */

/**
 * @typedef {object} ValidateOptions
 * @property {Iterable<string>} builtinCommands  Every built-in `ndx` command and tool delegation.
 * @property {string} [packageLabel]  How to name the package in problems; defaults to `package.json`'s `name`.
 */

/**
 * Validate the `ndx.extension` block of a parsed `package.json`.
 *
 * @param {unknown} packageJson
 * @param {ValidateOptions} options
 * @returns {ManifestValidation}
 */
export function validateExtensionManifest(packageJson, options) {
  if (!options || !options.builtinCommands) {
    throw new TypeError("validateExtensionManifest: options.builtinCommands is required");
  }
  const builtins = new Set(options.builtinCommands);
  const pkg = isObject(packageJson) ? packageJson : {};
  const label = options.packageLabel ?? (typeof pkg.name === "string" && pkg.name ? pkg.name : "<unnamed package>");
  const block = isObject(pkg.ndx) ? pkg.ndx.extension : undefined;

  /** @type {ManifestProblem[]} */
  const problems = [];
  /**
   * @param {string} path
   * @param {keyof typeof EXTENSION_MANIFEST_RULES} rule
   * @param {string} message
   */
  const report = (path, rule, message) =>
    problems.push({ package: label, path, rule, message, fix: EXTENSION_MANIFEST_RULES[rule] });

  if (!isObject(block)) {
    report("ndx.extension", "block-object", "is not an object");
    return { status: "invalid", name: undefined, manifest: undefined, problems };
  }
  const name = typeof block.name === "string" ? block.name : undefined;
  const at = (/** @type {string} */ key) => `ndx.extension.${key}`;

  // The contract version decides which rules apply, so it is settled first.
  if (block.apiVersion === undefined) {
    report(at("apiVersion"), "required", "is missing");
    return { status: "invalid", name, manifest: undefined, problems };
  }
  if (!Number.isInteger(block.apiVersion)) {
    report(at("apiVersion"), "api-version-integer", `is ${describe(block.apiVersion)}, not an integer`);
    return { status: "invalid", name, manifest: undefined, problems };
  }
  if (!SUPPORTED_EXTENSION_API_VERSIONS.includes(/** @type {number} */ (block.apiVersion))) {
    report(at("apiVersion"), "api-version-supported", `${block.apiVersion} is not a version this n-dx speaks`);
    return { status: "incompatible", name, manifest: undefined, problems };
  }

  // The package around the block: its name and version are shown for approval
  // and the version is part of what an approval binds to.
  if (typeof pkg.name === "string" && CONTROL_CHARACTER.test(pkg.name)) {
    report("name", "control-character", "contains a control character");
  }
  // parseVersion trims, so surrounding whitespace (a newline too) is refused here.
  if (typeof pkg.version !== "string" || pkg.version !== pkg.version.trim() || !parseVersion(pkg.version)) {
    report("version", "package-version", pkg.version === undefined ? "is missing" : `is ${describe(pkg.version)}, not a semver version`);
  }

  checkUnknown(block, EXTENSION_MANIFEST_FIELDS, "ndx.extension", report);

  if (block.name === undefined) report(at("name"), "required", "is missing");
  else checkName(block.name, at("name"), builtins, report);

  if (block.displayName !== undefined) checkString(block.displayName, at("displayName"), report);

  if (block.ndxVersion === undefined) report(at("ndxVersion"), "required", "is missing");
  else if (checkString(block.ndxVersion, at("ndxVersion"), report) && !isSemverRange(block.ndxVersion)) {
    report(at("ndxVersion"), "ndx-version-range", `"${block.ndxVersion}" is not a semver range`);
  }

  const commands = block.commands;
  if (commands !== undefined) {
    if (!Array.isArray(commands)) report(at("commands"), "array", `is ${describe(commands)}`);
    else {
      const seen = new Set();
      commands.forEach((command, i) => {
        const path = `${at("commands")}[${i}]`;
        if (!isObject(command)) { report(path, "object", `is ${describe(command)}`); return; }
        checkUnknown(command, COMMAND_FIELDS, path, report);
        if (command.name === undefined) report(`${path}.name`, "required", "is missing");
        else if (checkName(command.name, `${path}.name`, builtins, report)) {
          if (seen.has(command.name)) report(`${path}.name`, "command-duplicate", `"${command.name}" is declared twice`);
          seen.add(command.name);
        }
        checkPackagePath(command.bin, `${path}.bin`, report);
        if (command.summary === undefined) report(`${path}.summary`, "required", "is missing");
        else if (checkString(command.summary, `${path}.summary`, report)
          && command.summary.length > MAX_SUMMARY_LENGTH) {
          // A line break is a control character, refused by checkString.
          report(`${path}.summary`, "summary-length", `is ${command.summary.length} characters`);
        }
      });
    }
  }

  const sidecar = block.sidecar;
  if (sidecar !== undefined) {
    if (!isObject(sidecar)) report(at("sidecar"), "object", `is ${describe(sidecar)}`);
    else {
      checkUnknown(sidecar, SIDECAR_FIELDS, at("sidecar"), report);
      checkPackagePath(sidecar.bin, `${at("sidecar")}.bin`, report);
      if (sidecar.health !== undefined
        && checkString(sidecar.health, `${at("sidecar")}.health`, report)
        && !sidecar.health.startsWith("/")) {
        report(`${at("sidecar")}.health`, "url-path", `"${sidecar.health}" does not start with /`);
      }
      if (sidecar.idleStopMinutes !== undefined
        && !(Number.isInteger(sidecar.idleStopMinutes) && /** @type {number} */ (sidecar.idleStopMinutes) >= 1)) {
        report(`${at("sidecar")}.idleStopMinutes`, "positive-integer", `is ${describe(sidecar.idleStopMinutes)}`);
      }
    }
  }

  const hasCommands = Array.isArray(commands) && commands.length > 0;
  if (!hasCommands && sidecar === undefined) {
    report("ndx.extension", "nothing-declared", "declares no commands and no sidecar");
  }

  const hub = block.hub;
  if (hub !== undefined) {
    if (!isObject(hub)) report(at("hub"), "object", `is ${describe(hub)}`);
    else {
      checkUnknown(hub, HUB_FIELDS, at("hub"), report);
      if (hub.label === undefined) report(`${at("hub")}.label`, "required", "is missing");
      else checkString(hub.label, `${at("hub")}.label`, report);
      if (hub.description !== undefined) checkString(hub.description, `${at("hub")}.description`, report);
    }
    if (sidecar === undefined) report(at("hub"), "needs-sidecar", "links to a page no sidecar serves");
  }

  const links = block.projectLinks;
  if (links !== undefined) {
    if (!Array.isArray(links)) report(at("projectLinks"), "array", `is ${describe(links)}`);
    else {
      links.forEach((link, i) => {
        const path = `${at("projectLinks")}[${i}]`;
        if (!isObject(link)) { report(path, "object", `is ${describe(link)}`); return; }
        checkUnknown(link, PROJECT_LINK_FIELDS, path, report);
        if (link.label === undefined) report(`${path}.label`, "required", "is missing");
        else checkString(link.label, `${path}.label`, report);
        if (link.path === undefined) report(`${path}.path`, "required", "is missing");
        else if (checkString(link.path, `${path}.path`, report)) {
          if (!link.path.startsWith("/")) report(`${path}.path`, "url-path", `"${link.path}" does not start with /`);
          // `[^{}]`, not `[^}]`: a run of `{` would otherwise rescan to the end from each one.
          for (const [, placeholder] of link.path.matchAll(/\{([^{}]*)\}/g)) {
            if (!PROJECT_LINK_PLACEHOLDERS.includes(placeholder)) {
              report(`${path}.path`, "link-placeholder", `{${placeholder}} is not a placeholder the hub fills`);
            }
          }
        }
      });
      if (links.length > 0 && sidecar === undefined) {
        report(at("projectLinks"), "needs-sidecar", "links to pages no sidecar serves");
      }
    }
  }

  if (block.configSchema !== undefined) checkPackagePath(block.configSchema, at("configSchema"), report);

  if (problems.length > 0) return { status: "invalid", name, manifest: undefined, problems };
  return { status: "valid", name, manifest: /** @type {ExtensionManifest} */ (block), problems };
}

/**
 * One line per problem: package, JSON path, what is wrong, rule, fix.
 *
 * @param {ManifestProblem} problem
 * @returns {string}
 */
export function formatProblem(problem) {
  return escapeControlCharacters(`${problem.package}: ${problem.path} ${problem.message} [${problem.rule}] — fix: ${problem.fix}`);
}

/**
 * `text` with every control character written as a visible `\xNN` (or, for a
 * bidi control, `\uNNNN`) escape, so a value from a package can never move the
 * cursor, recolour the terminal, start a line of its own or reorder the line
 * it is on. Apply it to anything printed from a package.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeControlCharacters(text) {
  return text.replace(CONTROL_CHARACTERS, (c) => {
    const code = c.charCodeAt(0);
    return code > 0xff ? `\\u${code.toString(16)}` : `\\x${code.toString(16).padStart(2, "0")}`;
  });
}

/**
 * Whether `range` is a semver range in the npm grammar: `||`-separated sets of
 * comparators (`>=1.2.0`, `<2`, `^0.10`, `~1.2.3`, `1.x`, `*`) or hyphen ranges
 * (`1.2.0 - 1.4.0`). This checks the form only; whether the running n-dx is
 * inside the range is discovery's question.
 *
 * @param {string} range
 * @returns {boolean}
 */
export function isSemverRange(range) {
  const partial = String.raw`(?:[xX*]|0|[1-9]\d*)(?:\.(?:[xX*]|0|[1-9]\d*)){0,2}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
  const comparator = new RegExp(`^(?:<=|>=|<|>|=|\\^|~>?)?v?${partial}$`);
  const plain = new RegExp(`^v?${partial}$`);
  if (range.trim() === "") return false;
  return range.split("||").every((set) => {
    const parts = set.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    if (parts.length === 3 && parts[1] === "-") return plain.test(parts[0]) && plain.test(parts[2]);
    // npm also accepts a space between an operator and its version (">= 1.2.0").
    const joined = [];
    for (let i = 0; i < parts.length; i++) {
      if (/^(?:<=|>=|<|>|=|\^|~>?)$/.test(parts[i]) && i + 1 < parts.length) joined.push(parts[i] + parts[++i]);
      else joined.push(parts[i]);
    }
    return joined.every((c) => comparator.test(c));
  });
}

/**
 * Whether `version` is inside `range`, with npm's semantics: `^` and `~`,
 * x-ranges and partial versions, hyphen ranges, `||`. As in npm, a prerelease
 * version satisfies a comparator set only when one of the set's comparators
 * names a prerelease of the same major.minor.patch, so `0.11.0-rc.1` is not
 * inside `>=0.10.0`. A range {@link isSemverRange} rejects, or a version that
 * is not `major.minor.patch`, is never satisfied.
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function satisfiesSemverRange(version, range) {
  const v = parseVersion(version);
  if (!v || !isSemverRange(range)) return false;
  return range.split("||").some((set) => {
    const bounds = rangeSetBounds(set);
    if (!bounds.every(({ op, to }) => compareBound(v, op, to))) return false;
    if (v.pre.length === 0) return true;
    return bounds.some(({ to }) => to.pre.length > 0 && to.major === v.major && to.minor === v.minor && to.patch === v.patch);
  });
}

/**
 * Whether `value` is an extension name n-dx could accept: a lowercase slug of
 * the right length. Callers that build a path from a name check this first, so
 * a name from an invalid manifest can never reach the file system.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isExtensionNameSlug(value) {
  return typeof value === "string" && SLUG.test(value) && value.length <= MAX_NAME_LENGTH;
}

/**
 * @typedef {{major: number, minor: number, patch: number, pre: Array<string | number>}} SemverVersion
 * @typedef {{op: "<" | "<=" | ">" | ">=" | "=", to: SemverVersion}} SemverBound
 */

/**
 * @param {string} text
 * @returns {SemverVersion | null}
 */
function parseVersion(text) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!match) return null;
  const pre = match[4] ? match[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre };
}

/**
 * A partial version: `1`, `1.2`, `1.x`, `*`. Missing and wildcard parts are `null`.
 *
 * @param {string} text
 */
function parsePartial(text) {
  const [core, ...preParts] = text.replace(/^v/, "").split("+")[0].split("-");
  const nums = core.split(".").map((p) => (/^[xX*]$/.test(p) ? null : Number(p)));
  while (nums.length < 3) nums.push(null);
  const [major, minor, patch] = nums;
  const pre = preParts.length > 0 ? preParts.join("-").split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  // npm treats every part after a wildcard as a wildcard too: `1.x.3` is `1.x`.
  if (major === null) return { major: null, minor: null, patch: null, pre: [] };
  if (minor === null) return { major, minor: null, patch: null, pre: [] };
  return { major, minor, patch, pre: patch === null ? [] : pre };
}

/**
 * The bounds one `||`-separated comparator set puts on a version.
 *
 * @param {string} set
 * @returns {SemverBound[]}
 */
function rangeSetBounds(set) {
  const parts = set.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 3 && parts[1] === "-") {
    const lo = parsePartial(parts[0]);
    const hi = parsePartial(parts[2]);
    return [...comparatorBounds(">=", lo), ...comparatorBounds("<=", hi)];
  }
  /** @type {SemverBound[]} */
  const bounds = [];
  for (let i = 0; i < parts.length; i++) {
    let token = parts[i];
    if (/^(?:<=|>=|<|>|=|\^|~>?)$/.test(token) && i + 1 < parts.length) token += parts[++i];
    const [, op = "", rest] = /^(<=|>=|<|>|=|\^|~>?)?(.*)$/.exec(token) ?? [];
    bounds.push(...comparatorBounds(op, parsePartial(rest)));
  }
  return bounds;
}

/**
 * @param {string} op
 * @param {ReturnType<typeof parsePartial>} p
 * @returns {SemverBound[]}
 */
function comparatorBounds(op, p) {
  const { major, minor, patch, pre } = p;
  const at = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c, /** @type {Array<string | number>} */ r = []) =>
    ({ major: a, minor: b, patch: c, pre: r });
  if (major === null) return op === "<" || op === ">" ? [{ op: "<", to: at(0, 0, 0) }] : [];
  const lower = at(major, minor ?? 0, patch ?? 0, pre);
  // The first version past the partial: `1` → 2.0.0, `1.2` → 1.3.0, `1.2.3` → 1.2.3 itself.
  const next = minor === null ? at(major + 1, 0, 0) : patch === null ? at(major, minor + 1, 0) : null;
  switch (op) {
    case "^": {
      const upper = major > 0 || minor === null ? at(major + 1, 0, 0)
        : minor > 0 || patch === null ? at(0, minor + 1, 0)
          : at(0, 0, patch + 1);
      return [{ op: ">=", to: lower }, { op: "<", to: upper }];
    }
    case "~": case "~>":
      return [{ op: ">=", to: lower }, { op: "<", to: minor === null ? at(major + 1, 0, 0) : at(major, minor + 1, 0) }];
    case ">=": return [{ op: ">=", to: lower }];
    case ">": return next ? [{ op: ">=", to: next }] : [{ op: ">", to: lower }];
    case "<": return [{ op: "<", to: lower }];
    case "<=": return next ? [{ op: "<", to: next }] : [{ op: "<=", to: lower }];
    default: return next ? [{ op: ">=", to: lower }, { op: "<", to: next }] : [{ op: "=", to: lower }];
  }
}

/**
 * @param {SemverVersion} v
 * @param {SemverBound["op"]} op
 * @param {SemverVersion} to
 */
function compareBound(v, op, to) {
  const c = compareVersions(v, to);
  switch (op) {
    case "<": return c < 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    case ">=": return c >= 0;
    default: return c === 0;
  }
}

/**
 * Semver precedence: numbers, then a prerelease sorts before its release.
 *
 * @param {SemverVersion} a
 * @param {SemverVersion} b
 */
function compareVersions(a, b) {
  for (const key of /** @type {const} */ (["major", "minor", "patch"])) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}

/**
 * @typedef {(path: string, rule: keyof typeof EXTENSION_MANIFEST_RULES, message: string) => void} Report
 */

/**
 * @param {Record<string, unknown>} obj
 * @param {readonly string[]} known
 * @param {string} path
 * @param {Report} report
 */
function checkUnknown(obj, known, path, report) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) report(`${path}.${key}`, "unknown-field", "is not a field of the v1 manifest");
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Report} report
 * @returns {value is string}
 */
function checkString(value, path, report) {
  if (typeof value !== "string" || value.trim() === "") {
    report(path, "non-empty-string", `is ${describe(value)}`);
    return false;
  }
  if (CONTROL_CHARACTER.test(value)) {
    report(path, "control-character", `${describe(value)} contains a control character`);
    return false;
  }
  return true;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Set<string>} builtins
 * @param {Report} report
 * @returns {value is string}
 */
function checkName(value, path, builtins, report) {
  if (typeof value !== "string" || !SLUG.test(value) || value.length > MAX_NAME_LENGTH) {
    report(path, "name-slug", `${describe(value)} is not a lowercase slug`);
    return false;
  }
  if (RESERVED_EXTENSION_NAMES.includes(value)) {
    report(path, "name-reserved", `"${value}" is reserved`);
    return false;
  }
  if (builtins.has(value)) {
    report(path, "name-builtin", `"${value}" is a built-in ndx command`);
    return false;
  }
  return true;
}

/**
 * A path inside the package: relative, and never climbing out of it.
 *
 * @param {unknown} value
 * @param {string} path
 * @param {Report} report
 */
function checkPackagePath(value, path, report) {
  if (value === undefined) { report(path, "required", "is missing"); return; }
  if (!checkString(value, path, report)) return;
  const normalized = posix.normalize(value.replace(/\\/g, "/"));
  // `D:cli.js` is drive-relative: not absolute to either platform, yet Windows
  // resolves it against D:'s cwd, outside the package. The schema forbids it too.
  if (isAbsolute(value) || win32.isAbsolute(value) || DRIVE_PREFIX.test(value) || normalized === ".." || normalized.startsWith("../")) {
    report(path, "package-path", `"${value}" is not inside the package`);
  }
}
