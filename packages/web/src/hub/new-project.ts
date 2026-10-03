/**
 * Creating a project from the hub: where the folder goes, and whether it can.
 *
 * The hub's home page can start a project that does not exist yet — a folder
 * is created, registered, and its setup wizard opened. The part that needs
 * care is not the `mkdir`; it is telling the operator *exactly* which absolute
 * path they are about to create before they create it. A chooser that guesses
 * a parent directory silently is one that scatters half-initialized folders
 * across a machine, and the operator finds out later.
 *
 * So the planning is pure and separate from the act: {@link planNewProject}
 * answers "this is the path, and here is why it would or would not work" for
 * every keystroke the form sends, and the route performs only a plan that
 * already said `ok`.
 *
 * The id derivation mirrors `slugifyProjectId` / `deriveProjectId` in
 * `packages/core/web.js`, deliberately duplicated rather than imported: core
 * is the orchestration tier and the hub, two tiers below, must not import from
 * it. A project created here must land on the same id `ndx start` would later
 * derive for the same folder, or registering it from the CLI would make a
 * second entry for one directory — so keep the two in step.
 *
 * @module web/hub/new-project
 */

import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";

/** What the form asks for. Both halves arrive as typed, un-trimmed strings. */
export interface NewProjectInput {
  /** Directory the new folder goes in. */
  parent: string;
  /** The new folder's name — one path segment, not a path. */
  name: string;
}

/** The answer to "what would this create, and can it?". */
export interface NewProjectPlan {
  /** Resolved absolute parent directory. */
  parent: string;
  /** The folder name, trimmed. */
  name: string;
  /**
   * The absolute path that would be created. Always present — a plan that
   * cannot proceed still shows the path it was asked about, because that is
   * usually what tells the operator what they got wrong.
   */
  path: string;
  /** Whether {@link path} can be created (or adopted) as a project. */
  ok: boolean;
  /** Why not, in one sentence, when `ok` is false. */
  problem: string | null;
  /** A remark worth showing even when `ok` — e.g. an existing empty folder. */
  note: string | null;
  /** Whether the target already exists on disk. */
  exists: boolean;
}

/** Characters and shapes a single path segment must not have. */
const SEPARATORS = /[/\\]/;
// Windows refuses these as file names whatever the extension, and a folder
// created under one on another OS would be unopenable there. The hub is the
// one surface that creates directories for people, so it refuses them too.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** A name carrying a control character (or DEL) would make an unopenable folder. */
function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Windows strips these silently from the end of a name, giving a folder nobody asked for. */
const TRAILING_DOT_OR_SPACE = /[. ]$/;
const MAX_NAME_LENGTH = 100;

/** Validate the folder name alone. Returns the problem, or null when it is fine. */
export function validateProjectName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a folder name.";
  if (SEPARATORS.test(name)) return "The name is one folder, not a path — remove the slashes.";
  if (name === "." || name === "..") return `"${name}" is not a folder name.`;
  if (name.includes(":")) return "A folder name cannot contain a colon.";
  if (hasControlCharacter(name)) return "The name contains a control character.";
  if (TRAILING_DOT_OR_SPACE.test(name)) return "A folder name cannot end with a dot or a space.";
  if (RESERVED_NAMES.test(name)) return `"${name}" is a reserved device name on Windows.`;
  if (name.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  return null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether a directory holds nothing. An unreadable directory counts as non-empty. */
function isEmptyDirectory(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

/**
 * Work out what creating `name` inside `parent` would do.
 *
 * Pure apart from reading the filesystem, and never writes: the route calls it
 * for the live preview on every keystroke and again before creating anything,
 * so the path the operator approved is the path that gets made.
 */
export function planNewProject(input: NewProjectInput): NewProjectPlan {
  const name = input.name.trim();
  const parentRaw = input.parent.trim();
  const parent = parentRaw ? resolve(parentRaw) : "";
  // Shown even for an invalid name, so the preview line never goes blank
  // while someone is typing.
  const path = parent && name && !SEPARATORS.test(name) ? resolve(parent, name) : parent;

  const base = { parent, name, path, exists: pathExists(path) && path !== parent, note: null };

  if (!parentRaw) {
    return { ...base, ok: false, problem: "Choose the folder the project goes in." };
  }
  if (!isAbsolute(parent)) {
    return { ...base, ok: false, problem: "The parent folder must be an absolute path." };
  }
  if (!pathExists(parent)) {
    return { ...base, ok: false, problem: `That folder does not exist: ${parent}` };
  }
  if (!isDirectory(parent)) {
    return { ...base, ok: false, problem: `That is a file, not a folder: ${parent}` };
  }

  const nameProblem = validateProjectName(input.name);
  if (nameProblem) return { ...base, ok: false, problem: nameProblem };

  if (base.exists) {
    if (!isDirectory(path)) {
      return { ...base, ok: false, problem: "A file of that name is already there." };
    }
    if (!isEmptyDirectory(path)) {
      return {
        ...base,
        ok: false,
        problem: "That folder already exists and is not empty. Register it with `ndx start` instead.",
      };
    }
    return { ...base, ok: true, problem: null, note: "That folder already exists and is empty — it will be used as it is." };
  }

  return { ...base, ok: true, problem: null };
}

/** URL- and path-safe project id. Twin of `slugifyProjectId` in packages/core/web.js. */
export function slugifyProjectId(name: string): string {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug || "project";
}

/**
 * The id a new project gets: the slug of its folder name, with a 6-hex hash of
 * its path appended only when that slug already belongs to a different folder.
 *
 * Twin of `deriveProjectId` in packages/core/web.js, which hashes the origin
 * URL when there is one. A folder that has just been created has no remote, so
 * the path is the only thing to hash — and it is what core falls back to too.
 */
export function deriveProjectId(
  repoRoot: string,
  takenIds: ReadonlyMap<string, string> | Map<string, string>,
): string {
  const slug = slugifyProjectId(basename(repoRoot));
  const holder = takenIds.get(slug);
  if (holder === undefined || holder === repoRoot) return slug;
  return `${slug}-${createHash("sha1").update(repoRoot).digest("hex").slice(0, 6)}`;
}

/**
 * Where to offer to put a new project: the directory that already holds the
 * most registered projects, falling back to the user's home.
 *
 * Someone keeps their repositories together; the hub already knows where,
 * because every registered project names its root. Offering that is the
 * difference between a prefilled field and one the operator has to go and
 * look up — and the field stays editable either way.
 */
export function defaultParentDir(repoRoots: readonly string[], home: string): string {
  const counts = new Map<string, number>();
  for (const root of repoRoots) {
    if (!root || !isAbsolute(root)) continue;
    const parent = dirname(resolve(root));
    if (parent === resolve(root)) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  // Ties go to the alphabetically first parent, so the suggestion is stable
  // between reloads rather than following Map insertion order.
  for (const [parent, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best ?? resolve(home);
}

/**
 * Leave behind the same marker files `ndx start` writes when it registers a
 * directory with the hub.
 *
 * A folder created here has never run `ndx start`, so without this it is the
 * one registered project with no markers — and `ndx start stop`, `ndx start
 * status` and `ndx refresh --live-server` all read them. The pid is the hub's,
 * tagged `via: "hub"`, which is how every reader of that file knows not to
 * kill the hub for one project; the port is the hub's too, because that is the
 * address the project answers on from outside.
 *
 * Twin of `writeHubMarkerFiles` in packages/core/web.js — core writes it after
 * `ndx start` registers, the hub writes it for the projects it creates itself.
 * Keep the shape identical: core parses what this writes.
 *
 * Best-effort. The project is registered and serving either way, and a folder
 * on a read-only mount should not fail the creation over a convenience file.
 */
export function writeHubMarkerFiles(
  dir: string,
  marker: { hubPid: number; hubPort: number; projectId: string },
): void {
  // Asked for, not spelled out: where these two files live is the layout's
  // answer, the same one `packages/web/src/server/paths.ts` gives the project
  // server. (`registry.ts` reaches the foundation tier directly too — see
  // packages/web/CLAUDE.md on the hub zone's import surface.)
  const layout = resolveLayout(dir);
  try {
    writeFileSync(
      layout.webPidFile,
      JSON.stringify(
        { pid: marker.hubPid, port: marker.hubPort, startedAt: new Date().toISOString(), via: "hub", projectId: marker.projectId },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    writeFileSync(layout.webPortFile, `${marker.hubPort}\n`, "utf-8");
  } catch {
    // Non-fatal — see above.
  }
}
