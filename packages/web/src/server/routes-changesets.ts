/**
 * Pending changesets route — read-only.
 *
 * GET /api/changesets — every `.changeset/*.md` in the addressed workspace
 *   (the README the changesets CLI writes aside), each with the packages it
 *   bumps and how, and its summary text. `{ changesets: [] }` when the
 *   directory is missing: a project that does not use changesets has none
 *   pending.
 *
 * A plain directory read: the hub snapshot needs the bump types, and asking
 * the changesets CLI would mean a child process per request. A file whose
 * frontmatter does not parse is still listed, with `error` set, so a
 * malformed changeset is seen rather than silently skipped.
 *
 * @module web/server/routes-changesets
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";

export const CHANGESETS_PATH = "/api/changesets";

/** The changesets directory, relative to the project root. Not an n-dx directory. */
const CHANGESET_DIR = ".changeset";

export type ChangesetBump = "major" | "minor" | "patch" | "none";

export interface PendingChangeset {
  /** File name inside `.changeset/`. */
  file: string;
  /** Every package the changeset bumps, in file order. */
  packages: Array<{ name: string; bump: ChangesetBump }>;
  /** The text after the frontmatter, trimmed. */
  summary: string;
  /** Why the frontmatter could not be read; absent when it was. */
  error?: string;
}

const BUMPS: ReadonlySet<string> = new Set(["major", "minor", "patch", "none"]);

function unquote(text: string): string {
  const t = text.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

/** One changeset file's packages, bumps and summary. Pure. */
export function parseChangeset(file: string, text: string): PendingChangeset {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!match) return { file, packages: [], summary: text.trim(), error: "No frontmatter block." };
  const packages: PendingChangeset["packages"] = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const colon = line.lastIndexOf(":");
    const bump = colon < 0 ? "" : unquote(line.slice(colon + 1));
    if (colon < 0 || !BUMPS.has(bump)) {
      return { file, packages, summary: match[2].trim(), error: `Unreadable frontmatter line: ${line.trim()}` };
    }
    packages.push({ name: unquote(line.slice(0, colon)), bump: bump as ChangesetBump });
  }
  return { file, packages, summary: match[2].trim() };
}

/** Every pending changeset under `projectDir`, sorted by file name. */
export function readPendingChangesets(projectDir: string): PendingChangeset[] {
  const dir = join(projectDir, CHANGESET_DIR);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }
  return files.sort().map((file) => {
    try {
      return parseChangeset(file, readFileSync(join(dir, file), "utf-8"));
    } catch (err) {
      return { file, packages: [], summary: "", error: `Unreadable: ${(err as Error).message}` };
    }
  });
}

export function handleChangesetsRoute(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): boolean {
  const path = (req.url || "/").split("?")[0];
  if (path !== CHANGESETS_PATH || (req.method || "GET") !== "GET") return false;
  jsonResponse(res, 200, { changesets: readPendingChangesets(ctx.projectDir) });
  return true;
}
