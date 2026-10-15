/**
 * Python requirements as text: PEP 508 requirement strings (as they appear in
 * `pyproject.toml`, `setup.cfg`, `setup.py` and requirements files) and
 * pip requirements files with their `-r`/`-c` includes. Nothing is resolved
 * or installed; specifiers and markers are kept as written.
 *
 * @module lang-kit/python-requirements
 */

import { posix } from "node:path";
import type { BuildDependency } from "./build-model.js";

/** A declared dependency on a distribution. Shares the build model's fields: `group` is empty and `artifact` is the PEP 503 name. */
export interface PythonDependency extends BuildDependency {
  readonly group: "";
  /** The distribution name normalised per PEP 503 (`Foo_Bar.baz` → `foo-bar-baz`). */
  readonly artifact: string;
  /**
   * The version specifier as written (`>=1.2,<2`, Poetry's `^1.2`). Unresolved
   * when there is none, or when the dependency is a direct reference, a path
   * or a VCS checkout.
   */
  readonly version: BuildDependency["version"];
  /**
   * `main`; `optional:<extra>`; `group:<name>` (PEP 735 and Poetry groups,
   * Poetry's `dev-dependencies` as `group:dev`); `requirements` for a
   * requirements file; `constraint` for a constraints file.
   */
  readonly scope: string;
  /** The name as written. */
  readonly name: string;
  readonly extras?: readonly string[];
  /** The environment marker as written, without the `;`. */
  readonly marker?: string;
  /** A PEP 508 direct reference (`name @ url`), as written. */
  readonly url?: string;
  /** The file it came from, relative to the repository root, POSIX. */
  readonly file: string;
  /** 1-based line in that file. */
  readonly line: number;
}

/** A requirements-file line that names no distribution by PEP 508: an editable install, a URL, a path. Kept as written. */
export interface PythonReference {
  readonly text: string;
  readonly editable: boolean;
  /** From a `#egg=` fragment, PEP 503-normalised, when present. */
  readonly name?: string;
  readonly file: string;
  readonly line: number;
}

/** A PEP 508 requirement split into its parts, each as written. */
export interface ParsedRequirement {
  readonly name: string;
  readonly extras: readonly string[];
  /** The specifier, trimmed; "" when there is none. */
  readonly spec: string;
  readonly url?: string;
  readonly marker?: string;
}

/** Reads a file by its repository-relative path; `undefined` when it cannot be read. */
export type ReadRepoText = (path: string) => Promise<string | undefined>;

/** PEP 503: lowercase, and every run of `-`, `_` and `.` becomes one `-`. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/;
const SPEC = /^\(?\s*(?:(?:~=|===?|!=|<=?|>=?)\s*[A-Za-z0-9.*+!_-]+\s*,?\s*)*\)?$/;

/** Split a PEP 508 requirement string. Undefined when it is not one. */
export function parseRequirement(text: string): ParsedRequirement | undefined {
  const src = text.trim();
  const name = NAME.exec(src)?.[0];
  if (name === undefined) return undefined;
  let rest = src.slice(name.length).trimStart();
  let extras: string[] = [];
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return undefined;
    extras = rest
      .slice(1, end)
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");
    rest = rest.slice(end + 1).trimStart();
  }
  if (rest.startsWith("@")) {
    // The marker after a URL must be separated from it by whitespace.
    const after = rest.slice(1).trim();
    const m = /\s;/.exec(after);
    const url = (m ? after.slice(0, m.index) : after).trim();
    if (url === "") return undefined;
    const marker = m ? after.slice(m.index + 2).trim() : undefined;
    return { name, extras, spec: "", url, ...(marker && { marker }) };
  }
  const semi = rest.indexOf(";");
  const spec = (semi < 0 ? rest : rest.slice(0, semi)).trim();
  const marker = semi < 0 ? undefined : rest.slice(semi + 1).trim();
  if (!SPEC.test(spec)) return undefined;
  if (semi >= 0 && !marker) return undefined;
  return { name, extras, spec, ...(marker && { marker }) };
}

/** A dependency from a PEP 508 requirement, or undefined when the text is not one. */
export function requirementDependency(text: string, scope: string, file: string, line: number): PythonDependency | undefined {
  const r = parseRequirement(text);
  return r && dependencyOf(r, scope, file, line);
}

export function dependencyOf(r: ParsedRequirement, scope: string, file: string, line: number): PythonDependency {
  const version: BuildDependency["version"] = r.url
    ? { resolved: false, reason: "direct reference" }
    : r.spec === ""
      ? { resolved: false, reason: "no version specifier" }
      : { resolved: true, value: r.spec };
  return {
    group: "",
    artifact: normalizePythonName(r.name),
    version,
    scope,
    name: r.name,
    ...(r.extras.length > 0 && { extras: r.extras }),
    ...(r.marker !== undefined && { marker: r.marker }),
    ...(r.url !== undefined && { url: r.url }),
    file,
    line,
  };
}

// ── Requirements files ───────────────────────────────────────────────────

export interface RequirementsResult {
  readonly dependencies: PythonDependency[];
  readonly references: PythonReference[];
  /** Every file read, including followed includes, in reading order. */
  readonly files: string[];
  readonly notices: string[];
}

/**
 * Read requirements files and the `-r`/`-c` files they include. An include is
 * followed only when it names a file in `inventory` (repository-relative,
 * POSIX); a file is read once per call, and an include back into the chain
 * that reached it is reported as a cycle and not followed.
 */
export async function readRequirementsFiles(
  roots: readonly string[],
  inventory: ReadonlySet<string>,
  read: ReadRepoText,
): Promise<RequirementsResult> {
  const out: RequirementsResult = { dependencies: [], references: [], files: [], notices: [] };
  const visited = new Set<string>();

  async function visit(file: string, scope: string, chain: readonly string[]): Promise<void> {
    if (chain.includes(file)) {
      out.notices.push(`${chain[chain.length - 1]}: include cycle ${[...chain.slice(chain.indexOf(file)), file].join(" -> ")}; not followed`);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    const text = await read(file);
    if (text === undefined) {
      out.notices.push(`${file} is unreadable`);
      return;
    }
    out.files.push(file);
    for (const { text: entry, line } of logicalLines(text)) {
      const include = includeOf(entry);
      if (include) {
        const target = resolveInclude(file, include.path);
        if (target === undefined || !inventory.has(target)) {
          out.notices.push(`${file}:${line}: ${include.path} is not a file in the repository; not followed`);
          continue;
        }
        await visit(target, include.constraint || scope === "constraint" ? "constraint" : scope, [...chain, file]);
        continue;
      }
      const editable = editableOf(entry);
      if (editable !== undefined) {
        out.references.push(reference(editable, true, file, line));
        continue;
      }
      if (entry.startsWith("-")) continue; // index, find-links, hashes, --pre: not a requirement
      const requirement = stripRequirementOptions(entry);
      const parsed = looksLikeReference(requirement) ? undefined : parseRequirement(requirement);
      if (parsed) out.dependencies.push(dependencyOf(parsed, scope, file, line));
      else if (looksLikeReference(requirement)) out.references.push(reference(requirement, false, file, line));
      else out.notices.push(`${file}:${line}: not a requirement: ${requirement}`);
    }
  }

  for (const root of roots) await visit(root, "requirements", []);
  return out;
}

/** Lines with comments removed and `\` continuations joined, each with the line it starts on. Blank lines are dropped. */
function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let pending: { text: string; line: number } | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    // A comment starts at a `#` at the start of the line or after whitespace (`#egg=` in a URL is not one).
    const stripped = raw.replace(/(?:^|\s)#.*$/, "");
    const continued = stripped.endsWith("\\");
    const body = continued ? stripped.slice(0, -1) : stripped;
    pending = pending ? { text: `${pending.text} ${body.trim()}`, line: pending.line } : { text: body.trim(), line };
    if (continued) return;
    if (pending.text.trim() !== "") out.push({ text: pending.text.trim(), line: pending.line });
    pending = undefined;
  });
  if (pending && pending.text.trim() !== "") out.push({ text: pending.text.trim(), line: pending.line });
  return out;
}

function optionValue(entry: string, short: string, long: string): string | undefined {
  for (const flag of [long, short]) {
    if (entry === flag) return "";
    if (entry.startsWith(`${flag}=`)) return entry.slice(flag.length + 1).trim();
    if (entry.startsWith(`${flag} `) || entry.startsWith(`${flag}\t`)) return entry.slice(flag.length).trim();
  }
  // `-rfile`: pip accepts a short option glued to its value.
  if (entry.startsWith(short) && !entry.startsWith("--") && entry.length > short.length) return entry.slice(short.length).trim();
  return undefined;
}

function includeOf(entry: string): { path: string; constraint: boolean } | undefined {
  const r = optionValue(entry, "-r", "--requirement");
  if (r !== undefined) return { path: r, constraint: false };
  const c = optionValue(entry, "-c", "--constraint");
  return c === undefined ? undefined : { path: c, constraint: true };
}

function editableOf(entry: string): string | undefined {
  return optionValue(entry, "-e", "--editable");
}

/** The include's repository-relative path, or undefined when it leaves the repository or is a URL. */
function resolveInclude(from: string, target: string): string | undefined {
  if (target === "" || target.includes("://") || posix.isAbsolute(target)) return undefined;
  const joined = posix.normalize(posix.join(posix.dirname(from), target));
  return joined.startsWith("../") || joined === ".." ? undefined : joined;
}

/** Per-requirement options (`--hash=…`, `--config-settings …`) follow the requirement after whitespace. */
function stripRequirementOptions(entry: string): string {
  const m = /\s--?[A-Za-z]/.exec(entry);
  return (m ? entry.slice(0, m.index) : entry).trim();
}

const ARCHIVE = /\.(?:whl|zip|tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$/i;

/** A URL, a path or an archive rather than a PEP 508 requirement (`name @ url` is a requirement). */
function looksLikeReference(text: string): boolean {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\s*(?:\[[^\]]*\]\s*)?@/.test(text)) return false;
  return text.includes("://") || /^[.~/\\]/.test(text) || text.includes("/") || ARCHIVE.test(text.split(/[\s;]/)[0]);
}

function reference(text: string, editable: boolean, file: string, line: number): PythonReference {
  const egg = /#(?:.*&)?egg=([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(text)?.[1];
  return { text, editable, ...(egg !== undefined && { name: normalizePythonName(egg) }), file, line };
}
