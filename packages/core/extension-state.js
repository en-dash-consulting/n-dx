/**
 * What the user has decided about each installed extension, and the state that
 * follows from it: enabled, disabled, unapproved, incompatible, invalid or
 * conflict.
 *
 * Decisions live in `<ndx home>/extensions.json`, beside discovery's cache
 * (docs/architecture/extensions.md, "Trust, versioning and config"):
 *
 * - `approvals` — `{ [packageName]: Approval }` for user, global and dev copies.
 * - `projectApprovals` — `{ [projectDir]: { [packageName]: Approval } }`. A
 *   project-source extension is approved per project path, so cloning a repo
 *   never brings an approval with it.
 * - `disabled` — `{ [extensionName]: { disabledAt } }`. Disabling keeps the
 *   approval, so enabling again does not ask again.
 *
 * An approval holds a hash of the `ndx.extension` block and the package
 * version; a change to either leaves the extension unapproved until it is
 * approved again.
 *
 * Whatever else is in the file (discovery's cache) is kept as it was read.
 *
 * @module n-dx/extension-state
 */

import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { EXTENSIONS_CACHE_FILE } from "./extension-discovery.js";
import { satisfiesSemverRange } from "./extension-manifest.js";

/**
 * Every state an installed extension can be in. Only `enabled` runs.
 * `invalid` and `conflict` come from discovery: a manifest that breaks the
 * contract, or two packages claiming one name.
 */
export const EXTENSION_STATES = Object.freeze(["enabled", "disabled", "unapproved", "incompatible", "invalid", "conflict"]);

/**
 * @typedef {"enabled" | "disabled" | "unapproved" | "incompatible" | "invalid" | "conflict"} ExtensionStateName
 */

/**
 * @typedef {object} Approval
 * @property {string | undefined} version
 * @property {string} manifestHash
 * @property {string} source
 * @property {string} approvedAt
 */

/**
 * The parsed `extensions.json`; any other key is preserved untouched.
 *
 * @typedef {Record<string, any>} ExtensionsFile
 */

/**
 * @typedef {object} ExtensionState
 * @property {ExtensionStateName} state
 * @property {string} reason  Why it is not enabled; empty when it is.
 */

/**
 * @typedef {Pick<typeof nodeFs, "readFileSync" | "writeFileSync" | "renameSync" | "mkdirSync">} StateFs
 */

/**
 * Hash of an `ndx.extension` block, independent of key order.
 *
 * @param {unknown} block
 * @returns {string}
 */
export function manifestHash(block) {
  return createHash("sha256").update(canonicalJson(block)).digest("hex");
}

/**
 * Read `<home>/extensions.json`. A missing file is empty; one that is not a
 * JSON object throws, naming the file and the fix, because writing over it
 * would destroy the user's approvals.
 *
 * @param {string} home
 * @param {StateFs} [fs]
 * @returns {ExtensionsFile}
 */
export function readExtensionsFile(home, fs = nodeFs) {
  const path = join(home, EXTENSIONS_CACHE_FILE);
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return {};
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${/** @type {Error} */ (error).message}); fix or delete it — deleting it forgets every extension approval`);
  }
  if (!isObject(value)) throw new Error(`${path} is not a JSON object; fix or delete it — deleting it forgets every extension approval`);
  return value;
}

/**
 * Read the file, let `mutate` change it, and write it back through a temporary
 * file and a rename. The read is immediately before the write, so a discovery
 * cache written by another process a moment earlier is kept.
 *
 * @param {string} home
 * @param {(file: ExtensionsFile) => void} mutate
 * @param {StateFs} [fs]
 */
export function updateExtensionsFile(home, mutate, fs = nodeFs) {
  const file = readExtensionsFile(home, fs);
  mutate(file);
  const path = join(home, EXTENSIONS_CACHE_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  fs.renameSync(tmp, path);
}

/**
 * The approval that applies to `ext`, if any, whether or not it still matches.
 *
 * @param {ExtensionsFile} file
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 * @param {string | undefined} projectDir
 * @returns {Approval | undefined}
 */
export function approvalFor(file, ext, projectDir) {
  const table = ext.source === "project"
    ? (projectDir && isObject(file.projectApprovals) ? file.projectApprovals[resolve(projectDir)] : undefined)
    : file.approvals;
  const record = isObject(table) ? table[ext.packageName] : undefined;
  return isObject(record) ? /** @type {Approval} */ (record) : undefined;
}

/**
 * Record the user's approval of `ext` exactly as it is installed now.
 *
 * @param {ExtensionsFile} file
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 * @param {{projectDir?: string, now?: Date}} [options]
 */
export function recordApproval(file, ext, { projectDir, now = new Date() } = {}) {
  if (!ext.manifest) throw new TypeError("recordApproval: only a valid manifest can be approved");
  /** @type {Approval} */
  const record = { version: ext.version, manifestHash: manifestHash(ext.manifest), source: ext.source, approvedAt: now.toISOString() };
  if (ext.source === "project") {
    if (!projectDir) throw new TypeError("recordApproval: a project-source extension needs projectDir");
    const projects = isObject(file.projectApprovals) ? file.projectApprovals : (file.projectApprovals = {});
    const dir = resolve(projectDir);
    projects[dir] = { ...(isObject(projects[dir]) ? projects[dir] : {}), [ext.packageName]: record };
  } else {
    file.approvals = { ...(isObject(file.approvals) ? file.approvals : {}), [ext.packageName]: record };
  }
}

/**
 * Forget the user-level approval of a package (`ndx extensions remove`).
 * Project approvals belong to their projects and are left alone.
 *
 * @param {ExtensionsFile} file
 * @param {string} packageName
 */
export function forgetApproval(file, packageName) {
  if (isObject(file.approvals)) delete file.approvals[packageName];
}

/**
 * @param {ExtensionsFile} file
 * @param {string} name  The extension name (or package name when the manifest has none).
 * @param {boolean} disabled
 * @param {Date} [now]
 */
export function setDisabled(file, name, disabled, now = new Date()) {
  const table = isObject(file.disabled) ? file.disabled : (file.disabled = {});
  if (disabled) table[name] = { disabledAt: now.toISOString() };
  else delete table[name];
}

/**
 * The key `disabled` uses for `ext`.
 *
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 */
export function stateKey(ext) {
  return ext.name ?? ext.packageName;
}

/**
 * What the user is approving: package, version, source, commands and sidecar.
 * Shown by `ndx extensions enable` and by an extension's first `ndx <name>`.
 *
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 * @param {string} reason  Why it is unapproved, from {@link extensionState}.
 * @returns {string[]}
 */
export function describeForApproval(ext, reason) {
  const m = ext.manifest;
  const lines = [
    `'${stateKey(ext)}' is ${reason}.`,
    `  package  ${ext.packageName}@${ext.version ?? "?"}`,
    `  source   ${ext.source} (${ext.dir})`,
  ];
  for (const c of m?.commands ?? []) lines.push(`  command  ndx ${c.name} → ${c.bin}`);
  if (m?.sidecar) lines.push(`  sidecar  ${m.sidecar.bin}, served at /x/${m.name}/ by the hub`);
  return lines;
}

/**
 * Decide an extension's state. A problem with the package itself (invalid,
 * conflict, incompatible) outranks the user's decisions; disabling outranks
 * the lack of an approval.
 *
 * @param {import("./extension-discovery.js").DiscoveredExtension} ext
 * @param {{file: ExtensionsFile, ndxVersion: string, projectDir?: string}} context
 * @returns {ExtensionState}
 */
export function extensionState(ext, { file, ndxVersion, projectDir }) {
  if (ext.status === "invalid") {
    const [first] = ext.problems;
    const more = ext.problems.length > 1 ? ` (+${ext.problems.length - 1} more)` : "";
    return { state: "invalid", reason: first ? `${first.path} ${first.message}${more}` : "invalid manifest" };
  }
  if (ext.status === "conflict") {
    const parts = ext.conflicts.map((c) => `${c.names.map((n) => `"${n}"`).join(", ")} also claimed by ${c.packageName} (${c.source})`);
    return { state: "conflict", reason: parts.join("; ") };
  }
  if (ext.status === "incompatible") {
    const [first] = ext.problems;
    return { state: "incompatible", reason: first ? `${first.path} ${first.message}` : "unsupported apiVersion" };
  }
  const range = ext.manifest?.ndxVersion;
  if (range !== undefined && !satisfiesSemverRange(ndxVersion, range)) {
    return { state: "incompatible", reason: `needs n-dx ${range}; this is ${ndxVersion}` };
  }
  if (isObject(file.disabled) && file.disabled[stateKey(ext)]) {
    return { state: "disabled", reason: "disabled with 'ndx extensions disable'" };
  }
  const approval = approvalFor(file, ext, projectDir);
  if (!approval) {
    return { state: "unapproved", reason: ext.source === "project" ? "not approved for this project" : "not approved yet" };
  }
  if (approval.version !== ext.version) {
    return { state: "unapproved", reason: `version changed since approval (${approval.version ?? "none"} → ${ext.version ?? "none"})` };
  }
  if (approval.manifestHash !== manifestHash(ext.manifest)) {
    return { state: "unapproved", reason: "manifest changed since approval" };
  }
  return { state: "enabled", reason: "" };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * JSON with object keys sorted at every level.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
